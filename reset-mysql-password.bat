@echo off
echo Resetting MySQL root password to 'Pushkarjay'...
echo.

echo Step 1: Stopping MySQL service...
net stop MySQL80 2>nul
if %errorlevel% neq 0 (
    echo Failed to stop MySQL service. Please run as Administrator.
    echo Right-click on Command Prompt and select "Run as administrator"
    pause
    exit /b 1
)

echo Step 2: Starting MySQL in safe mode...
start /B "C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld" --skip-grant-tables --skip-networking --console

echo Waiting for MySQL to start in safe mode...
timeout /t 5 /nobreak >nul

echo Step 3: Resetting password...
"D:\MySQL\MySQL Workbench 8.0\mysql" -u root -e "FLUSH PRIVILEGES; ALTER USER 'root'@'localhost' IDENTIFIED BY 'Pushkarjay'; FLUSH PRIVILEGES; SELECT 'Password reset successful!' AS message;"

echo Step 4: Stopping safe mode and restarting MySQL normally...
taskkill /f /im mysqld.exe 2>nul
timeout /t 2 /nobreak >nul

net start MySQL80

echo.
echo Password reset complete! New password is: Pushkarjay
echo Testing connection...

"D:\MySQL\MySQL Workbench 8.0\mysql" -u root -p"Pushkarjay" -e "SELECT 'Connection successful!' AS status;"

if %errorlevel% equ 0 (
    echo SUCCESS: MySQL password has been reset to 'Pushkarjay'
) else (
    echo ERROR: Password reset may have failed. Please try manual reset.
)

pause
