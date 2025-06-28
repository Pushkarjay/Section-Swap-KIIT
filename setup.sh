#!/bin/bash

# KIIT Section Swap - Development Setup Script
# This script helps set up the development environment

echo "🚀 Setting up KIIT Section Swap development environment..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js v18 or higher."
    echo "   Download from: https://nodejs.org/"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not found."
    exit 1
fi

echo "✅ npm found: $(npm --version)"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Failed to install dependencies"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Copy environment file if it doesn't exist
if [ ! -f .env ]; then
    if [ -f .env.example ]; then
        echo "📝 Creating .env file from .env.example..."
        cp .env.example .env
        echo "⚠️  Please edit .env file with your database credentials"
    else
        echo "⚠️  .env.example not found. Please create .env file manually"
    fi
else
    echo "✅ .env file already exists"
fi

echo ""
echo "🎉 Setup completed!"
echo ""
echo "Next steps:"
echo "1. Edit .env file with your database credentials"
echo "2. Set up your database (PostgreSQL or MySQL)"
echo "3. Run: npm start"
echo ""
echo "For PostgreSQL: Use setup-database-postgresql.sql"
echo "For MySQL: Use setup-database.sql"
echo ""
