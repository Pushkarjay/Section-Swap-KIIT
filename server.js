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

// Utility function to detect batch from roll number
function detectBatchFromRollNumber(rollNumber) {
    // Extract first 2 digits from roll number
    const yearPrefix = rollNumber.substring(0, 2);
    const startYear = parseInt('20' + yearPrefix);
    
    if (isNaN(startYear) || startYear < 2020 || startYear > 2030) {
        return null; // Invalid year
    }
    
    const endYear = startYear + 4;
    return `${startYear}-${endYear.toString().substring(2)}`;
}

// Utility function to calculate semester from batch and current date
function calculateSemesterFromBatch(batch) {
    if (!batch) return null;
    
    const [startYear] = batch.split('-').map(y => parseInt(y.length === 2 ? '20' + y : y));
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1; // 1-12
    
    // Calculate years elapsed
    let yearsElapsed = currentYear - startYear;
    
    // Adjust for semester timing (assuming odd semesters start in July-Aug)
    if (currentMonth >= 7) {
        yearsElapsed += 0.5; // Second half of the year
    }
    
    // Calculate semester (2 semesters per year)
    const semesterNumber = Math.ceil(yearsElapsed * 2);
    
    // Cap at 8th semester
    const cappedSemester = Math.min(Math.max(semesterNumber, 2), 8);
    
    // Ensure even semester
    const evenSemester = cappedSemester % 2 === 0 ? cappedSemester : cappedSemester + 1;
    
    return `${evenSemester}th sem`;
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
                    desired_sections TEXT,
                    batch VARCHAR(10),
                    semester VARCHAR(10),
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
                console.log('Column desired_sections already exists or other issue:', e.message);
            }
            
            // Add batch and semester columns if they don't exist (for existing databases)
            try {
                await executeQuery(`
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS batch VARCHAR(10)
                `);
                console.log('✅ Added batch column');
            } catch (e) {
                console.log('Column batch already exists or other issue:', e.message);
            }
            
            try {
                await executeQuery(`
                    ALTER TABLE students ADD COLUMN IF NOT EXISTS semester VARCHAR(10)
                `);
                console.log('✅ Added semester column');
            } catch (e) {
                console.log('Column semester already exists or other issue:', e.message);
            }
            
            // Migrate data from old column name if it exists
            try {
                await executeQuery(`
                    UPDATE students SET desired_sections = desired_section 
                    WHERE desired_sections IS NULL AND desired_section IS NOT NULL
                `);
                console.log('✅ Migrated data from desired_section to desired_sections');
            } catch (e) {
                console.log('No migration needed for desired_section column');
            }
            
            // Auto-populate batch for existing students who don't have it
            try {
                const [studentsWithoutBatch] = await executeQuery(`
                    SELECT id, roll_number FROM students WHERE batch IS NULL
                `);
                
                for (const student of studentsWithoutBatch) {
                    const detectedBatch = detectBatchFromRollNumber(student.roll_number);
                    if (detectedBatch) {
                        await executeQuery(`
                            UPDATE students SET batch = $1 WHERE id = $2
                        `, [detectedBatch, student.id]);
                    }
                }
                
                if (studentsWithoutBatch.length > 0) {
                    console.log(`✅ Auto-populated batch for ${studentsWithoutBatch.length} existing students`);
                }
            } catch (e) {
                console.log('Batch auto-population skipped:', e.message);
            }
            
            // Migrate whatsapp_groups table to add semester column if it doesn't exist
            try {
                await executeQuery(`
                    ALTER TABLE whatsapp_groups ADD COLUMN IF NOT EXISTS semester VARCHAR(10)
                `);
                console.log('✅ Added semester column to whatsapp_groups');
            } catch (e) {
                console.log('Column semester in whatsapp_groups already exists or other issue:', e.message);
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
            
            await executeQuery(`
                CREATE TABLE IF NOT EXISTS whatsapp_groups (
                    id SERIAL PRIMARY KEY,
                    section VARCHAR(10) NOT NULL,
                    batch VARCHAR(10),
                    semester VARCHAR(10),
                    group_link TEXT NOT NULL,
                    group_name VARCHAR(100),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE(section, batch, semester, group_link)
                )
            `);
            
            await executeQuery(`
                CREATE TABLE IF NOT EXISTS feedback (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) DEFAULT 'Anonymous',
                    category VARCHAR(50) NOT NULL,
                    message TEXT NOT NULL,
                    rating INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
                        desired_sections JSON,
                        batch VARCHAR(10),
                        semester VARCHAR(10),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
                    )
                `);
                
                // Add batch and semester columns if they don't exist (for existing databases)
                try {
                    await connection.execute(`
                        ALTER TABLE students ADD COLUMN batch VARCHAR(10)
                    `);
                    console.log('✅ Added batch column');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.log('Column batch already exists or other issue:', e.message);
                    }
                }
                
                try {
                    await connection.execute(`
                        ALTER TABLE students ADD COLUMN semester VARCHAR(10)
                    `);
                    console.log('✅ Added semester column');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.log('Column semester already exists or other issue:', e.message);
                    }
                }
                
                // Auto-populate batch for existing students who don't have it
                try {
                    const [studentsWithoutBatch] = await connection.execute(`
                        SELECT id, roll_number FROM students WHERE batch IS NULL
                    `);
                    
                    for (const student of studentsWithoutBatch) {
                        const detectedBatch = detectBatchFromRollNumber(student.roll_number);
                        if (detectedBatch) {
                            await connection.execute(`
                                UPDATE students SET batch = ? WHERE id = ?
                            `, [detectedBatch, student.id]);
                        }
                    }
                    
                    if (studentsWithoutBatch.length > 0) {
                        console.log(`✅ Auto-populated batch for ${studentsWithoutBatch.length} existing students`);
                    }
                } catch (e) {
                    console.log('Batch auto-population skipped:', e.message);
                }
                
                // Migrate whatsapp_groups table to add semester column if it doesn't exist
                try {
                    await connection.execute(`
                        ALTER TABLE whatsapp_groups ADD COLUMN semester VARCHAR(10)
                    `);
                    console.log('✅ Added semester column to whatsapp_groups');
                } catch (e) {
                    if (!e.message.includes('Duplicate column')) {
                        console.log('Column semester in whatsapp_groups already exists or other issue:', e.message);
                    }
                }
                
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
                
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS whatsapp_groups (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        section VARCHAR(10) NOT NULL,
                        batch VARCHAR(10),
                        semester VARCHAR(10),
                        group_link TEXT NOT NULL,
                        group_name VARCHAR(100),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY unique_section_batch_semester_link (section, batch, semester, group_link(255))
                    )
                `);
                
                await connection.execute(`
                    CREATE TABLE IF NOT EXISTS feedback (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        name VARCHAR(100) DEFAULT 'Anonymous',
                        category VARCHAR(50) NOT NULL,
                        message TEXT NOT NULL,
                        rating INT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
        const { rollNumber, name, phoneNumber, email, password, currentSection, desiredSections, semester, batch: manualBatch } = req.body;
        
        // Auto-detect batch from roll number
        let batch = manualBatch || detectBatchFromRollNumber(rollNumber);
        
        // If batch couldn't be detected, use manual batch or set to null
        if (!batch) {
            batch = null;
        }
        
        // Hash password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(password, saltRounds);
        
        // Convert desired sections array to JSON string
        const desiredSectionsJson = JSON.stringify(desiredSections || []);
        
        if (isPostgreSQL) {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_sections, batch, semester) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection, desiredSectionsJson, batch, semester]
            );
            res.status(201).json({ message: 'Student registered successfully', id: result[0].id });
        } else {
            const [result] = await executeQuery(
                'INSERT INTO students (roll_number, name, phone_number, email, password_hash, current_section, desired_sections, batch, semester) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [rollNumber, name, phoneNumber, email, passwordHash, currentSection, desiredSectionsJson, batch, semester]
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
        
        // Check if student needs to update batch/semester
        const needsProfileUpdate = !student.batch || !student.semester;
        
        // If batch is missing, try to auto-detect it
        if (!student.batch) {
            const detectedBatch = detectBatchFromRollNumber(student.roll_number);
            if (detectedBatch) {
                // Update the database with detected batch
                await executeQuery(
                    isPostgreSQL ?
                        'UPDATE students SET batch = $1 WHERE id = $2' :
                        'UPDATE students SET batch = ? WHERE id = ?',
                    [detectedBatch, student.id]
                );
                student.batch = detectedBatch;
            }
        }
        
        const token = jwt.sign(
            { id: student.id, rollNumber: student.roll_number },
            process.env.JWT_SECRET || 'your-secret-key',
            { expiresIn: '24h' }
        );
        
        res.json({
            message: 'Login successful',
            token,
            needsProfileUpdate: needsProfileUpdate,
            student: {
                id: student.id,
                rollNumber: student.roll_number,
                name: student.name,
                currentSection: student.current_section,
                desiredSections: student.desired_sections ? JSON.parse(student.desired_sections) : [],
                batch: student.batch,
                semester: student.semester
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// Reset password
app.post('/api/reset-password', async (req, res) => {
    try {
        const { rollNumber, phoneNumber, newPassword } = req.body;
        
        if (!rollNumber || !phoneNumber || !newPassword) {
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Verify roll number and phone number match
        const [rows] = await executeQuery(
            isPostgreSQL ? 
                'SELECT * FROM students WHERE roll_number = $1 AND phone_number = $2' : 
                'SELECT * FROM students WHERE roll_number = ? AND phone_number = ?',
            [rollNumber, phoneNumber]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'No account found with this roll number and phone number' });
        }

        // Hash new password
        const saltRounds = 10;
        const passwordHash = await bcrypt.hash(newPassword, saltRounds);

        // Update password
        await executeQuery(
            isPostgreSQL ?
                'UPDATE students SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE roll_number = $2' :
                'UPDATE students SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE roll_number = ?',
            [passwordHash, rollNumber]
        );

        res.json({ message: 'Password reset successful' });
    } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// Get student profile
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const [rows] = await executeQuery(
            isPostgreSQL ? 
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_sections, batch, semester, created_at FROM students WHERE id = $1' :
                'SELECT id, roll_number, name, phone_number, email, current_section, desired_sections, batch, semester, created_at FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const student = rows[0];
        
        // Auto-detect batch if missing
        if (!student.batch) {
            const detectedBatch = detectBatchFromRollNumber(student.roll_number);
            if (detectedBatch) {
                student.batch = detectedBatch;
                // Update in database
                await executeQuery(
                    isPostgreSQL ?
                        'UPDATE students SET batch = $1 WHERE id = $2' :
                        'UPDATE students SET batch = ? WHERE id = ?',
                    [detectedBatch, student.id]
                );
            }
        }
        
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
        const { name, phoneNumber, email, desiredSections, batch, semester } = req.body;
        
        // Convert desired sections array to JSON string
        const desiredSectionsJson = JSON.stringify(desiredSections || []);
        
        await executeQuery(
            isPostgreSQL ?
                'UPDATE students SET name = $1, phone_number = $2, email = $3, desired_sections = $4, batch = $5, semester = $6 WHERE id = $7' :
                'UPDATE students SET name = ?, phone_number = ?, email = ?, desired_sections = ?, batch = ?, semester = ? WHERE id = ?',
            [name, phoneNumber, email, desiredSectionsJson, batch, semester, req.user.id]
        );
        
        res.json({ message: 'Profile updated successfully' });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});

// Update current section (after official swap completion)
app.put('/api/update-section', authenticateToken, async (req, res) => {
    try {
        const { newSection } = req.body;
        
        if (!newSection) {
            return res.status(400).json({ error: 'New section is required' });
        }
        
        // Get current student info
        const [currentStudent] = await executeQuery(
            isPostgreSQL ? 'SELECT * FROM students WHERE id = $1' : 'SELECT * FROM students WHERE id = ?',
            [req.user.id]
        );
        
        if (currentStudent.length === 0) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        const oldSection = currentStudent[0].current_section;
        
        // Update current section
        await executeQuery(
            isPostgreSQL ?
                'UPDATE students SET current_section = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2' :
                'UPDATE students SET current_section = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [newSection, req.user.id]
        );
        
        // Record in swap history
        await executeQuery(
            isPostgreSQL ?
                'INSERT INTO swap_history (student_id, from_section, to_section) VALUES ($1, $2, $3)' :
                'INSERT INTO swap_history (student_id, from_section, to_section) VALUES (?, ?, ?)',
            [req.user.id, oldSection, newSection]
        );
        
        res.json({ 
            message: 'Section updated successfully',
            oldSection: oldSection,
            newSection: newSection
        });
    } catch (error) {
        console.error('Section update error:', error);
        res.status(500).json({ error: 'Failed to update section' });
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
        
        // Check if student has batch information
        if (!student.batch) {
            return res.status(400).json({ error: 'Please update your batch information in your profile first' });
        }
        
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
            
            // Check for direct swap - ONLY within the same batch
            const [directSwapPartners] = await executeQuery(
                isPostgreSQL ? `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = $1 AND id != $2 AND batch = $3
                ` : `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = ? AND id != ? AND batch = ?
                `,
                [targetSection, student.id, student.batch]
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
            
            // Find multi-step swap for this section (within same batch)
            const swapPath = await findMultiStepSwap(student.current_section, targetSection, student.id, student.batch);
            
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
            message: `No swaps found for any of your desired sections within your batch (${student.batch}): ${sectionsToSearch.join(', ')}` 
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
        
        // Check if student has batch information
        if (!student.batch) {
            return res.status(400).json({ error: 'Please update your batch information in your profile first' });
        }
        
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
            
            // Check for direct swap - ONLY within the same batch
            const [directSwapPartners] = await executeQuery(
                isPostgreSQL ? `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = $1 AND id != $2 AND batch = $3
                ` : `
                    SELECT id, roll_number, name, current_section, desired_sections 
                    FROM students 
                    WHERE current_section = ? AND id != ? AND batch = ?
                `,
                [targetSection, student.id, student.batch]
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
            
            // Find multi-step swap for this section (within same batch)
            const swapPath = await findMultiStepSwap(student.current_section, targetSection, student.id, student.batch);
            
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
                message: `No swaps found for any of your desired sections within your batch (${student.batch}): ${desiredSections.join(', ')}`,
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
        
        const currentStudent = student[0];
        
        // Auto-detect batch if missing
        if (!currentStudent.batch) {
            const detectedBatch = detectBatchFromRollNumber(currentStudent.roll_number);
            if (detectedBatch) {
                await executeQuery(
                    isPostgreSQL ?
                        'UPDATE students SET batch = $1 WHERE id = $2' :
                        'UPDATE students SET batch = ? WHERE id = ?',
                    [detectedBatch, currentStudent.id]
                );
                currentStudent.batch = detectedBatch;
            }
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
        
        // Get all students from the SAME BATCH for swap sheet
        const [allStudents] = await executeQuery(
            currentStudent.batch ? 
                (isPostgreSQL ? 
                    'SELECT id, roll_number, name, current_section, desired_sections, batch, semester FROM students WHERE batch = $1 ORDER BY roll_number' :
                    'SELECT id, roll_number, name, current_section, desired_sections, batch, semester FROM students WHERE batch = ? ORDER BY roll_number'
                ) :
                'SELECT id, roll_number, name, current_section, desired_sections, batch, semester FROM students ORDER BY roll_number',
            currentStudent.batch ? [currentStudent.batch] : []
        );
        
        // Get comprehensive match information for all students (within same batch)
        const studentMatches = await checkAllStudentMatches(currentStudent.batch);
        
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
        
        // Get available direct swaps for this student (within same batch)
        const availableSwaps = [];
        
        if (currentStudent.desired_sections && currentStudent.batch) {
            try {
                const studentDesiredSections = JSON.parse(currentStudent.desired_sections);
                
                for (const targetSection of studentDesiredSections) {
                    if (targetSection === currentStudent.current_section) continue;
                    
                    // Find students in target section who want current student's section (SAME BATCH)
                    const [potentialPartners] = await executeQuery(
                        isPostgreSQL ? `
                            SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                            FROM students 
                            WHERE current_section = $1 AND id != $2 AND batch = $3
                        ` : `
                            SELECT id, roll_number, name, phone_number, current_section, desired_sections 
                            FROM students 
                            WHERE current_section = ? AND id != ? AND batch = ?
                        `,
                        [targetSection, req.user.id, currentStudent.batch]
                    );
                    
                    const directPartners = potentialPartners.filter(partner => {
                        if (!partner.desired_sections) return false;
                        try {
                            const partnerDesired = JSON.parse(partner.desired_sections);
                            return partnerDesired.includes(currentStudent.current_section);
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
                    
                    // Check for multi-step swaps for this section (within same batch)
                    const multiStepPath = await findMultiStepSwap(currentStudent.current_section, targetSection, req.user.id, currentStudent.batch);
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
                ...currentStudent,
                desired_sections: (() => {
                    try {
                        return currentStudent.desired_sections ? 
                            JSON.parse(currentStudent.desired_sections) : [];
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
async function findMultiStepSwap(fromSection, toSection, excludeId, batch = null) {
    try {
        // Get current user info first
        const [currentUserResult] = await executeQuery(
            isPostgreSQL ? `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                FROM students 
                WHERE id = $1
            ` : `
                SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                FROM students 
                WHERE id = ?
            `,
            [excludeId]
        );
        
        const currentUser = currentUserResult.length > 0 ? currentUserResult[0] : null;
        
        // Use batch from parameter or current user's batch
        const filterBatch = batch || (currentUser ? currentUser.batch : null);
        
        // Get all other students and their desired swaps (SAME BATCH only)
        const [students] = await executeQuery(
            filterBatch ? 
                (isPostgreSQL ? `
                    SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                    FROM students 
                    WHERE id != $1 AND batch = $2
                ` : `
                    SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                    FROM students 
                    WHERE id != ? AND batch = ?
                `) :
                (isPostgreSQL ? `
                    SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                    FROM students 
                    WHERE id != $1
                ` : `
                    SELECT id, roll_number, name, phone_number, current_section, desired_sections, batch 
                    FROM students 
                    WHERE id != ?
                `),
            filterBatch ? [excludeId, filterBatch] : [excludeId]
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
async function checkAllStudentMatches(batch = null) {
    try {
        const [allStudents] = await executeQuery(
            batch ? 
                (isPostgreSQL ? 
                    'SELECT id, roll_number, name, current_section, desired_sections, batch FROM students WHERE batch = $1 ORDER BY roll_number' :
                    'SELECT id, roll_number, name, current_section, desired_sections, batch FROM students WHERE batch = ? ORDER BY roll_number'
                ) :
                'SELECT id, roll_number, name, current_section, desired_sections, batch FROM students ORDER BY roll_number',
            batch ? [batch] : []
        );
        
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
                
                // Check for direct matches first (faster) - within same batch
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

// WhatsApp Groups endpoints

// Get all WhatsApp groups (optionally filtered by batch and/or semester)
app.get('/api/whatsapp-groups', async (req, res) => {
    try {
        const { batch, semester } = req.query;
        
        let query = 'SELECT * FROM whatsapp_groups';
        let conditions = [];
        let params = [];
        
        if (batch) {
            conditions.push(isPostgreSQL ? `batch = $${params.length + 1}` : 'batch = ?');
            params.push(batch);
        }
        
        if (semester) {
            conditions.push(isPostgreSQL ? `semester = $${params.length + 1}` : 'semester = ?');
            params.push(semester);
        }
        
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        
        query += ' ORDER BY batch, semester, section, created_at';
        
        const [groups] = await executeQuery(query, params);
        res.json(groups);
    } catch (error) {
        console.error('Get groups error:', error);
        res.status(500).json({ error: 'Failed to fetch groups' });
    }
});

// Add WhatsApp group
app.post('/api/whatsapp-groups', async (req, res) => {
    try {
        const { section, batch, semester, groupLink, groupName } = req.body;
        
        if (!section || !groupLink) {
            return res.status(400).json({ error: 'Section and group link are required' });
        }

        // Check if this exact link already exists for this section, batch, and semester
        const [existing] = await executeQuery(
            isPostgreSQL ? 
                'SELECT * FROM whatsapp_groups WHERE section = $1 AND batch = $2 AND semester = $3 AND group_link = $4' :
                'SELECT * FROM whatsapp_groups WHERE section = ? AND batch = ? AND semester = ? AND group_link = ?',
            [section, batch, semester, groupLink]
        );

        if (existing.length > 0) {
            return res.json({ 
                message: 'This group link already exists for this section, batch, and semester',
                duplicate: true 
            });
        }

        // Insert new group
        if (isPostgreSQL) {
            await executeQuery(
                'INSERT INTO whatsapp_groups (section, batch, semester, group_link, group_name) VALUES ($1, $2, $3, $4, $5)',
                [section, batch, semester, groupLink, groupName]
            );
        } else {
            await executeQuery(
                'INSERT INTO whatsapp_groups (section, batch, semester, group_link, group_name) VALUES (?, ?, ?, ?, ?)',
                [section, batch, semester, groupLink, groupName]
            );
        }

        res.status(201).json({ message: 'Group link added successfully' });
    } catch (error) {
        console.error('Add group error:', error);
        if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
            res.json({ 
                message: 'This group link already exists for this section, batch, and semester',
                duplicate: true 
            });
        } else {
            res.status(500).json({ error: 'Failed to add group link' });
        }
    }
});

// Feedback endpoints

// Get all feedback
app.get('/api/feedback', async (req, res) => {
    try {
        const [feedbackList] = await executeQuery(
            'SELECT * FROM feedback ORDER BY created_at DESC'
        );
        res.json(feedbackList);
    } catch (error) {
        console.error('Get feedback error:', error);
        res.status(500).json({ error: 'Failed to fetch feedback' });
    }
});

// Submit feedback
app.post('/api/feedback', async (req, res) => {
    try {
        const { name, category, message, rating } = req.body;
        
        if (!category || !message) {
            return res.status(400).json({ error: 'Category and message are required' });
        }

        const feedbackName = name && name.trim() !== '' ? name : 'Anonymous';

        if (isPostgreSQL) {
            await executeQuery(
                'INSERT INTO feedback (name, category, message, rating) VALUES ($1, $2, $3, $4)',
                [feedbackName, category, message, rating]
            );
        } else {
            await executeQuery(
                'INSERT INTO feedback (name, category, message, rating) VALUES (?, ?, ?, ?)',
                [feedbackName, category, message, rating]
            );
        }

        res.status(201).json({ message: 'Feedback submitted successfully' });
    } catch (error) {
        console.error('Submit feedback error:', error);
        res.status(500).json({ error: 'Failed to submit feedback' });
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
