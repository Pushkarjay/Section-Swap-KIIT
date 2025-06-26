@echo off
cls
echo ============================================
echo MySQL Password Reset to 'Pushkarjay'
echo ============================================
echo.

echo Checking if running as Administrator...
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Please run as Administrator!
    echo Right-click on Command Prompt and select "Run as administrator"
    pause
    exit /b 1
)

echo Step 1: Stopping MySQL service...
net stop MySQL80
if %errorlevel% neq 0 (
    echo Warning: Could not stop MySQL80 service
)

echo.
echo Step 2: Creating password reset file...
echo FLUSH PRIVILEGES; > reset.sql
echo ALTER USER 'root'@'localhost' IDENTIFIED BY 'Pushkarjay'; >> reset.sql
echo FLUSH PRIVILEGES; >> reset.sql

echo.
echo Step 3: Starting MySQL with reset script...
start /B "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" --init-file=%cd%\reset.sql --console

echo Waiting for MySQL to process reset...
timeout /t 10

echo.
echo Step 4: Stopping reset mode...
taskkill /f /im mysqld.exe >nul 2>&1

echo.
echo Step 5: Starting MySQL service normally...
net start MySQL80

echo.
echo Step 6: Testing new password...
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p"Pushkarjay" -e "SELECT 'Password reset successful!' AS message;"

if %errorlevel% equ 0 (
    echo.
    echo SUCCESS: MySQL password has been reset to 'Pushkarjay'
    echo.
    echo Setting up database...
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p"Pushkarjay" -e "CREATE DATABASE IF NOT EXISTS section_swap_db;"
    "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p"Pushkarjay" section_swap_db < setup-database.sql
    
    echo.
    echo Testing Node.js connection...
    npm run test-db
    
    echo.
    echo ALL DONE! You can now run: npm run dev
) else (
    echo ERROR: Password reset failed
    echo Please try manual reset or contact support
)

del reset.sql >nul 2>&1
echo.
pause
