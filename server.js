const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
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

// ==========================================
// 🔐 SIGNED SESSION + AUDIT LOGGING
// ==========================================
// ตั้งค่า SESSION_SECRET ใน Environment Variables ของโฮสต์ให้เป็นค่าสุ่มยาวอย่างน้อย 32 ตัวอักษร
// ถ้าไม่ได้ตั้งค่า จะใช้ secret ชั่วคราวและผู้ใช้ต้อง login ใหม่เมื่อเซิร์ฟเวอร์ restart
const SESSION_COOKIE = 'todlen_session';
const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const SESSION_SECRET = process.env.SESSION_SECRET || process.env.LOG_SESSION_SECRET || crypto.randomBytes(48).toString('hex');
if (!process.env.SESSION_SECRET && !process.env.LOG_SESSION_SECRET) {
    console.warn('[security] Please configure SESSION_SECRET in environment variables for persistent signed sessions.');
}

function parseCookies(header = '') {
    const out = {};
    header.split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i < 0) return;
        const key = part.slice(0, i).trim();
        const value = part.slice(i + 1).trim();
        try { out[key] = decodeURIComponent(value); } catch (_) { out[key] = value; }
    });
    return out;
}

function signSessionPayload(payload) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function readSession(req) {
    const token = parseCookies(req.headers.cookie || '')[SESSION_COOKIE];
    if (!token || !token.includes('.')) return null;
    const dot = token.lastIndexOf('.');
    const payload = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    const expected = signSessionPayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!data.exp || data.exp < Math.floor(Date.now() / 1000) || !data.id) return null;
        return { id: Number(data.id), username: data.username, name: data.name, role: data.role, branch: data.branch };
    } catch (_) { return null; }
}

function setSessionCookie(res, user) {
    const payload = Buffer.from(JSON.stringify({
        id: Number(user.id), username: user.username, name: user.name,
        role: user.role, branch: user.branch,
        exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS
    })).toString('base64url');
    const token = `${payload}.${signSessionPayload(payload)}`;
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

app.use((req, res, next) => {
    req.auditUser = readSession(req);
    next();
});

async function writeAuditLog(req, entry, actorOverride = null) {
    const actor = actorOverride || req.auditUser || null;
    const metadata = entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : null;
    const branch = entry.branch || (req.path.match(/^\/api\/todlen\/(korat|buriram)(?:\/|$)/) || [])[1] || (actor && actor.branch !== 'all' ? actor.branch : null) || null;
    const target = entry.target || inferAuditTarget(req.path);
    await promiseDb.query(
        `INSERT INTO audit_logs
         (actor_user_id, actor_username, actor_name, actor_role, action_key, description, branch,
          target_type, target_id, status_code, is_success, metadata, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            actor && Number.isFinite(Number(actor.id)) ? Number(actor.id) : null,
            actor && actor.username ? String(actor.username).slice(0, 50) : null,
            actor && actor.name ? String(actor.name).slice(0, 100) : null,
            actor && actor.role ? String(actor.role).slice(0, 20) : null,
            String(entry.actionKey || 'system.activity').slice(0, 120),
            String(entry.description || 'กิจกรรมในระบบ').slice(0, 500),
            branch ? String(branch).slice(0, 40) : null,
            target.type ? String(target.type).slice(0, 80) : null,
            target.id !== null && target.id !== undefined ? String(target.id).slice(0, 100) : null,
            entry.statusCode === undefined ? null : Number(entry.statusCode),
            entry.isSuccess === undefined ? 1 : (entry.isSuccess ? 1 : 0),
            metadata ? JSON.stringify(metadata) : null,
            String(req.ip || req.socket?.remoteAddress || '').slice(0, 45) || null,
            String(req.get('user-agent') || '').slice(0, 255) || null
        ]
    );
}

function inferAuditTarget(pathname) {
    const patterns = [
        [/\/daily-profit-records\/([^/]+)/, 'daily_profit_record'],
        [/\/users\/([^/]+)/, 'user'],
        [/\/partners\/([^/]+)/, 'partner'],
        [/\/menus\/([^/]+)/, 'menu'],
        [/\/history\/bill\/([^/]+)/, 'bill'],
        [/\/orders\/(?:item|serve|reject)\/([^/]+)/, 'order'],
        [/\/confirm-table\/([^/]+)/, 'table'],
        [/\/serve-table\/([^/]+)/, 'table']
    ];
    for (const [regex, type] of patterns) {
        const match = pathname.match(regex);
        if (match) return { type, id: match[1] };
    }
    if (pathname.includes('save-daily-profit')) return { type: 'daily_profit_record', id: null };
    if (pathname.includes('/todlen/users')) return { type: 'user', id: null };
    if (pathname.includes('/partners')) return { type: 'partner', id: null };
    if (pathname.includes('/menus')) return { type: 'menu', id: null };
    if (pathname.includes('/orders')) return { type: 'order', id: null };
    return { type: null, id: null };
}

function describeAuditMutation(req) {
    const p = req.path;
    const m = req.method;
    const branch = (p.match(/^\/api\/todlen\/(korat|buriram)(?:\/|$)/) || [])[1];
    const branchLabel = branch === 'korat' ? 'สาขาโคราช' : branch === 'buriram' ? 'สาขาบุรีรัมย์' : '';
    if (p.includes('/save-daily-profit')) return ['profit.save', `บันทึก/แก้ไขส่วนแบ่งกำไรประจำวัน ${branchLabel}`.trim()];
    if (p.includes('/daily-profit-records/') && m === 'DELETE') return ['profit.delete', `ลบประวัติส่วนแบ่งกำไร ${branchLabel}`.trim()];
    if (p === '/api/todlen/users' && m === 'POST') return ['user.create', 'เพิ่มผู้ใช้งาน'];
    if (p.startsWith('/api/todlen/users/') && m === 'PUT') return ['user.update', 'แก้ไขข้อมูลผู้ใช้งาน'];
    if (p.startsWith('/api/todlen/users/') && m === 'DELETE') return ['user.delete', 'ลบผู้ใช้งาน'];
    if (p.includes('/partners') && m === 'POST') return ['partner.create', `เพิ่มหุ้นส่วน ${branchLabel}`.trim()];
    if (p.includes('/partners/') && m === 'PUT') return ['partner.update', `แก้ไขข้อมูลหุ้นส่วน ${branchLabel}`.trim()];
    if (p.includes('/partners/') && m === 'DELETE') return ['partner.delete', `ลบหุ้นส่วน ${branchLabel}`.trim()];
    if (p.includes('/config') && m === 'POST') return ['settings.update', `เปลี่ยนการตั้งค่าระบบ ${branchLabel}`.trim()];
    if (p === '/api/orders/batch') return ['order.create', 'รับออเดอร์ใหม่'];
    if (p.includes('/orders/confirm-table/')) return ['order.confirm_table', 'ยืนยันออเดอร์ทั้งโต๊ะ'];
    if (p.includes('/orders/reject/')) return ['order.cancel', 'ยกเลิกออเดอร์'];
    if (p.includes('/orders/item/') && m === 'DELETE') return ['order.delete_item', 'ลบรายการอาหารจากออเดอร์'];
    if (p.includes('/orders/serve-table/')) return ['order.serve_table', 'เปลี่ยนสถานะอาหารทั้งโต๊ะเป็นเสิร์ฟแล้ว'];
    if (p.includes('/orders/serve/')) return ['order.serve', 'เปลี่ยนสถานะรายการอาหารเป็นเสิร์ฟแล้ว'];
    if (p.includes('/orders/history/bill/') && m === 'PUT') return ['bill.update', 'แก้ไขบิลย้อนหลัง'];
    if (p.includes('/orders/history/bill/') && m === 'DELETE') return ['bill.delete', 'ลบบิลย้อนหลัง'];
    if (p === '/api/category-order') return ['menu.category_order', 'เปลี่ยนลำดับหมวดหมู่เมนู'];
    if (p === '/api/menus' && m === 'POST') return ['menu.create', 'เพิ่มเมนูอาหาร'];
    if (p.startsWith('/api/menus/') && m === 'PUT') return ['menu.update', 'แก้ไขเมนูอาหาร'];
    if (p.startsWith('/api/menus/') && m === 'DELETE') return ['menu.delete', 'ลบเมนูอาหาร'];
    if (p === '/api/auth/login') return ['legacy.login', 'พยายามเข้าสู่ระบบแจ่วฮ้อนด้วยรหัสผ่านกลาง'];
    const methodLabels = { POST: 'เพิ่ม/บันทึก', PUT: 'แก้ไข', PATCH: 'แก้ไข', DELETE: 'ลบ' };
    return [`api.${m.toLowerCase()}`, `${methodLabels[m] || m} ข้อมูลผ่าน ${p}`.slice(0, 500)];
}

function safeAuditMetadata(body = {}) {
    const allowed = [
        'recordDate', 'posNetProfit', 'finalProfit', 'shopFund', 'name', 'username', 'role', 'branch',
        'share_percent', 'shopFundPercent', 'expense_date', 'total_amount', 'title', 'table_number',
        'menu_name', 'payment_method', 'customer_name', 'order_date', 'order_time', 'date', 'setting_key',
        'category', 'price', 'qty', 'bill_id'
    ];
    const safe = {};
    for (const key of allowed) {
        const value = body[key];
        if (value === undefined || value === null) continue;
        if (typeof value === 'string') safe[key] = value.slice(0, 200);
        else if (typeof value === 'number' || typeof value === 'boolean') safe[key] = value;
    }
    if (Array.isArray(body.items)) safe.itemsCount = body.items.length;
    if (Array.isArray(body.order_items)) safe.orderItemsCount = body.order_items.length;
    if (Array.isArray(body.payouts)) safe.payoutsCount = body.payouts.length;
    return safe;
}

// Log every state-changing API call. Passwords and secret fields are deliberately never captured.
app.use((req, res, next) => {
    const mutating = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
    if (!mutating || !req.path.startsWith('/api/') || ['/api/todlen/login', '/api/todlen/logout'].includes(req.path)) return next();
    const [actionKey, description] = describeAuditMutation(req);
    const metadata = safeAuditMetadata(req.body || {});
    metadata.method = req.method;
    metadata.path = req.path;
    const target = inferAuditTarget(req.path);
    res.on('finish', () => {
        writeAuditLog(req, {
            actionKey, description, metadata, target,
            statusCode: res.statusCode,
            isSuccess: res.statusCode < 400
        }).catch(err => console.error('[audit] Failed to write activity log:', err.message));
    });
    next();
});

async function requireAdmin(req, res, next) {
    try {
        if (!req.auditUser || !req.auditUser.id) return res.status(401).json({ success: false, message: 'กรุณาเข้าสู่ระบบใหม่' });
        const [rows] = await promiseDb.query('SELECT id, username, name, role, branch FROM todlen_users WHERE id = ? LIMIT 1', [req.auditUser.id]);
        if (!rows.length || rows[0].role !== 'admin') return res.status(403).json({ success: false, message: 'เฉพาะ Admin เท่านั้นที่ดูประวัตินี้ได้' });
        req.auditUser = rows[0];
        next();
    } catch (err) {
        res.status(500).json({ success: false, message: 'ตรวจสอบสิทธิ์ไม่สำเร็จ' });
    }
}

async function requireAdminPage(req, res, next) {
    try {
        if (!req.auditUser || !req.auditUser.id) return res.redirect('/todlen/login');
        const [rows] = await promiseDb.query('SELECT id, username, name, role, branch FROM todlen_users WHERE id = ? LIMIT 1', [req.auditUser.id]);
        if (!rows.length || rows[0].role !== 'admin') return res.status(403).send('หน้านี้สำหรับ Admin เท่านั้น');
        req.auditUser = rows[0];
        next();
    } catch (_) { res.status(500).send('ตรวจสอบสิทธิ์ไม่สำเร็จ'); }
}

async function cleanupOldAuditLogs() {
    try {
        await promiseDb.query('DELETE FROM audit_logs WHERE created_at < DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)');
    } catch (err) {
        if (err.code !== 'ER_NO_SUCH_TABLE') console.error('[audit] Retention cleanup failed:', err.message);
    }
}
setTimeout(cleanupOldAuditLogs, 10000).unref();
setInterval(cleanupOldAuditLogs, 24 * 60 * 60 * 1000).unref();

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
app.get('/todlen/admin/logs', requireAdminPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'todlen-logs.html')));
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
            try {
                await writeAuditLog(req, {
                    actionKey: 'auth.login.failed', description: 'เข้าสู่ระบบทอดเล่นไม่สำเร็จ',
                    isSuccess: false, statusCode: 401,
                    metadata: { attemptedUsername: String(username || '').slice(0, 50) }
                }, { id: null, username: String(username || '').slice(0, 50), name: null, role: null, branch: null });
            } catch (logErr) { console.error('[audit] Failed to log login failure:', logErr.message); }
            return res.status(401).json({ success: false, message: 'Username หรือ Password ไม่ถูกต้อง' });
        }

        const user = rows[0];
        setSessionCookie(res, user);
        try {
            await writeAuditLog(req, {
                actionKey: 'auth.login.success', description: 'เข้าสู่ระบบทอดเล่นสำเร็จ',
                isSuccess: true, statusCode: 200,
                metadata: { username: user.username, role: user.role, branch: user.branch }
            }, user);
        } catch (logErr) { console.error('[audit] Failed to log login success:', logErr.message); }
        let redirectTo = user.role === 'admin' ? '/todlen/select-branch' : `/todlen/${user.branch}/profit`;
        res.json({ success: true, user: { name: user.name, role: user.role, branch: user.branch }, redirectTo });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.post('/api/todlen/logout', async (req, res) => {
    try {
        if (req.auditUser) {
            try {
                await writeAuditLog(req, { actionKey: 'auth.logout', description: 'ออกจากระบบทอดเล่น', isSuccess: true, statusCode: 200 });
            } catch (logErr) { console.error('[audit] Failed to log logout:', logErr.message); }
        }
        clearSessionCookie(res);
        res.json({ success: true, message: 'ออกจากระบบแล้ว' });
    } catch (err) {
        clearSessionCookie(res);
        res.status(500).json({ success: false, message: 'ออกจากระบบแล้ว แต่บันทึกเหตุการณ์ไม่สำเร็จ' });
    }
});

app.get('/api/todlen/audit-logs', requireAdmin, async (req, res) => {
    try {
        await cleanupOldAuditLogs();
        const page = Math.max(1, Math.min(100000, parseInt(req.query.page, 10) || 1));
        const pageSize = Math.max(10, Math.min(100, parseInt(req.query.pageSize, 10) || 50));
        const offset = (page - 1) * pageSize;
        const conditions = ['created_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 90 DAY)'];
        const params = [];
        const q = String(req.query.q || '').trim().slice(0, 200);
        const branch = String(req.query.branch || '').trim();
        const status = String(req.query.status || '').trim();
        const action = String(req.query.action || '').trim().slice(0, 120);
        const from = String(req.query.from || '').trim();
        const to = String(req.query.to || '').trim();
        if (q) {
            const like = `%${q}%`;
            conditions.push('(actor_username LIKE ? OR actor_name LIKE ? OR description LIKE ? OR action_key LIKE ? OR branch LIKE ? OR target_id LIKE ? OR CAST(metadata AS CHAR) LIKE ?)');
            params.push(like, like, like, like, like, like, like);
        }
        if (['korat', 'buriram'].includes(branch)) { conditions.push('branch = ?'); params.push(branch); }
        if (status === 'success') conditions.push('is_success = 1');
        if (status === 'failed') conditions.push('is_success = 0');
        if (action) { conditions.push('action_key = ?'); params.push(action); }
        const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
        if (validDate(from)) { conditions.push('created_at >= ?'); params.push(`${from} 00:00:00`); }
        if (validDate(to)) { conditions.push('created_at < DATE_ADD(?, INTERVAL 1 DAY)'); params.push(`${to} 00:00:00`); }
        const where = conditions.join(' AND ');
        const [[countRow]] = await promiseDb.query(`SELECT COUNT(*) AS total FROM audit_logs WHERE ${where}`, params);
        const [logs] = await promiseDb.query(
            `SELECT id, actor_user_id, actor_username, actor_name, actor_role, action_key, description,
                    branch, target_type, target_id, status_code, is_success, metadata, ip_address, user_agent, created_at
             FROM audit_logs WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
            [...params, pageSize, offset]
        );
        res.json({ success: true, logs, pagination: { page, pageSize, total: Number(countRow.total), totalPages: Math.max(1, Math.ceil(Number(countRow.total) / pageSize)) } });
    } catch (err) {
        console.error('[audit] Failed to query logs:', err.message);
        res.status(500).json({ success: false, message: 'โหลดประวัติไม่สำเร็จ กรุณาตรวจสอบว่ารันไฟล์ SQL สำหรับสร้างตาราง Log แล้ว' });
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
        const handshakeHeaders = socket.handshake.headers || {};
        const socketAuditReq = {
            headers: handshakeHeaders,
            path: '/socket.io/checkout_table',
            ip: socket.handshake.address || '',
            socket: { remoteAddress: socket.handshake.address || '' },
            auditUser: readSession({ headers: handshakeHeaders }),
            get: (name) => handshakeHeaders[String(name).toLowerCase()] || ''
        };
        db.query(sql, [paymentMethod, billId, tableNum], (err, result) => {
            if (err) {
                writeAuditLog(socketAuditReq, {
                    actionKey: 'legacy.checkout.failed', description: 'ปิดบิล/รับชำระเงินไม่สำเร็จ',
                    target: { type: 'table', id: tableNum }, statusCode: 500, isSuccess: false,
                    metadata: { tableNum, paymentMethod }
                }).catch(logErr => console.error('[audit] Failed to log checkout failure:', logErr.message));
                return;
            }
            writeAuditLog(socketAuditReq, {
                actionKey: 'legacy.checkout', description: 'ปิดบิลและรับชำระเงิน',
                target: { type: 'table', id: tableNum }, statusCode: 200, isSuccess: true,
                metadata: { tableNum, paymentMethod, billId, affectedRows: result.affectedRows }
            }).catch(logErr => console.error('[audit] Failed to log checkout:', logErr.message));
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
// 🛒 1. ดึงข้อมูลสรุป POS สดจาก MySQL (แยกตามสาขา)
app.get('/api/todlen/:branch/pos-summary', async (req, res) => {
    try {
        const { branch } = req.params;
        const { mode, date, month } = req.query;
        const ordersTable = getBranchTable(branch, 'orders');
        const marketTable = getBranchTable(branch, 'market_expenses');
        const pettyTable = getBranchTable(branch, 'petty_expenses');

        let dateCondOrders = '', dateCondMarket = '', dateCondPetty = '';
        let params = [];

        if (mode === 'daily' && date) {
            dateCondOrders = 'WHERE order_date = ?';
            dateCondMarket = 'WHERE expense_date = ?';
            dateCondPetty = 'WHERE expense_date = ?';
            params = [date];
        } else if (mode === 'monthly' && month) {
            dateCondOrders = 'WHERE order_date LIKE ?';
            dateCondMarket = 'WHERE expense_date LIKE ?';
            dateCondPetty = 'WHERE expense_date LIKE ?';
            params = [`${month}%`];
        }

        const [orders] = await promiseDb.query(`SELECT * FROM ${ordersTable} ${dateCondOrders} ORDER BY id DESC`, params);
        const [marketExpenses] = await promiseDb.query(`SELECT * FROM ${marketTable} ${dateCondMarket} ORDER BY id DESC`, params);
        const [pettyExpenses] = await promiseDb.query(`SELECT * FROM ${pettyTable} ${dateCondPetty} ORDER BY id DESC`, params);

        const totalSales = orders.reduce((sum, o) => sum + parseFloat(o.total_amount || 0), 0);
        const totalMarket = marketExpenses.reduce((sum, m) => sum + parseFloat(m.total_amount || 0), 0);
        const totalPetty = pettyExpenses.reduce((sum, p) => sum + parseFloat(p.total_amount || 0), 0);

        res.json({ success: true, totalSales, totalMarket, totalPetty, orders, marketExpenses, pettyExpenses });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 📋 2. ดึงเมนูอาหารตามสาขา
app.get('/api/todlen/:branch/menu-items', async (req, res) => {
    try {
        const { branch } = req.params;
        const menuTable = getBranchTable(branch, 'menu');
        const [items] = await promiseDb.query(`SELECT * FROM ${menuTable} ORDER BY id ASC`);
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 🛒 3. บันทึกค่าตลาด
app.post('/api/todlen/:branch/market-expenses', async (req, res) => {
    try {
        const { branch } = req.params;
        const { expenseDate, totalAmount } = req.body;
        const marketTable = getBranchTable(branch, 'market_expenses');
        await promiseDb.query(`INSERT INTO ${marketTable} (expense_date, total_amount) VALUES (?, ?)`, [expenseDate, totalAmount]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 💸 4. บันทึกเบิกย่อย
app.post('/api/todlen/:branch/petty-expenses', async (req, res) => {
    try {
        const { branch } = req.params;
        const { expenseDate, expenseTime, title, totalAmount } = req.body;
        const pettyTable = getBranchTable(branch, 'petty_expenses');
        await promiseDb.query(`INSERT INTO ${pettyTable} (expense_date, expense_time, title, totalAmount) VALUES (?, ?, ?, ?)`, [expenseDate, expenseTime, title, totalAmount]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});
server.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์ทำงานเรียบร้อยที่ http://localhost:${PORT}`);
});

// ==========================================
// 🍟 POS LIVE ONLINE DATABASE SYSTEM (เพิ่มใหม่)
// ==========================================

// 1. ดึงข้อมูลออเดอร์/ค่าตลาด/เบิกย่อย ประจำวันจาก Database
app.get('/api/todlen/:branch/pos-records', async (req, res) => {
    try {
        const { branch } = req.params;
        const { date } = req.query;
        const ordersTable = getBranchTable(branch, 'orders');
        const marketTable = getBranchTable(branch, 'market_expenses');
        const pettyTable = getBranchTable(branch, 'petty_expenses');

        const [orders] = await promiseDb.query(`SELECT * FROM ${ordersTable} WHERE order_date = ? ORDER BY id DESC`, [date]);
        const [market] = await promiseDb.query(`SELECT * FROM ${marketTable} WHERE expense_date = ? ORDER BY id DESC`, [date]);
        const [petty] = await promiseDb.query(`SELECT * FROM ${pettyTable} WHERE expense_date = ? ORDER BY id DESC`, [date]);

        res.json({ success: true, orders, market, petty });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 2. บันทึกออเดอร์ขายลง Database
app.post('/api/todlen/:branch/orders', async (req, res) => {
    try {
        const { branch } = req.params;
        const { orderDate, orderTime, items, totalAmount } = req.body;
        const table = getBranchTable(branch, 'orders');
        await promiseDb.query(
            `INSERT INTO ${table} (customer_name, order_date, order_time, order_items, total_amount) VALUES (?, ?, ?, ?, ?)`,
            ['ลูกค้าหน้าร้าน', orderDate, orderTime, JSON.stringify(items || []), totalAmount]
        );
        res.json({ success: true, message: 'บันทึกออเดอร์ลง Database สำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 3. บันทึกค่าตลาดลง Database
app.post('/api/todlen/:branch/market-expenses', async (req, res) => {
    try {
        const { branch } = req.params;
        const { expenseDate, totalAmount } = req.body;
        const table = getBranchTable(branch, 'market_expenses');
        await promiseDb.query(
            `INSERT INTO ${table} (expense_date, total_amount) VALUES (?, ?)`,
            [expenseDate, totalAmount]
        );
        res.json({ success: true, message: 'บันทึกค่าตลาดลง Database สำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 4. บันทึกค่าเบิกย่อยลง Database
app.post('/api/todlen/:branch/petty-expenses', async (req, res) => {
    try {
        const { branch } = req.params;
        const { expenseDate, expenseTime, title, totalAmount } = req.body;
        const table = getBranchTable(branch, 'petty_expenses');
        await promiseDb.query(
            `INSERT INTO ${table} (expense_date, expense_time, title, total_amount) VALUES (?, ?, ?, ?)`,
            [expenseDate, expenseTime, title, totalAmount]
        );
        res.json({ success: true, message: 'บันทึกเบิกย่อยลง Database สำเร็จ' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// 5. ลบรายการออเดอร์/ค่าตลาด/เบิกย่อย ออกจาก Database
app.delete('/api/todlen/:branch/pos-records/:type/:id', async (req, res) => {
    try {
        const { branch, type, id } = req.params;
        let tableType = 'orders';
        if (type === 'Market') tableType = 'market_expenses';
        if (type === 'Expenses') tableType = 'petty_expenses';

        const table = getBranchTable(branch, tableType);
        await promiseDb.query(`DELETE FROM ${table} WHERE id = ?`, [id]);
        res.json({ success: true, message: 'ลบรายการเรียบร้อย' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});