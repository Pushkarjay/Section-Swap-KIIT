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
    try {
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
    } catch (error) {
        console.error('Database query error:', error.message);
        console.error('Query:', query);
        console.error('Params:', params);
        throw error;
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
                    desired_sections TEXT, -- JSON array of sections in priority order
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            
            // Add the desired_sections column if it doesn't exist (for existing databases)
            try {
                await executeQuery(`
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS desired_sections TEXT
                `);
            } catch (e) {
                // Column might already exist, ignore error
                console.log('Column desired_sections already exists or other issue:', e.message);
            }
            
            // Migrate data from old column name if it exists
            try {
                await executeQuery(`
                    UPDATE students SET desired_sections = desired_section 
                    WHERE desired_sections IS NULL AND desired_section IS NOT NULL
                `);
                console.log('✅ Migrated data from desired_section to desired_sections');
            } catch (e) {
                // Old column doesn't exist, ignore
                console.log('No migration needed for desired_section column');
            }
            
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
                        desired_sections JSON, -- Array of sections in priority order
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
        const { rollNumber, name, phoneNumber, email, password, currentSection, desiredSections } = req.body;
        
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Convert desired sections array to JSON string
        const desiredSectionsJson = JSON.stringify(desiredSections || []);
        
        if (isPostgreSQL) {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_sections) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection, desiredSectionsJson]
            );
            res.status(201).json({ message: 'Student registered successfully', id: result[0].id });
        } else {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_sections) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection, desiredSectionsJson]
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
                desiredSections: student.desired_sections ? JSON.parse(student.desired_sections) : []
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
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_sections, created_at FROM students WHERE id = $1' :
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_sections, created_at FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = rows[0];
        res.json({
            ...student,
            desired_sections: student.desired_sections ? JSON.parse(student.desired_sections) : []
        });
    } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
    }
});

// Update profile
app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const { name, phoneNumber, email, desiredSections } = req.body;
        
        // Convert desired sections array to JSON string
        const desiredSectionsJson = JSON.stringify(desiredSections || []);
        
        await executeQuery(
            isPostgreSQL ?
                'UPDATE students SET name = $1, phone_number = $2, email = $3, desired_sections = $4 WHERE id = $5' :
                'UPDATE students SET name = ?, phone_number = ?, email = ?, desired_sections = ? WHERE id = ?',
            [name, phoneNumber, email, desiredSectionsJson, req.user.id]
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
        const { desiredSection } = req.body; // Single section for immediate search
        
        // Get current student info
        const [currentStudent] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (currentStudent.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = currentStudent[0];
        
        // If searching for a specific section, use that; otherwise use priority list
        const sectionsToSearch = desiredSection ? [desiredSection] : 
            (student.desired_sections ? JSON.parse(student.desired_sections) : []);
        
        if (sectionsToSearch.length === 0) {
            return res.json({ type: 'none', message: 'No desired sections specified' });
        }
        
        // Check each desired section in priority order
        for (const targetSection of sectionsToSearch) {
            if (targetSection === student.current_section) {
                continue; // Skip if already in desired section
            }
            
            // Check for direct swap
            const [directSwapPartners] = await executeQuery(
                isPostgreSQL ? `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = $1 AND id != $2
                ` : `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = ? AND id != ?
                `,
                [targetSection, student.id]
            );
            
            // Find partners who want student's current section
            const directPartner = directSwapPartners.find(partner => {
                if (!partner.desired_sections) return false;
                try {
                    const partnerDesired = JSON.parse(partner.desired_sections);
                    return partnerDesired.includes(student.current_section);
                } catch (e) {
                    return false;
                }
            });
            
            if (directPartner) {
                // Send email notification if student has email
                if (student.email) {
                    await sendSwapNotification(
                        student.email,
                        student.name,
                        directPartner.name,
                        directPartner.roll_number,
                        directPartner.current_section,
                        student.current_section,
                        targetSection,
                        'direct'
                    );
                }
                
                return res.json({
                    type: 'direct',
                    partner: directPartner,
                    targetSection: targetSection
                });
            }
            
            // Find multi-step swap for this section
            const swapPath = await findMultiStepSwap(student.current_section, targetSection, student.id);
            
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
                        targetSection,
                        'multi-step'
                    );
                }
                
                return res.json({
                    type: 'multi',
                    path: swapPath,
                    targetSection: targetSection
                });
            }
        }
        
        res.json({ 
            type: 'none', 
            message: `No swaps found for any of your desired sections: ${sectionsToSearch.join(', ')}` 
        });
    } catch (error) {
        console.error('Find swap error:', error);
        res.status(500).json({ error: 'Failed to find swap options' });
    }
});

// Find swaps automatically across all desired sections
app.post('/api/find-all-swaps', authenticateToken, async (req, res) => {
    try {
        // Get current student info
        const [currentStudent] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (currentStudent.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = currentStudent[0];
        const desiredSections = student.desired_sections ? JSON.parse(student.desired_sections) : [];
        
        if (desiredSections.length === 0) {
            return res.json({ 
                type: 'none', 
                message: 'No desired sections specified. Please update your profile to add desired sections.' 
            });
        }
        
        const swapResults = [];
        
        // Check each desired section in priority order
        for (let i = 0; i < desiredSections.length; i++) {
            const targetSection = desiredSections[i];
            
            if (targetSection === student.current_section) {
                continue; // Skip if already in desired section
            }
            
            // Check for direct swap
            const [directSwapPartners] = await executeQuery(
                isPostgreSQL ? `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = $1 AND id != $2
                ` : `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = ? AND id != ?
                `,
                [targetSection, student.id]
            );
            
            // Find partners who want student's current section
            const directPartners = directSwapPartners.filter(partner => {
                if (!partner.desired_sections) return false;
                try {
                    const partnerDesired = JSON.parse(partner.desired_sections);
                    return partnerDesired.includes(student.current_section);
                } catch (e) {
                    return false;
                }
            });
            
            if (directPartners.length > 0) {
                swapResults.push({
                    type: 'direct',
                    targetSection: targetSection,
                    priority: i + 1,
                    partners: directPartners
                });
            }
            
            // Find multi-step swap for this section
            const swapPath = await findMultiStepSwap(student.current_section, targetSection, student.id);
            
            if (swapPath) {
                swapResults.push({
                    type: 'multi',
                    targetSection: targetSection,
                    priority: i + 1,
                    path: swapPath
                });
            }
        }
        
        // Send email notification for the highest priority swap found
        if (swapResults.length > 0 && student.email) {
            const bestSwap = swapResults[0]; // First result has highest priority
            
            if (bestSwap.type === 'direct') {
                const partner = bestSwap.partners[0];
                await sendSwapNotification(
                    student.email,
                    student.name,
                    partner.name,
                    partner.roll_number,
                    partner.current_section,
                    student.current_section,
                    bestSwap.targetSection,
                    'direct'
                );
            } else if (bestSwap.type === 'multi') {
                const firstStep = bestSwap.path[0];
                await sendSwapNotification(
                    student.email,
                    student.name,
                    firstStep.student ? firstStep.student.name : 'Multiple Students',
                    firstStep.student ? firstStep.student.roll_number : 'Various',
                    firstStep.from,
                    student.current_section,
                    bestSwap.targetSection,
                    'multi-step'
                );
            }
        }
        
        if (swapResults.length === 0) {
            res.json({ 
                type: 'none', 
                message: `No swaps found for any of your desired sections: ${desiredSections.join(', ')}`,
                desiredSections: desiredSections
            });
        } else {
            res.json({
                type: 'multiple',
                swaps: swapResults,
                desiredSections: desiredSections
            });
        }
    } catch (error) {
        console.error('Find all swaps error:', error);
        res.status(500).json({ error: 'Failed to find swap options' });
    }
});

// Create swap request
app.post('/api/swap-request', authenticateToken, async (req, res) => {
    try {
        const { targetSection, swapType, swapPath } = req.body;
        
        if (isPostgreSQL) {
            const [result] = await executeQuery(
                'INSERT INTO swap_requests (requester_id, target_section, swap_type, swap_path) VALUES ($1, $2, $3, $4) RETURNING id',
                [req.user.id, targetSection, swapType, JSON.stringify(swapPath || null)]
            );
            res.json({ message: 'Swap request created successfully', requestId: result[0].id });
        } else {
            const [result] = await executeQuery(
                'INSERT INTO swap_requests (requester_id, target_section, swap_type, swap_path) VALUES (?, ?, ?, ?)',
                [req.user.id, targetSection, swapType, JSON.stringify(swapPath || null)]
            );
            res.json({ message: 'Swap request created successfully', requestId: result.insertId });
        }
    } catch (error) {
        console.error('Swap request error:', error);
        res.status(500).json({ error: 'Failed to create swap request' });
    }
});

// Get swap history
app.get('/api/swap-history', authenticateToken, async (req, res) => {
    try {
        const [rows] = await executeQuery(
            isPostgreSQL ? `
                SELECT sh.*, sp.roll_number as partner_roll_number, sp.name as partner_name
                FROM swap_history sh
                LEFT JOIN students sp ON sh.swap_partner_id = sp.id
                WHERE sh.student_id = $1
                ORDER BY sh.swap_date DESC
            ` : `
                SELECT sh.*, sp.roll_number as partner_roll_number, sp.name as partner_name
                FROM swap_history sh
                LEFT JOIN students sp ON sh.swap_partner_id = sp.id
                WHERE sh.student_id = ?
                ORDER BY sh.swap_date DESC
            `,
            [req.user.id]
        );
        
        res.json(rows);
    } catch (error) {
        console.error('Swap history error:', error);
        res.status(500).json({ error: 'Failed to fetch swap history' });
    }
});

// Get dashboard data
app.get('/api/dashboard', authenticateToken, async (req, res) => {
    try {
        console.log('Dashboard request from user ID:', req.user.id);
        
        // Get current student
        const [student] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (student.length === 0) {
            console.log('Student not found for ID:', req.user.id);
            return res.status(404).json({ error: 'Student not found' });
        }
        
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
            SELECT id, roll_number, name, current_section, desired_sections
            FROM students
            ORDER BY roll_number
        `);
        
        // Get comprehensive match information for all students
        const studentMatches = await checkAllStudentMatches();
        
        // Parse desired_sections for each student and add match status
        const studentsWithParsedSections = allStudents.map(student => {
            try {
                return {
                    ...student,
                    desired_sections: student.desired_sections ? JSON.parse(student.desired_sections) : [],
                    hasMatches: studentMatches[student.id] || false
                };
            } catch (e) {
                console.error('Error parsing desired_sections for student:', student.roll_number, e);
                return {
                    ...student,
                    desired_sections: [],
                    hasMatches: false
                };
            }
        });
        
        // Get available direct swaps for this student
        const availableSwaps = [];
        
        if (student[0].desired_sections) {
            try {
                const studentDesiredSections = JSON.parse(student[0].desired_sections);
                
                for (const targetSection of studentDesiredSections) {
                    if (targetSection === student[0].current_section) continue;
                    
                    // Find students in target section who want current student's section
                    const [potentialPartners] = await executeQuery(
                        isPostgreSQL ? `
                            SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                            FROM students 
                            WHERE current_section = $1 AND id != $2
                        ` : `
                            SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                            FROM students 
                            WHERE current_section = ? AND id != ?
                        `,
                        [targetSection, req.user.id]
                    );
                    
                    const directPartners = potentialPartners.filter(partner => {
                        if (!partner.desired_sections) return false;
                        try {
                            const partnerDesired = JSON.parse(partner.desired_sections);
                            return partnerDesired.includes(student[0].current_section);
                        } catch (e) {
                            return false;
                        }
                    });
                    
                    if (directPartners.length > 0) {
                        availableSwaps.push({
                            type: 'direct',
                            targetSection: targetSection,
                            partners: directPartners.map(p => ({
                                id: p.id,
                                roll_number: p.roll_number,
                                name: p.name,
                                phone_number: p.phone_number,
                                current_section: p.current_section
                            }))
                        });
                    }
                    
                    // Check for multi-step swaps for this section
                    const multiStepPath = await findMultiStepSwap(student[0].current_section, targetSection, req.user.id);
                    if (multiStepPath && multiStepPath.length > 0) {
                        availableSwaps.push({
                            type: 'multi',
                            targetSection: targetSection,
                            path: multiStepPath.map(step => ({
                                from: step.from,
                                to: step.to,
                                student: step.student ? {
                                    id: step.student.id,
                                    roll_number: step.student.roll_number,
                                    name: step.student.name,
                                    phone_number: step.student.phone_number,
                                    current_section: step.student.current_section
                                } : null,
                                isCurrentUser: step.isCurrentUser || false
                            }))
                        });
                    }
                }
            } catch (e) {
                console.error('Error checking available swaps:', e);
            }
        }
        
        const dashboardData = {
            student: {
                ...student[0],
                desired_sections: (() => {
                    try {
                        return student[0].desired_sections ? 
                            JSON.parse(student[0].desired_sections) : [];
                    } catch (e) {
                        console.error('Error parsing student desired_sections:', e);
                        return [];
                    }
                })()
            },
            pendingRequests: pendingRequests.length,
            totalSwaps: historyCount[0].count || 0,
            allStudents: studentsWithParsedSections,
            availableSwaps: availableSwaps
        };
        
        console.log('Dashboard data prepared successfully');
        res.json(dashboardData);
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data', details: error.message });
    }
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
    const health = {
        status: 'OK',
        timestamp: new Date().toISOString(),
        database: isPostgreSQL ? 'PostgreSQL' : 'MySQL',
        environment: process.env.NODE_ENV || 'development',
        databaseConnected: false
    };
    
    try {
        // Test database connection
        if (isPostgreSQL) {
            await executeQuery('SELECT 1 as test');
        } else {
            await executeQuery('SELECT 1 as test');
        }
        health.databaseConnected = true;
    } catch (error) {
        health.databaseConnected = false;
        health.databaseError = error.message;
    }
    
    res.json(health);
});

// Comprehensive multi-step swap algorithm using cycle detection
async function findMultiStepSwap(fromSection, toSection, excludeId) {
    try {
        // Get current user info first
        const [currentUserResult] = await executeQuery(
            isPostgreSQL ? `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                FROM students 
                WHERE id = $1
            ` : `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                FROM students 
                WHERE id = ?
            `,
            [excludeId]
        );
        
        const currentUser = currentUserResult.length > 0 ? currentUserResult[0] : null;
        
        // Get all other students and their desired swaps
        const [students] = await executeQuery(
            isPostgreSQL ? `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                FROM students 
                WHERE id != $1
            ` : `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                FROM students 
                WHERE id != ?
            `,
            [excludeId]
        );
        
        // Parse all students' desired sections
        const validStudents = [];
        students.forEach(student => {
            if (!student.desired_sections) return;
            
            try {
                const desiredSections = JSON.parse(student.desired_sections);
                if (!Array.isArray(desiredSections) || desiredSections.length === 0) return;
                
                validStudents.push({
                    ...student,
                    desired_sections_parsed: desiredSections
                });
            } catch (e) {
                console.error('Error parsing desired_sections for student:', student.id, e);
            }
        });
        
        // Find swap cycles using improved algorithm with current user info
        const path = findSwapCycle(fromSection, toSection, validStudents, 4, currentUser);
        return path;
    } catch (error) {
        console.error('Error in findMultiStepSwap:', error);
        return null;
    }
}

// Improved multi-step swap finder with candidate limits and systematic search
function findSwapCycle(startSection, targetSection, students, maxDepth, currentUser = null) {
    // This function finds swap chains of length 2-5 with max 5 candidates per step
    
    if (!currentUser) return null;
    
    const userDesiredSections = JSON.parse(currentUser.desired_sections || '[]');
    
    // Only proceed if the user actually wants the targetSection
    if (!userDesiredSections.includes(targetSection)) {
        return null;
    }
    
    const MAX_CANDIDATES = 5;
    const MAX_SWAP_LENGTH = 5;
    
    // Helper function to find candidates for a specific step
    function getCandidates(fromSection, toSection, excludeSections = []) {
        let candidates;
        if (toSection === null) {
            // Get all students in fromSection (for intermediate steps)
            candidates = students.filter(s => 
                s.current_section === fromSection &&
                !excludeSections.includes(s.current_section)
            );
        } else {
            // Get students in fromSection who want to go to toSection
            candidates = students.filter(s => 
                s.current_section === fromSection &&
                !excludeSections.includes(s.current_section) &&
                s.desired_sections_parsed.includes(toSection)
            );
        }
        return candidates.slice(0, MAX_CANDIDATES); // Limit to 5 candidates
    }
    
    // Try swap chains of increasing length: 2, 3, 4, 5
    for (let swapLength = 2; swapLength <= MAX_SWAP_LENGTH; swapLength++) {
        console.log(`Trying ${swapLength}-step swap from ${startSection} to ${targetSection}`);
        
        if (swapLength === 2) {
            // Direct swap: User -> Target student -> User
            const directCandidates = getCandidates(targetSection, startSection);
            if (directCandidates.length > 0) {
                return [
                    {
                        from: startSection,
                        to: targetSection,
                        student: currentUser,
                        isCurrentUser: true
                    },
                    {
                        from: targetSection,
                        to: startSection,
                        student: directCandidates[0],
                        isCurrentUser: false
                    }
                ];
            }
        }
        
        if (swapLength === 3) {
            // 3-step swap: User -> A -> Target -> User
            for (const desiredA of userDesiredSections) {
                if (desiredA === startSection || desiredA === targetSection) continue;
                
                const candidatesA = getCandidates(desiredA, targetSection, [startSection]);
                for (const studentA of candidatesA) {
                    const candidatesTarget = getCandidates(targetSection, startSection, [desiredA]);
                    if (candidatesTarget.length > 0) {
                        return [
                            {
                                from: startSection,
                                to: desiredA,
                                student: currentUser,
                                isCurrentUser: true
                            },
                            {
                                from: desiredA,
                                to: targetSection,
                                student: studentA,
                                isCurrentUser: false
                            },
                            {
                                from: targetSection,
                                to: startSection,
                                student: candidatesTarget[0],
                                isCurrentUser: false
                            }
                        ];
                    }
                }
            }
        }
        
        if (swapLength === 4) {
            // 4-step swap: User -> A -> B -> Target -> User
            for (const desiredA of userDesiredSections) {
                if (desiredA === startSection || desiredA === targetSection) continue;
                
                const candidatesA = getCandidates(desiredA, null, [startSection]);
                for (const studentA of candidatesA.slice(0, MAX_CANDIDATES)) {
                    for (const desiredB of studentA.desired_sections_parsed) {
                        if (desiredB === startSection || desiredB === targetSection || desiredB === desiredA) continue;
                        
                        const candidatesB = getCandidates(desiredB, targetSection, [startSection, desiredA]);
                        for (const studentB of candidatesB) {
                            const candidatesTarget = getCandidates(targetSection, startSection, [desiredA, desiredB]);
                            if (candidatesTarget.length > 0) {
                                return [
                                    {
                                        from: startSection,
                                        to: desiredA,
                                        student: currentUser,
                                        isCurrentUser: true
                                    },
                                    {
                                        from: desiredA,
                                        to: desiredB,
                                        student: studentA,
                                        isCurrentUser: false
                                    },
                                    {
                                        from: desiredB,
                                        to: targetSection,
                                        student: studentB,
                                        isCurrentUser: false
                                    },
                                    {
                                        from: targetSection,
                                        to: startSection,
                                        student: candidatesTarget[0],
                                        isCurrentUser: false
                                    }
                                ];
                            }
                        }
                    }
                }
            }
        }
        
        if (swapLength === 5) {
            // 5-step swap: User -> A -> B -> C -> Target -> User
            for (const desiredA of userDesiredSections) {
                if (desiredA === startSection || desiredA === targetSection) continue;
                
                const candidatesA = getCandidates(desiredA, null, [startSection]);
                for (const studentA of candidatesA.slice(0, MAX_CANDIDATES)) {
                    for (const desiredB of studentA.desired_sections_parsed) {
                        if (desiredB === startSection || desiredB === targetSection || desiredB === desiredA) continue;
                        
                        const candidatesB = getCandidates(desiredB, null, [startSection, desiredA]);
                        for (const studentB of candidatesB.slice(0, MAX_CANDIDATES)) {
                            for (const desiredC of studentB.desired_sections_parsed) {
                                if (desiredC === startSection || desiredC === targetSection || 
                                    desiredC === desiredA || desiredC === desiredB) continue;
                                
                                const candidatesC = getCandidates(desiredC, targetSection, [startSection, desiredA, desiredB]);
                                for (const studentC of candidatesC) {
                                    const candidatesTarget = getCandidates(targetSection, startSection, [desiredA, desiredB, desiredC]);
                                    if (candidatesTarget.length > 0) {
                                        return [
                                            {
                                                from: startSection,
                                                to: desiredA,
                                                student: currentUser,
                                                isCurrentUser: true
                                            },
                                            {
                                                from: desiredA,
                                                to: desiredB,
                                                student: studentA,
                                                isCurrentUser: false
                                            },
                                            {
                                                from: desiredB,
                                                to: desiredC,
                                                student: studentB,
                                                isCurrentUser: false
                                            },
                                            {
                                                from: desiredC,
                                                to: targetSection,
                                                student: studentC,
                                                isCurrentUser: false
                                            },
                                            {
                                                from: targetSection,
                                                to: startSection,
                                                student: candidatesTarget[0],
                                                isCurrentUser: false
                                            }
                                        ];
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    
    console.log(`No valid swap chain found from ${startSection} to ${targetSection}`);
    return null; // No valid cycle found for this specific target section
}

// Enhanced function to check if any student has potential swaps (direct or multi-step)
async function checkAllStudentMatches() {
    try {
        const [allStudents] = await executeQuery(`
            SELECT id, roll_number, name, current_section, desired_sections
            FROM students
            ORDER BY roll_number
        `);
        
        const studentMatches = {};
        
        // Parse all students' desired sections
        const validStudents = [];
        allStudents.forEach(student => {
            if (!student.desired_sections) {
                studentMatches[student.id] = false;
                return;
            }
            
            try {
                const desiredSections = JSON.parse(student.desired_sections);
                if (!Array.isArray(desiredSections) || desiredSections.length === 0) {
                    studentMatches[student.id] = false;
                    return;
                }
                
                validStudents.push({
                    ...student,
                    desired_sections_parsed: desiredSections
                });
            } catch (e) {
                console.error('Error parsing desired_sections for student:', student.id, e);
                studentMatches[student.id] = false;
            }
        });
        
        // For each student, check if they have any matches
        for (const student of validStudents) {
            let hasMatch = false;
            
            // Check each desired section
            for (const targetSection of student.desired_sections_parsed) {
                if (targetSection === student.current_section) continue;
                
                // Check for direct matches first (faster)
                const directMatches = validStudents.filter(other => 
                    other.current_section === targetSection && 
                    other.id !== student.id &&
                    other.desired_sections_parsed.includes(student.current_section)
                );
                
                if (directMatches.length > 0) {
                    hasMatch = true;
                    break;
                }
                
                // Check for multi-step matches using simplified approach
                const otherStudents = validStudents.filter(s => s.id !== student.id);
                
                // Simple multi-step check: Look for 2-step cycles
                // A wants B's section, B wants C's section, C wants A's section
                const studentsInTarget = otherStudents.filter(s => s.current_section === targetSection);
                
                for (const middleStudent of studentsInTarget) {
                    // Check where middle student wants to go
                    for (const middleDesired of middleStudent.desired_sections_parsed) {
                        if (middleDesired === student.current_section || middleDesired === targetSection) continue;
                        
                        // Check if anyone in middleDesired section wants to come to student's section
                        const studentsInMiddleDesired = otherStudents.filter(s => 
                            s.current_section === middleDesired &&
                            s.desired_sections_parsed.includes(student.current_section)
                        );
                        
                        if (studentsInMiddleDesired.length > 0) {
                            hasMatch = true;
                            break;
                        }
                    }
                    if (hasMatch) break;
                }
                
                if (hasMatch) break;
            }
            
            studentMatches[student.id] = hasMatch;
        }
        
        return studentMatches;
    } catch (error) {
        console.error('Error in checkAllStudentMatches:', error);
        return {};
    }
}

// New endpoint to get comprehensive student match information
app.get('/api/student-matches', async (req, res) => {
    try {
        const studentMatches = await checkAllStudentMatches();
        res.json({ studentMatches });
    } catch (error) {
        console.error('Error getting student matches:', error);
        res.status(500).json({ error: 'Failed to get student matches', details: error.message });
    }
});

// Test endpoint to verify multi-step matching logic with example data
app.get('/api/test-multistep', async (req, res) => {
    try {
        // Example scenario: Suchit, Aman, Antara case
        const testStudents = [
            {
                id: 1,
                roll_number: 'SUCHIT001',
                name: 'Suchit',
                current_section: '10',
                desired_sections_parsed: ['20', '30']
            },
            {
                id: 2,
                roll_number: 'AMAN001',
                name: 'Aman',
                current_section: '20',
                desired_sections_parsed: ['30', '40']
            },
            {
                id: 3,
                roll_number: 'ANTARA001',
                name: 'Antara',
                current_section: '30',
                desired_sections_parsed: ['10', '40']
            },
            {
                id: 4,
                roll_number: 'STUDENT001',
                name: 'Student 4',
                current_section: '40',
                desired_sections_parsed: ['50']
            }
        ];
        
        // Manual analysis of the scenario
        const manualAnalysis = {
            "Suchit wants 30": {
                "direct": "Antara is in 30 and wants 10 - DIRECT MATCH!",
                "result": "Should show 'Matches found'"
            },
            "Aman wants 30": {
                "direct": "Antara is in 30 but wants 10, not 20 - no direct match",
                "multiStep": "Aman(20)→Suchit(10)→Antara(30) - but Suchit wants 30, not 20",
                "result": "Complex multi-step needed"
            },
            "Antara wants 10": {
                "direct": "Suchit is in 10 and wants 30 - but also wants 20, not necessarily 30",
                "result": "Should show 'Matches found' due to direct with Suchit"
            }
        };
        
        // Test the algorithm for each student
        const results = {};
        
        for (const student of testStudents) {
            results[student.name] = {};
            
            for (const targetSection of student.desired_sections_parsed) {
                const otherStudents = testStudents.filter(s => s.id !== student.id);
                
                // Test direct matches
                const directMatches = otherStudents.filter(other => 
                    other.current_section === targetSection && 
                    other.desired_sections_parsed.includes(student.current_section)
                );
                
                // Test simple 2-step multi-step
                let simpleMultiStep = false;
                const studentsInTarget = otherStudents.filter(s => s.current_section === targetSection);
                
                for (const middleStudent of studentsInTarget) {
                    for (const middleDesired of middleStudent.desired_sections_parsed) {
                        if (middleDesired === student.current_section || middleDesired === targetSection) continue;
                        
                        const studentsInMiddleDesired = otherStudents.filter(s => 
                            s.current_section === middleDesired &&
                            s.desired_sections_parsed.includes(student.current_section)
                        );
                        
                        if (studentsInMiddleDesired.length > 0) {
                            simpleMultiStep = true;
                            break;
                        }
                    }
                    if (simpleMultiStep) break;
                }
                
                // Test full cycle detection
                const cycle = findSwapCycle(student.current_section, targetSection, otherStudents, 4, student);
                
                results[student.name][`to_section_${targetSection}`] = {
                    directMatch: directMatches.length > 0,
                    directPartners: directMatches.map(m => `${m.name}(${m.current_section})`),
                    simpleMultiStep: simpleMultiStep,
                    fullCycle: cycle && cycle.length > 0,
                    cycleDetails: cycle,
                    hasAnyMatch: directMatches.length > 0 || simpleMultiStep || (cycle && cycle.length > 0)
                };
            }
        }
        
        // Calculate status for each student
        const statusResults = {};
        for (const student of testStudents) {
            let hasAnyMatch = false;
            
            // Check if they have desired sections and current section is not in desired list
            const hasDesiredSections = student.desired_sections_parsed.length > 0;
            const isCurrentSectionDesired = student.desired_sections_parsed.includes(student.current_section);
            
            if (hasDesiredSections && !isCurrentSectionDesired) {
                for (const targetSection of student.desired_sections_parsed) {
                    if (targetSection === student.current_section) continue;
                    
                    const otherStudents = testStudents.filter(s => s.id !== student.id);
                    
                    // Check direct matches
                    const directMatches = otherStudents.filter(other => 
                        other.current_section === targetSection && 
                        other.desired_sections_parsed.includes(student.current_section)
                    );
                    
                    if (directMatches.length > 0) {
                        hasAnyMatch = true;
                        break;
                    }
                    
                    // Check simple multi-step
                    const studentsInTarget = otherStudents.filter(s => s.current_section === targetSection);
                    
                    for (const middleStudent of studentsInTarget) {
                        for (const middleDesired of middleStudent.desired_sections_parsed) {
                            if (middleDesired === student.current_section || middleDesired === targetSection) continue;
                            
                            const studentsInMiddleDesired = otherStudents.filter(s => 
                                s.current_section === middleDesired &&
                                s.desired_sections_parsed.includes(student.current_section)
                            );
                            
                            if (studentsInMiddleDesired.length > 0) {
                                hasAnyMatch = true;
                                break;
                            }
                        }
                        if (hasAnyMatch) break;
                    }
                    
                    if (hasAnyMatch) break;
                }
            }
            
            statusResults[student.name] = {
                currentSection: student.current_section,
                desiredSections: student.desired_sections_parsed,
                hasDesiredSections,
                isCurrentSectionDesired,
                hasAnyMatch,
                status: !hasDesiredSections ? 'No preference' : 
                       isCurrentSectionDesired ? 'Satisfied' :
                       hasAnyMatch ? 'Matches found' : 'Looking for swap'
            };
        }
        
        res.json({
            testStudents,
            manualAnalysis,
            algorithmResults: results,
            statusCalculation: statusResults,
            explanation: {
                scenario: "Testing Suchit (10→20,30), Aman (20→30,40), Antara (30→10,40)",
                expectedResults: {
                    "Suchit": "Should show 'Matches found' - wants 30, Antara in 30 wants 10 (DIRECT)",
                    "Aman": "Should show 'Looking for swap' or 'Matches found' if complex multi-step works",
                    "Antara": "Should show 'Matches found' - wants 10, Suchit in 10 wants 30 (DIRECT)"
                }
            }
        });
    } catch (error) {
        console.error('Test multi-step error:', error);
        res.status(500).json({ error: 'Test failed', details: error.message });
    }
});

// Debug endpoint to check specific swap scenarios
app.get('/api/debug-swaps', async (req, res) => {
    try {
        // Get all students with their parsed desired sections
        const [allStudents] = await executeQuery(`
            SELECT id, roll_number, name, current_section, desired_sections
            FROM students
            ORDER BY roll_number
        `);
        
        const studentsWithParsed = allStudents.map(student => {
            let parsedDesired = [];
            try {
                parsedDesired = student.desired_sections ? JSON.parse(student.desired_sections) : [];
            } catch (e) {
                console.error('Parse error for student:', student.roll_number, e);
            }
            
            return {
                ...student,
                desired_sections_parsed: parsedDesired
            };
        });
        
        // Find potential direct swaps
        const potentialSwaps = [];
        
        for (let i = 0; i < studentsWithParsed.length; i++) {
            const student1 = studentsWithParsed[i];
            
            if (!student1.desired_sections_parsed || student1.desired_sections_parsed.length === 0) continue;
            
            for (let j = i + 1; j < studentsWithParsed.length; j++) {
                const student2 = studentsWithParsed[j];
                
                if (!student2.desired_sections_parsed || student2.desired_sections_parsed.length === 0) continue;
                
                // Check if they can swap directly
                const student1WantsStudent2Section = student1.desired_sections_parsed.includes(student2.current_section);
                const student2WantsStudent1Section = student2.desired_sections_parsed.includes(student1.current_section);
                
                if (student1WantsStudent2Section && student2WantsStudent1Section) {
                    potentialSwaps.push({
                        student1: {
                            roll: student1.roll_number,
                            name: student1.name,
                            current: student1.current_section,
                            wants: student1.desired_sections_parsed
                        },
                        student2: {
                            roll: student2.roll_number,
                            name: student2.name,
                            current: student2.current_section,
                            wants: student2.desired_sections_parsed
                        },
                        swapSections: `${student1.current_section} ↔ ${student2.current_section}`
                    });
                }
            }
        }
        
        res.json({
            totalStudents: studentsWithParsed.length,
            potentialDirectSwaps: potentialSwaps,
            studentsWantingSection28: studentsWithParsed.filter(s => 
                s.desired_sections_parsed && s.desired_sections_parsed.includes('28')
            ).map(s => ({
                roll: s.roll_number,
                name: s.name,
                current: s.current_section,
                wants: s.desired_sections_parsed
            })),
            studentsInSection28: studentsWithParsed.filter(s => s.current_section === '28').map(s => ({
                roll: s.roll_number,
                name: s.name,
                current: s.current_section,
                wants: s.desired_sections_parsed
            }))
        });
    } catch (error) {
        console.error('Debug swaps error:', error);
        res.status(500).json({ error: 'Debug failed', details: error.message });
    }
});

// Start server first, then initialize database
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🌐 Live demo: https://section-swap-kiit.onrender.com`);
    console.log(`🔌 Database type: ${isPostgreSQL ? 'PostgreSQL' : 'MySQL'}`);
    
    // Initialize database after server starts
    initializeDatabase()
        .then(() => {
            console.log('✅ Database initialized successfully');
        })
        .catch((error) => {
            console.error('❌ Database initialization failed:', error.message);
            console.log('⚠️ Server will continue running but database features may be limited');
        });
});
