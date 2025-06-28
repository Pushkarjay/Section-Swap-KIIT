@echo off

REM KIIT Section Swap - Development Setup Script for Windows
REM This script helps set up the development environment

echo 🚀 Setting up KIIT Section Swap development environment...

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Node.js is not installed. Please install Node.js v18 or higher.
    echo    Download from: https://nodejs.org/
    pause
    exit /b 1
)

echo ✅ Node.js found
node --version

REM Check if npm is available
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ npm is not found.
    pause
    exit /b 1
)

echo ✅ npm found
npm --version

REM Install dependencies
echo 📦 Installing dependencies...
npm install

if %errorlevel% neq 0 (
    echo ❌ Failed to install dependencies
    pause
    exit /b 1
)

echo ✅ Dependencies installed successfully

REM Copy environment file if it doesn't exist
if not exist .env (
    if exist .env.example (
        echo 📝 Creating .env file from .env.example...
        copy .env.example .env
        echo ⚠️  Please edit .env file with your database credentials
    ) else (
        echo ⚠️  .env.example not found. Please create .env file manually
    )
) else (
    echo ✅ .env file already exists
)

echo.
echo 🎉 Setup completed!
echo.
echo Next steps:
echo 1. Edit .env file with your database credentials
echo 2. Set up your database (PostgreSQL or MySQL)
echo 3. Run: npm start
echo.
echo For PostgreSQL: Use setup-database-postgresql.sql
echo For MySQL: Use setup-database.sql
echo.

pause
