const mysql = require('mysql2/promise');
require('dotenv').config();

async function testConnection() {
    console.log('Testing MySQL connection...');
    console.log('Configuration:');
    console.log(`Host: ${process.env.DB_HOST || 'localhost'}`);
    console.log(`User: ${process.env.DB_USER || 'root'}`);
    console.log(`Database: ${process.env.DB_NAME || 'section_swap_db'}`);
    console.log('Password: ' + (process.env.DB_PASSWORD ? '[SET]' : '[NOT SET]'));
    
    try {
        const connection = await mysql.createConnection({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'section_swap_db'
        });
        
        console.log('\n✅ Successfully connected to MySQL database!');
        
        // Test database structure
        const [tables] = await connection.execute('SHOW TABLES');
        console.log('\n📋 Available tables:');
        tables.forEach(table => {
            console.log(`  - ${Object.values(table)[0]}`);
        });
        
        // Test students table
        const [students] = await connection.execute('SELECT COUNT(*) as count FROM students');
        console.log(`\n👥 Students in database: ${students[0].count}`);
        
        // Test sample data
        if (students[0].count > 0) {
            const [sampleStudents] = await connection.execute('SELECT roll_number, name, current_section, desired_section FROM students LIMIT 3');
            console.log('\n📝 Sample students:');
            sampleStudents.forEach(student => {
                console.log(`  - ${student.roll_number}: ${student.name} (${student.current_section} → ${student.desired_section || 'None'})`);
            });
        }
        
        await connection.end();
        console.log('\n🎉 Database test completed successfully!');
        console.log('\nYou can now start the server with: npm run dev');
        
    } catch (error) {
        console.error('\n❌ Database connection failed:');
        console.error(error.message);
        
        if (error.code === 'ER_ACCESS_DENIED_ERROR') {
            console.log('\n🔧 Fix: Check your MySQL username and password in .env file');
        } else if (error.code === 'ER_BAD_DB_ERROR') {
            console.log('\n🔧 Fix: Run the setup-database.sql script first');
            console.log('   mysql -u root -p < setup-database.sql');
        } else if (error.code === 'ECONNREFUSED') {
            console.log('\n🔧 Fix: Make sure MySQL server is running');
            console.log('   Windows: net start mysql');
            console.log('   Or start XAMPP/WAMP MySQL service');
        }
        
        process.exit(1);
    }
}

testConnection();
