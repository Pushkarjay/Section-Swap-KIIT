-- PostgreSQL Setup Script for Render Deployment
-- This script creates the required tables for the Section Swap System

-- Create the database (if not exists)
-- Note: Render creates the database automatically, so we just create tables

-- Students table
CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    roll_number VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone_number VARCHAR(20),
    email VARCHAR(100),
    password_hash VARCHAR(255) NOT NULL,
    current_section VARCHAR(10) NOT NULL,
    desired_section VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Swap requests table
CREATE TABLE IF NOT EXISTS swap_requests (
    id SERIAL PRIMARY KEY,
    requester_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    target_section VARCHAR(10) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
    swap_type VARCHAR(10) DEFAULT 'direct' CHECK (swap_type IN ('direct', 'multi')),
    swap_path TEXT, -- JSON string for multi-step swaps
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Swap history table
CREATE TABLE IF NOT EXISTS swap_history (
    id SERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    from_section VARCHAR(10) NOT NULL,
    to_section VARCHAR(10) NOT NULL,
    swap_partner_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    swap_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_students_roll ON students(roll_number);
CREATE INDEX IF NOT EXISTS idx_students_current_section ON students(current_section);
CREATE INDEX IF NOT EXISTS idx_students_desired_section ON students(desired_section);
CREATE INDEX IF NOT EXISTS idx_swap_requests_status ON swap_requests(status);
CREATE INDEX IF NOT EXISTS idx_swap_history_date ON swap_history(swap_date);

-- Insert sample data for testing (optional)
INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_section) 
VALUES 
    ('2106001', 'John Doe', '9876543210', 'john@kiit.ac.in', '$2a$10$example_hash_here', 'A1', 'B2'),
    ('2106002', 'Jane Smith', '9876543211', 'jane@kiit.ac.in', '$2a$10$example_hash_here', 'B2', 'A1'),
    ('2106003', 'Alice Johnson', '9876543212', 'alice@kiit.ac.in', '$2a$10$example_hash_here', 'C3', 'D4'),
    ('2106004', 'Bob Wilson', '9876543213', 'bob@kiit.ac.in', '$2a$10$example_hash_here', 'D4', 'C3')
ON CONFLICT (roll_number) DO NOTHING;

-- Show tables created
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
