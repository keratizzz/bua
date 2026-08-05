const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const db = mysql.createConnection({
    host: '127.0.0.1',
    user: 'root',
    password: '31102015',
    database: 'restaurant',
    port: 3306
});

db.connect(err => {
    if (err) {
        console.error('เกิดข้อผิดพลาดในการเชื่อมต่อฐานข้อมูล:', err);
        return;
    }
    console.log('เชื่อมต่อฐานข้อมูล MySQL สำเร็จแล้ว!');
});

// ==========================================
// 🌐 PAGE ROUTES (เส้นทางสำหรับเปิดหน้าเว็บ)
// ==========================================

// หน้าห้องครัวสำหรับ มือถือ/คอมพิวเตอร์ รุ่นใหม่
app.get('/kitchen', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'kitchen.html'));
});

// หน้าห้องครัวสำหรับ Samsung Tab E (แท็บเล็ตรุ่นเก่า)
app.get('/kitchen-legacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'kitchen-legacy.html'));
});

// ==========================================
// 🔌 SOCKET.IO REAL-TIME SYSTEM
// ==========================================
io.on('connection', (socket) => {
    socket.on('get_bill_details', (tableNum) => {
        const sql = "SELECT * FROM orders WHERE table_number = ? AND status IN ('confirmed', 'served')";
        db.query(sql, [tableNum], (err, results) => {
            if (err) return;
            socket.emit('show_bill', { table: tableNum, items: results });
        });
    });

    socket.on('checkout_table', ({ tableNum, paymentMethod }) => {
        const billId = 'BILL-' + Date.now();
        const sql = "UPDATE orders SET status = 'paid', payment_method = ?, bill_id = ?, checkout_time = NOW() WHERE table_number = ? AND status IN ('confirmed', 'served')";
        db.query(sql, [paymentMethod, billId, tableNum], (err, result) => {
            if (err) return;
            io.emit('clear_table_ui', tableNum);
            notifyActiveTables();
        });
    });

    socket.on('request_active_tables', () => {
        notifyActiveTables();
    });
});

function notifyActiveTables() {
    const sql = "SELECT DISTINCT table_number FROM orders WHERE status IN ('confirmed', 'served')";
    db.query(sql, (err, results) => {
        if (err) return;
        const tables = results.map(r => r.table_number);
        io.emit('update_active_tables', tables);
    });
}

// ==========================================
// 🚀 API ENDPOINTS (ระบบจัดการออเดอร์)
// ==========================================

app.post('/api/orders/batch', (req, res) => {
    const { table_number, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ message: 'ตะกร้าว่างเปล่า' });

    const values = items.map(item => [
        table_number, item.menu_name, item.price, item.qty || 1, item.addons || '', 'pending'
    ]);

    const sql = "INSERT INTO orders (table_number, menu_name, price, qty, addons, status) VALUES ?";
    db.query(sql, [values], (err, result) => {
        if (err) return res.status(500).json(err);
        io.emit('new_order_submitted');
        res.json({ message: 'สั่งอาหารสำเร็จ', inserted_count: result.affectedRows });
    });
});

app.get('/api/orders/pending', (req, res) => {
    const sql = `
        SELECT orders.*, menus.category 
        FROM orders 
        LEFT JOIN menus ON orders.menu_name = menus.name 
        WHERE orders.status = 'pending' 
        ORDER BY orders.id ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/orders/drinks', (req, res) => {
    const sql = `
        SELECT orders.*, menus.category 
        FROM orders 
        JOIN menus ON orders.menu_name = menus.name 
        WHERE orders.status = 'confirmed' AND menus.category = 'เครื่องดื่ม'
        ORDER BY orders.id ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/orders/confirm-table/:tableNum', (req, res) => {
    const tableNum = req.params.tableNum;
    const sql = "UPDATE orders SET status = 'confirmed' WHERE table_number = ? AND status = 'pending'";
    
    db.query(sql, [tableNum], (err) => {
        if (err) return res.status(500).json(err);
        io.emit('update_kitchen');
        io.emit('new_order_submitted');
        notifyActiveTables();
        res.json({ message: 'ยืนยันรับออเดอร์เรียบร้อย' });
    });
});

app.put('/api/orders/reject/:id', (req, res) => {
    const sql = "UPDATE orders SET status = 'cancelled' WHERE id = ?";
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        io.emit('new_order_submitted');
        res.json({ message: 'ยกเลิกออเดอร์เรียบร้อย' });
    });
});

app.delete('/api/orders/item/:id', (req, res) => {
    const sql = "DELETE FROM orders WHERE id = ?";
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        notifyActiveTables(); 
        res.json({ message: 'ลบรายการออกจากบิลเรียบร้อย' });
    });
});

app.post('/api/orders/custom', (req, res) => {
    const { table_number, menu_name, price, qty } = req.body;
    const checkSql = "SELECT id, qty FROM orders WHERE table_number = ? AND menu_name = ? AND status IN ('confirmed', 'served') LIMIT 1";
    
    db.query(checkSql, [table_number, menu_name], (err, results) => {
        if (err) return res.status(500).json(err);
        
        if (results.length > 0) {
            const existingId = results[0].id;
            const newQty = parseInt(results[0].qty) + parseInt(qty);
            const updateSql = "UPDATE orders SET qty = ? WHERE id = ?";
            db.query(updateSql, [newQty, existingId], (updateErr) => {
                if (updateErr) return res.status(500).json(updateErr);
                notifyActiveTables();
                res.json({ message: 'รวมจำนวนรายการสำเร็จ' });
            });
        } else {
            const insertSql = "INSERT INTO orders (table_number, menu_name, price, qty, status) VALUES (?, ?, ?, ?, 'served')";
            db.query(insertSql, [table_number, menu_name, price, qty], (insertErr) => {
                if (insertErr) return res.status(500).json(insertErr);
                notifyActiveTables();
                res.json({ message: 'เพิ่มรายการใหม่สำเร็จ' });
            });
        }
    });
});

app.get('/api/orders', (req, res) => {
    const sql = `
        SELECT orders.* 
        FROM orders 
        LEFT JOIN menus ON orders.menu_name = menus.name 
        WHERE orders.status = 'confirmed' 
          AND (menus.category IS NULL OR menus.category != 'เครื่องดื่ม')
        ORDER BY orders.id ASC
    `;
    db.query(sql, (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/orders/serve/:id', (req, res) => {
    const sql = "UPDATE orders SET status = 'served' WHERE id = ?";
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        io.emit('new_order_submitted');
        notifyActiveTables();
        res.json({ message: 'เสิร์ฟแล้ว' });
    });
});

app.put('/api/orders/serve-table/:tableNum', (req, res) => {
    const sql = `
        UPDATE orders 
        LEFT JOIN menus ON orders.menu_name = menus.name 
        SET orders.status = 'served' 
        WHERE orders.table_number = ? AND orders.status = 'confirmed' 
          AND (menus.category IS NULL OR menus.category != 'เครื่องดื่ม')
    `;
    db.query(sql, [req.params.tableNum], (err, result) => {
        if (err) return res.status(500).json(err);
        notifyActiveTables();
        res.json({ message: 'เสิร์ฟอาหารทั้งโต๊ะแล้ว' });
    });
});

// ==========================================
// 📜 HISTORY API ENDPOINTS (แก้ไขให้รองรับ MariaDB 10.4)
// ==========================================

// 1. ดึงตารางประวัติบิลทั้งหมดที่จ่ายเงินแล้ว (จัดกลุ่มตาม bill_id)
app.get('/api/orders/history', (req, res) => {
    const sql = `
        SELECT 
            bill_id AS id,
            table_number,
            SUM(price * qty) AS total,
            payment_method,
            MAX(checkout_time) AS created_at,
            SUM(qty) AS item_count
        FROM orders 
        WHERE status = 'paid' AND bill_id IS NOT NULL
        GROUP BY bill_id, table_number, payment_method
        ORDER BY MAX(checkout_time) DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching history:", err);
            return res.status(500).json(err);
        }
        res.json(results);
    });
});

// 2. ดึงรายการอาหารของบิลเก่าตาม ID หรือ Bill ID (สำหรับใช้ปริ้นใบเสร็จย้อนหลัง)
app.get('/api/orders/history/:id/items', (req, res) => {
    const historyId = req.params.id;
    const sql = "SELECT menu_name, price, qty FROM orders WHERE bill_id = ? OR id = ?";
    db.query(sql, [historyId, historyId], (err, results) => {
        if (err) {
            console.error("Error fetching history items:", err);
            return res.status(500).json(err);
        }
        res.json(results);
    });
});

// ==========================================
// 🍔 API ENDPOINTS (ระบบจัดการเมนูอาหาร Admin)
// ==========================================

// [ดึงข้อมูลลำดับหมวดหมู่]
app.get('/api/category-order', (req, res) => {
    const sql = "SELECT setting_value FROM system_settings WHERE setting_key = 'category_order'";
    db.query(sql, (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }
        
        let orderList = [];
        if (results.length > 0 && results[0].setting_value) {
            try {
                orderList = JSON.parse(results[0].setting_value);
            } catch (e) {
                orderList = [];
            }
        }
        res.json({ order_list: orderList });
    });
});

// [บันทึกลำดับหมวดหมู่]
app.post('/api/category-order', (req, res) => {
    const orderList = req.body.order_list || [];
    const jsonString = JSON.stringify(orderList);
    
    const sql = "UPDATE system_settings SET setting_value = ? WHERE setting_key = 'category_order'";
    db.query(sql, [jsonString], (err, results) => {
        if (err) {
            console.error(err);
            return res.status(500).json({ error: "Database error" });
        }
        res.json({ success: true, message: "บันทึกสำเร็จ" });
    });
});

// [ดึงข้อมูล]
app.get('/api/menus', (req, res) => {
    const sql = "SELECT * FROM menus ORDER BY category, id ASC";
    db.query(sql, (err, results) => {
        if (err) {
            console.error("ดึงข้อมูลเมนูไม่ได้:", err);
            return res.status(500).json(err);
        }
        res.json(results);
    });
});

// [เพิ่มเมนูใหม่] - *เพิ่ม spiciness ที่นี่*
app.post('/api/menus', (req, res) => {
    const { name, price, category, image_url, meats, addons, spiciness } = req.body;
    const sql = "INSERT INTO menus (name, price, category, image_url, meats, addons, spiciness) VALUES (?, ?, ?, ?, ?, ?, ?)";
    db.query(sql, [name, price, category, image_url, meats, addons, spiciness], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'เพิ่มเมนูสำเร็จ', insertId: result.insertId });
    });
});

// [แก้ไขเมนู] - *เพิ่ม spiciness ที่นี่*
app.put('/api/menus/:id', (req, res) => {
    const { name, price, category, image_url, meats, addons, spiciness } = req.body;
    const sql = "UPDATE menus SET name=?, price=?, category=?, image_url=?, meats=?, addons=?, spiciness=? WHERE id=?";
    db.query(sql, [name, price, category, image_url, meats, addons, spiciness, req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'แก้ไขเมนูสำเร็จ' });
    });
});

// [ลบเมนู]
app.delete('/api/menus/:id', (req, res) => {
    const sql = "DELETE FROM menus WHERE id=?";
    db.query(sql, [req.params.id], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'ลบเมนูสำเร็จ' });
    });
});

// ==========================================
// 📜 HISTORY & SUMMARY API ENDPOINTS
// ==========================================

// หน้าเว็บดูประวัติและสรุปยอด
app.get('/history', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

// 1. ดึงประวัติบิลทั้งหมด (รวมรายการในบิลเดียวกันเป็น 1 ช่อง)
app.get('/api/orders/history-grouped', (req, res) => {
    const sql = `
        SELECT 
            bill_id,
            table_number,
            payment_method,
            MAX(checkout_time) AS checkout_time,
            SUM(price * qty) AS total_amount,
            SUM(qty) AS total_qty,
            GROUP_CONCAT(CONCAT(menu_name, ' (x', qty, ')') SEPARATOR ', ') AS item_summary
        FROM orders 
        WHERE status = 'paid' AND bill_id IS NOT NULL
        GROUP BY bill_id, table_number, payment_method
        ORDER BY MAX(checkout_time) DESC
    `;
    db.query(sql, (err, results) => {
        if (err) {
            console.error("Error fetching grouped history:", err);
            return res.status(500).json(err);
        }
        res.json(results);
    });
});

// 2. ดึงรายละเอียดของบิลเดี่ยว (ใช้สำหรับแก้ไขบิล)
app.get('/api/orders/history/bill/:billId', (req, res) => {
    const billId = req.params.billId;
    const sql = "SELECT * FROM orders WHERE bill_id = ?";
    db.query(sql, [billId], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

// 3. แก้ไขข้อมูลในบิล (เปลี่ยนวิธีชำระเงิน หรือปรับเปลี่ยนรายการ)
app.put('/api/orders/history/bill/:billId', (req, res) => {
    const billId = req.params.billId;
    const { payment_method, items } = req.body;

    // อัปเดตวิธีชำระเงินทุกรายการในบิล
    const updatePaySql = "UPDATE orders SET payment_method = ? WHERE bill_id = ?";
    db.query(updatePaySql, [payment_method, billId], (err) => {
        if (err) return res.status(500).json(err);

        // อัปเดตรายการแต่ละชิ้น (ราคา / จำนวน)
        if (items && Array.isArray(items)) {
            const promises = items.map(item => {
                return new Promise((resolve, reject) => {
                    const updateItemSql = "UPDATE orders SET price = ?, qty = ? WHERE id = ?";
                    db.query(updateItemSql, [item.price, item.qty, item.id], (iErr) => {
                        if (iErr) reject(iErr);
                        else resolve();
                    });
                });
            });

            Promise.all(promises)
                .then(() => res.json({ message: "อัปเดตบิลสำเร็จ" }))
                .catch(pErr => res.status(500).json(pErr));
        } else {
            res.json({ message: "อัปเดตบิลสำเร็จ" });
        }
    });
});

// 4. ลบบิลย้อนหลัง
app.delete('/api/orders/history/bill/:billId', (req, res) => {
    const billId = req.params.billId;
    const sql = "DELETE FROM orders WHERE bill_id = ?";
    db.query(sql, [billId], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "ลบบิลเรียบร้อยแล้ว" });
    });
});

// 5. ดึงข้อมูลสรุปยอดขาย (รองรับ รายวัน รายสัปดาห์ รายเดือน)
app.get('/api/orders/summary-report', (req, res) => {
    const { start_date, end_date } = req.query;

    let dateCondition = "";
    let params = [];

    if (start_date && end_date) {
        dateCondition = "AND checkout_time >= ? AND checkout_time <= ?";
        params = [`${start_date} 00:00:00`, `${end_date} 23:59:59`];
    }

    const summarySql = `
        SELECT 
            COUNT(DISTINCT bill_id) AS total_bills,
            COALESCE(SUM(price * qty), 0) AS total_sales,
            COALESCE(SUM(CASE WHEN payment_method = 'เงินสด' THEN price * qty ELSE 0 END), 0) AS total_cash,
            COALESCE(SUM(CASE WHEN payment_method = 'เงินโอน' THEN price * qty ELSE 0 END), 0) AS total_transfer,
            COALESCE(SUM(qty), 0) AS total_items
        FROM orders 
        WHERE status = 'paid' AND bill_id IS NOT NULL ${dateCondition}
    `;

    const topItemsSql = `
        SELECT menu_name, SUM(qty) AS total_qty, SUM(price * qty) AS total_price
        FROM orders
        WHERE status = 'paid' AND bill_id IS NOT NULL ${dateCondition}
        GROUP BY menu_name
        ORDER BY total_qty DESC
    `;

    db.query(summarySql, params, (err, summaryResults) => {
        if (err) return res.status(500).json(err);

        db.query(topItemsSql, params, (topErr, topResults) => {
            if (topErr) return res.status(500).json(topErr);

            res.json({
                summary: summaryResults[0] || {},
                top_items: topResults || []
            });
        });
    });
});

// ==========================================

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ทำงานเรียบร้อยที่ http://localhost:${PORT}`);
});