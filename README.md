# Student Section Swap System - KIIT

A comprehensive web-based system that facilitates section swaps among students using MySQL database, authentication, and multi-step swap algorithms.

🌐 **Live Demo**: [https://section-swap-kiit.onrender.com](https://section-swap-kiit.onrender.com)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-00000F?style=for-the-badge&logo=mysql&logoColor=white)
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
- **💾 MySQL Integration**: Persistent data storage with relational database
- **⚡ Real-time Updates**: Dynamic content updates without page refresh

## 🚀 Quick Start

### 🌐 Try the Live Demo
**Visit**: [https://section-swap-kiit.onrender.com](https://section-swap-kiit.onrender.com)

- Register with any roll number (e.g., 2106001)
- Use any current section (A1, B2, C3, etc.)
- Set a desired section different from current
- Explore the swap features!

### Prerequisites

- **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
- **MySQL Server** (v8.0 or higher) - [Download here](https://dev.mysql.com/downloads/mysql/)

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
├── 📄 index.html              # Frontend (SPA)
├── 🖥️ server.js               # Express.js backend
├── 📦 package.json            # Dependencies
├── 🗄️ setup-database.sql      # Database schema
├── 🧪 test-db.js              # Database connection test
├── 📝 README.md               # This file
└── ⚙️ .env.example            # Environment template
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
- **Swap Sheet**: Complete view of all students and their swap preferences
- **MySQL Database**: Persistent data storage with proper relationships
- **Real-time Updates**: Dynamic content updates without page refresh

## Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (Vanilla)
- **Backend**: Node.js, Express.js
- **Database**: MySQL
- **Authentication**: JWT (JSON Web Tokens)
- **Security**: bcryptjs for password hashing

## Prerequisites

Before running this application, make sure you have:

1. **Node.js** (v14 or higher) - [Download here](https://nodejs.org/)
2. **MySQL Server** (v8.0 or higher) - [Download here](https://dev.mysql.com/downloads/mysql/)
3. **Git** (optional) - [Download here](https://git-scm.com/)

## Installation & Setup

### 1. Clone/Download the Project
```bash
git clone https://github.com/Pushkarjay/Section-Swap-KIIT.git
cd Section-Swap-KIIT
```

### 2. Install Dependencies
```bash
npm install
```

### 3. MySQL Setup

1. **Start MySQL Server** on your PC
2. **Create a database user** (or use root):
   ```sql
   CREATE USER 'section_swap_user'@'localhost' IDENTIFIED BY 'your_password';
   GRANT ALL PRIVILEGES ON *.* TO 'section_swap_user'@'localhost';
   FLUSH PRIVILEGES;
   ```

### 4. Environment Configuration

1. **Copy the `.env` file** and update with your MySQL credentials:
   ```env
   DB_USER=root
   DB_PASSWORD=your_mysql_password
   DB_NAME=section_swap_db
   JWT_SECRET=your_jwt_secret_key_here
   PORT=3000
   ```

2. **Replace placeholders**:
   - `your_mysql_password`: Your MySQL root password
   - `your_jwt_secret_key_here`: A random secret key for JWT (e.g., "mysecretkey123")

### 5. Start the Application

```bash
npm start
```

Or for development with auto-restart:
```bash
npm run dev
```

### 6. Access the Application

Open your web browser and go to:
```
http://localhost:3000
```

## Database Schema

The application automatically creates the following tables:

### `students`
- `id` (Primary Key)
- `roll_number` (Unique)
- `name`
- `phone_number`
- `email`
- `password_hash`
- `current_section`
- `desired_section`
- `created_at`
- `updated_at`

### `swap_requests`
- `id` (Primary Key)
- `requester_id` (Foreign Key)
- `target_section`
- `status` (pending/completed/cancelled)
- `swap_type` (direct/multi)
- `swap_path` (JSON)
- `created_at`
- `updated_at`

### `swap_history`
- `id` (Primary Key)
- `student_id` (Foreign Key)
- `from_section`
- `to_section`
- `swap_partner_id` (Foreign Key)
- `swap_date`

## How to Use

### 1. Registration
1. Click "Register here" on the login page
2. Fill in your details:
   - Roll Number
   - Full Name
   - Phone Number
   - Email (optional)
   - Password
   - Current Section
3. Click "Register"

### 2. Login
1. Enter your Roll Number and Password
2. Click "Login"

### 3. Dashboard
After login, you'll see:
- **Current Section**: Your assigned section
- **Desired Section**: Section you want to move to
- **Pending Requests**: Number of active swap requests
- **Total Swaps**: Historical swap count

### 4. Profile Management
- Click "View Profile" to update your information
- Change your desired section
- Update contact details

### 5. Finding Swaps
1. Click "Find Swap" from dashboard
2. Select your desired section
3. The system will show:
   - **Direct Swap**: If someone in your desired section wants your current section
   - **Multi-Step Swap**: A chain of swaps to reach your desired section
   - **No Swap**: If no options are available

### 6. Swap Sheet
- Click "View Swap Sheet" to see all students and their preferences
- Shows everyone's current and desired sections
- Helps identify potential swap partners

## API Endpoints

### Authentication
- `POST /api/register` - Register new student
- `POST /api/login` - Student login

### Profile
- `GET /api/profile` - Get student profile
- `PUT /api/profile` - Update profile

### Swaps
- `POST /api/find-swap` - Find swap options
- `POST /api/swap-request` - Create swap request
- `GET /api/swap-history` - Get swap history

### Dashboard
- `GET /api/dashboard` - Get dashboard data

## Algorithm Explanation

### Direct Swap
The system checks if any student in the desired section wants to move to the current student's section.

### Multi-Step Swap
Uses **Breadth-First Search (BFS)** algorithm:
1. Creates a graph where each section points to desired sections
2. Finds the shortest path from current section to desired section
3. Returns the sequence of swaps needed

## Troubleshooting

### Common Issues

1. **Database Connection Error**
   - Check if MySQL server is running
   - Verify credentials in `.env` file
   - Ensure the database user has proper permissions

2. **Port Already in Use**
   - Change the PORT in `.env` file
   - Or stop the process using the port

3. **Login/Registration Not Working**
   - Check browser console for errors
   - Verify API endpoints are responding
   - Check database connections

4. **Can't Find Swaps**
   - Make sure multiple students are registered
   - Ensure students have different current and desired sections
   - Check that there's a valid swap path

### MySQL Commands for Testing

```sql
-- View all students
SELECT * FROM students;

-- View all swap requests
SELECT * FROM swap_requests;

-- View swap history
SELECT * FROM swap_history;

-- Reset database (careful!)
DROP DATABASE section_swap_db;
```

## Security Features

- **Password Hashing**: Uses bcryptjs with salt rounds
- **JWT Authentication**: Secure token-based authentication
- **Input Validation**: Server-side validation for all inputs
- **SQL Injection Prevention**: Using parameterized queries

## Future Enhancements

- Email notifications for swap confirmations
- Real-time chat between swap partners
- Admin panel for managing sections and students
- Mobile app version
- Integration with college management systems

## Support

For issues or questions:
1. Check the troubleshooting section
2. Review browser console for errors
3. Check server logs in terminal
4. Verify database connectivity

## License

This project is licensed under the MIT License.

