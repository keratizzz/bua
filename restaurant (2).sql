-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1
-- Generation Time: Aug 02, 2026 at 04:45 PM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `restaurant`
--

-- --------------------------------------------------------

--
-- Table structure for table `menus`
--

CREATE TABLE `menus` (
  `id` int(11) NOT NULL,
  `name` varchar(100) NOT NULL,
  `price` int(11) NOT NULL,
  `meats` text DEFAULT NULL,
  `addons` text DEFAULT NULL,
  `category` varchar(50) DEFAULT 'ทั่วไป',
  `image_url` text DEFAULT NULL,
  `spiciness` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `menus`
--

INSERT INTO `menus` (`id`, `name`, `price`, `meats`, `addons`, `category`, `image_url`, `spiciness`) VALUES
(18, 'ข้าวกะเพรา', 45, 'หมูชิ้น,หมูสับ,เครื่องใน,เนื้อสับ+5,เนื้อชิ้น+5,หมูกรอบ+10,ทะเล+15,คอหมูย่าง+20,เสือร้องไห้+20,ไส้อ่อน+20', 'พิเศษ+10,ไข่ดาว+10,ไข่เจียว +10,ไข่ต้ม +10', 'ข้าว', 'images/moo.jpg', 'ไม่เผ็ด,เผ็ดน้อย,เผ็ดกลาง,เผ็ดมาก'),
(50, 'แจ่วฮ้อนหมู', 119, '', '', 'แจ่วฮ้อน', 'images/jao.jpg', NULL),
(51, 'แจ่วฮ้อนเนื้อ', 129, '', '', 'แจ่วฮ้อน', 'images/jao.jpg', NULL),
(52, 'แจ่วฮ้อนหมู-เนื้อ', 139, '', '', 'แจ่วฮ้อน', 'images/jao.jpg', NULL),
(53, 'หมู 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao7.jpg', NULL),
(54, 'เนื้อ 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao6.jpg', NULL),
(55, 'สไบนาง 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao4.jpg', NULL),
(56, 'วุ้นเส้น 1 ถาด', 30, '', '', 'แจ่วฮ้อน', 'images/jao1.jpg', NULL),
(57, 'ไข่ไก่ 1 ฟอง', 10, '', '', 'แจ่วฮ้อน', 'images/egg.jpg', NULL),
(58, 'ตับ 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao5.jpg', NULL),
(59, 'กุ้งสด 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao3.jpg', NULL),
(60, 'ปลาหมึก 1 ถาด', 50, '', '', 'แจ่วฮ้อน', 'images/jao2.jpg', NULL),
(61, 'ลาบหมู', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/10.png', NULL),
(62, 'ลาบเนื้อ', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/9.png', NULL),
(63, 'ตับหวาน', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/8.png', NULL),
(64, 'ก้อยหมู', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/7.png', NULL),
(65, 'ก้อยเนื้อ', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/6.png', NULL),
(66, 'ก้อยขม', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/5.png', NULL),
(67, 'ก้อยมะนาว', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/6.png', NULL),
(68, 'ปีกไก่ทอด', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/3.png', NULL),
(69, 'ไส้อ่อนทอด', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/2.png', NULL),
(70, 'เอ็นไก่ทอด', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/1.png', NULL),
(71, 'คอหมูย่าง', 90, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/18.png', NULL),
(72, 'เนื้อย่าง', 90, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/19.png', NULL),
(73, 'เสือร้องไห้', 90, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/15.png', NULL),
(74, 'คั่วไก่บ้าน', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/17.png', NULL),
(75, 'คั่วหมู', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/16.png', NULL),
(76, 'คั่วเนื้อ', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/14.png', NULL),
(77, 'ต้มแซ่บหมู', 70, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/13.png', NULL),
(78, 'ต้มแซ่บเนื้อ', 80, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/12.png', NULL),
(79, 'ต้มแซ่บหมู-เนื้อ', 90, '', '', 'ประเภทลาบ / ก้อย / อาหารอีสาน', 'images/11.png', NULL),
(80, 'ยำวุ้นเส้น', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/27.png', NULL),
(81, 'ยำปลาหมึก', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/26.png', NULL),
(82, 'ยำปูม้า', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/31.png', NULL),
(83, 'ยำรวมทะเล', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/28.png', NULL),
(84, 'ยำไส้อ่อน', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/25.png', NULL),
(85, 'หมูมะนาว', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/30.png', NULL),
(86, 'เนื้อมะนาว', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/29.png', NULL),
(87, 'ลวกจิ้มหมู', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/24.png', NULL),
(88, 'ลวกจิ้มเนื้อ', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/23.png', NULL),
(89, 'ไส้อ่อนลวกจิ้ม', 70, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/22.png', NULL),
(90, 'ปูม้าลวกจิ้ม', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/20.png', NULL),
(91, 'กุ้งแช่น้ำปลา', 80, '', '', 'ประเภทยำ / ลวกจิ้ม / มะนาว', 'images/21.png', NULL),
(92, 'น้ำเปล่า เล็ก', 10, '', '', 'เครื่องดื่ม', 'images/Water.png', NULL),
(93, 'น้ำเปล่า ใหญ่', 20, '', '', 'เครื่องดื่ม', 'images/bigwater.jpg', NULL),
(94, 'น้ำอัดลม', 15, '', '', 'เครื่องดื่ม', 'images/Coke.png', NULL),
(95, 'โซดา', 10, '', '', 'เครื่องดื่ม', 'images/soda.png', NULL),
(96, 'น้ำแข็ง', 10, '', '', 'เครื่องดื่ม', 'images/ice.png', NULL),
(97, 'ช้าง', 70, '', '', 'เครื่องดื่ม', 'images/chang.png', NULL),
(98, 'ลีโอ', 75, '', '', 'เครื่องดื่ม', 'images/leo.png', NULL),
(99, 'สิงห์', 80, '', '', 'เครื่องดื่ม', 'images/sing.png', NULL),
(100, 'หงส์ทอง', 299, '', '', 'เครื่องดื่ม', 'images/hong.png', NULL),
(101, 'แสงโสม', 345, '', '', 'เครื่องดื่ม', 'images/sang.png', NULL),
(102, 'ข้าวผัดผักบุ้ง', 45, 'หมูชิ้น,หมูสับ,เครื่องใน,เนื้อสับ+5,เนื้อชิ้น+5,หมูกรอบ+10,ทะเล+15,คอหมูย่าง+20,เสือร้องไห้+20,ไส้อ่อน+20', 'พิเศษ+10,ไข่ดาว+10,ไข่เจียว +10,ไข่ต้ม +10', 'ข้าว', 'images/kao2.jpg', NULL),
(103, 'ข้าวผัดพริกแกง', 45, 'หมูชิ้น,หมูสับ,เครื่องใน,เนื้อสับ+5,เนื้อชิ้น+5,หมูกรอบ+10,ทะเล+15,คอหมูย่าง+20,เสือร้องไห้+20,ไส้อ่อน+20', 'พิเศษ+10,ไข่ดาว+10,ไข่เจียว +10,ไข่ต้ม +10', 'ข้าว', 'images/kao4.jpg', NULL),
(104, 'ข้าวผัด', 45, 'หมูชิ้น,หมูสับ,เครื่องใน,เนื้อสับ+5,เนื้อชิ้น+5,หมูกรอบ+10,ทะเล+15,คอหมูย่าง+20,เสือร้องไห้+20,ไส้อ่อน+20', 'พิเศษ+10,ไข่ดาว+10,ไข่เจียว +10,ไข่ต้ม +10', 'ข้าว', 'images/kao1.jpg', NULL),
(105, 'ข้าวผัดพริกเกลือ', 45, 'หมูชิ้น,หมูสับ,เครื่องใน,เนื้อสับ+5,เนื้อชิ้น+5,หมูกรอบ+10,ทะเล+15,คอหมูย่าง+20,เสือร้องไห้+20,ไส้อ่อน+20', 'พิเศษ+10,ไข่ดาว+10,ไข่เจียว +10,ไข่ต้ม +10', 'ข้าว', 'images/kao3.jpg', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `orders`
--

CREATE TABLE `orders` (
  `id` int(11) NOT NULL,
  `table_number` varchar(10) NOT NULL,
  `menu_name` varchar(100) NOT NULL,
  `status` varchar(50) DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `addons` varchar(255) DEFAULT '',
  `price` int(11) DEFAULT 0,
  `qty` int(11) DEFAULT 1,
  `payment_method` varchar(50) DEFAULT '-',
  `bill_id` varchar(50) DEFAULT NULL,
  `checkout_time` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `system_settings`
--

CREATE TABLE `system_settings` (
  `setting_key` varchar(50) NOT NULL,
  `setting_value` text NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `system_settings`
--

INSERT INTO `system_settings` (`setting_key`, `setting_value`) VALUES
('category_order', '[\"แจ่วฮ้อน\",\"ข้าว\",\"ประเภทยำ / ลวกจิ้ม / มะนาว\",\"ประเภทลาบ / ก้อย / อาหารอีสาน\",\"เครื่องดื่ม\"]');

--
-- Indexes for dumped tables
--

--
-- Indexes for table `menus`
--
ALTER TABLE `menus`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `orders`
--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `system_settings`
--
ALTER TABLE `system_settings`
  ADD PRIMARY KEY (`setting_key`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `menus`
--
ALTER TABLE `menus`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=106;

--
-- AUTO_INCREMENT for table `orders`
--
ALTER TABLE `orders`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=201;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
