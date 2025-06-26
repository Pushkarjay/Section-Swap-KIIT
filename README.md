# Student Section Swap System - KIIT

A comprehensive web-based system that facilitates section swaps among students using PostgreSQL database, authentication, and multi-step swap algorithms.

🌐 **Live Demo**: [https://section-swap-kiit.onrender.com](https://section-swap-kiit.onrender.com)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

## ✨ Features

- **🔐 User Authentication**: Secure login/registration with password hashing and JWT tokens
- **👤 Profile Management**: Students can update their personal information and desired sections
- **📊 Dashboard**: Overview of current section, pending requests, and swap statistics
- **🔄 Swap Algorithm**: Intelligent system to find direct and multi-step swap opportunities
- **📋 Swap Sheet**: View all students and their current/desired sections
- **💾 PostgreSQL Integration**: Persistent data storage with relational database
- **⚡ Real-time Updates**: Dynamic content updates without page refresh

## 🚀 Quick Start

### 🌐 Try the Live Demo
**Visit**: [https://section-swap-kiit.onrender.com](https://section-swap-kiit.onrender.com)

- Register with any roll number (e.g., 2106001)
- Use any current section (A1, B2, C3, etc.)
- Set a desired section different from current
- Explore the swap features!

### Prerequisites

### Local Development

- **Node.js** (v18 or higher) - [Download here](https://nodejs.org/)
- **PostgreSQL** or **MySQL** (for local development) - [Download here](https://www.postgresql.org/download/)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Pushkarjay/Section-Swap-KIIT.git
   cd Section-Swap-KIIT
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env file with your MySQL credentials
   ```

4. **Set up database**
   ```bash
   # Login to MySQL
   mysql -u root -p
   
   # Run the setup script
   source setup-database.sql
   ```

5. **Start the application**
   ```bash
   # Development mode (auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

6. **Open your browser**
   ```
   http://localhost:3000
   ```

## 📱 Usage

### For Students

1. **Register** with your roll number, name, phone, and current section
2. **Login** using your credentials
3. **Set desired section** in your profile
4. **Find swaps** - the system will show direct or multi-step swap options
5. **View swap sheet** to see all students and their preferences

### Swap Algorithm

- **Direct Swap**: Finds students who want each other's sections
- **Multi-Step Swap**: Uses BFS algorithm to find optimal swap chains
- **Smart Matching**: Minimizes the number of swaps required

## 🏗️ Project Structure

```
Section-Swap-KIIT/
├── 📄 index.html                      # Frontend (SPA)
├── 🖥️ server.js                       # Express.js backend
├── 📦 package.json                    # Dependencies
├── 🗄️ setup-database.sql              # MySQL schema (local dev)
├── 🗄️ setup-database-postgresql.sql   # PostgreSQL schema (production)
├── 🧪 test-db.js                      # Database connection test
├── 📝 README.md                       # This file
└── ⚙️ .env.example                    # Environment template
```

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/register` | Register new student |
| POST | `/api/login` | Student login |
| GET | `/api/profile` | Get student profile |
| PUT | `/api/profile` | Update profile |
| GET | `/api/dashboard` | Get dashboard data |
| POST | `/api/find-swap` | Find swap opportunities |
| POST | `/api/swap-request` | Create swap request |
| GET | `/api/swap-history` | Get swap history |

## 🗄️ Database Schema

### Students Table
- `id` - Primary key
- `roll_number` - Unique student identifier  
- `name` - Student full name
- `phone_number` - Contact number
- `email` - Email address
- `password_hash` - Encrypted password
- `current_section` - Current allotted section
- `desired_section` - Preferred section

### Additional Tables
- `swap_requests` - Tracks swap requests and status
- `swap_history` - Historical record of completed swaps

## 🔒 Security Features

- ✅ Password hashing using bcryptjs
- ✅ JWT token authentication  
- ✅ Input validation and sanitization
- ✅ SQL injection prevention
- ✅ Environment variable protection

## 🧪 Testing

```bash
# Test database connection
npm run test-db

# Test all functionality
npm test
```

## 🚀 Deployment

### Deploy to Render (Recommended)

✅ **Live at**: [https://section-swap-kiit.onrender.com](https://section-swap-kiit.onrender.com)

**Quick Deployment Steps:**
1. **Create Render Account**: Go to [render.com](https://render.com) and sign up
2. **Connect GitHub**: Link your GitHub account
3. **Create PostgreSQL Database**: 
   - Name: `Section_Swap`
   - Region: `Oregon (US West)`
   - Copy the **External Database URL**
4. **Create Web Service**: Choose your repository
5. **Configure Settings**:
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Environment: `Node`
6. **Add Environment Variables**:
   - `JWT_SECRET`: `section_swap_jwt_secret_2024_render_production`
   - `NODE_ENV`: `production`
   - `DATABASE_URL`: `postgresql://section_swap_user:...` (from step 3)
7. **Deploy**: Your app will be live at `https://section-swap-kiit.onrender.com`

**Features:**
- ✅ Free tier available (750 hours/month)
- ✅ Automatic deployments from GitHub
- ✅ Built-in PostgreSQL database
- ✅ HTTPS included
- ✅ Environment variables management

### Deploy to Railway
1. Go to [railway.app](https://railway.app)
2. Connect GitHub repository
3. Add MySQL database service
4. Set environment variables
5. Deploy automatically

### Deploy to Heroku
1. Install Heroku CLI
2. `heroku create your-app-name`
3. `heroku addons:create cleardb:ignite` (MySQL)
4. Set environment variables
5. `git push heroku main`

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 👥 Authors

- **Pushkarjay** - *Initial work* - [Pushkarjay](https://github.com/Pushkarjay)

## 🙏 Acknowledgments

- KIIT University for the inspiration
- Node.js and Express.js communities
- MySQL team for excellent documentation

---

⭐ **Star this repo if you found it helpful!** ⭐

