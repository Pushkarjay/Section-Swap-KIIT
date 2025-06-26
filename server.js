const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');
const nodemailer = require('nodemailer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('.'));

// Database setup - auto-detect PostgreSQL or MySQL
let pool;
const isPostgreSQL = process.env.DATABASE_URL && process.env.DATABASE_URL.includes('postgres');

if (isPostgreSQL) {
    console.log('🐘 Using PostgreSQL for production');
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
} else {
    console.log('🐬 Using MySQL for local development');
    const mysql = require('mysql2/promise');
    if (process.env.DATABASE_URL) {
        const url = new URL(process.env.DATABASE_URL);
        pool = mysql.createPool({
            host: url.hostname,
            port: url.port || 3306,
            user: url.username,
            password: url.password,
            database: url.pathname.slice(1),
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    } else {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'section_swap_db',
            waitForConnections: true,
            connectionLimit: 10,
            queueLimit: 0
        });
    }
}

// Email configuration (optional)
let transporter = null;
if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
    transporter = nodemailer.createTransporter({
        service: process.env.EMAIL_SERVICE || 'gmail',
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS
        }
    });
    console.log('📧 Email notifications enabled');
} else {
    console.log('📧 Email notifications disabled (no credentials provided)');
}

// Database helper functions
async function executeQuery(query, params = []) {
    if (isPostgreSQL) {
        const client = await pool.connect();
        try {
            const result = await client.query(query, params);
            return [result.rows];
        } finally {
            client.release();
        }
    } else {
        const connection = await pool.getConnection();
        try {
            const [rows] = await connection.execute(query, params);
            return [rows];
        } finally {
            connection.release();
        }
    }
}

// Initialize Database
async function initializeDatabase() {
    try {
        console.log('🔌 Initializing database...');
        
        if (isPostgreSQL) {
            // PostgreSQL table creation
            await executeQuery(`
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
                )
            `);
            
            await executeQuery(`
                CREATE TABLE IF NOT EXISTS swap_requests (
                    id SERIAL PRIMARY KEY,
                    requester_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
                    target_section VARCHAR(10) NOT NULL,
                    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'cancelled')),
                    swap_type VARCHAR(10) DEFAULT 'direct' CHECK (swap_type IN ('direct', 'multi')),
                    swap_path TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            await executeQuery(`
                CREATE TABLE IF NOT EXISTS swap_history (
                    id SERIAL PRIMARY KEY,
                    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
                    from_section VARCHAR(10) NOT NULL,
                    to_section VARCHAR(10) NOT NULL,
                    swap_partner_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
                    swap_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            console.log('✅ PostgreSQL tables created successfully');
        } else {
            // MySQL table creation
            const connection = await pool.getConnection();
            try {
                await connection.execute(`CREATE DATABASE IF NOT EXISTS section_swap_db`);
                await connection.execute(`USE section_swap_db`);
                
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS students (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        roll_number VARCHAR(20) UNIQUE NOT NULL,
                        name VARCHAR(100) NOT NULL,
                        phone_number VARCHAR(15) NOT NULL,
                        email VARCHAR(100),
                        password_hash VARCHAR(255) NOT NULL,
                        current_section VARCHAR(10) NOT NULL,
                        desired_section VARCHAR(10),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS swap_requests (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        requester_id INT NOT NULL,
                        target_section VARCHAR(10) NOT NULL,
                        status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
                        swap_type ENUM('direct', 'multi') DEFAULT 'direct',
                        swap_path JSON,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        FOREIGN KEY (requester_id) REFERENCES students(id)
                    )
                `);
                
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS swap_history (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        student_id INT NOT NULL,
                        from_section VARCHAR(10) NOT NULL,
                        to_section VARCHAR(10) NOT NULL,
                        swap_partner_id INT,
                        swap_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (student_id) REFERENCES students(id),
                        FOREIGN KEY (swap_partner_id) REFERENCES students(id)
                    )
                `);
                
                console.log('✅ MySQL tables created successfully');
            } finally {
                connection.release();
            }
        }
        
        console.log('🎉 Database initialization completed');
    } catch (error) {
        console.error('❌ Database initialization failed:', error);
        throw error;
    }
}

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    
    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }
    
    jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key', (err, user) => {
        if (err) return res.status(403).json({ error: 'Invalid token' });
        req.user = user;
        next();
    });
};

// Email notification function
async function sendSwapNotification(toEmail, studentName, partnerName, partnerRoll, partnerSection, currentSection, desiredSection, swapType = 'direct') {
    if (!transporter || !toEmail) return;
    
    try {
        const mailOptions = {
            from: process.env.EMAIL_FROM || 'KIIT Section Swap <noreply@sectionswap.com>',
            to: toEmail,
            subject: `🔄 Potential Section Swap Found - ${currentSection} ↔ ${desiredSection}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                    <h2 style="color: #2c3e50; text-align: center;">🎉 Potential Section Swap Found!</h2>
                    
                    <div style="background-color: #f8f9fa; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <p><strong>Hi ${studentName},</strong></p>
                        <p>Great news! We found a potential ${swapType} swap partner for you:</p>
                    </div>
                    
                    <div style="background-color: #e3f2fd; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3 style="color: #1976d2; margin-top: 0;">Swap Details:</h3>
                        <p><strong>Partner:</strong> ${partnerName} (${partnerRoll})</p>
                        <p><strong>Your Section:</strong> ${currentSection} → <strong>${desiredSection}</strong></p>
                        <p><strong>Partner's Section:</strong> ${partnerSection} → <strong>${currentSection}</strong></p>
                        <p><strong>Swap Type:</strong> ${swapType === 'direct' ? 'Direct Swap' : 'Multi-Step Swap'}</p>
                    </div>
                    
                    <div style="background-color: #fff3cd; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #ffc107;">
                        <h4 style="color: #856404; margin-top: 0;">⚠️ Important:</h4>
                        <p>This is an <strong>unofficial notification</strong>. Please:</p>
                        <ul>
                            <li>Contact your swap partner to confirm interest</li>
                            <li>Complete the swap through <strong>official KIIT procedures</strong></li>
                            <li>Verify with your academic office before making changes</li>
                        </ul>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px;">
                        <a href="https://section-swap-kiit.onrender.com" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 5px; display: inline-block;">
                            View on Platform
                        </a>
                    </div>
                    
                    <hr style="margin: 30px 0; border: 1px solid #eee;">
                    <p style="font-size: 12px; color: #6c757d; text-align: center;">
                        This email was sent by the unofficial KIIT Section Swap platform.<br>
                        This is not an official KIIT communication.
                    </p>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        console.log(`📧 Swap notification sent to ${toEmail}`);
    } catch (error) {
        console.error('📧 Email send error:', error);
    }
}

// Routes

// Register new student
app.post('/api/register', async (req, res) => {
    try {
        const { rollNumber, name, phoneNumber, email, password, currentSection } = req.body;
        
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        if (isPostgreSQL) {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection]
            );
            res.status(201).json({ message: 'Student registered successfully', id: result[0].id });
        } else {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section) VALUES (?, ?, ?, ?, ?, ?)',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection]
            );
            res.status(201).json({ message: 'Student registered successfully', id: result.insertId });
        }
    } catch (error) {
        console.error('Registration error:', error);
        if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
            res.status(400).json({ error: 'Roll number already exists' });
        } else {
            res.status(500).json({ error: 'Registration failed' });
        }
    }
});

// Login
app.post('/api/login', async (req, res) => {
    try {
        const { rollNumber, password } = req.body;
        
        const [rows] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE roll_number = $1' : 'SELECT * FROM students WHERE roll_number = ?',
            [rollNumber]
        );
        
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const student = rows[0];
        const validPassword = await bcrypt.compare(password, student.password_hash);
        
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        const token = jwt.sign(
            { id: student.id, rollNumber: student.roll_number },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        
        res.json({
            message: 'Login successful',
            token,
            student: {
                id: student.id,
                rollNumber: student.roll_number,
                name: student.name,
                currentSection: student.current_section,
                desiredSection: student.desired_section
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Get student profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [rows] = await executeQuery(
            isPostgreSQL ? 
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_section, created_at FROM students WHERE id = $1' :
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_section, created_at FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(rows[0]);
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, phoneNumber, email, desiredSection } = req.body;
        
        await executeQuery(
            isPostgreSQL ?
                'UPDATE students SET name = $1, phone_number = $2, email = $3, desired_section = $4 WHERE id = $5' :
                'UPDATE students SET name = ?, phone_number = ?, email = ?, desired_section = ? WHERE id = ?',
            [name, phoneNumber, email, desiredSection, req.user.id]
        );
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Find swap options
app.post('/api/find-swap', authenticateToken, async (req, res) => {
    try {
        const { desiredSection } = req.body;
        
        // Get current student info
        const [currentStudent] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (currentStudent.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = currentStudent[0];
        
        // Check for direct swap
        const [directSwapPartners] = await executeQuery(
            isPostgreSQL ? `
                SELECT id, roll_number, name, current_section, desired_section 
                FROM students 
                WHERE current_section = $1 AND desired_section = $2 AND id != $3
            ` : `
                SELECT id, roll_number, name, current_section, desired_section 
                FROM students 
                WHERE current_section = ? AND desired_section = ? AND id != ?
            `,
            [desiredSection, student.current_section, student.id]
        );
        
        if (directSwapPartners.length > 0) {
            const partner = directSwapPartners[0];
            
            // Send email notification if student has email
            if (student.email) {
                await sendSwapNotification(
                    student.email,
                    student.name,
                    partner.name,
                    partner.roll_number,
                    partner.current_section,
                    student.current_section,
                    desiredSection,
                    'direct'
                );
            }
            
            return res.json({
                type: 'direct',
                partner: partner
            });
        }
        
        // Find multi-step swap
        const swapPath = await findMultiStepSwap(student.current_section, desiredSection, student.id);
        
        if (swapPath) {
            // Send email notification for multi-step swap
            if (student.email && swapPath.length > 0) {
                const firstStep = swapPath[0];
                await sendSwapNotification(
                    student.email,
                    student.name,
                    firstStep.student ? firstStep.student.name : 'Multiple Students',
                    firstStep.student ? firstStep.student.roll_number : 'Various',
                    firstStep.from,
                    student.current_section,
                    desiredSection,
                    'multi-step'
                );
            }
            
            return res.json({
                type: 'multi',
                path: swapPath
            });
        }
        
        res.json({ type: 'none' });
    } catch (error) {
        console.error('Find swap error:', error);
        res.status(500).json({ error: 'Failed to find swap options' });
    }
});

// Create swap request
app.post('/api/swap-request', authenticateToken, async (req, res) => {
    try {
        const { targetSection, swapType, swapPath } = req.body;
        
        const [result] = await pool.execute(
            'INSERT INTO swap_requests (requester_id, target_section, swap_type, swap_path) VALUES (?, ?, ?, ?)',
            [req.user.id, targetSection, swapType, JSON.stringify(swapPath || null)]
        );
        
        res.json({ message: 'Swap request created successfully', requestId: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create swap request' });
    }
});

// Get swap history
app.get('/api/swap-history', authenticateToken, async (req, res) => {
    try {
        const [rows] = await pool.execute(`
            SELECT sh.*, sp.roll_number as partner_roll_number, sp.name as partner_name
            FROM swap_history sh
            LEFT JOIN students sp ON sh.swap_partner_id = sp.id
            WHERE sh.student_id = ?
            ORDER BY sh.swap_date DESC
        `, [req.user.id]);
        
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch swap history' });
    }
});

// Get dashboard data
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        // Get current student
        const [student] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        // Get pending requests
        const [pendingRequests] = await executeQuery(
            isPostgreSQL ? 
                'SELECT * FROM swap_requests WHERE requester_id = $1 AND status = $2' :
                'SELECT * FROM swap_requests WHERE requester_id = ? AND status = ?',
            [req.user.id, 'pending']
        );
        
        // Get swap history count
        const [historyCount] = await executeQuery(
            isPostgreSQL ? 
                'SELECT COUNT(*) as count FROM swap_history WHERE student_id = $1' :
                'SELECT COUNT(*) as count FROM swap_history WHERE student_id = ?',
            [req.user.id]
        );
        
        // Get all students for swap sheet
        const [allStudents] = await executeQuery(`
            SELECT roll_number, name, current_section, desired_section
            FROM students
            ORDER BY roll_number
        `);
        
        res.json({
            student: student[0],
            pendingRequests: pendingRequests.length,
            totalSwaps: historyCount[0].count,
            allStudents
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
});

// Multi-step swap algorithm
async function findMultiStepSwap(fromSection, toSection, excludeId) {
    try {
        // Get all students and their desired swaps
        const [students] = await pool.execute(`
            SELECT id, roll_number, name, current_section, desired_section 
            FROM students 
            WHERE current_section != desired_section AND id != ?
        `, [excludeId]);
        
        // Create graph
        const graph = {};
        const studentMap = {};
        
        students.forEach(student => {
            if (!graph[student.current_section]) {
                graph[student.current_section] = [];
            }
            graph[student.current_section].push(student.desired_section);
            studentMap[student.current_section] = student;
        });
        
        // BFS to find path
        const queue = [[fromSection]];
        const visited = new Set([fromSection]);
        
        while (queue.length > 0) {
            const path = queue.shift();
            const current = path[path.length - 1];
            
            if (current === toSection) {
                // Convert path to steps with student info
                const steps = [];
                for (let i = 0; i < path.length - 1; i++) {
                    const student = studentMap[path[i]];
                    steps.push({
                        from: path[i],
                        to: path[i + 1],
                        student: student || null
                    });
                }
                return steps;
            }
            
            if (graph[current]) {
                for (const neighbor of graph[current]) {
                    if (!visited.has(neighbor)) {
                        visited.add(neighbor);
                        queue.push([...path, neighbor]);
                    }
                }
            }
        }
        
        return null;
    } catch (error) {
        console.error('Error in findMultiStepSwap:', error);
        return null;
    }
}

// Initialize database and start server
initializeDatabase().then(() => {
    app.listen(PORT, () => {
        console.log(`Server running on http://localhost:${PORT}`);
    });
});
