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

// ==========================================
// 🗄️ DATABASE CONNECTION POOL
// ==========================================
const db = mysql.createPool({
    host: process.env.DB_HOST || process.env.MYSQL_ADDON_HOST || 'b7ugjqxplhd9vdliphnu-mysql.services.clever-cloud.com',
    user: process.env.DB_USER || process.env.MYSQL_ADDON_USER || 'uqtvlwaikceun2hs',
    password: process.env.DB_PASSWORD || process.env.MYSQL_ADDON_PASSWORD,
    database: process.env.DB_NAME || process.env.MYSQL_ADDON_DB || 'b7ugjqxplhd9vdliphnu',
    port: process.env.DB_PORT || process.env.MYSQL_ADDON_PORT || 3306,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promiseDb = db.promise();

function getBranchTable(branch, tableType) {
    const validBranches = ['korat', 'buriram'];
    if (!validBranches.includes(branch)) throw new Error('สาขาไม่ถูกต้อง');
    return `${branch}_${tableType}`;
}

// ==========================================
// 🌐 PAGE ROUTES
// ==========================================

// --- ระบบเดิม (แจ่วฮ้อน) ---
app.get('/kitchen', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kitchen.html')));
app.get('/kitchen-legacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'kitchen-legacy.html')));
app.get('/history', (req, res) => res.sendFile(path.join(__dirname, 'public', 'history.html')));

// --- ระบบใหม่ (ทอดเล่น) ---
app.get('/todlen/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'todlen-login.html')));
app.get('/todlen/select-branch', (req, res) => res.sendFile(path.join(__dirname, 'public', 'todlen-select.html')));
app.get('/todlen/:branch/pos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'todlen-pos.html')));
app.get('/todlen/:branch/profit', (req, res) => res.sendFile(path.join(__dirname, 'public', 'todlen-profit.html')));


// ==========================================
// 🍟 TODLEN API SYSTEM
// ==========================================

// 1. เข้าสู่ระบบกลาง
app.post('/api/todlen/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const [rows] = await promiseDb.query('SELECT * FROM todlen_users WHERE username = ?', [username]);

        if (rows.length === 0 || rows[0].password_hash !== password) {
            return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        const user = rows[0];
        let redirectTo = user.role === 'admin' ? '/todlen/select-branch' : `/todlen/${user.branch}/profit`;
        res.json({ success: true, user: { name: user.name, role: user.role, branch: user.branch }, redirectTo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. เช็คออเดอร์ซ้ำจากชื่อลูกค้า
app.get('/api/todlen/:branch/check-duplicate-customer', async (req, res) => {
    try {
        const { branch } = req.params;
        const { customerName, date } = req.query;
        const ordersTable = getBranchTable(branch, 'orders');

        const [rows] = await promiseDb.query(
            `SELECT id, order_time, total_amount FROM ${ordersTable} WHERE order_date = ? AND customer_name = ? AND customer_name != 'ลูกค้าหน้าร้าน'`,
            [date, customerName]
        );

        res.json({ isDuplicate: rows.length > 0, existingOrders: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. คำนวณกำไรสุทธิจาก POS
app.get('/api/todlen/:branch/pos-net-profit', async (req, res) => {
    try {
        const { branch } = req.params;
        const { date } = req.query;

        const ordersTable = getBranchTable(branch, 'orders');
        const marketTable = getBranchTable(branch, 'market_expenses');
        const pettyTable = getBranchTable(branch, 'petty_expenses');

        const [[sales]] = await promiseDb.query(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM ${ordersTable} WHERE order_date = ?`, [date]);
        const [[market]] = await promiseDb.query(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM ${marketTable} WHERE expense_date = ?`, [date]);
        const [[petty]] = await promiseDb.query(`SELECT COALESCE(SUM(total_amount), 0) AS total FROM ${pettyTable} WHERE expense_date = ?`, [date]);

        const totalSales = parseFloat(sales.total);
        const totalMarket = parseFloat(market.total);
        const totalPetty = parseFloat(petty.total);
        const netProfit = totalSales - totalMarket - totalPetty;

        res.json({ success: true, date, totalSales, totalMarket, totalPetty, netProfit });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. บันทึกส่วนแบ่งกำไร (รองรับ payouts, attendances และ shopFund แบบ Dynamic)
app.post('/api/todlen/:branch/save-daily-profit', async (req, res) => {
    try {
        const { branch } = req.params;
        const { recordDate, posNetProfit, finalProfit, shopFund, payouts, attendances } = req.body;
        const profitTable = getBranchTable(branch, 'daily_profit_records');

        const payoutsJson = JSON.stringify(payouts || {});
        const attendancesJson = JSON.stringify(attendances || {});

        await promiseDb.query(
            `INSERT INTO ${profitTable} (record_date, pos_net_profit, final_profit, shop_fund, payouts, attendances) 
             VALUES (?, ?, ?, ?, ?, ?) 
             ON DUPLICATE KEY UPDATE pos_net_profit=?, final_profit=?, shop_fund=?, payouts=?, attendances=?`,
            [
                recordDate, posNetProfit, finalProfit, shopFund, payoutsJson, attendancesJson,
                posNetProfit, finalProfit, shopFund, payoutsJson, attendancesJson
            ]
        );

        res.json({ success: true, message: 'บันทึกส่วนแบ่งกำไรเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. ดึงประวัติส่วนแบ่งกำไร
app.get('/api/todlen/:branch/daily-profit-records', async (req, res) => {
    try {
        const { branch } = req.params;
        const profitTable = getBranchTable(branch, 'daily_profit_records');
        const [rows] = await promiseDb.query(`SELECT * FROM ${profitTable} ORDER BY record_date ASC`);
        res.json({ success: true, records: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 6. ลบประวัติส่วนแบ่งกำไรตาม ID
app.delete('/api/todlen/:branch/daily-profit-records/:id', async (req, res) => {
    try {
        const { branch, id } = req.params;
        const profitTable = getBranchTable(branch, 'daily_profit_records');
        await promiseDb.query(`DELETE FROM ${profitTable} WHERE id = ?`, [id]);
        res.json({ success: true, message: 'ลบรายการเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 7. จัดการผู้ใช้งาน (Admin)
app.get('/api/todlen/users', async (req, res) => {
    try {
        const [users] = await promiseDb.query('SELECT id, name, username, role, branch, created_at FROM todlen_users ORDER BY id DESC');
        res.json({ success: true, users });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/todlen/users', async (req, res) => {
    try {
        const { name, username, password, role, branch } = req.body;
        if (!name || !username || !password || !role) {
            return res.status(400).json({ success: false, message: 'กรุณากรอกข้อมูลให้ครบถ้วน' });
        }
        const [result] = await promiseDb.query(
            'INSERT INTO todlen_users (name, username, password_hash, role, branch) VALUES (?, ?, ?, ?, ?)',
            [name, username, password, role, branch || null]
        );
        res.json({ success: true, message: 'เพิ่มผู้ใช้งานเรียบร้อยแล้ว', userId: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') return res.status(400).json({ success: false, message: 'Username นี้ถูกใช้งานแล้ว' });
        res.status(500).json({ success: false, message: err.message });
    }
});

app.put('/api/todlen/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { name, username, password, role, branch } = req.body;

        let sql = 'UPDATE todlen_users SET name = ?, username = ?, role = ?, branch = ?';
        let params = [name, username, role, branch || null];

        if (password && password.trim() !== '') {
            sql += ', password_hash = ?';
            params.push(password);
        }

        sql += ' WHERE id = ?';
        params.push(id);

        await promiseDb.query(sql, params);
        res.json({ success: true, message: 'อัปเดตข้อมูลผู้ใช้งานสำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/todlen/users/:id', async (req, res) => {
    try {
        const { id } = req.params;
        await promiseDb.query('DELETE FROM todlen_users WHERE id = ?', [id]);
        res.json({ success: true, message: 'ลบผู้ใช้งานเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 8. จัดการหุ้นส่วน (Partners)
app.get('/api/todlen/:branch/partners', async (req, res) => {
    try {
        const { branch } = req.params;
        const partnerTable = getBranchTable(branch, 'partners');
        const [partners] = await promiseDb.query(`SELECT * FROM ${partnerTable} ORDER BY id ASC`);
        res.json({ success: true, partners });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/todlen/:branch/partners', async (req, res) => {
    try {
        const { branch } = req.params;
        // เปลี่ยนการรับค่าให้ตรงกับฐานข้อมูล (name, share_percent)
        const { name, share_percent } = req.body; 
        const partnerTable = getBranchTable(branch, 'partners');

        const [result] = await promiseDb.query(
            // แก้ไขชื่อคอลัมน์ในคำสั่ง SQL ให้เป็น name และ share_percent
            `INSERT INTO ${partnerTable} (name, share_percent) VALUES (?, ?)`,
            [name, share_percent]
        );
        res.json({ success: true, message: 'เพิ่มหุ้นส่วนเรียบร้อยแล้ว', partnerId: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
app.put('/api/todlen/:branch/partners/:id', async (req, res) => {
    try {
        const { branch, id } = req.params;
        // เปลี่ยนการรับค่าให้ตรงกับฐานข้อมูล (name, share_percent)
        const { name, share_percent } = req.body;
        const partnerTable = getBranchTable(branch, 'partners');

        await promiseDb.query(
            // แก้ไขชื่อคอลัมน์ในคำสั่ง SQL ให้เป็น name และ share_percent
            `UPDATE ${partnerTable} SET name = ?, share_percent = ? WHERE id = ?`,
            [name, share_percent, id]
        );
        res.json({ success: true, message: 'อัปเดตข้อมูลหุ้นส่วนเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.delete('/api/todlen/:branch/partners/:id', async (req, res) => {
    try {
        const { branch, id } = req.params;
        const partnerTable = getBranchTable(branch, 'partners');
        await promiseDb.query(`DELETE FROM ${partnerTable} WHERE id = ?`, [id]);
        res.json({ success: true, message: 'ลบรายชื่อหุ้นส่วนเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 9. ตั้งค่า % ทุนร้าน
app.get('/api/todlen/:branch/config', async (req, res) => {
    try {
        const { branch } = req.params;
        const [rows] = await promiseDb.query(
            "SELECT setting_value FROM system_settings WHERE setting_key = ?", 
            [`${branch}_shop_fund_percent`]
        );
        const shopFundPercent = rows.length > 0 ? parseFloat(rows[0].setting_value) : (branch === 'buriram' ? 20 : 30);
        res.json({ success: true, shopFundPercent });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/todlen/:branch/config', async (req, res) => {
    try {
        const { branch } = req.params;
        const { shopFundPercent } = req.body;
        await promiseDb.query(
            `INSERT INTO system_settings (setting_key, setting_value) 
             VALUES (?, ?) 
             ON DUPLICATE KEY UPDATE setting_value = ?`,
            [`${branch}_shop_fund_percent`, shopFundPercent.toString(), shopFundPercent.toString()]
        );
        res.json({ success: true, message: 'อัปเดต % หักเข้าทุนร้านเรียบร้อยแล้ว' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});


// ==========================================
// 🔌 SOCKET.IO REAL-TIME SYSTEM (แจ่วฮ้อน)
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

    socket.on('request_active_tables', () => notifyActiveTables());
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
// 🍲 JAEW HON API SYSTEM (ระบบเดิม)
// ==========================================
app.get('/api/orders/pending', (req, res) => {
    const sql = `SELECT orders.*, menus.category FROM orders LEFT JOIN menus ON orders.menu_name = menus.name WHERE orders.status = 'pending' ORDER BY orders.id ASC`;
    db.query(sql, (err, results) => { if (err) return res.status(500).json(err); res.json(results); });
});

app.get('/api/orders/drinks', (req, res) => {
    const sql = `SELECT orders.*, menus.category FROM orders JOIN menus ON orders.menu_name = menus.name WHERE orders.status = 'confirmed' AND menus.category = 'เครื่องดื่ม' ORDER BY orders.id ASC`;
    db.query(sql, (err, results) => { if (err) return res.status(500).json(err); res.json(results); });
});

app.put('/api/orders/confirm-table/:tableNum', (req, res) => {
    const sql = "UPDATE orders SET status = 'confirmed' WHERE table_number = ? AND status = 'pending'";
    db.query(sql, [req.params.tableNum], (err) => {
        if (err) return res.status(500).json(err);
        io.emit('update_kitchen');
        io.emit('new_order_submitted');
        notifyActiveTables();
        res.json({ message: 'ยืนยันรับออเดอร์เรียบร้อย' });
    });
});

app.put('/api/orders/reject/:id', (req, res) => {
    db.query("UPDATE orders SET status = 'cancelled' WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        io.emit('new_order_submitted');
        res.json({ message: 'ยกเลิกออเดอร์เรียบร้อย' });
    });
});

app.delete('/api/orders/item/:id', (req, res) => {
    db.query("DELETE FROM orders WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        notifyActiveTables();
        res.json({ message: 'ลบรายการเรียบร้อย' });
    });
});

app.post('/api/orders/custom', (req, res) => {
    const { table_number, menu_name, price, qty } = req.body;
    db.query("SELECT id, qty FROM orders WHERE table_number = ? AND menu_name = ? AND status IN ('confirmed', 'served') LIMIT 1", [table_number, menu_name], (err, results) => {
        if (err) return res.status(500).json(err);
        if (results.length > 0) {
            db.query("UPDATE orders SET qty = ? WHERE id = ?", [parseInt(results[0].qty) + parseInt(qty), results[0].id], (uErr) => {
                if (uErr) return res.status(500).json(uErr);
                notifyActiveTables();
                res.json({ message: 'รวมจำนวนสำเร็จ' });
            });
        } else {
            db.query("INSERT INTO orders (table_number, menu_name, price, qty, status) VALUES (?, ?, ?, ?, 'served')", [table_number, menu_name, price, qty], (iErr) => {
                if (iErr) return res.status(500).json(iErr);
                notifyActiveTables();
                res.json({ message: 'เพิ่มรายการสำเร็จ' });
            });
        }
    });
});

app.get('/api/orders', (req, res) => {
    db.query("SELECT orders.* FROM orders LEFT JOIN menus ON orders.menu_name = menus.name WHERE orders.status = 'confirmed' AND (menus.category IS NULL OR menus.category != 'เครื่องดื่ม') ORDER BY orders.id ASC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/orders/serve/:id', (req, res) => {
    db.query("UPDATE orders SET status = 'served' WHERE id = ?", [req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        io.emit('new_order_submitted');
        notifyActiveTables();
        res.json({ message: 'เสิร์ฟแล้ว' });
    });
});

app.put('/api/orders/serve-table/:tableNum', (req, res) => {
    db.query("UPDATE orders LEFT JOIN menus ON orders.menu_name = menus.name SET orders.status = 'served' WHERE orders.table_number = ? AND orders.status = 'confirmed' AND (menus.category IS NULL OR menus.category != 'เครื่องดื่ม')", [req.params.tableNum], (err) => {
        if (err) return res.status(500).json(err);
        notifyActiveTables();
        res.json({ message: 'เสิร์ฟอาหารทั้งโต๊ะแล้ว' });
    });
});

app.get('/api/orders/history', (req, res) => {
    db.query("SELECT bill_id AS id, table_number, SUM(price * qty) AS total, payment_method, MAX(checkout_time) AS created_at, SUM(qty) AS item_count FROM orders WHERE status = 'paid' AND bill_id IS NOT NULL GROUP BY bill_id, table_number, payment_method ORDER BY MAX(checkout_time) DESC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/orders/history/:id/items', (req, res) => {
    db.query("SELECT menu_name, price, qty FROM orders WHERE bill_id = ? OR id = ?", [req.params.id, req.params.id], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/category-order', (req, res) => {
    db.query("SELECT setting_value FROM system_settings WHERE setting_key = 'category_order'", (err, results) => {
        if (err) return res.status(500).json({ error: "Database error" });
        let orderList = [];
        if (results.length > 0 && results[0].setting_value) {
            try { orderList = JSON.parse(results[0].setting_value); } catch (e) {}
        }
        res.json({ order_list: orderList });
    });
});

app.post('/api/category-order', (req, res) => {
    db.query("UPDATE system_settings SET setting_value = ? WHERE setting_key = 'category_order'", [JSON.stringify(req.body.order_list || [])], (err) => {
        if (err) return res.status(500).json({ error: "Database error" });
        res.json({ success: true, message: "บันทึกสำเร็จ" });
    });
});

app.get('/api/menus', (req, res) => {
    db.query("SELECT * FROM menus ORDER BY category, id ASC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.post('/api/menus', (req, res) => {
    const { name, price, category, image_url, meats, addons, spiciness } = req.body;
    db.query("INSERT INTO menus (name, price, category, image_url, meats, addons, spiciness) VALUES (?, ?, ?, ?, ?, ?, ?)", [name, price, category, image_url, meats, addons, spiciness], (err, result) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'เพิ่มเมนูสำเร็จ', insertId: result.insertId });
    });
});

app.put('/api/menus/:id', (req, res) => {
    const { name, price, category, image_url, meats, addons, spiciness } = req.body;
    db.query("UPDATE menus SET name=?, price=?, category=?, image_url=?, meats=?, addons=?, spiciness=? WHERE id=?", [name, price, category, image_url, meats, addons, spiciness, req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'แก้ไขเมนูสำเร็จ' });
    });
});

app.delete('/api/menus/:id', (req, res) => {
    db.query("DELETE FROM menus WHERE id=?", [req.params.id], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: 'ลบเมนูสำเร็จ' });
    });
});

app.get('/api/orders/history-grouped', (req, res) => {
    db.query("SELECT bill_id, table_number, payment_method, MAX(checkout_time) AS checkout_time, SUM(price * qty) AS total_amount, SUM(qty) AS total_qty, GROUP_CONCAT(CONCAT(menu_name, ' (x', qty, ')') SEPARATOR ', ') AS item_summary FROM orders WHERE status = 'paid' AND bill_id IS NOT NULL GROUP BY bill_id, table_number, payment_method ORDER BY MAX(checkout_time) DESC", (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.get('/api/orders/history/bill/:billId', (req, res) => {
    db.query("SELECT * FROM orders WHERE bill_id = ?", [req.params.billId], (err, results) => {
        if (err) return res.status(500).json(err);
        res.json(results);
    });
});

app.put('/api/orders/history/bill/:billId', (req, res) => {
    const { payment_method, items } = req.body;
    db.query("UPDATE orders SET payment_method = ? WHERE bill_id = ?", [payment_method, req.params.billId], (err) => {
        if (err) return res.status(500).json(err);
        if (items && Array.isArray(items)) {
            const promises = items.map(item => new Promise((resolve, reject) => {
                db.query("UPDATE orders SET price = ?, qty = ? WHERE id = ?", [item.price, item.qty, item.id], (iErr) => iErr ? reject(iErr) : resolve());
            }));
            Promise.all(promises).then(() => res.json({ message: "อัปเดตบิลสำเร็จ" })).catch(pErr => res.status(500).json(pErr));
        } else {
            res.json({ message: "อัปเดตบิลสำเร็จ" });
        }
    });
});

app.delete('/api/orders/history/bill/:billId', (req, res) => {
    db.query("DELETE FROM orders WHERE bill_id = ?", [req.params.billId], (err) => {
        if (err) return res.status(500).json(err);
        res.json({ message: "ลบบิลเรียบร้อยแล้ว" });
    });
});

app.get('/api/orders/summary-report', (req, res) => {
    const { start_date, end_date } = req.query;
    let dateCondition = "";
    let params = [];

    if (start_date && end_date) {
        dateCondition = "AND checkout_time >= ? AND checkout_time <= ?";
        params = [`${start_date} 00:00:00`, `${end_date} 23:59:59`];
    }

    const summarySql = `SELECT COUNT(DISTINCT bill_id) AS total_bills, COALESCE(SUM(price * qty), 0) AS total_sales, COALESCE(SUM(CASE WHEN payment_method = 'เงินสด' THEN price * qty ELSE 0 END), 0) AS total_cash, COALESCE(SUM(CASE WHEN payment_method = 'เงินโอน' THEN price * qty ELSE 0 END), 0) AS total_transfer, COALESCE(SUM(qty), 0) AS total_items FROM orders WHERE status = 'paid' AND bill_id IS NOT NULL ${dateCondition}`;
    const topItemsSql = `SELECT menu_name, SUM(qty) AS total_qty, SUM(price * qty) AS total_price FROM orders WHERE status = 'paid' AND bill_id IS NOT NULL ${dateCondition} GROUP BY menu_name ORDER BY total_qty DESC`;

    db.query(summarySql, params, (err, summaryResults) => {
        if (err) return res.status(500).json(err);
        db.query(topItemsSql, params, (topErr, topResults) => {
            if (topErr) return res.status(500).json(topErr);
            res.json({ summary: summaryResults[0] || {}, top_items: topResults || [] });
        });
    });
});

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    const SYSTEM_PASSWORD = process.env.SYSTEM_PASSWORD || "31102015";
    if (password === SYSTEM_PASSWORD) res.json({ success: true });
    else res.status(401).json({ success: false, message: "รหัสผ่านไม่ถูกต้อง" });
});

app.post('/api/orders/batch', (req, res) => {
    const { table_number, items } = req.body;
    if (!items || items.length === 0) return res.status(400).json({ message: 'ตะกร้าว่างเปล่า' });

    db.query("SELECT name, price FROM menus", (err, menus) => {
        if (err) return res.status(500).json(err);
        const priceMap = new Map(menus.map(m => [m.name, m.price]));

        const values = items.map(item => {
            const basePrice = priceMap.get(item.menu_name) || 0;
            const validatedPrice = (item.price >= basePrice) ? item.price : basePrice;
            return [table_number, item.menu_name, validatedPrice, item.qty || 1, item.addons || '', 'pending'];
        });

        db.query("INSERT INTO orders (table_number, menu_name, price, qty, addons, status) VALUES ?", [values], (iErr, result) => {
            if (iErr) return res.status(500).json(iErr);
            io.emit('new_order_submitted');
            res.json({ message: 'สั่งอาหารสำเร็จ', inserted_count: result.affectedRows });
        });
    });
});


// ==========================================
// 🚀 START SERVER (ย้ายมาไว้ท้ายสุด)
// ==========================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ทำงานเรียบร้อยที่ http://localhost:${PORT}`);
});