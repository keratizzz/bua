<?php
header('Content-Type: application/json; charset=utf-8');

// ตั้งค่าการเชื่อมต่อฐานข้อมูล (เปลี่ยนรหัสผ่านถ้ามี)
$host = '127.0.0.1';
$dbname = 'restaurant';
$user = 'root'; 
$pass = '31102015'; 

try {
    $pdo = new PDO("mysql:host=$host;dbname=$dbname;charset=utf8", $user, $pass);
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

    $method = $_SERVER['REQUEST_METHOD'];

    if ($method === 'GET') {
        // ดึงข้อมูลลำดับหมวดหมู่
        $stmt = $pdo->prepare("SELECT setting_value FROM system_settings WHERE setting_key = 'category_order'");
        $stmt->execute();
        $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
        $order_list = $result ? json_decode($result['setting_value'], true) : [];
        echo json_encode(['order_list' => $order_list]);
    } 
    elseif ($method === 'POST') {
        // บันทึกข้อมูลลำดับหมวดหมู่
        $input = json_decode(file_get_contents('php://input'), true);
        $order_list = isset($input['order_list']) ? json_encode($input['order_list']) : '[]';

        $stmt = $pdo->prepare("UPDATE system_settings SET setting_value = :val WHERE setting_key = 'category_order'");
        $stmt->execute([':val' => $order_list]);

        echo json_encode(['success' => true, 'message' => 'บันทึกสำเร็จ']);
    }
} catch (PDOException $e) {
    echo json_encode(['error' => 'Database error']);
}
?>