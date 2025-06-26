# MySQL Password Reset and Database Setup Script
# This PowerShell script will reset your MySQL password and set up the database

Write-Host "=== MySQL Password Reset and Database Setup ===" -ForegroundColor Cyan
Write-Host "Target Password: Pushkarjay" -ForegroundColor Yellow
Write-Host ""

# MySQL paths
$mysqlPath = "C:\Program Files\MySQL\MySQL Server 8.0\bin"
$mysqld = "$mysqlPath\mysqld.exe"
$mysql = "$mysqlPath\mysql.exe"
$mysqladmin = "$mysqlPath\mysqladmin.exe"

# Check if running as administrator
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator'" -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "Step 1: Stopping MySQL service..." -ForegroundColor Green
try {
    Stop-Service -Name "MySQL80" -Force -ErrorAction Stop
    Write-Host "✓ MySQL service stopped" -ForegroundColor Green
    Start-Sleep -Seconds 2
} catch {
    Write-Host "⚠ Could not stop MySQL service: $($_.Exception.Message)" -ForegroundColor Yellow
}

Write-Host "Step 2: Starting MySQL in safe mode..." -ForegroundColor Green
$process = Start-Process -FilePath $mysqld -ArgumentList "--skip-grant-tables", "--skip-networking" -PassThru -WindowStyle Hidden

Start-Sleep -Seconds 5

Write-Host "Step 3: Resetting password..." -ForegroundColor Green
try {
    $resetScript = @"
FLUSH PRIVILEGES;
ALTER USER 'root'@'localhost' IDENTIFIED BY 'Pushkarjay';
FLUSH PRIVILEGES;
SELECT 'Password reset successful!' AS message;
"@
    
    $resetScript | & $mysql -u root
    Write-Host "✓ Password reset command executed" -ForegroundColor Green
} catch {
    Write-Host "⚠ Error during password reset: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "Step 4: Stopping safe mode..." -ForegroundColor Green
try {
    $process.Kill()
    Get-Process mysqld -ErrorAction SilentlyContinue | Stop-Process -Force
    Start-Sleep -Seconds 3
} catch {
    Write-Host "Safe mode process stopped" -ForegroundColor Yellow
}

Write-Host "Step 5: Starting MySQL service normally..." -ForegroundColor Green
try {
    Start-Service -Name "MySQL80" -ErrorAction Stop
    Write-Host "✓ MySQL service started" -ForegroundColor Green
    Start-Sleep -Seconds 3
} catch {
    Write-Host "⚠ Error starting MySQL service: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host "Step 6: Testing new password..." -ForegroundColor Green
try {
    $env:MYSQL_PWD = "Pushkarjay"
    $testResult = & $mysql -u root -e "SELECT 'Connection successful!' AS status;" 2>&1
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "✓ SUCCESS: Password reset to 'Pushkarjay'" -ForegroundColor Green
        
        Write-Host "Step 7: Setting up database..." -ForegroundColor Green
        & $mysql -u root -e "CREATE DATABASE IF NOT EXISTS section_swap_db;"
        & $mysql -u root section_swap_db -e "source setup-database.sql" 2>$null
        
        Write-Host "Step 8: Testing Node.js connection..." -ForegroundColor Green
        npm run test-db
        
    } else {
        Write-Host "✗ Password reset failed. Error: $testResult" -ForegroundColor Red
    }
} catch {
    Write-Host "✗ Connection test failed: $($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== Setup Complete ===" -ForegroundColor Cyan
Write-Host "MySQL Password: Pushkarjay" -ForegroundColor Yellow
Write-Host "You can now run: npm run dev" -ForegroundColor Green

Read-Host "Press Enter to continue"
