-- Section Swap Database Setup Script
-- Run this script in MySQL to set up the database

CREATE DATABASE IF NOT EXISTS section_swap_db;
USE section_swap_db;

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id INT AUTO_INCREMENT PRIMARY KEY,
    roll_number VARCHAR(20) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(15) NOT NULL,
    email VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    current_section VARCHAR(10) NOT NULL,
    desired_sections JSON, -- Array of sections in priority order
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_roll_number (roll_number),
    INDEX idx_current_section (current_section)
);

-- Swap requests table
CREATE TABLE IF NOT EXISTS swap_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    requester_id INT NOT NULL,
    target_section VARCHAR(10) NOT NULL,
    status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
    swap_type ENUM('direct', 'multi') DEFAULT 'direct',
    swap_path JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (requester_id) REFERENCES students(id) ON DELETE CASCADE,
    INDEX idx_requester_status (requester_id, status),
    INDEX idx_target_section (target_section)
);

-- Swap history table
CREATE TABLE IF NOT EXISTS swap_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    student_id INT NOT NULL,
    from_section VARCHAR(10) NOT NULL,
    to_section VARCHAR(10) NOT NULL,
    swap_partner_id INT,
    swap_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY (swap_partner_id) REFERENCES students(id) ON DELETE SET NULL,
    INDEX idx_student_date (student_id, swap_date),
    INDEX idx_sections (from_section, to_section)
);

-- Insert sample data for testing
INSERT IGNORE INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_sections) VALUES
('21051001', 'John Doe', '9876543210', 'john@kiit.ac.in', '$2a$10$example.hash.here', '4', '["32"]'),
('21051002', 'Jane Smith', '9876543211', 'jane@kiit.ac.in', '$2a$10$example.hash.here', '5', '["20"]'),
('21051003', 'Bob Johnson', '9876543212', 'bob@kiit.ac.in', '$2a$10$example.hash.here', '6', '["6"]'),
('21051004', 'Alice Brown', '9876543213', 'alice@kiit.ac.in', '$2a$10$example.hash.here', '20', '["4"]'),
('21051005', 'Charlie Wilson', '9876543214', 'charlie@kiit.ac.in', '$2a$10$example.hash.here', '32', '["5"]');

-- Create a view for easy querying
CREATE OR REPLACE VIEW student_swap_view AS
SELECT 
    s.id,
    s.roll_number,
    s.name,
    s.current_section,
    s.desired_sections,
    s.phone_number,
    s.email,
    CASE 
        WHEN JSON_CONTAINS(s.desired_sections, JSON_QUOTE(s.current_section)) THEN 'Satisfied'
        WHEN s.desired_sections IS NULL OR JSON_LENGTH(s.desired_sections) = 0 THEN 'No preference'
        ELSE 'Looking for swap'
    END as status
FROM students s
ORDER BY s.roll_number;

SHOW TABLES;
DESCRIBE students;
DESCRIBE swap_requests;
DESCRIBE swap_history;

SELECT 'Database setup completed successfully!' as message;
