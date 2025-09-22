// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const axios = require('axios');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const compression = require('compression');
const MongoStore = require('connect-mongo');

const app = express();
const port = process.env.PORT || 3000;



// Make sure this is at the very top of your file
if (process.env.NODE_ENV !== 'production') {
  console.log('Development mode - loading environment variables');
}


// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/learn-with-saurab', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log('✅ Connected to MongoDB'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});


// Create indexes for better performance
async function createIndexes() {
  try {
    await User.collection.createIndex({ email: 1 }, { unique: true });
    await User.collection.createIndex({ username: 1 }, { unique: true });
    await Course.collection.createIndex({ title: 'text', description: 'text' });
    await Course.collection.createIndex({ category: 1 });
    await Course.collection.createIndex({ createdAt: -1 });
    await Transaction.collection.createIndex({ transactionId: 1 });
    await Transaction.collection.createIndex({ userId: 1 });
    console.log('✅ Database indexes created');
  } catch (error) {
    console.log('ℹ️ Some indexes already exist');
  }
}

// Call this function after MongoDB connection
mongoose.connection.once('open', () => {
  createIndexes();
});



// Update your User Schema to include mobile number
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  mobile: { type: String, required: true }, // Add this field
  password: { type: String, required: true },
  firstName: { type: String, required: true }, // Add this field
  lastName: { type: String, required: true }, // Add this field
  isAdmin: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now },
  enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }],
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  progress: {
    totalMinutesWatched: { type: Number, default: 0 },
    coursesCompleted: { type: Number, default: 0 }
  }
}, { timestamps: true });



// Enhanced Course Schema with categories and document resources
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  imagePath: String,
  imageUrl: String,
  category: { 
    type: String, 
    enum: ['CEE Preparation', 'Loksewa Preparation', 'License Exam', 'Others'],
    default: 'Others'
  },
  level: { type: String, default: 'Beginner' },
  duration: { type: Number, default: 0 },
  modules: [{
    moduleTitle: String,
    moduleDescription: String,
    videos: [{
      _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
      videoTitle: String,
      videoUrl: String,
      duration: Number,
      isFree: { type: Boolean, default: false }
    }],
    resources: [{
      _id: { type: String, default: () => new mongoose.Types.ObjectId().toString() },
      title: String,
      fileUrl: String,
      type: String,
      isFree: { type: Boolean, default: false }
    }],
    tests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Test' }]
  }]
}, { timestamps: true });


const User = mongoose.model('User', userSchema);
const Course = mongoose.model('Course', courseSchema);




// Authentication middleware
const requireAuth = (req, res, next) => {
  if (req.session && req.session.userId) {
    return next();
  }
  res.redirect('/login');
};


// Middleware to check if user is admin
const requireAdmin = async (req, res, next) => {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  
  try {
    const user = await User.findById(req.session.userId);
    if (!user || !user.isAdmin) {
      return res.status(403).send('Access denied. Admin privileges required.');
    }
    next();
  } catch (error) {
    res.status(500).send('Server error');
  }
};

// Additional Multer storage for videos and resources
const videoStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/videos/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const resourceStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/resources/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const uploadVideo = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/videos/')
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname)
    }
  }),
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed!'), false);
    }
  }
});

const uploadResource = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/resources/')
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname)
    }
  }),
  fileFilter: function (req, file, cb) {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/plain',
      'application/zip'
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only document files (PDF, DOC, DOCX, PPT, PPTX, TXT, ZIP) are allowed!'), false);
    }
  }
});


// Create directories if they don't exist
const directories = ['uploads', 'uploads/videos', 'uploads/resources', 'uploads/question-images'];

directories.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});


// Configure Multer for image uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/')
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname)
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});



// Configure multer for question images
const questionImageStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, 'public/uploads/question-images');
    require('fs').mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const uploadQuestionImage = multer({
  storage: multer.diskStorage({
    destination: function (req, file, cb) {
      cb(null, 'uploads/question-images/')
    },
    filename: function (req, file, cb) {
      cb(null, Date.now() + '-' + file.originalname)
    }
  }),
  fileFilter: function (req, file, cb) {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});



// Add these requires at the top
const { addWatermark, checkFFmpeg } = require('./video-utils');



// Create uploads directory if it doesn't exist
if (!fs.existsSync('uploads')) {
  fs.mkdirSync('uploads');
}

// Middleware setup
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
// Add this right after your other middleware
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.json({ limit: '50mb' }));
app.use(compression());
app.use(express.static(__dirname, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));


app.use(session({
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: { 
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGODB_URI,
    ttl: 24 * 60 * 60 // 1 day
  })
}));


// Add input validation middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Basic XSS protection
app.use((req, res, next) => {
  // Simple sanitization for POST/PUT requests
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].replace(/<script[^>]*>.*?<\/script>/gi, '');
      }
    });
  }
  next();
});


const rateLimit = require('express-rate-limit');

// General rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Stricter limiter for auth routes
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // 5 attempts
  message: 'Too many login attempts, please try again after 15 minutes'
});
app.use(['/login', '/signup', '/forgot-password'], authLimiter);


// Add this right after your other middleware
app.use((req, res, next) => {
  if (req.url.includes('add-resource')) {
    console.log('=== RESOURCE UPLOAD REQUEST ===');
    console.log('Headers:', req.headers['content-type']);
    console.log('Method:', req.method);
  }
  next();
});


// Add this right after your session middleware
app.use((req, res, next) => {
  console.log('Session info:', {
    userId: req.session.userId,
    sessionId: req.sessionID
  });
  next();
});



// Create a dedicated error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.message);
  console.error(err.stack);
  
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? 'Something went wrong!' 
      : err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Use custom error classes
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}




// Serve CSS files
app.get('/style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'style.css'));
});

app.get('/auth-style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'auth-style.css'));
});

app.get('/admin-style.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin-style.css'));
});

// Route to serve the homepage with modern design
app.get('/', async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 }).limit(6);
    
    let coursesHtml = '';
    if (courses.length > 0) {
      coursesHtml = courses.map(course => `
        <div class="course-card fade-in">
          <div class="course-image-container">
            ${course.imagePath ? `
              <img src="${course.imagePath}" alt="${course.title}" class="course-image">
            ` : course.imageUrl ? `
              <img src="${course.imageUrl}" alt="${course.title}" class="course-image">
            ` : '<div class="course-image-placeholder"><i class="fas fa-book-open"></i></div>'}
          </div>
          
          <div class="course-content">
            <h3 class="course-title">${course.title}</h3>
            <p class="course-description">${course.description}</p>
            <div class="course-meta">
              <span class="course-price">NPR ${course.price}</span>
              <div class="course-actions">
                <button class="modern-btn btn-primary" onclick="buyCourse('${course._id}', ${course.price}, '${course.title.replace(/'/g, "\\'")}')">
                  Enroll Now
                </button>
              </div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      coursesHtml = `
        <div class="empty-state">
          <i class="fas fa-book-open" style="font-size: 4rem; margin-bottom: 1rem;"></i>
          <h3>No Courses Available Yet</h3>
          <p>Check back soon for amazing courses!</p>
        </div>
      `;
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Learn with Saurab - Ace Your CEE, License & LokSewa Exams</title>
    <link rel="stylesheet" href="/modern-style.css">
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>
<body>
    <nav class="modern-nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">Learn with Saurab</a>
            <ul class="nav-menu">
                <li><a href="/" class="nav-link">Home</a></li>
                <li><a href="/browse-courses" class="nav-link">Courses</a></li>
                <li><a href="/about" class="nav-link">About</a></li>
                <li><a href="/login" class="nav-link">Login</a></li>
                <li><a href="/signup" class="modern-btn btn-primary">Sign Up</a></li>
            </ul>
            <button class="mobile-menu-btn" style="display: none;">
                <i class="fas fa-bars"></i>
            </button>
        </div>
    </nav>

    <section class="hero-section">
        <div class="container">
            <div class="hero-grid">
                <div class="hero-content">
                    <h1>Ace Your CEE, License & LokSewa Exams</h1>
                    <p>Expert preparation from an MBBS student with 6+ years of coaching experience. Get structured courses, proven strategies, and personal guidance to secure your future in medical and paramedical fields.</p>
                    <div class="hero-buttons">
                        <a href="/browse-courses" class="modern-btn btn-primary">Browse Courses</a>
                        <a href="/signup" class="modern-btn btn-outline">Free Resources</a>
                    </div>
                </div>
                <div class="hero-image">
                    <img src="Logo.png" alt="Saurab Acharya - MBBS Student & MAT Expert">
                </div>
            </div>
        </div>
    </section>

    <section class="container" style="padding: 80px 0;">
        <div class="modern-card">
            <h2 style="text-align: center; margin-bottom: 2rem; font-family: 'Montserrat', sans-serif;">Featured Courses</h2>
            <div class="courses-grid">
                ${coursesHtml}
            </div>
            <div style="text-align: center; margin-top: 2rem;">
                <a href="/browse-courses" class="modern-btn btn-secondary">View All Courses</a>
            </div>
        </div>
    </section>

    <section class="container" style="padding: 80px 0;">
        <h2 style="text-align: center; margin-bottom: 3rem; font-family: 'Montserrat', sans-serif;">Why Choose Learn with Saurab?</h2>
        <div class="features-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 2rem;">
            <div class="modern-card">
                <i class="fas fa-graduation-cap" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;"></i>
                <h3>Expert Guidance</h3>
                <p>Learn from a current MBBS student with 6+ years of coaching experience, bridging the gap between textbook knowledge and practical exam strategies.</p>
            </div>
            <div class="modern-card">
                <i class="fas fa-bullseye" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;"></i>
                <h3>Focused Content</h3>
                <p>Curriculum designed specifically for CEE, Loksewa, and License exams targeting exactly what you need to know, eliminating irrelevant content.</p>
            </div>
            <div class="modern-card">
                <i class="fas fa-lightbulb" style="font-size: 2.5rem; color: var(--primary); margin-bottom: 1rem;"></i>
                <h3>Clear Explanation</h3>
                <p>Complex concepts broken down into simple, easy-to-understand lessons from the author of a definitive MAT Book for CEE.</p>
            </div>
        </div>
    </section>

    <footer style="background: var(--dark-light); padding: 3rem 0; margin-top: 4rem;">
        <div class="container">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem;">
                <div>
                    <h3 style="margin-bottom: 1rem;">Learn with Saurab</h3>
                    <p>Your partner in achieving academic excellence and career success in medical, paramedical field and loksewa.</p>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Quick Links</h3>
                    <ul style="list-style: none;">
                        <li><a href="/" style="color: var(--gray); text-decoration: none;">Home</a></li>
                        <li><a href="/browse-courses" style="color: var(--gray); text-decoration: none;">Courses</a></li>
                        <li><a href="/about" style="color: var(--gray); text-decoration: none;">About</a></li>
                        <li><a href="/contact" style="color: var(--gray); text-decoration: none;">Contact</a></li>
                    </ul>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Connect With Us</h3>
                    <div style="display: flex; gap: 1rem;">
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-facebook"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-instagram"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-youtube"></i></a>
                    </div>
                </div>
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 2rem; padding-top: 2rem; text-align: center;">
                <p>© 2025 Learn with Saurab. All rights reserved.</p>
            </div>
        </div>
    </footer>

    <script>
        function buyCourse(courseId, price, title) {
            if (confirm('Enroll in "' + title + '" for NPR ' + price + '?')) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/enroll-test/' + courseId);
            }
        }
        
        // Mobile menu functionality
        document.addEventListener('DOMContentLoaded', function() {
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            const navMenu = document.querySelector('.nav-menu');
            
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', function() {
                    navMenu.style.display = navMenu.style.display === 'flex' ? 'none' : 'flex';
                });
            }
            
            // Check if mobile menu should be shown
            function checkMobile() {
                if (window.innerWidth <= 768) {
                    mobileMenuBtn.style.display = 'block';
                    navMenu.style.display = 'none';
                } else {
                    mobileMenuBtn.style.display = 'none';
                    navMenu.style.display = 'flex';
                }
            }
            
            checkMobile();
            window.addEventListener('resize', checkMobile);
        });
    </script>
    <script src="/content-protection.js"></script>
    <script src="/mobile-nav.js"></script>
           </body>
</html>
`);
  } catch (error) {
    console.error('Error loading courses:', error);
    res.status(500).send('Error loading courses');
  }
});


// Serve About Page
app.get('/about', (req, res) => {
  res.sendFile(path.join(__dirname, 'about.html'));
});


// Courses listing page
app.get('/courses', async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    
    let coursesHtml = '';
    if (courses.length > 0) {
      coursesHtml = courses.map(course => `
        <div class="course-card fade-in">
          <div class="course-image-container">
            ${course.imagePath ? `
              <img src="${course.imagePath}" alt="${course.title}" class="course-image">
            ` : course.imageUrl ? `
              <img src="${course.imageUrl}" alt="${course.title}" class="course-image">
            ` : '<div class="course-image-placeholder"><i class="fas fa-book-open"></i></div>'}
          </div>
          
          <div class="course-content">
            <h3 class="course-title">${course.title}</h3>
            <p class="course-description">${course.description}</p>
            <div class="course-meta">
              <span class="course-price">NPR ${course.price}</span>
              <div class="course-actions">
                <button class="modern-btn btn-primary" onclick="buyCourse('${course._id}', ${course.price}, '${course.title.replace(/'/g, "\\'")}')">
                  Enroll Now
                </button>
                <button class="modern-btn btn-outline" onclick="window.location.href='/course-preview/${course._id}'">
                  Preview
                </button>
              </div>
            </div>
          </div>
        </div>
      `).join('');
    } else {
      coursesHtml = `
        <div class="empty-state">
          <i class="fas fa-book-open" style="font-size: 4rem; margin-bottom: 1rem;"></i>
          <h3>No Courses Available Yet</h3>
          <p>Check back soon for amazing courses!</p>
        </div>
      `;
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>All Courses - Learn with Saurab</title>
    <link rel="stylesheet" href="/modern-style.css">
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>
<body>
    <nav class="modern-nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">Learn with Saurab</a>
            <ul class="nav-menu">
                <li><a href="/" class="nav-link">Home</a></li>
                <li><a href="/browse-courses" class="nav-link active">Courses</a></li>
                <li><a href="/about" class="nav-link">About</a></li>
                <li><a href="/login" class="nav-link">Login</a></li>
                <li><a href="/signup" class="modern-btn btn-primary">Sign Up</a></li>
            </ul>
            <button class="mobile-menu-btn" style="display: none;">
                <i class="fas fa-bars"></i>
            </button>
        </div>
    </nav>

    <section class="container" style="padding: 120px 0 40px;">
        <div class="modern-card">
            <h1 style="text-align: center; margin-bottom: 1rem; font-family: 'Montserrat', sans-serif;">All Courses</h1>
            <p style="text-align: center; color: var(--gray); margin-bottom: 2rem;">Browse our complete catalog of courses designed to help you succeed</p>
            
            <div style="margin-bottom: 2rem; display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap;">
                <button class="modern-btn btn-primary">All Courses</button>
                <button class="modern-btn btn-outline">CEE Preparation</button>
                <button class="modern-btn btn-outline">Loksewa Preparation</button>
                <button class="modern-btn btn-outline">License Exams</button>
            </div>
            
            <div class="courses-grid">
                ${coursesHtml}
            </div>
        </div>
    </section>

    <footer style="background: var(--dark-light); padding: 3rem 0; margin-top: 4rem;">
        <div class="container">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem;">
                <div>
                    <h3 style="margin-bottom: 1rem;">Learn with Saurab</h3>
                    <p>Your partner in achieving academic excellence and career success in medical, paramedical field and loksewa.</p>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Quick Links</h3>
                    <ul style="list-style: none;">
                        <li><a href="/" style="color: var(--gray); text-decoration: none;">Home</a></li>
                        <li><a href="/browse-courses" style="color: var(--gray); text-decoration: none;">Courses</a></li>
                        <li><a href="/about" style="color: var(--gray); text-decoration: none;">About</a></li>
                        <li><a href="/contact" style="color: var(--gray); text-decoration: none;">Contact</a></li>
                    </ul>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Connect With Us</h3>
                    <div style="display: flex; gap: 1rem;">
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-facebook"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-instagram"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-youtube"></i></a>
                    </div>
                </div>
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 2rem; padding-top: 2rem; text-align: center;">
                <p>© 2025 Learn with Saurab. All rights reserved.</p>
            </div>
        </div>
    </footer>

    <script>
        function buyCourse(courseId, price, title) {
            if (confirm('Enroll in "' + title + '" for NPR ' + price + '?')) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/enroll-test/' + courseId);
            }
        }
        
        // Mobile menu functionality
        document.addEventListener('DOMContentLoaded', function() {
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            const navMenu = document.querySelector('.nav-menu');
            
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', function() {
                    navMenu.style.display = navMenu.style.display === 'flex' ? 'none' : 'flex';
                });
            }
            
            // Check if mobile menu should be shown
            function checkMobile() {
                if (window.innerWidth <= 768) {
                    mobileMenuBtn.style.display = 'block';
                    navMenu.style.display = 'none';
                } else {
                    mobileMenuBtn.style.display = 'none';
                    navMenu.style.display = 'flex';
                }
            }
            
            checkMobile();
            window.addEventListener('resize', checkMobile);
        });
    </script>
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
          </body>
</html>
`);
  } catch (error) {
    console.error('Error loading courses:', error);
    res.status(500).send('Error loading courses');
  }
});



// Course preview page
app.get('/course-preview/:id', async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    
    if (!course) {
      return res.status(404).send('Course not found');
    }

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules.map((module, index) => `
        <div class="module-preview">
          <h4>Module ${index + 1}: ${module.moduleTitle}</h4>
          <p>${module.moduleDescription}</p>
          <div class="module-content">
            <p><i class="fas fa-video"></i> ${module.videos ? module.videos.length : 0} videos</p>
            <p><i class="fas fa-file-alt"></i> ${module.resources ? module.resources.length : 0} resources</p>
          </div>
        </div>
      `).join('');
    }

    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${course.title} Preview - Learn with Saurab</title>
    <link rel="stylesheet" href="/modern-style.css">
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        .preview-hero {
            padding: 120px 0 60px;
            background: linear-gradient(135deg, var(--dark) 0%, var(--dark-light) 100%);
        }
        .module-preview {
            background: rgba(255,255,255,0.05);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border-left: 4px solid var(--primary);
        }
        .preview-content {
            display: grid;
            grid-template-columns: 2fr 1fr;
            gap: 2rem;
        }
        @media (max-width: 968px) {
            .preview-content {
                grid-template-columns: 1fr;
            }
        }
    </style>
</head>
<body>
    <nav class="modern-nav">
        <div class="nav-container">
            <a href="/" class="nav-logo">Learn with Saurab</a>
            <ul class="nav-menu">
                <li><a href="/" class="nav-link">Home</a></li>
                <li><a href="/browse-courses" class="nav-link">Courses</a></li>
                <li><a href="/about" class="nav-link">About</a></li>
                <li><a href="/login" class="nav-link">Login</a></li>
                <li><a href="/signup" class="modern-btn btn-primary">Sign Up</a></li>
            </ul>
            <button class="mobile-menu-btn" style="display: none;">
                <i class="fas fa-bars"></i>
            </button>
        </div>
    </nav>

    <section class="preview-hero">
        <div class="container">
            <div class="modern-card">
                <div style="display: grid; grid-template-columns: 1fr 2fr; gap: 2rem; align-items: center;">
                    <div>
                        ${course.imagePath ? `
                            <img src="${course.imagePath}" alt="${course.title}" style="width: 100%; border-radius: var(--radius);">
                        ` : course.imageUrl ? `
                            <img src="${course.imageUrl}" alt="${course.title}" style="width: 100%; border-radius: var(--radius);">
                        ` : '<div style="width: 100%; aspect-ratio: 3/4; background: var(--primary); display: flex; align-items: center; justify-content: center; border-radius: var(--radius);"><i class="fas fa-book-open" style="font-size: 3rem; color: white;"></i></div>'}
                    </div>
                    <div>
                        <h1>${course.title}</h1>
                        <p>${course.description}</p>
                        <div style="display: flex; gap: 1rem; margin: 1.5rem 0;">
                            <span style="background: rgba(225, 6, 0, 0.2); color: #e10600; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                                ${course.category || 'Education'}
                            </span>
                            <span style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                                ${course.level || 'All Levels'}
                            </span>
                        </div>
                        <div style="display: flex; gap: 1rem; align-items: center;">
                            <span style="font-size: 1.5rem; font-weight: 700; color: var(--primary);">NPR ${course.price}</span>
                            <button class="modern-btn btn-primary" onclick="buyCourse('${course._id}', ${course.price}, '${course.title.replace(/'/g, "\\'")}')">
                                Enroll Now
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <section class="container" style="padding: 60px 0;">
        <div class="preview-content">
            <div>
                <div class="modern-card">
                    <h2 style="margin-bottom: 1.5rem;">Course Content</h2>
                    ${modulesHtml || '<p>Course content is being prepared. Check back soon!</p>'}
                </div>
                
                <div class="modern-card" style="margin-top: 2rem;">
                    <h2 style="margin-bottom: 1.5rem;">About This Course</h2>
                    <p>${course.description}</p>
                    <div style="margin-top: 1.5rem;">
                        <h3>What You'll Learn</h3>
                        <ul style="list-style: none; margin-top: 1rem;">
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--success); margin-right: 0.5rem;"></i> Comprehensive exam preparation strategies</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--success); margin-right: 0.5rem;"></i> In-depth subject knowledge</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--success); margin-right: 0.5rem;"></i> Time management techniques</li>
                            <li style="margin-bottom: 0.5rem;"><i class="fas fa-check" style="color: var(--success); margin-right: 0.5rem;"></i> Practice tests and quizzes</li>
                        </ul>
                    </div>
                </div>
            </div>
            
            <div>
                <div class="modern-card">
                    <h3 style="margin-bottom: 1rem;">Course Features</h3>
                    <div style="display: flex; flex-direction: column; gap: 1rem;">
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-play-circle" style="color: var(--primary);"></i>
                            <span>${course.modules ? course.modules.reduce((total, module) => total + (module.videos ? module.videos.length : 0), 0) : 0} video lessons</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-file-alt" style="color: var(--primary);"></i>
                            <span>${course.modules ? course.modules.reduce((total, module) => total + (module.resources ? module.resources.length : 0), 0) : 0} resources</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-infinity" style="color: var(--primary);"></i>
                            <span>Full lifetime access</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                            <i class="fas fa-mobile-alt" style="color: var(--primary);"></i>
                            <span>Access on mobile and TV</span>
                        </div>
                    </div>
                    <div style="margin-top: 1.5rem;">
                        <button class="modern-btn btn-primary" style="width: 100%; text-align: center; justify-content: center;" onclick="buyCourse('${course._id}', ${course.price}, '${course.title.replace(/'/g, "\\'")}')">
                            Enroll Now for NPR ${course.price}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </section>

    <footer style="background: var(--dark-light); padding: 3rem 0; margin-top: 4rem;">
        <div class="container">
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 2rem;">
                <div>
                    <h3 style="margin-bottom: 1rem;">Learn with Saurab</h3>
                    <p>Your partner in achieving academic excellence and career success in medical, paramedical field and loksewa.</p>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Quick Links</h3>
                    <ul style="list-style: none;">
                        <li><a href="/" style="color: var(--gray); text-decoration: none;">Home</a></li>
                        <li><a href="/browse-courses" style="color: var(--gray); text-decoration: none;">Courses</a></li>
                        <li><a href="/about" style="color: var(--gray); text-decoration: none;">About</a></li>
                        <li><a href="/contact" style="color: var(--gray); text-decoration: none;">Contact</a></li>
                    </ul>
                </div>
                <div>
                    <h3 style="margin-bottom: 1rem;">Connect With Us</h3>
                    <div style="display: flex; gap: 1rem;">
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-facebook"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-instagram"></i></a>
                        <a href="#" style="color: var(--gray); font-size: 1.5rem;"><i class="fab fa-youtube"></i></a>
                    </div>
                </div>
            </div>
            <div style="border-top: 1px solid rgba(255,255,255,0.1); margin-top: 2rem; padding-top: 2rem; text-align: center;">
                <p>© 2025 Learn with Saurab. All rights reserved.</p>
            </div>
        </div>
    </footer>

    <script>
        function buyCourse(courseId, price, title) {
            if (confirm('Enroll in "' + title + '" for NPR ' + price + '?')) {
                window.location.href = '/login?redirect=' + encodeURIComponent('/enroll-test/' + courseId);
            }
        }
        
        // Mobile menu functionality
        document.addEventListener('DOMContentLoaded', function() {
            const mobileMenuBtn = document.querySelector('.mobile-menu-btn');
            const navMenu = document.querySelector('.nav-menu');
            
            if (mobileMenuBtn) {
                mobileMenuBtn.addEventListener('click', function() {
                    navMenu.style.display = navMenu.style.display === 'flex' ? 'none' : 'flex';
                });
            }
            
            // Check if mobile menu should be shown
            function checkMobile() {
                if (window.innerWidth <= 768) {
                    mobileMenuBtn.style.display = 'block';
                    navMenu.style.display = 'none';
                } else {
                    mobileMenuBtn.style.display = 'none';
                    navMenu.style.display = 'flex';
                }
            }
            
            checkMobile();
            window.addEventListener('resize', checkMobile);
        });
    </script>
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
           </body>
</html>
`);
  } catch (error) {
    console.error('Error loading course preview:', error);
    res.status(500).send('Error loading course preview');
  }
});




// Modern login page
app.get('/login', (req, res) => {
  const redirectUrl = req.query.redirect || '/dashboard';
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - Learn with Saurab</title>
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --gray-light: #e2e8f0;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0c0c0c 0%, #1a1a1a 100%);
            color: var(--light);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .auth-container {
            display: flex;
            width: 100%;
            max-width: 1000px;
            min-height: 600px;
            background: var(--dark-light);
            border-radius: var(--radius);
            overflow: hidden;
            box-shadow: var(--shadow);
        }

        .auth-left {
            flex: 1;
            background: linear-gradient(135deg, rgba(225, 6, 0, 0.8) 0%, rgba(179, 5, 0, 0.9) 100%), url('https://images.unsplash.com/photo-1522881193457-37ae97c905bf?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80') center/cover no-repeat;
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            color: white;
            position: relative;
        }

        .auth-left::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(225, 6, 0, 0.8) 0%, rgba(179, 5, 0, 0.9) 100%);
            z-index: 1;
        }

        .auth-left-content {
            position: relative;
            z-index: 2;
        }

        .auth-logo {
            font-family: 'Montserrat', sans-serif;
            font-weight: 800;
            font-size: 2rem;
            margin-bottom: 20px;
        }

        .auth-left h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2.5rem;
            margin-bottom: 20px;
            line-height: 1.2;
        }

        .auth-left p {
            font-size: 1.1rem;
            margin-bottom: 30px;
            opacity: 0.9;
        }

        .features-list {
            list-style: none;
            margin-top: 30px;
        }

        .features-list li {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            font-weight: 500;
        }

        .features-list li i {
            margin-right: 10px;
            color: white;
            background: rgba(255, 255, 255, 0.2);
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .auth-right {
            flex: 1;
            padding: 50px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: var(--dark-light);
        }

        .auth-header {
            text-align: center;
            margin-bottom: 40px;
        }

        .auth-header h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 10px;
            color: var(--light);
        }

        .auth-header p {
            color: var(--gray);
            font-size: 1rem;
        }

        .auth-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .form-group label {
            font-weight: 500;
            color: var(--light);
            font-size: 0.9rem;
        }

        .input-with-icon {
            position: relative;
        }

        .input-with-icon i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray);
        }

        .input-with-icon input {
            padding-left: 45px;
        }

        .form-control {
            padding: 15px;
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            font-family: inherit;
            font-size: 1rem;
            transition: var(--transition);
        }

        .form-control:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(225, 6, 0, 0.2);
        }

        .remember-forgot {
            display: flex;
            justify-content: space-between;
            align-items: center;
            font-size: 0.9rem;
        }

        .remember-me {
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .remember-me input {
            width: 16px;
            height: 16px;
        }

        .forgot-password {
            color: var(--primary);
            text-decoration: none;
            transition: var(--transition);
        }

        .forgot-password:hover {
            text-decoration: underline;
        }

        .auth-btn {
            padding: 15px;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: var(--radius);
            font-family: 'Montserrat', sans-serif;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: var(--transition);
            margin-top: 10px;
        }

        .auth-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .divider {
            display: flex;
            align-items: center;
            margin: 25px 0;
            color: var(--gray);
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
        }

        .divider span {
            padding: 0 15px;
            font-size: 0.9rem;
        }

        .social-login {
            display: flex;
            gap: 15px;
            margin-bottom: 30px;
        }

        .social-btn {
            flex: 1;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: var(--radius);
            background: transparent;
            color: var(--light);
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            font-size: 0.9rem;
        }

        .social-btn:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        .auth-footer {
            text-align: center;
            margin-top: 30px;
            color: var(--gray);
            font-size: 0.9rem;
        }

        .auth-footer a {
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            transition: var(--transition);
        }

        .auth-footer a:hover {
            text-decoration: underline;
        }

        @media (max-width: 900px) {
            .auth-container {
                flex-direction: column;
                max-width: 500px;
            }
            
            .auth-left {
                padding: 30px;
                text-align: center;
            }
            
            .auth-left h2 {
                font-size: 2rem;
            }
            
            .features-list {
                text-align: left;
            }
        }

        @media (max-width: 480px) {
            .auth-right {
                padding: 30px;
            }
            
            .social-login {
                flex-direction: column;
            }
            
            .remember-forgot {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
            }
        }
    </style>
</head>
<body>
    <div class="auth-container">
        <div class="auth-left">
            <div class="auth-left-content">
                <div class="auth-logo">Learn with Saurab</div>
                <h2>Continue Your Learning Journey</h2>
                <p>Access expert courses, track your progress, and achieve your academic goals with our comprehensive learning platform.</p>
                
                <ul class="features-list">
                    <li><i class="fas fa-graduation-cap"></i> Expert CEE, License & LokSewa Preparation</li>
                    <li><i class="fas fa-video"></i> Comprehensive Video Lessons</li>
                    <li><i class="fas fa-certificate"></i> Guidance and Motivation</li>
                    <li><i class="fas fa-mobile-alt"></i> Access Anywhere, Anytime</li>
                </ul>
            </div>
        </div>
        
        <div class="auth-right">
            <div class="auth-header">
                <h2>Welcome Back</h2>
                <p>Sign in to access your account</p>
            </div>
            
            <form class="auth-form" action="/login" method="POST">
                <input type="hidden" name="redirect" value="/dashboard">
                
                <div class="form-group">
                    <label for="username">Username or Email</label>
                    <div class="input-with-icon">
                        <i class="fas fa-user"></i>
                        <input type="text" id="username" name="username" class="form-control" placeholder="Enter your username or email" required>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="password">Password</label>
                    <div class="input-with-icon">
                        <i class="fas fa-lock"></i>
                        <input type="password" id="password" name="password" class="form-control" placeholder="Enter your password" required>
                    </div>
                </div>
                
                <div class="remember-forgot">
                    <label class="remember-me">
                        <input type="checkbox" name="remember">
                        <span>Remember me</span>
                    </label>
                    <a href="/forgot-password" class="forgot-password">Forgot password?</a>
                </div>
                
                <button type="submit" class="auth-btn">Sign In</button>
            </form>
            
            <div class="divider">
                <span>Or continue with</span>
            </div>
            
            <div class="social-login">
                <button class="social-btn">
                    <i class="fab fa-google"></i>
                    Google
                </button>
                <button class="social-btn">
                    <i class="fab fa-facebook-f"></i>
                    Facebook
                </button>
            </div>
            
            <div class="auth-footer">
                Don't have an account? <a href="/signup">Create account</a>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const form = document.querySelector('.auth-form');
            
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                
                const submitBtn = form.querySelector('.auth-btn');
                submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
                submitBtn.disabled = true;
                
                // Simulate login process
                setTimeout(function() {
                    form.submit();
                }, 1500);
            });
            
            // Add input validation
            const inputs = form.querySelectorAll('.form-control');
            inputs.forEach(input => {
                input.addEventListener('blur', function() {
                    if (this.value.trim() !== '') {
                        this.classList.add('has-value');
                    } else {
                        this.classList.remove('has-value');
                    }
                });
            });
        });
    </script>
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
</body>
</html>
  `);
});

// Process login form submission
app.post('/login', async (req, res) => {
  const { username, password, redirect } = req.body;
  
  try {
    // Find user by username or email
    const user = await User.findOne({
      $or: [
        { username: username.trim() },
        { email: username.toLowerCase().trim() }
      ]
    });

    if (user && await bcrypt.compare(password, user.password)) {
      req.session.userId = user._id;
      return res.redirect(redirect || '/dashboard');
    }
    
    // Login failed
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Login Failed - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/auth-style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Login Failed</h2>
                      <p>Invalid username/email or password. Please try again.</p>
                  </div>
                  <div style="text-align: center; margin: 20px 0;">
                      <a href="/login" class="auth-btn">Try Again</a>
                  </div>
                  <div class="auth-links">
                      <a href="/forgot-password">Forgot Password?</a> • 
                      <a href="/signup">Create Account</a> • 
                      <a href="/">Home</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).send('Error logging in');
  }
});

// Route to serve a professional signup form
app.get('/signup', (req, res) => {
  res.send(`
  <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Sign Up - Learn with Saurab</title>
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --gray-light: #e2e8f0;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: linear-gradient(135deg, #0c0c0c 0%, #1a1a1a 100%);
            color: var(--light);
            line-height: 1.6;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .auth-container {
            display: flex;
            width: 100%;
            max-width: 1000px;
            min-height: 650px;
            background: var(--dark-light);
            border-radius: var(--radius);
            overflow: hidden;
            box-shadow: var(--shadow);
        }

        .auth-left {
            flex: 1;
            background: linear-gradient(135deg, rgba(225, 6, 0, 0.8) 0%, rgba(179, 5, 0, 0.9) 100%), url('https://images.unsplash.com/photo-1522881193457-37ae97c905bf?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D&auto=format&fit=crop&w=1470&q=80') center/cover no-repeat;
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            color: white;
            position: relative;
        }

        .auth-left::after {
            content: '';
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: linear-gradient(135deg, rgba(225, 6, 0, 0.8) 0%, rgba(179, 5, 0, 0.9) 100%);
            z-index: 1;
        }

        .auth-left-content {
            position: relative;
            z-index: 2;
        }

        .auth-logo {
            font-family: 'Montserrat', sans-serif;
            font-weight: 800;
            font-size: 2rem;
            margin-bottom: 20px;
        }

        .auth-left h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2.5rem;
            margin-bottom: 20px;
            line-height: 1.2;
        }

        .auth-left p {
            font-size: 1.1rem;
            margin-bottom: 30px;
            opacity: 0.9;
        }

        .features-list {
            list-style: none;
            margin-top: 30px;
        }

        .features-list li {
            display: flex;
            align-items: center;
            margin-bottom: 15px;
            font-weight: 500;
        }

        .features-list li i {
            margin-right: 10px;
            color: white;
            background: rgba(255, 255, 255, 0.2);
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .auth-right {
            flex: 1;
            padding: 40px;
            display: flex;
            flex-direction: column;
            justify-content: center;
            background: var(--dark-light);
            overflow-y: auto;
        }

        .auth-header {
            text-align: center;
            margin-bottom: 30px;
        }

        .auth-header h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 10px;
            color: var(--light);
        }

        .auth-header p {
            color: var(--gray);
            font-size: 1rem;
        }

        .auth-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .form-group label {
            font-weight: 500;
            color: var(--light);
            font-size: 0.9rem;
        }

        .input-with-icon {
            position: relative;
        }

        .input-with-icon i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray);
        }

        .input-with-icon input {
            padding-left: 45px;
        }

        .form-control {
            padding: 15px;
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            font-family: inherit;
            font-size: 1rem;
            transition: var(--transition);
            width: 100%;
        }

        .form-control:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(225, 6, 0, 0.2);
        }

        .form-row {
            display: flex;
            gap: 15px;
        }

        .form-row .form-group {
            flex: 1;
        }

        .password-toggle {
            position: absolute;
            right: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray);
            cursor: pointer;
        }

        .validation-message {
            font-size: 0.8rem;
            margin-top: 5px;
            min-height: 18px;
        }

        .valid {
            color: var(--success);
        }

        .invalid {
            color: var(--danger);
        }

        .admin-options {
            background: rgba(255, 255, 255, 0.05);
            padding: 15px;
            border-radius: var(--radius);
            margin-top: 10px;
            border-left: 3px solid var(--primary);
        }

        .admin-options label {
            display: block;
            margin-bottom: 10px;
        }

        .auth-btn {
            padding: 15px;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: var(--radius);
            font-family: 'Montserrat', sans-serif;
            font-weight: 600;
            font-size: 1rem;
            cursor: pointer;
            transition: var(--transition);
            margin-top: 10px;
        }

        .auth-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .divider {
            display: flex;
            align-items: center;
            margin: 20px 0;
            color: var(--gray);
        }

        .divider::before,
        .divider::after {
            content: '';
            flex: 1;
            height: 1px;
            background: rgba(255, 255, 255, 0.1);
        }

        .divider span {
            padding: 0 15px;
            font-size: 0.9rem;
        }

        .social-signup {
            display: flex;
            gap: 15px;
            margin-bottom: 25px;
        }

        .social-btn {
            flex: 1;
            padding: 12px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: var(--radius);
            background: transparent;
            color: var(--light);
            cursor: pointer;
            transition: var(--transition);
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 10px;
            font-size: 0.9rem;
        }

        .social-btn:hover {
            background: rgba(255, 255, 255, 0.05);
        }

        .auth-footer {
            text-align: center;
            margin-top: 20px;
            color: var(--gray);
            font-size: 0.9rem;
        }

        .auth-footer a {
            color: var(--primary);
            text-decoration: none;
            font-weight: 600;
            transition: var(--transition);
        }

        .auth-footer a:hover {
            text-decoration: underline;
        }

        @media (max-width: 900px) {
            .auth-container {
                flex-direction: column;
                max-width: 500px;
            }
            
            .auth-left {
                padding: 30px;
                text-align: center;
            }
            
            .auth-left h2 {
                font-size: 2rem;
            }
            
            .features-list {
                text-align: left;
            }
            
            .form-row {
                flex-direction: column;
                gap: 15px;
            }
        }

        @media (max-width: 480px) {
            .auth-right {
                padding: 25px;
            }
            
            .social-signup {
                flex-direction: column;
            }
        }
    </style>
</head>
<body>
    <div class="auth-container">
        <div class="auth-left">
            <div class="auth-left-content">
                <div class="auth-logo">Learn with Saurab</div>
                <h2>Start Your Learning Journey</h2>
                <p>Join thousands of students achieving their dreams in medical and paramedical fields with our expert guidance.</p>
                
                <ul class="features-list">
                    <li><i class="fas fa-graduation-cap"></i> Expert CEE, License & LokSewa Preparation</li>
                    <li><i class="fas fa-video"></i> Comprehensive Video Lessons</li>
                    <li><i class="fas fa-certificate"></i> Guidance and Motivation</li>
                    <li><i class="fas fa-mobile-alt"></i> Access Anywhere, Anytime</li>
                </ul>
            </div>
        </div>
        
        <div class="auth-right">
            <div class="auth-header">
                <h2>Create Account</h2>
                <p>Join our community of learners</p>
            </div>
            
            <form class="auth-form" id="signupForm" action="/signup" method="POST">
                <div class="form-row">
                    <div class="form-group">
                        <label for="firstName">First Name</label>
                        <div class="input-with-icon">
                            <i class="fas fa-user"></i>
                            <input type="text" id="firstName" name="firstName" class="form-control" placeholder="First name" required>
                        </div>
                        <div class="validation-message" id="firstNameValidation"></div>
                    </div>
                    
                    <div class="form-group">
                        <label for="lastName">Last Name</label>
                        <div class="input-with-icon">
                            <i class="fas fa-user"></i>
                            <input type="text" id="lastName" name="lastName" class="form-control" placeholder="Last name" required>
                        </div>
                        <div class="validation-message" id="lastNameValidation"></div>
                    </div>
                </div>
                
                <div class="form-group">
                    <label for="username">Username</label>
                    <div class="input-with-icon">
                        <i class="fas fa-at"></i>
                        <input type="text" id="username" name="username" class="form-control" placeholder="Choose a username" required>
                    </div>
                    <div class="validation-message" id="usernameValidation"></div>
                </div>
                
                <div class="form-group">
                    <label for="email">Email Address</label>
                    <div class="input-with-icon">
                        <i class="fas fa-envelope"></i>
                        <input type="email" id="email" name="email" class="form-control" placeholder="Your email address" required>
                    </div>
                    <div class="validation-message" id="emailValidation"></div>
                </div>
                
                <div class="form-group">
                    <label for="mobile">Mobile Number</label>
                    <div class="input-with-icon">
                        <i class="fas fa-phone"></i>
                        <input type="tel" id="mobile" name="mobile" class="form-control" placeholder="Your mobile number" required>
                    </div>
                    <div class="validation-message" id="mobileValidation"></div>
                </div>
                
                <div class="form-row">
                    <div class="form-group">
                        <label for="password">Password</label>
                        <div class="input-with-icon">
                            <i class="fas fa-lock"></i>
                            <input type="password" id="password" name="password" class="form-control" placeholder="Create a password" required>
                            <span class="password-toggle" id="passwordToggle">
                                <i class="fas fa-eye"></i>
                            </span>
                        </div>
                        <div class="validation-message" id="passwordValidation"></div>
                    </div>
                    
                    <div class="form-group">
                        <label for="confirmPassword">Confirm Password</label>
                        <div class="input-with-icon">
                            <i class="fas fa-lock"></i>
                            <input type="password" id="confirmPassword" name="confirmPassword" class="form-control" placeholder="Confirm your password" required>
                        </div>
                        <div class="validation-message" id="confirmPasswordValidation"></div>
                    </div>
                </div>
                
               
                
                <button type="submit" class="auth-btn" id="submitBtn">Create Account</button>
            </form>
            
            <div class="divider">
                <span>Or sign up with</span>
            </div>
            
            <div class="social-signup">
                <button class="social-btn">
                    <i class="fab fa-google"></i>
                    Google
                </button>
                <button class="social-btn">
                    <i class="fab fa-facebook-f"></i>
                    Facebook
                </button>
            </div>
            
            <div class="auth-footer">
                Already have an account? <a href="/login">Sign in</a>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const form = document.getElementById('signupForm');
            const passwordToggle = document.getElementById('passwordToggle');
            const passwordField = document.getElementById('password');
            const registerAsAdmin = document.getElementById('registerAsAdmin');
            const adminCodeContainer = document.getElementById('adminCodeContainer');
            const submitBtn = document.getElementById('submitBtn');
            
            // Toggle password visibility
            passwordToggle.addEventListener('click', function() {
                if (passwordField.type === 'password') {
                    passwordField.type = 'text';
                    passwordToggle.innerHTML = '<i class="fas fa-eye-slash"></i>';
                } else {
                    passwordField.type = 'password';
                    passwordToggle.innerHTML = '<i class="fas fa-eye"></i>';
                }
            });
            
            // Toggle admin code field
            registerAsAdmin.addEventListener('change', function() {
                adminCodeContainer.style.display = this.checked ? 'block' : 'none';
            });
            
            // Form validation
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                
                if (validateForm()) {
                    // Show loading state
                    submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Creating Account...';
                    submitBtn.disabled = true;
                    
                    // Simulate form submission
                    setTimeout(function() {
                        form.submit();
                    }, 1500);
                }
            });
            
            // Real-time validation
            document.getElementById('email').addEventListener('blur', validateEmail);
            document.getElementById('mobile').addEventListener('blur', validateMobile);
            document.getElementById('password').addEventListener('input', validatePassword);
            document.getElementById('confirmPassword').addEventListener('blur', validateConfirmPassword);
            document.getElementById('username').addEventListener('blur', validateUsername);
            document.getElementById('firstName').addEventListener('blur', validateFirstName);
            document.getElementById('lastName').addEventListener('blur', validateLastName);
            
            function validateForm() {
                let isValid = true;
                
                if (!validateFirstName()) isValid = false;
                if (!validateLastName()) isValid = false;
                if (!validateUsername()) isValid = false;
                if (!validateEmail()) isValid = false;
                if (!validateMobile()) isValid = false;
                if (!validatePassword()) isValid = false;
                if (!validateConfirmPassword()) isValid = false;
                
                return isValid;
            }
            
            function validateFirstName() {
                const firstName = document.getElementById('firstName');
                const validation = document.getElementById('firstNameValidation');
                
                if (firstName.value.trim() === '') {
                    validation.textContent = 'First name is required';
                    validation.className = 'validation-message invalid';
                    return false;
                } else if (firstName.value.length < 2) {
                    validation.textContent = 'First name must be at least 2 characters';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = '';
                    validation.className = 'validation-message';
                    return true;
                }
            }
            
            function validateLastName() {
                const lastName = document.getElementById('lastName');
                const validation = document.getElementById('lastNameValidation');
                
                if (lastName.value.trim() === '') {
                    validation.textContent = 'Last name is required';
                    validation.className = 'validation-message invalid';
                    return false;
                } else if (lastName.value.length < 2) {
                    validation.textContent = 'Last name must be at least 2 characters';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = '';
                    validation.className = 'validation-message';
                    return true;
                }
            }
            
            function validateUsername() {
                const username = document.getElementById('username');
                const validation = document.getElementById('usernameValidation');
                const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
                
                if (username.value.trim() === '') {
                    validation.textContent = 'Username is required';
                    validation.className = 'validation-message invalid';
                    return false;
                } else if (!usernameRegex.test(username.value)) {
                    validation.textContent = 'Username must be 3-20 characters (letters, numbers, underscores only)';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = '';
                    validation.className = 'validation-message';
                    return true;
                }
            }
            
            function validateEmail() {
                const email = document.getElementById('email');
                const validation = document.getElementById('emailValidation');
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                
                if (email.value.trim() === '') {
                    validation.textContent = 'Email is required';
                    validation.className = 'validation-message invalid';
                    return false;
                } else if (!emailRegex.test(email.value)) {
                    validation.textContent = 'Please enter a valid email address';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = 'Email format is valid';
                    validation.className = 'validation-message valid';
                    return true;
                }
            }
            
            function validateMobile() {
                const mobile = document.getElementById('mobile');
                const validation = document.getElementById('mobileValidation');
                // Simple validation for 10-digit numbers, can be adjusted for international formats
                const mobileRegex = /^[0-9]{10}$/;
                
                if (mobile.value.trim() === '') {
                    validation.textContent = 'Mobile number is required';
                    validation.className = 'validation-message invalid';
                    return false;
                } else if (!mobileRegex.test(mobile.value)) {
                    validation.textContent = 'Please enter a valid 10-digit mobile number';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = 'Mobile number is valid';
                    validation.className = 'validation-message valid';
                    return true;
                }
            }
            
            function validatePassword() {
                const password = document.getElementById('password');
                const validation = document.getElementById('passwordValidation');
                
                if (password.value.length < 6) {
                    validation.textContent = 'Password must be at least 6 characters';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = 'Password strength: ' + getPasswordStrength(password.value);
                    validation.className = 'validation-message valid';
                    return true;
                }
            }
            
            function validateConfirmPassword() {
                const password = document.getElementById('password');
                const confirmPassword = document.getElementById('confirmPassword');
                const validation = document.getElementById('confirmPasswordValidation');
                
                if (confirmPassword.value !== password.value) {
                    validation.textContent = 'Passwords do not match';
                    validation.className = 'validation-message invalid';
                    return false;
                } else {
                    validation.textContent = 'Passwords match';
                    validation.className = 'validation-message valid';
                    return true;
                }
            }
            
            function getPasswordStrength(password) {
                let strength = 'Weak';
                if (password.length >= 8) strength = 'Medium';
                if (password.length >= 10 && /[0-9]/.test(password) && /[!@#$%^&*]/.test(password)) strength = 'Strong';
                return strength;
            }
        });
    </script>
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
</body>
</html>
  `);
});




// Process signup form submission with mobile number
app.post('/signup', async (req, res) => {
  const { firstName, lastName, username, email, mobile, password, confirmPassword, registerAsAdmin, adminCode } = req.body;



  // Validation
   if (!mobile || mobile.length < 10) {
    return res.status(400).send('Please provide a valid mobile number');
  }
  if (!username || !email || !password) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Signup Failed - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/auth-style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Signup Failed</h2>
                      <p>All fields are required. Please fill in all information.</p>
                  </div>
                  <div style="text-align: center; margin: 20px 0;">
                      <a href="/signup" class="auth-btn">Try Again</a>
                  </div>
                  <div class="auth-links">
                      <a href="/login">Already have an account?</a> • 
                      <a href="/">Home</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }

  // Password length validation
  if (password.length < 6) {
    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Signup Failed - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/auth-style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Signup Failed</h2>
                      <p>Password must be at least 6 characters long.</p>
                  </div>
                  <div style="text-align: center; margin: 20px 0;">
                      <a href="/signup" class="auth-btn">Try Again</a>
                  </div>
                  <div class="auth-links">
                      <a href="/login">Already have an account?</a> • 
                      <a href="/">Home</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }

  try {
    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email: email.toLowerCase() }, { username }]
    });

    if (existingUser) {
      let errorMessage = 'Could not create user. Please try again.';
      if (existingUser.email === email.toLowerCase()) {
        errorMessage = 'Email already exists. Please use a different email or login.';
      } else if (existingUser.username === username) {
        errorMessage = 'Username already exists. Please choose a different username.';
      }

      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Signup Failed - Learn with Saurab</title>
              <link rel="stylesheet" href="/responsive.css">
            <link rel="stylesheet" href="/auth-style.css">
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Signup Failed</h2>
                        <p>${errorMessage}</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/signup" class="auth-btn">Try Again</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Already have an account?</a> • 
                        <a href="/">Home</a>
                    </div>
                </div>
            </div>
                <script src="/content-protection.js"></script>
                <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }

    // Create new user
    const hashedPassword = await bcrypt.hash(password, 12);
    let isAdmin = false;
    if (registerAsAdmin && adminCode === 'LearnwithsaurabAdmin2000') {
      isAdmin = true;
    }
      
    
    // After creating the user
    const newUser = new User({ 
      username: username.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      mobile: mobile.trim(),
      isAdmin
    });
    
    await newUser.save();
    
    // Auto-login after signup
    req.session.userId = newUser._id;
    
    // Send welcome email (non-blocking)
    require('./helpers/emailHelpers').sendWelcomeEmail(newUser._id);
    
    res.redirect('/dashboard');
  } catch (error) {
    // error handling
  }
});



// Forgot Password - Show form (Professional)
app.get('/forgot-password', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Forgot Password - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link rel="stylesheet" href="/auth-style.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <h2>Reset Password</h2>
                    <p>Enter your email to receive reset instructions</p>
                </div>
                <form class="auth-form" action="/forgot-password" method="POST">
                    <div class="form-group">
                        <input type="email" name="email" placeholder="Your Email Address" required>
                    </div>
                    <button type="submit" class="auth-btn">Send Reset Instructions</button>
                </form>
                <div class="auth-links">
                    <a href="/login">Back to Login</a> • 
                    <a href="/signup">Create Account</a> • 
                    <a href="/">Home</a>
                </div>
            </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
    </body>
    </html>
  `);
});



// Forgot Password - Process request
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  try {
    const user = await User.findOne({ email });
    const resetToken = crypto.randomBytes(20).toString('hex');
    
    if (user) {
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();
      
      // Send password reset email
      require('./helpers/emailHelpers').sendPasswordResetEmail(user._id, resetToken);
    }
    

    
    // Respond with success message regardless of user existence
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Password Reset Requested</title>
          <link rel="stylesheet" href="/responsive.css">
        <link rel="stylesheet" href="/auth-style.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
        <div class="auth-container">
          <div class="auth-card">
            <div class="auth-header">
              <h2>Password Reset Requested</h2>
              <p>If an account with that email exists, you will receive password reset instructions.</p>
            </div>
            <div style="text-align: center; margin: 20px 0;">
              <a href="/login" class="auth-btn">Back to Login</a>
            </div>
            <div class="auth-links">
              <a href="/signup">Create Account</a> • 
              <a href="/">Home</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Forgot password error:', error);
    res.send(`
      <!DOCTYPE html>
      <html lang="en>
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/auth-style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Something Went Wrong</h2>
                      <p>Please try again later</p>
                  </div>
                  <div class="auth-links">
                      <a href="/forgot-password">Try Again</a> • 
                      <a href="/">Home</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }
});



// Reset Password - Show form
app.get('/reset-password/:token', async (req, res) => {
  try {
    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invalid Link - Learn with Saurab</title>
              <link rel="stylesheet" href="/responsive.css">
            <link rel="stylesheet" href="/auth-style.css">
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Invalid or Expired Link</h2>
                        <p>This password reset link is invalid or has expired.</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/forgot-password" class="auth-btn">Request New Link</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Home</a>
                    </div>
                </div>
            </div>
                <script src="/content-protection.js"></script>
                <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Reset Password - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/auth-style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Create New Password</h2>
                      <p>Enter your new password below</p>
                  </div>
                  <form class="auth-form" action="/reset-password/${req.params.token}" method="POST">
                      <div class="form-group">
                          <input type="password" name="password" placeholder="New Password (min. 6 characters)" required>
                      </div>
                      <div class="form-group">
                          <input type="password" name="confirmPassword" placeholder="Confirm New Password" required>
                      </div>
                      <button type="submit" class="auth-btn">Reset Password</button>
                  </form>
                  <div class="auth-links">
                      <a href="/login">Back to Login</a> • 
                      <a href="/">Home</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading reset password page');
  }
});

// Reset Password - Process reset
app.post('/reset-password/:token', async (req, res) => {
  try {
    const { password, confirmPassword } = req.body;
    
    if (password !== confirmPassword) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Password Mismatch - Learn with Saurab</title>
              <link rel="stylesheet" href="/responsive.css">
            <link rel="stylesheet" href="/auth-style.css">
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Passwords Don't Match</h2>
                        <p>Please make sure both passwords are identical.</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/reset-password/${req.params.token}" class="auth-btn">Try Again</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Home</a>
                    </div>
                </div>
            </div>
                <script src="/content-protection.js"></script>
                <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }

    if (password.length < 6) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Password Too Short - Learn with Saurab</title>
              <link rel="stylesheet" href="/responsive.css">
            <link rel="stylesheet" href="/auth-style.css">
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Password Too Short</h2>
                        <p>Password must be at least 6 characters long.</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/reset-password/${req.params.token}" class="auth-btn">Try Again</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Home</a>
                    </div>
                </div>
            </div>
                <script src="/content-protection.js"></script>
                <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }

    const user = await User.findOne({
      resetPasswordToken: req.params.token,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.send(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Invalid Link - Learn with Saurab</title>
              <link rel="stylesheet" href="/responsive.css">
            <link rel="stylesheet" href="/auth-style.css">
            <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Invalid or Expired Link</h2>
                        <p>This password reset link is invalid or has expired.</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/forgot-password" class="auth-btn">Request New Link</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Home</a>
                    </div>
                </div>
            </div>
                <script src="/content-protection.js"></script>
                <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }



    // Update password
const hashedPassword = await bcrypt.hash(password, 12);
user.password = hashedPassword;
user.resetPasswordToken = undefined;
user.resetPasswordExpires = undefined;
await user.save();

res.send(`
  <!DOCTYPE html>
  <html lang="en">
  <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Password Reset - Learn with Saurab</title>
        <link rel="stylesheet" href="/responsive.css">
      <link rel="stylesheet" href="/auth-style.css">
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  </head>
  <body>
      <div class="auth-container">
          <div class="auth-card">
              <div class="auth-header">
                  <h2>Password Reset Successfully</h2>
                  <p>Your password has been updated. You can now login with your new password.</p>
              </div>
              <div style="text-align: center; margin: 20px 0;">
                  <a href="/login" class="auth-btn">Login Now</a>
              </div>
              <div class="auth-links">
                  <a href="/">Home</a>
              </div>
          </div>
      </div>
          <script src="/content-protection.js"></script>
          <script src="/mobile-nav.js"></script>
  </body>
  </html>
`);
} catch (error) {
res.status(500).send('Error resetting password');
}
});


// Check FFmpeg availability on server start
checkFFmpeg().then((available) => {
  if (available) {
    console.log('FFmpeg is available for video processing');
  } else {
    console.log('FFmpeg is not available, some features will be limited');
  }
});






























// Enhanced Create Course Page with Categories
app.get('/admin/new-course', requireAdmin, (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Create Course - Learn with Saurab Admin</title>
        <link rel="stylesheet" href="/responsive.css">
      <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
      <style>
        :root {
          --primary: #e10600;
          --primary-dark: #b30500;
          --secondary: #4C6EF5;
          --dark: #0c0c0c;
          --dark-light: #1a1a1a;
          --light: #ffffff;
          --gray: #718096;
          --success: #38a169;
          --radius: 12px;
          --shadow: 0 10px 30px rgba(0,0,0,0.15);
          --transition: all 0.3s ease;
        }

        * {
          margin: 0;
          padding: 0;
          box-sizing: border-box;
        }

        body {
          font-family: 'Inter', sans-serif;
          background: var(--dark);
          color: var(--light);
          line-height: 1.6;
          padding: 20px;
        }

        .admin-container {
          max-width: 800px;
          margin: 0 auto;
        }

        .admin-header {
          background: var(--dark-light);
          padding: 2rem;
          border-radius: var(--radius);
          margin-bottom: 2rem;
          border-left: 4px solid var(--primary);
        }

        .admin-header h1 {
          font-family: 'Montserrat', sans-serif;
          font-size: 2rem;
          margin-bottom: 0.5rem;
          color: var(--light);
        }

        .admin-header p {
          color: var(--gray);
        }

        .admin-card {
          background: var(--dark-light);
          padding: 2rem;
          border-radius: var(--radius);
          border: 1px solid rgba(255,255,255,0.1);
        }

        .form-group {
          margin-bottom: 1.5rem;
        }

        .form-group label {
          display: block;
          margin-bottom: 0.5rem;
          font-weight: 600;
          color: var(--light);
        }

        .form-control {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: var(--radius);
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.05);
          color: var(--light);
          font-family: inherit;
          transition: var(--transition);
        }

        .form-control:focus {
          outline: none;
          border-color: var(--primary);
          box-shadow: 0 0 0 3px rgba(225, 6, 0, 0.2);
        }

        .form-select {
          width: 100%;
          padding: 0.75rem 1rem;
          border-radius: var(--radius);
          border: 1px solid rgba(255,255,255,0.2);
          background: rgba(255,255,255,0.05);
          color: var(--light);
          font-family: inherit;
        }

        .admin-btn {
          display: inline-block;
          padding: 0.75rem 1.5rem;
          background: var(--primary);
          color: white;
          text-decoration: none;
          border-radius: var(--radius);
          font-weight: 600;
          transition: var(--transition);
          border: none;
          cursor: pointer;
          font-family: inherit;
        }

        .admin-btn:hover {
          background: var(--primary-dark);
          transform: translateY(-2px);
        }

        .admin-links {
          margin-top: 2rem;
          display: flex;
          gap: 1rem;
        }

        .admin-links a {
          color: var(--primary);
          text-decoration: none;
        }

        .admin-links a:hover {
          text-decoration: underline;
        }

        .preview-image {
          max-width: 200px;
          max-height: 200px;
          border-radius: 8px;
          margin-top: 0.5rem;
        }

        .checkbox-group {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          margin: 1rem 0;
        }

        .checkbox-group input[type="checkbox"] {
          width: 18px;
          height: 18px;
        }
      </style>
    </head>
    <body>
      <div class="admin-container">
        <div class="admin-header">
          <h1><i class="fas fa-plus-circle"></i> Create New Course</h1>
          <p>Add a new course to your learning platform</p>
        </div>
        
        <div class="admin-card">
          <form class="admin-form" action="/admin/new-course" method="POST" enctype="multipart/form-data">
            <div class="form-group">
              <label for="title">Course Title *</label>
              <input type="text" id="title" name="title" class="form-control" placeholder="e.g., MAT Mastery for CEE" required>
            </div>
            
            <div class="form-group">
              <label for="description">Course Description *</label>
              <textarea id="description" name="description" class="form-control" placeholder="Describe what students will learn..." required rows="4"></textarea>
            </div>
            
            <div class="form-group">
              <label for="category">Course Category *</label>
              <select id="category" name="category" class="form-select" required>
                <option value="">Select Category</option>
                <option value="CEE Preparation">CEE Preparation</option>
                <option value="Loksewa Preparation">Loksewa Preparation</option>
                <option value="License Exam">License Exam</option>
                <option value="Others">Others</option>
              </select>
            </div>
            
            <div class="form-group">
              <label for="price">Price (NPR) *</label>
              <input type="number" id="price" name="price" class="form-control" placeholder="2999" min="0" required>
            </div>
            
            <div class="form-group">
              <label for="level">Course Level</label>
              <select id="level" name="level" class="form-select">
                <option value="Beginner">Beginner</option>
                <option value="Intermediate">Intermediate</option>
                <option value="Advanced">Advanced</option>
              </select>
            </div>
            
            <div class="form-group">
              <label for="courseImage">Course Image</label>
              <input type="file" id="courseImage" name="courseImage" class="form-control" accept="image/*">
              <small style="color: var(--gray); display: block; margin-top: 5px;">Recommended: 3:4 aspect ratio (e.g., 600×800px)</small>
            </div>
            
            <div class="form-group">
              <label for="imageUrl">Or use Image URL</label>
              <input type="url" id="imageUrl" name="imageUrl" class="form-control" placeholder="https://example.com/image.jpg">
            </div>
            
            <button type="submit" class="admin-btn">Create Course</button>
          </form>
          
          <div class="admin-links">
            <a href="/"><i class="fas fa-home"></i> Home</a>
            <a href="/dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
            <a href="/admin/manage-courses"><i class="fas fa-book"></i> Manage Courses</a>
          </div>
        </div>
      </div>
          <script src="/content-protection.js"></script>
          <script src="/mobile-nav.js"></script>
    </body>
    </html>
  `);
});

// Enhanced Course Creation Handler
app.post('/admin/new-course', requireAdmin, upload.single('courseImage'), async (req, res) => {
  const { title, description, price, category, level, imageUrl } = req.body;
  
  // Validation
  if (!title || !description || !price || !category) {
    return res.status(400).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0c0c0c; color: white; padding: 20px; }
          .error-container { max-width: 600px; margin: 50px auto; text-align: center; }
          h1 { color: #e10600; margin-bottom: 1rem; }
          a { color: #4C6EF5; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1><i class="fas fa-exclamation-triangle"></i> Missing Information</h1>
          <p>Title, description, price, and category are required fields.</p>
          <p><a href="/admin/new-course">Try Again</a> | <a href="/admin">Admin Portal</a></p>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }
  
  try {
    let imagePath = '';
    if (req.file) {
      imagePath = '/uploads/' + req.file.filename;
    }

    const newCourse = new Course({ 
      title, 
      description, 
      price, 
      category,
      level: level || 'Beginner',
      imageUrl,
      imagePath 
    });
    
    await newCourse.save();
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Success - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0c0c0c; color: white; padding: 20px; }
          .success-container { max-width: 600px; margin: 50px auto; text-align: center; }
          h1 { color: #38a169; margin-bottom: 1rem; }
          a { color: #4C6EF5; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="success-container">
          <h1><i class="fas fa-check-circle"></i> Course Created Successfully!</h1>
          <p>"${title}" has been published and is now available to students.</p>
          <p>
            <a href="/admin/new-course">Create Another Course</a> | 
            <a href="/admin/manage-courses">Manage Courses</a> | 
            <a href="/admin/course/${newCourse._id}/content">Add Content</a>
          </p>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
    
  } catch (error) {
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0c0c0c; color: white; padding: 20px; }
          .error-container { max-width: 600px; margin: 50px auto; text-align: center; }
          h1 { color: #e10600; margin-bottom: 1rem; }
          a { color: #4C6EF5; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1><i class="fas fa-exclamation-triangle"></i> Error Creating Course</h1>
          <p>${error.message}</p>
          <p><a href="/admin/new-course">Try Again</a> | <a href="/admin">Admin Portal</a></p>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }
});

// Enhanced Edit Course Page
app.get('/admin/edit-course/:courseId', requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Edit Course - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 800px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .form-group {
            margin-bottom: 1.5rem;
          }

          .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: var(--light);
          }

          .form-control {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.05);
            color: var(--light);
            font-family: inherit;
            transition: var(--transition);
          }

          .form-control:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(225, 6, 0, 0.2);
          }

          .form-select {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.05);
            color: var(--light);
            font-family: inherit;
          }

          .admin-btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          .preview-image {
            max-width: 200px;
            max-height: 200px;
            border-radius: 8px;
            margin-top: 0.5rem;
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-edit"></i> Edit Course: ${course.title}</h1>
            <p>Update your course details</p>
          </div>
          
          <div class="admin-card">
            <form class="admin-form" action="/admin/update-course/${course._id}" method="POST" enctype="multipart/form-data">
              <div class="form-group">
                <label for="title">Course Title</label>
                <input type="text" id="title" name="title" class="form-control" value="${course.title}" required>
              </div>
              
              <div class="form-group">
                <label for="description">Course Description</label>
                <textarea id="description" name="description" class="form-control" required>${course.description}</textarea>
              </div>
              
              <div class="form-group">
                <label for="category">Course Category</label>
                <select id="category" name="category" class="form-select" required>
                  <option value="CEE Preparation" ${course.category === 'CEE Preparation' ? 'selected' : ''}>CEE Preparation</option>
                  <option value="Loksewa Preparation" ${course.category === 'Loksewa Preparation' ? 'selected' : ''}>Loksewa Preparation</option>
                  <option value="License Exam" ${course.category === 'License Exam' ? 'selected' : ''}>License Exam</option>
                  <option value="Others" ${course.category === 'Others' ? 'selected' : ''}>Others</option>
                </select>
              </div>
              
              <div class="form-group">
                <label for="price">Price (NPR)</label>
                <input type="number" id="price" name="price" class="form-control" value="${course.price}" required>
              </div>
              
              <div class="form-group">
                <label for="level">Course Level</label>
                <select id="level" name="level" class="form-select">
                  <option value="Beginner" ${course.level === 'Beginner' ? 'selected' : ''}>Beginner</option>
                  <option value="Intermediate" ${course.level === 'Intermediate' ? 'selected' : ''}>Intermediate</option>
                  <option value="Advanced" ${course.level === 'Advanced' ? 'selected' : ''}>Advanced</option>
                </select>
              </div>
              
              ${course.imagePath ? `
              <div class="form-group">
                <label>Current Image</label>
                <img src="${course.imagePath}" class="preview-image">
              </div>
              ` : ''}
              
              <div class="form-group">
                <label for="courseImage">Update Course Image</label>
                <input type="file" id="courseImage" name="courseImage" class="form-control" accept="image/*">
              </div>
              
              <div class="form-group">
                <label for="imageUrl">Or use Image URL</label>
                <input type="text" id="imageUrl" name="imageUrl" class="form-control" value="${course.imageUrl || ''}" placeholder="https://example.com/image.jpg">
              </div>
              
              <button type="submit" class="admin-btn">Update Course</button>
            </form>
            
            <div class="admin-links">
              <a href="/admin/manage-courses"><i class="fas fa-arrow-left"></i> Back to Manage Courses</a>
              <a href="/admin/course/${course._id}/content"><i class="fas fa-cog"></i> Manage Content</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading edit page: ' + error.message);
  }
});

// Enhanced Course Update Handler
app.post('/admin/update-course/:courseId', requireAdmin, upload.single('courseImage'), async (req, res) => {
  try {
    const { title, description, price, category, level, imageUrl } = req.body;
    const course = await Course.findById(req.params.courseId);
    
    if (req.file) {
      course.imagePath = '/uploads/' + req.file.filename;
    }
    if (imageUrl) {
      course.imageUrl = imageUrl;
    }
    
    course.title = title;
    course.description = description;
    course.price = price;
    course.category = category;
    course.level = level;
    
    await course.save();
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Course Updated - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0c0c0c; color: white; padding: 20px; }
          .success-container { max-width: 600px; margin: 50px auto; text-align: center; }
          h1 { color: #38a169; margin-bottom: 1rem; }
          a { color: #4C6EF5; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="success-container">
          <h1><i class="fas fa-check-circle"></i> Course Updated Successfully!</h1>
          <p>"${title}" has been updated with the new details.</p>
          <p>
            <a href="/admin/manage-courses">Back to Manage Courses</a> | 
            <a href="/admin/course/${course._id}/content">Manage Content</a> | 
            <a href="/course-preview/${course._id}">Preview Course</a>
          </p>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
    
  } catch (error) {
    res.status(500).send('Error updating course: ' + error.message);
  }
});

// Enhanced Course Management Page
app.get('/admin/manage-courses', requireAdmin, async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    
    let coursesHtml = '';
    if (courses.length > 0) {
      coursesHtml = courses.map(course => `
        <div class="course-item">
          <div class="course-image">
            ${course.imagePath ? `
              <img src="${course.imagePath}" alt="${course.title}">
            ` : course.imageUrl ? `
              <img src="${course.imageUrl}" alt="${course.title}">
            ` : `
              <div class="course-image-placeholder">
                <i class="fas fa-book"></i>
              </div>
            `}
          </div>
          <div class="course-details">
            <h3>${course.title}</h3>
            <p class="course-description">${course.description}</p>
            <div class="course-meta">
              <span class="course-category">${course.category}</span>
              <span class="course-level">${course.level}</span>
              <span class="course-price">NPR ${course.price}</span>
            </div>
            <div class="course-stats">
              <span><i class="fas fa-film"></i> ${course.modules.reduce((total, module) => total + (module.videos ? module.videos.length : 0), 0)} videos</span>
              <span><i class="fas fa-file-alt"></i> ${course.modules.reduce((total, module) => total + (module.resources ? module.resources.length : 0), 0)} resources</span>
              <span><i class="fas fa-graduation-cap"></i> ${course.modules.reduce((total, module) => total + (module.tests ? module.tests.length : 0), 0)} tests</span>
            </div>
          </div>
          <div class="course-actions">
            <a href="/admin/edit-course/${course._id}" class="action-btn edit-btn">
              <i class="fas fa-edit"></i> Edit
            </a>
            <a href="/admin/course/${course._id}/content" class="action-btn content-btn">
              <i class="fas fa-cog"></i> Content
            </a>
            <button onclick="deleteCourse('${course._id}')" class="action-btn delete-btn">
              <i class="fas fa-trash"></i> Delete
            </button>
          </div>
        </div>
      `).join('');
    } else {
      coursesHtml = `
        <div class="empty-state">
          <i class="fas fa-book-open" style="font-size: 4rem; margin-bottom: 1rem;"></i>
          <h3>No Courses Available</h3>
          <p>You haven't created any courses yet. Start by creating your first course.</p>
        </div>
      `;
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Manage Courses - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .courses-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
          }

          .courses-filter {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
          }

          .filter-btn {
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.05);
            color: var(--light);
            cursor: pointer;
            transition: var(--transition);
          }

          .filter-btn.active {
            background: var(--primary);
            border-color: var(--primary);
          }

          .filter-btn:hover {
            background: rgba(255,255,255,0.1);
          }

          .course-item {
            display: grid;
            grid-template-columns: 120px 1fr auto;
            gap: 1.5rem;
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            border: 1px solid rgba(255,255,255,0.05);
            transition: var(--transition);
          }

          .course-item:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: var(--shadow);
          }

          .course-image {
            width: 120px;
            height: 120px;
            border-radius: var(--radius);
            overflow: hidden;
          }

          .course-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .course-image-placeholder {
            width: 100%;
            height: 100%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 2rem;
          }

          .course-details h3 {
            font-family: 'Montserrat', sans-serif;
            font-size: 1.25rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .course-description {
            color: var(--gray);
            margin-bottom: 1rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .course-meta {
            display: flex;
            gap: 0.5rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
          }

          .course-category, .course-level, .course-price {
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .course-category {
            background: rgba(76, 110, 245, 0.2);
            color: var(--secondary);
          }

          .course-level {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
          }

          .course-price {
            background: rgba(225, 6, 0, 0.2);
            color: var(--primary);
          }

          .course-stats {
            display: flex;
            gap: 1rem;
            font-size: 0.9rem;
            color: var(--gray);
          }

          .course-stats span {
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }

          .course-actions {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
          }

          .action-btn {
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            text-decoration: none;
            font-size: 0.9rem;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transition: var(--transition);
          }

          .edit-btn {
            background: rgba(76, 110, 245, 0.1);
            color: var(--secondary);
            border: 1px solid rgba(76, 110, 245, 0.2);
          }

          .edit-btn:hover {
            background: rgba(76, 110, 245, 0.2);
          }

          .content-btn {
            background: rgba(56, 161, 105, 0.1);
            color: var(--success);
            border: 1px solid rgba(56, 161, 105, 0.2);
          }

          .content-btn:hover {
            background: rgba(56, 161, 105, 0.2);
          }

          .delete-btn {
            background: rgba(229, 62, 62, 0.1);
            color: var(--danger);
            border: 1px solid rgba(229, 62, 62, 0.2);
            cursor: pointer;
            font-family: inherit;
          }

          .delete-btn:hover {
            background: rgba(229, 62, 62, 0.2);
          }

          .empty-state {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          .admin-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .course-item {
              grid-template-columns: 1fr;
              text-align: center;
            }

            .course-image {
              margin: 0 auto;
            }

            .course-meta, .course-stats {
              justify-content: center;
            }

            .course-actions {
              flex-direction: row;
              justify-content: center;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-book"></i> Manage Courses</h1>
            <p>Edit or delete existing courses</p>
          </div>
          
          <div class="admin-card">
            <div class="courses-header">
              <h2>All Courses (${courses.length})</h2>
              <a href="/admin/new-course" class="admin-btn">
                <i class="fas fa-plus"></i> Create New Course
              </a>
            </div>
            
            <div class="courses-filter">
              <button class="filter-btn active">All Courses</button>
              <button class="filter-btn">CEE Preparation</button>
              <button class="filter-btn">Loksewa Preparation</button>
              <button class="filter-btn">License Exam</button>
            </div>
            
            <div class="courses-list">
              ${coursesHtml}
            </div>
            
            <div class="admin-links">
              <a href="/admin"><i class="fas fa-arrow-left"></i> Back to Admin Portal</a>
              <a href="/"><i class="fas fa-home"></i> Home</a>
            </div>
          </div>
        </div>

        <script>
          function deleteCourse(courseId) {
            if (confirm('Are you sure you want to delete this course? This action cannot be undone.')) {
              fetch('/admin/delete-course/' + courseId, { method: 'POST' })
                .then(() => window.location.reload());
            }
          }

          // Filter functionality
          document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.addEventListener('click', function() {
              document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
              this.classList.add('active');
              
              const filter = this.textContent;
              const courseItems = document.querySelectorAll('.course-item');
              
              courseItems.forEach(item => {
                const category = item.querySelector('.course-category').textContent;
                if (filter === 'All Courses' || category === filter) {
                  item.style.display = 'grid';
                } else {
                  item.style.display = 'none';
                }
              });
            });
          });
        </script>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading courses: ' + error.message);
  }
});




// Enhanced Course Content Management Page
app.get('/admin/course/:courseId/content', requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).send('Course not found');

    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules.map((module, idx) => {
        const videosCount = module.videos ? module.videos.length : 0;
        const resourcesCount = module.resources ? module.resources.length : 0;
        const testsCount = module.tests ? module.tests.length : 0;
        const freeVideos = module.videos ? module.videos.filter(v => v.isFree).length : 0;
        const freeResources = module.resources ? module.resources.filter(r => r.isFree).length : 0;

        return `
          <div class="module-card">
            <div class="module-header">
              <h3>Module ${idx + 1}: ${module.moduleTitle}</h3>
              <div class="module-stats">
                <span>${videosCount} videos (${freeVideos} free)</span>
                <span>${resourcesCount} resources (${freeResources} free)</span>
                <span>${testsCount} tests</span>
              </div>
            </div>
            
            <p class="module-description">${module.moduleDescription}</p>
            
            <div class="module-content">
              <!-- Videos Section -->
              <div class="content-section">
                <h4><i class="fas fa-video"></i> Videos</h4>
                ${module.videos && module.videos.length > 0 ? `
                  <ul class="content-list">
                    ${module.videos.map((v, vIdx) => `
                      <li>
                        <div class="content-item">
                          <span class="content-title">${v.videoTitle}</span>
                          <div class="content-meta">
                            <span>${v.duration} min</span>
                            ${v.isFree ? '<span class="free-badge">Free Preview</span>' : ''}
                            <a href="/video-player?id=${v.videoUrl.split('/').pop()}&title=${encodeURIComponent(v.videoTitle)}&description=${encodeURIComponent(v.description || '')}" class="view-link">
                              <i class="fas fa-play"></i> View
                            </a>
                          </div>
                        </div>
                      </li>
                    `).join('')}
                  </ul>
                ` : '<p class="no-content">No videos added yet</p>'}
                
                <div class="add-content-form">
                  <h5>Add New Video</h5>
                  <form action="/admin/course/${course._id}/add-video" method="POST" enctype="multipart/form-data">
                    <input type="hidden" name="moduleIndex" value="${idx}">
                    <div class="form-row">
                      <input type="text" name="videoTitle" placeholder="Video Title" required>
                      <input type="number" name="duration" placeholder="Duration (min)" required>
                    </div>
                    <div class="form-row">
                      <label class="checkbox-label">
                        <input type="checkbox" name="isFree" value="true">
                        Free Preview
                      </label>
                      <input type="file" name="video" accept="video/*" required>
                    </div>
                    <div class="form-row">
                      <textarea name="description" placeholder="Video Description" class="form-control"></textarea>
                    </div>
                    <button type="submit" class="add-btn">
                      <i class="fas fa-plus"></i> Add Video
                    </button>
                  </form>
                </div>
              </div>
              
              <!-- Resources Section -->
              <div class="content-section">
                <h4><i class="fas fa-file-alt"></i> Resources</h4>
                ${module.resources && module.resources.length > 0 ? `
                  <ul class="content-list">
                    ${module.resources.map((r, rIdx) => `
                      <li>
                        <div class="content-item">
                          <span class="content-title">${r.title} (${r.type})</span>
                          <div class="content-meta">
                            <a href="${r.fileUrl}" target="_blank">Download</a>
                            ${r.isFree ? '<span class="free-badge">Free</span>' : ''}
                          </div>
                        </div>
                      </li>
                    `).join('')}
                  </ul>
                ` : '<p class="no-content">No resources added yet</p>'}
                
                <div class="add-content-form">
                  <h5>Add New Resource</h5>
                  <form action="/admin/course/${course._id}/add-resource" method="POST" enctype="multipart/form-data">
                    <input type="hidden" name="moduleIndex" value="${idx}">
                    <div class="form-row">
                      <input type="text" name="title" placeholder="Resource Title" required>
                      <select name="type" required>
                        <option value="">Select Type</option>
                        <option value="PDF">PDF</option>
                        <option value="DOC">DOC</option>
                        <option value="DOCX">DOCX</option>
                        <option value="PPT">PPT</option>
                        <option value="PPTX">PPTX</option>
                        <option value="TXT">TXT</option>
                        <option value="ZIP">ZIP</option>
                      </select>
                    </div>
                    <div class="form-row">
                      <label class="checkbox-label">
                        <input type="checkbox" name="isFree" value="true">
                        Free Download
                      </label>
                      <input type="file" name="resource" accept=".pdf,.doc,.docx,.ppt,.pptx,.txt,.zip" required>
                    </div>
                    <button type="submit" class="add-btn">
                      <i class="fas fa-plus"></i> Add Resource
                    </button>
                  </form>
                </div>
              </div>
              
              <!-- Tests Section -->
              <div class="content-section">
                <h4><i class="fas fa-question-circle"></i> Tests & Quizzes</h4>
                ${module.tests && module.tests.length > 0 ? `
                  <ul class="content-list">
                    ${module.tests.map((test, testIdx) => `
                      <li>
                        <div class="content-item">
                          <span class="content-title">${test.title}</span>
                          <div class="content-meta">
                            <span>${test.questions ? test.questions.length : 0} questions</span>
                            ${test.isFree ? '<span class="free-badge">Free Test</span>' : ''}
                          </div>
                          <div class="content-actions">
                            <a href="/admin/test/${test._id}/edit">Edit</a>
                            <a href="/admin/test/${test._id}/results">Results</a>
                          </div>
                        </div>
                      </li>
                    `).join('')}
                  </ul>
                ` : '<p class="no-content">No tests added yet</p>'}
                
                <div class="add-content-form">
                  <a href="/admin/course/${course._id}/module/${idx}/create-test" class="add-btn">
                    <i class="fas fa-plus"></i> Create Test
                  </a>
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('');
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Manage Content - ${course.title}</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .course-info {
            display: flex;
            align-items: center;
            gap: 1.5rem;
            margin-bottom: 2rem;
            padding-bottom: 1.5rem;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .course-image {
            width: 100px;
            height: 100px;
            border-radius: var(--radius);
            overflow: hidden;
          }

          .course-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .course-image-placeholder {
            width: 100%;
            height: 100%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 1.5rem;
          }

          .course-details h2 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .course-details p {
            color: var(--gray);
          }

          .course-meta {
            display: flex;
            gap: 1rem;
            margin-top: 0.5rem;
          }

          .course-category, .course-level {
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .course-category {
            background: rgba(76, 110, 245, 极客时间);
            color: var(--secondary);
          }

          .course-level {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
          }

          .add-module-form {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .add-module-form h3 {
            margin-bottom: 1rem;
            font-family: 'Montserrat', sans-serif;
            color: var(--light);
          }

          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
            margin-bottom: 1rem;
          }

          .form-control {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,极客时间);
            color: var(--light);
            font-family: inherit;
          }

          .form-control:focus {
            outline: none;
            border-color: var(--primary);
          }

          textarea.form-control {
            min-height: 100px;
            resize: vertical;
          }

          .add-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: var(--radius);
            cursor: pointer;
            font-family: inherit;
            font-weight: 500;
            transition: var(--transition);
          }

          .add-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .module-card {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .module-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            padding-bottom: 1rem;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .module-header h3 {
            font-family: 'Montserrat', sans-serif;
            color: var(--light);
          }

          .module-stats {
            display: flex;
            gap: 1rem;
            font-size: 0.9rem;
            color: var(--gray);
          }

          .module-description {
            color: var(--gray);
            margin-bottom: 1.5rem;
          }

          .module-content {
            display: grid;
            grid-template-columns: 1fr;
            gap: 1.极客时间;
          }

          .content-section {
            background: rgba(255,255,255,0.02);
            padding: 1.5rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          .content-section h4 {
            font-family: '极客时间', sans-serif;
            margin-bottom: 1rem;
            color: var(--light);
            display: flex;
            align-items: center;
            gap: 0.5rem;
          }

          .content-list {
            list-style: none;
            margin-bottom: 1.5rem;
          }

          .content-list li {
            padding: 0.75rem;
            border-bottom: 1px solid rgba(255,255,255,0.05);
          }

          .content-list li:last-child {
            border-bottom: none;
          }

          .content-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .content-title {
            flex: 1;
          }

          .content-meta {
            display: flex;
            align-items: center;
            gap: 1rem;
          }

          .view-link {
            color: var(--secondary);
            text-decoration: none;
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }

          .view-link:hover {
            text-decoration: underline;
          }

          .free-badge {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8极客时间;
            font-weight: 500;
          }

          .content-actions {
            display: flex;
            gap: 0.5rem;
          }

          .content-actions a {
            color: var(--secondary);
            text-decoration: none;
            font-size: 0.9rem;
          }

          .content-actions a:hover {
            text-decoration: underline;
          }

          .no-content {
            color: var(--gray);
            font-style: italic;
            margin-bottom: 1.5rem;
          }

          .add-content-form {
            background: rgba(255,255,255,0.02);
            padding: 1rem;
            border-radius: var(--radius);
            border: 1px dashed rgba(255,255,255,0.1);
极客时间
          .add-content-form h5 {
            margin-bottom: 1rem;
            color: var(--light);
          }

          .checkbox-label {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            color: var(--light);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin极客时间 a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .form-row {
              grid-template-columns: 1fr;
            }

            .module-header {
              flex-direction: column;
              align-items: flex-start;
              gap: 1rem;
            }

            .module-stats {
              flex-wrap: wrap;
            }

            .content-item {
              flex-direction: column;
              align-items: flex-start;
              gap: 0.5rem;
            }

            .content-meta {
              width: 100%;
              justify-content: space-between;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-cog"></i> Manage Content</h1>
            <p>Add and manage content for "${course.title}"</p>
          </div>
          
          <div class="admin-card">
            <div class="course-info">
              <div class="course-image">
                ${course.imagePath ? `
                  <img src="${course.imagePath}" alt="${course.title}">
                ` : course.imageUrl ? `
                  <img src="${course.imageUrl}" alt="${course.title}">
                ` : `
                  <div class="course-image-placeholder">
                    <i class="fas fa-book"></i>
                  </div>
                `}
              </div>
              <div class="course极客时间">
                <h2>${course.title}</h2>
                <p>${course.description}</p>
                <div class="course-meta">
                  <span class="course-category">${course.category}</span>
                  <span class="course-level">${course.level}</span>
                </div>
              </div>
            </div>
            
            <div class="add-mod极客时间-form">
              <h3><极客时间 class="fas fa-plus"></i> Add New Module</h3>
              <form action="/admin/course/${course._id}/add-module" method="POST">
                <div class="form-row">
                  <input type="text" name="moduleTitle" class="form-control" placeholder="Module Title" required>
                  <textarea name="moduleDescription" class="form-control" placeholder="Module Description" required></textarea>
                </div>
                <button type="submit" class="add-btn">
                  <i class="fas fa-plus"></i> Add Module
                </button>
              </form>
            </div>
            
            <div class="modules-list">
              ${modulesHtml || `
                <div class="empty-state">
                  <i class="fas fa-folder-open" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray);"></i>
                  <h3>No Modules Added Yet</h3>
                  <p>Start by adding your first module to this course.</p>
                </div>
              `}
            </div>
            
            <div class="admin-links">
              <a href="/admin/manage-courses"><i class="fas fa-arrow-left"></i> Back to Manage Courses</a>
              <a href="/admin"><i class="fas fa-cog"></i> Admin Portal</a>
            </div>
          </div>
        </div>
        
        <!-- Add protection script -->
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading content manager: ' + error.message);
  }
});





// Enhanced Add Module Handler
app.post('/admin/course/:courseId/add-module', requireAdmin, async (req, res) => {
  try {
    const { moduleTitle, moduleDescription } = req.body;
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).send('Course not found');
    
    course.modules.push({ 
      moduleTitle, 
      moduleDescription, 
      videos: [], 
      resources: [], 
      tests: [] 
    });
    
    await course.save();
    res.redirect(`/admin/course/${course._id}/content`);
  } catch (error) {
    res.status(500).send('Error adding module: ' + error.message);
  }
});

// Enhanced Video Upload Handler to use protected videos
app.post('/admin/course/:courseId/add-video', requireAdmin, uploadVideo.single('video'), async (req, res) => {
  try {
    const { moduleIndex, videoTitle, duration, isFree, description } = req.body;
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).send('Course not found');
    if (!req.file) return res.status(400).send('No video file uploaded');
    
    // Add watermark to video (if FFmpeg is available)
    try {
      await addWatermark(
        req.file.path, 
        req.file.path, 
        '© Learn with Saurab'
      );
    } catch (error) {
      console.log('Watermarking not available, proceeding without it');
    }
    
    const videoObj = {
      videoTitle,
      videoUrl: '/protected-video/' + req.file.filename, // Use protected route
      duration: Number(duration),
      isFree: isFree === 'true',
      description: description || ''
    };
    
    course.modules[moduleIndex].videos.push(videoObj);
    await course.save();
    res.redirect(`/admin/course/${course._id}/content`);
  } catch (error) {
    res.status(500).send('Error uploading video: ' + error.message);
  }
});

// Enhanced Resource Upload Handler with Free Option
app.post('/admin/course/:courseId/add-resource', requireAdmin, uploadResource.single('resource'), async (req, res) => {
  try {
    const { moduleIndex, title, type, isFree } = req.body;
    const course = await Course.findById(req.params.courseId);
    
    if (!course) return res.status(404).send('Course not found');
    if (!req.file) return res.status(400).send('No resource file uploaded');

    const fileUrl = '/uploads/resources/' + req.file.filename;
    const resourceObj = {
      title: title,
      fileUrl: fileUrl,
      type: type,
      isFree: isFree === 'true'
    };

    // Initialize resources array if it doesn't exist
    if (!course.modules[moduleIndex].resources) {
      course.modules[moduleIndex].resources = [];
    }

    // Add the resource
    course.modules[moduleIndex].resources.push(resourceObj);
    await course.save();
    res.redirect(`/admin/course/${course._id}/content`);
  } catch (error) {
    res.status(500).send('Error uploading resource: ' + error.message);
  }
});

// Enhanced Test Creation Form with Free Option
app.get('/admin/course/:courseId/module/:moduleIndex/create-test', requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).send('Course not found');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Create Test - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1000px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .form-group {
            margin-bottom: 1.5rem;
          }

          .form-group label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 600;
            color: var(--light);
          }

          .form-control {
            width: 100%;
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.2);
            background: rgba(255,255,255,0.05);
            color: var(--light);
            font-family: inherit;
            transition: var(--transition);
          }

          .form-control:focus {
            outline: none;
            border-color: var(--primary);
            box-shadow: 0 0 0 3px rgba(225, 6, 0, 0.2);
          }

          .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 1rem;
          }

          .checkbox-group {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin: 1rem 0;
          }

          .checkbox-group input[type="checkbox"] {
            width: 18px;
            height: 18px;
          }

          .admin-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-btn.secondary {
            background: transparent;
            border: 1px solid var(--primary);
            color: var(--primary);
          }

          .admin-btn.secondary:hover {
            background: var(--primary);
            color: white;
          }

          .question-item {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .option-item {
            background: rgba(255,255,255,0.02);
            padding: 1rem;
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .image-preview {
            max-width: 200px;
            max-height: 200px;
            margin: 10px 0;
            border-radius: var(--radius);
          }

          .option-image-preview {
            max-width: 100px;
            max-height: 100px;
            margin: 5px 0;
            border-radius: var(--radius);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .form-row {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-plus-circle"></i> Create New Test</h1>
            <p>For: ${course.title} - Module ${parseInt(req.params.moduleIndex) + 1}</p>
          </div>
          
          <div class="admin-card">
            <form action="/admin/course/${req.params.courseId}/module/${req.params.moduleIndex}/create-test" method="POST" enctype="multipart/form-data">
              <div class="form-group">
                <label for="title">Test Title*</label>
                <input type="text" id="title" name="title" class="form-control" required>
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description" class="form-control" rows="3"></textarea>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="duration">Duration (minutes)*</label>
                  <input type="number" id="duration" name="duration" class="form-control" value="30" min="5" required>
                </div>
                
                <div class="form-group">
                  <label for="maxAttempts">Maximum Attempts*</label>
                  <input type="number" id="maxAttempts" name="maxAttempts" class="form-control" value="1" min="1" required>
                </div>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="passPercentage">Pass Percentage*</label>
                  <input type="number" id="passPercentage" name="passPercentage" class="form-control" value="60" min="0" max="100" required>
                </div>
                
                <div class="form-group">
                  <div class="checkbox-group">
                    <input type="checkbox" id="isFree" name="isFree" value="true">
                    <label for="isFree">Free Preview Test</label>
                  </div>
                  
                  <div class="checkbox-group">
                    <input type="checkbox" id="hasNegativeMarking" name="hasNegativeMarking" value="true" onchange="toggleNegativeMarking()">
                    <label for="hasNegativeMarking">Enable Negative Marking</label>
                  </div>
                </div>
              </div>
              
              <div id="negativeMarkingSection" style="display: none;">
                <div class="form-group">
                  <label for="negativeMarkingPercentage">Negative Marking Percentage</label>
                  <input type="number" id="negativeMarkingPercentage" name="negativeMarkingPercentage" class="form-control" value="25" min="0" max="100">
                  <small>Percentage of question points to deduct for wrong answers</small>
                </div>
              </div>
              
              <h3>Questions</h3>
              <div id="questions-container">
                <div class="question-item">
                  <div class="form-group">
                    <label>Question 1*</label>
                    <textarea name="questions[0][questionText]" class="form-control" placeholder="Enter question" rows="3" required></textarea>
                  </div>
                  
                  <div class="form-group">
                    <label>Question Image (Optional)</label>
                    <input type="file" name="questionImage0" class="form-control" accept="image/*" onchange="previewQuestionImage(this, 0)">
                    <img id="question-image-preview-0" class="image-preview" src="" alt="Question image preview">
                  </div>
                  
                  <div class="form-group">
                    <label>Question Type*</label>
                    <select name="questions[0][questionType]" class="form-control" onchange="toggleOptions(this, 0)" required>
                      <option value="multiple-choice-single">Multiple Choice (Single Answer)</option>
                      <option value="multiple-choice-multiple">Multiple Choice (Multiple Answers)</option>
                      <option value="true-false">True/False</option>
                      <option value="short-answer">Short Answer</option>
                    </select>
                  </div>
                  
                  <div id="options-0" class="options-container">
                    <h4>Options</h4>
                    <div class="option-item">
                      <div class="form-group">
                        <label>Option 1*</label>
                        <input type="text" name="questions[0][options][0][text]" class="form-control" placeholder="Option text" required>
                        <input type="file" name="optionImage0-0" class="form-control" accept="image/*" onchange="previewOptionImage(this, 0, 0)">
                        <img id="option-image-preview-0-0" class="option-image-preview" src="" alt="Option image preview">
                        <div class="checkbox-group">
                          <input type="checkbox" name="questions[0][options][0][isCorrect]" value="true">
                          <label>Correct Answer</label>
                        </div>
                      </div>
                    </div>
                    
                    <div class="option-item">
                      <div class="form-group">
                        <label>Option 2*</label>
                        <input type="text" name="questions[0][options][1][text]" class="form-control" placeholder="Option text" required>
                        <input type="file" name="optionImage0-1" class="form-control" accept="image/*" onchange="previewOptionImage(this, 0, 1)">
                        <img id="option-image-preview-0-1" class="option-image-preview" src="" alt="Option image preview">
                        <div class="checkbox-group">
                          <input type="checkbox" name="questions[0][options][1][isCorrect]" value="true">
                          <label>Correct Answer</label>
                        </div>
                      </div>
                    </div>
                    
                    <button type="button" onclick="addOption(0)" class="admin-btn">
                      <i class="fas fa-plus"></i> Add Option
                    </button>
                  </div>
                  
                  <div class="form-group">
                    <label>Points*</label>
                    <input type="number" name="questions[0][points]" class="form-control" value="1" min="1" required>
                  </div>
                  
                  <div class="form-group">
                    <label>Answer Description/Explanation (Optional)</label>
                    <textarea name="questions[0][description]" class="form-control" placeholder="Explanation for the answer" rows="2"></textarea>
                  </div>
                  
                  <div id="short-answer-0" style="display: none;">
                    <div class="form-group">
                      <label>Correct Answer (for short answer)*</label>
                      <input type="text" name="questions[0][correctAnswer]" class="form-control" placeholder="Correct answer">
                    </div>
                  </div>
                </div>
              </div>
              
              <button type="button" onclick="addQuestion()" class="admin-btn">
                <i class="fas fa-plus"></i> Add Question
              </button>
              
              <div class="checkbox-group" style="margin: 1.5rem 0;">
                <input type="checkbox" id="isPublished" name="isPublished" value="true" checked>
                <label for="isPublished">Publish Test (make it available to students)</label>
              </div>
              
              <button type="submit" class="admin-btn">Create Test</button>
              <a href="/admin/course/${req.params.courseId}/content" class="admin-btn secondary">Cancel</a>
            </form>
          </div>
        </div>

        <script>
          let questionCount = 1;
          let optionCounts = [2];
          
          function toggleNegativeMarking() {
            const negativeMarkingSection = document.getElementById('negativeMarkingSection');
            const hasNegativeMarking = document.getElementById('hasNegativeMarking').checked;
            negativeMarkingSection.style.display = hasNegativeMarking ? 'block' : 'none';
          }
          
          function previewQuestionImage(input, questionIndex) {
            const preview = document.getElementById('question-image-preview-' + questionIndex);
            if (input.files && input.files[0]) {
              const reader = new FileReader();
              reader.onload = function(e) {
                preview.src = e.target.result;
                preview.style.display = 'block';
              }
              reader.readAsDataURL(input.files[0]);
            }
          }
          
          function previewOptionImage(input, questionIndex, optionIndex) {
            const preview = document.getElementById('option-image-preview-' + questionIndex + '-' + optionIndex);
            if (input.files && input.files[0]) {
              const reader = new FileReader();
              reader.onload = function(e) {
                preview.src = e.target.result;
                preview.style.display = 'block';
              }
              reader.readAsDataURL(input.files[0]);
            }
          }
          
          function addQuestion() {
            const container = document.getElementById('questions-container');
            const newQuestion = document.createElement('div');
            newQuestion.className = 'question-item';
            
            optionCounts[questionCount] = 2;
            
            newQuestion.innerHTML = \`
              <div class="form-group">
                <label>Question \${questionCount + 1}*</label>
                <textarea name="questions[\${questionCount}][questionText]" class="form-control" placeholder="Enter question" rows="3" required></textarea>
              </div>
              
              <div class="form-group">
                <label>Question Image (Optional)</label>
                <input type="file" name="questionImage\${questionCount}" class="form-control" accept="image/*" onchange="previewQuestionImage(this, \${questionCount})">
                <img id="question-image-preview-\${questionCount}" class="image-preview" src="" alt="Question image preview">
              </div>
              
              <div class="form-group">
                <label>Question Type*</label>
                <select name="questions[\${questionCount}][questionType]" class="form-control" onchange="toggleOptions(this, \${questionCount})" required>
                  <option value="multiple-choice-single">Multiple Choice (Single Answer)</option>
                  <option value="multiple-choice-multiple">Multiple Choice (Multiple Answers)</option>
                  <option value="true-false">True/False</option>
                  <option value="short-answer">Short Answer</option>
                </select>
              </div>
              
              <div id="options-\${questionCount}" class="options-container">
                <h4>Options</h4>
                <div class="option-item">
                  <div class="form-group">
                    <label>Option 1*</label>
                    <input type="text" name="questions[\${questionCount}][options][0][text]" class="form-control" placeholder="Option text" required>
                    <input type="file" name="optionImage\${questionCount}-0" class="form-control" accept="image/*" onchange="previewOptionImage(this, \${questionCount}, 0)">
                    <img id="option-image-preview-\${questionCount}-0" class="option-image-preview" src="" alt="Option image preview">
                    <div class="checkbox-group">
                      <input type="checkbox" name="questions[\${questionCount}][options][0][isCorrect]" value="true">
                      <label>Correct Answer</label>
                    </div>
                  </div>
                </div>
                
                <div class="option-item">
                  <div class="form-group">
                    <label>Option 2*</label>
                    <input type="text" name="questions[\${questionCount}][options][1][text]" class="form-control" placeholder="Option text" required>
                    <input type="file" name="optionImage\${questionCount}-1" class="form-control" accept="image/*" onchange="previewOptionImage(this, \${questionCount}, 1)">
                    <img id="option-image-preview-\${questionCount}-1" class="option-image-preview" src="" alt="Option image preview">
                    <div class="checkbox-group">
                      <input type="checkbox" name="questions[\${questionCount}][options][1][isCorrect]" value="true">
                      <label>Correct Answer</label>
                    </div>
                  </div>
                </div>
                
                <button type="button" onclick="addOption(\${questionCount})" class="admin-btn">
                  <i class="fas fa-plus"></i> Add Option
                </button>
              </div>
              
              <div class="form-group">
                <label>Points*</label>
                <input type="number" name="questions[\${questionCount}][points]" class="form-control" value="1" min="1" required>
              </div>
              
              <div class="form-group">
                <label>Answer Description/Explanation (Optional)</label>
                <textarea name="questions[\${questionCount}][description]" class="form-control" placeholder="Explanation for the answer" rows="2"></textarea>
              </div>
              
              <div id="short-answer-\${questionCount}" style="display: none;">
                <div class="form-group">
                  <label>Correct Answer (for short answer)*</label>
                  <input type="text" name="questions[\${questionCount}][correctAnswer]" class="form-control" placeholder="Correct answer">
                </div>
              </div>
              
              <button type="button" onclick="this.parentElement.remove()" class="admin-btn secondary">
                <i class="fas fa-trash"></i> Remove Question
              </button>
            \`;
            
            container.appendChild(newQuestion);
            questionCount++;
          }
          
          function addOption(questionIndex) {
            const optionsContainer = document.getElementById(\`options-\${questionIndex}\`);
            const optionCount = optionCounts[questionIndex] || 0;
            
            const newOption = document.createElement('div');
            newOption.className = 'option-item';
            newOption.innerHTML = \`
              <div class="form-group">
                <label>Option \${optionCount + 1}</label>
                <input type="text" name="questions[\${questionIndex}][options][\${optionCount}][text]" class="form-control" placeholder="Option text">
                <input type="file" name="optionImage\${questionIndex}-\${optionCount}" class="form-control" accept="image/*" onchange="previewOptionImage(this, \${questionIndex}, \${optionCount})">
                <img id="option-image-preview-\${questionIndex}-\${optionCount}" class="option-image-preview" src="" alt="Option image preview">
                <div class="checkbox-group">
                  <input type="checkbox" name="questions[\${questionIndex}][options][\${optionCount}][isCorrect]" value="true">
                  <label>Correct Answer</label>
                </div>
              </div>
            \`;
            
            optionsContainer.insertBefore(newOption, optionsContainer.lastElementChild);
            optionCounts[questionIndex] = optionCount + 1;
          }
          
          function toggleOptions(select, questionIndex) {
            const optionsContainer = document.getElementById(\`options-\${questionIndex}\`);
            const shortAnswerContainer = document.getElementById(\`short-answer-\${questionIndex}\`);
            
            if (select.value === 'short-answer') {
              optionsContainer.style.display = 'none';
              if (shortAnswerContainer) shortAnswerContainer.style.display = 'block';
            } else {
              optionsContainer.style.display = 'block';
              if (shortAnswerContainer) shortAnswerContainer.style.display = 'none';
            }
          }
        </script>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading test form: ' + error.message);
  }
});

// Enhanced Test Creation Handler with Free Option
app.post('/admin/course/:courseId/module/:moduleIndex/create-test', requireAdmin, uploadQuestionImage.any(), async (req, res) => {
  try {
    const { title, description, duration, maxAttempts, passPercentage, hasNegativeMarking, negativeMarkingPercentage, isFree, isPublished } = req.body;
    
    // Parse questions from form data
    const questions = [];
    let questionIndex = 0;
    
    while (req.body[`questions[${questionIndex}][questionText]`]) {
      const question = {
        questionText: req.body[`questions[${questionIndex}][questionText]`],
        questionType: req.body[`questions[${questionIndex}][questionType]`],
        points: parseInt(req.body[`questions[${questionIndex}][points]`]) || 1,
        description: req.body[`questions[${questionIndex}][description]`] || '',
        correctAnswer: req.body[`questions[${questionIndex}][correctAnswer]`] || ''
      };
      
      // Handle question image
      const questionImageFile = req.files.find(f => f.fieldname === `questionImage${questionIndex}`);
      if (questionImageFile) {
        question.questionImage = '/uploads/question-images/' + questionImageFile.filename;
      }
      
      // Process options
      if (question.questionType !== 'short-answer') {
        question.options = [];
        let optionIndex = 0;
        
        while (req.body[`questions[${questionIndex}][options][${optionIndex}][text]`]) {
          const option = {
            text: req.body[`questions[${questionIndex}][options][${optionIndex}][text]`],
            isCorrect: req.body[`questions[${questionIndex}][options][${optionIndex}][isCorrect]`] === 'true'
          };
          
          // Handle option image
          const optionImageFile = req.files.find(f => f.fieldname === `optionImage${questionIndex}-${optionIndex}`);
          if (optionImageFile) {
            option.image = '/uploads/question-images/' + optionImageFile.filename;
          }
          
          question.options.push(option);
          optionIndex++;
        }
      }
      
      questions.push(question);
      questionIndex++;
    }
    
    // Create new test
    const newTest = new Test({
      courseId: req.params.courseId,
      moduleIndex: parseInt(req.params.moduleIndex),
      title,
      description,
      duration: parseInt(duration) || 30,
      maxAttempts: parseInt(maxAttempts) || 1,
      passPercentage: parseInt(passPercentage) || 60,
      hasNegativeMarking: hasNegativeMarking === 'true',
      negativeMarkingPercentage: parseInt(negativeMarkingPercentage) || 25,
      isFree: isFree === 'true',
      questions: questions,
      isPublished: isPublished === 'true'
    });
    
    await newTest.save();
    
    // Add test to course module
    const course = await Course.findById(req.params.courseId);
    course.modules[req.params.moduleIndex].tests.push(newTest._id);
    await course.save();
    
    res.redirect(`/admin/course/${req.params.courseId}/content?message=Test created successfully`);
  } catch (error) {
    res.status(500).send('Error creating test: ' + error.message);
  }
});





















// Enhanced Test Update Handler with Free Option
app.post('/admin/test/:testId/update', requireAdmin, uploadQuestionImage.fields([
  { name: 'questions[][questionImage]', maxCount: 50 },
  { name: 'questions[][options][][image]', maxCount: 200 }
]), async (req, res) => {
  try {
    const { title, description, duration, maxAttempts, passPercentage, hasNegativeMarking, negativeMarkingPercentage, isFree, isPublished, questions } = req.body;
    
    const test = await Test.findById(req.params.testId);
    if (!test) return res.status(404).send('Test not found');
    
    // Process questions data with image handling
    const processedQuestions = await Promise.all(questions.map(async (q, index) => {
      const question = {
        questionText: q.questionText,
        questionType: q.questionType,
        points: parseInt(q.points) || 1,
        description: q.description || ''
      };
      
      // Handle question image
      if (q.removeQuestionImage === 'true') {
        question.questionImage = undefined;
      } else {
        const questionImageFile = req.files['questions[][questionImage]']?.find(f => {
          const fieldName = f.fieldname;
          return fieldName.includes(`[${index}][questionImage]`);
        });
        
        if (questionImageFile) {
          question.questionImage = '/uploads/question-images/' + questionImageFile.filename;
        } else if (test.questions[index]?.questionImage) {
          question.questionImage = test.questions[index].questionImage;
        }
      }
      
      if (q.questionType === 'short-answer') {
        question.correctAnswer = q.correctAnswer;
        question.options = undefined;
      } else if (q.options) {
        question.options = await Promise.all(q.options.map(async (option, optIndex) => {
          const optionData = {
            text: option.text,
            isCorrect: option.isCorrect === 'true'
          };
          
          // Handle option image
          if (option.removeOptionImage === 'true') {
            optionData.image = undefined;
          } else {
            const optionImageFile = req.ffiles['questions[][options][][image]']?.find(f => {
              const fieldName = f.fieldname;
              return fieldName.includes(`[${index}][options][${optIndex}][image]`);
            });
            
            if (optionImageFile) {
              optionData.image = '/uploads/question-images/' + optionImageFile.filename;
            } else if (test.questions[index]?.options?.[optIndex]?.image) {
              optionData.image = test.questions[index].options[optIndex].image;
            }
          }
          
          return optionData;
        }));
        question.correctAnswer = undefined;
      }
      
      return question;
    }));
    
    // Update test
    test.title = title;
    test.description = description;
    test.duration = parseInt(duration) || 30;
    test.maxAttempts = parseInt(maxAttempts) || 1;
    test.passPercentage = parseInt(passPercentage) || 60;
    test.hasNegativeMarking = hasNegativeMarking === 'true';
    test.negativeMarkingPercentage = parseInt(negativeMarkingPercentage) || 25;
    test.isFree = isFree === 'true';
    test.questions = processedQuestions;
    test.isPublished = isPublished === 'true';
    
    await test.save();
    
    res.redirect(`/admin/course/${test.courseId}/tests?message=Test updated successfully`);
  } catch (error) {
    res.status(500).send('Error updating test: ' + error.message);
  }
});


// Enhanced Delete Test Handler
app.get('/admin/test/:testId/delete', requireAdmin, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    if (!test) return res.status(404).send('Test not found');
    
    const courseId = test.courseId;
    
    // Remove test reference from course module
    const course = await Course.findById(courseId);
    if (course && course.modules[test.moduleIndex] && course.modules[test.moduleIndex].tests) {
      course.modules[test.moduleIndex].tests = course.modules[test.moduleIndex].tests.filter(
        testId => testId.toString() !== req.params.testId
      );
      await course.save();
    }
    
    await Test.findByIdAndDelete(req.params.testId);
    
    // Also delete all test results
    await TestResult.deleteMany({ testId: req.params.testId });
    
    res.redirect(`/admin/course/${courseId}/tests?message=Test deleted successfully`);
  } catch (error) {
    res.status(500).send('Error deleting test: ' + error.message);
  }
});


// Enhanced View Tests for a Course
app.get('/admin/course/:courseId/tests', requireAdmin, async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    const tests = await Test.find({ courseId: req.params.courseId }).sort({ createdAt: -1 });
    
    let testsHtml = tests.map(test => `
      <div class="test-item">
        <div class="test-info">
          <h3>${test.title}</h3>
          <p>${test.description || 'No description'}</p>
          <div class="test-meta">
            <span>Module: ${test.moduleIndex + 1}</span>
            <span>Questions: ${test.questions.length}</span>
            <span>Duration: ${test.duration} mins</span>
            ${test.isFree ? '<span class="free-badge">Free Preview</span>' : ''}
          </div>
        </div>
        <div class="test-actions">
          <a href="/admin/test/${test._id}/edit" class="action-btn edit-btn">
            <i class="fas fa-edit"></i> Edit
          </a>
          <a href="/admin/test/${test._id}/results" class="action-btn results-btn">
            <i class="fas fa-chart-bar"></i> Results
          </a>
          <a href="/test/${test._id}/take" class="action-btn preview-btn">
            <i class="fas fa-eye"></i> Preview
          </a>
        </div>
      </div>
    `).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Tests - ${course.title}</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1000px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .tests-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
          }

          .test-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border: 1px solid rgba(255,255,255,0.05);
            transition: var(--transition);
          }

          .test-item:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: var(--shadow);
          }

          .test-info h3 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .test-info p {
            color: var(--gray);
            margin-bottom: 0.5rem;
          }

          .test-meta {
            display: flex;
            gap: 1rem;
            font-size: 0.9rem;
            color: var(--gray);
          }

          .free-badge {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .test-actions {
            display: flex;
            gap: 0.5rem;
          }

          .action-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            text-decoration: none;
            font-size: 0.9rem;
            transition: var(--transition);
          }

          .edit-btn {
            background: rgba(76, 110, 245, 0.1);
            color: var(--secondary);
            border: 1px solid rgba(76, 110, 245, 0.2);
          }

          .edit-btn:hover {
            background: rgba(76, 110, 245, 0.2);
          }

          .results-btn {
            background: rgba(230, 126, 34, 0.1);
            color: #E67E22;
            border: 1px solid rgba(230, 126, 34, 0.2);
          }

          .results-btn:hover {
            background: rgba(230, 126, 34, 0.2);
          }

          .preview-btn {
            background: rgba(56, 161, 105, 0.1);
            color: var(--success);
            border: 1px solid rgba(56, 161, 105, 0.2);
          }

          .preview-btn:hover {
            background: rgba(56, 161, 105, 0.2);
          }

          .admin-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          .empty-state {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          @media (max-width: 768px) {
            .test-item {
              flex-direction: column;
              align-items: flex-start;
              gap: 1rem;
            }

            .test-actions {
              width: 100%;
              justify-content: space-between;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-question-circle"></i> Tests: ${course.title}</h1>
            <p>Manage tests and quizzes for this course</p>
          </div>
          
          <div class="admin-card">
            <div class="tests-header">
              <h2>All Tests (${tests.length})</h2>
              <a href="/admin/course/${course._id}/module/0/create-test" class="admin-btn">
                <i class="fas fa-plus"></i> Create New Test
              </a>
            </div>
            
            <div class="tests-list">
              ${testsHtml || `
                <div class="empty-state">
                  <i class="fas fa-question-circle" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray);"></i>
                  <h3>No Tests Available</h3>
                  <p>You haven't created any tests for this course yet.</p>
                </div>
              `}
            </div>
            
            <div class="admin-links">
              <a href="/admin/course/${course._id}/content"><i class="fas fa-arrow-left"></i> Back to Course Content</a>
              <a href="/admin/manage-courses"><i class="fas fa-book"></i> Manage Courses</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading tests: ' + error.message);
  }
});


// Test Results Page
app.get('/admin/test/:testId/results', requireAdmin, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    const course = await Course.findById(test.courseId);
    const results = await TestResult.find({ testId: req.params.testId })
      .populate('studentId', 'name email')
      .sort({ completedAt: -1 });
    
    let resultsHtml = results.map(result => `
      <tr>
        <td>${result.studentId.name}</td>
        <td>${result.studentId.email}</td>
        <td>${result.score}/${result.totalPoints}</td>
        <td>${result.percentage}%</td>
        <td>${result.passed ? '<span class="passed">Passed</span>' : '<span class="failed">Failed</span>'}</td>
        <td>${new Date(result.completedAt).toLocaleDateString()}</td>
        <td>
          <a href="/admin/test-result/${result._id}" class="action-btn view-btn">
            <i class="fas fa-eye"></i> Details
          </a>
        </td>
      </tr>
    `).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Results - ${test.title}</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .results-summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 1rem;
            margin-bottom: 2rem;
          }

          .summary-card {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            text-align: center;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .summary-card h3 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .summary-card .number {
            font-size: 2rem;
            font-weight: bold;
            color: var(--primary);
          }

          .results-table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 2rem;
          }

          .results-table th,
          .results-table td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid rgba(255,255,255,0.1);
          }

          .results-table th {
            background: rgba(255,255,255,0.05);
            font-weight: 600;
            color: var(--light);
          }

          .results-table tr:hover {
            background: rgba(255,255,255,0.02);
          }

          .passed {
            color: var(--success);
            font-weight: 600;
          }

          .failed {
            color: var(--danger);
            font-weight: 600;
          }

          .action-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            text-decoration: none;
            font-size: 0.9rem;
            transition: var(--transition);
          }

          .view-btn {
            background: rgba(76, 110, 245, 0.1);
            color: var(--secondary);
            border: 1px solid rgba(76, 110, 245, 0.2);
          }

          .view-btn:hover {
            background: rgba(76, 110, 245, 0.2);
          }

          .admin-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .results-table {
              display: block;
              overflow-x: auto;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-chart-bar"></i> Test Results: ${test.title}</h1>
            <p>Course: ${course.title} - Module ${test.moduleIndex + 1}</p>
          </div>
          
          <div class="admin-card">
            <div class="results-summary">
              <div class="summary-card">
                <h3>Total Attempts</h3>
                <div class="number">${results.length}</div>
              </div>
              <div class="summary-card">
                <h3>Average Score</h3>
                <div class="number">${results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length) : 0}%</div>
              </div>
              <div class="summary-card">
                <h3>Pass Rate</h3>
                <div class="number">${results.length > 0 ? Math.round((results.filter(r => r.passed).length / results.length) * 100) : 0}%</div>
              </div>
            </div>
            
            <h3>Student Results</h3>
            <table class="results-table">
              <thead>
                <tr>
                  <th>Student Name</th>
                  <th>Email</th>
                  <th>Score</th>
                  <th>Percentage</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${resultsHtml || `
                  <tr>
                    <td colspan="7" style="text-align: center; padding: 2rem; color: var(--gray);">
                      No test results available yet.
                    </td>
                  </tr>
                `}
              </tbody>
            </table>
            
            <div class="admin-links">
              <a href="/admin/course/${course._id}/tests"><i class="fas fa-arrow-left"></i> Back to Tests</a>
              <a href="/admin/course/${course._id}/content"><i class="fas fa-cog"></i> Course Content</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading test results: ' + error.message);
  }
});


// Individual Test Result Details
app.get('/admin/test-result/:resultId', requireAdmin, async (req, res) => {
  try {
    const result = await TestResult.findById(req.params.resultId)
      .populate('testId')
      .populate('studentId', 'name email');
    
    if (!result) return res.status(404).send('Test result not found');
    
    const test = result.testId;
    const course = await Course.findById(test.courseId);
    
    let answersHtml = result.answers.map((answer, index) => {
      const question = test.questions[answer.questionIndex];
      let answerHtml = '';
      
      if (question.questionType === 'short-answer') {
        answerHtml = `
          <p><strong>Student's Answer:</strong> ${answer.answerText || 'No answer'}</p>
          <p><strong>Correct Answer:</strong> ${question.correctAnswer}</p>
        `;
      } else {
        answerHtml = `
          <p><strong>Selected Option${question.questionType === 'multiple-choice-multiple' ? 's' : ''}:</strong> 
          ${answer.selectedOption !== undefined ? 
            (Array.isArray(answer.selectedOption) ? 
              answer.selectedOption.map(opt => `Option ${opt + 1}`).join(', ') : 
              `Option ${answer.selectedOption + 1}`) : 
            'No selection'}
          </p>
          <p><strong>Correct Option${question.questionType === 'multiple-choice-multiple' ? 's' : ''}:</strong> 
          ${question.options.map((opt, i) => opt.isCorrect ? `Option ${i + 1}` : '').filter(Boolean).join(', ')}
          </p>
        `;
      }
      
      return `
        <div class="answer-item ${answer.isCorrect ? 'correct' : 'incorrect'}">
          <h4>Question ${answer.questionIndex + 1}: ${question.questionText}</h4>
          ${answerHtml}
          <p><strong>Points:</strong> ${answer.pointsEarned}/${question.points}</p>
          ${question.description ? `<p><strong>Explanation:</strong> ${question.description}</p>` : ''}
        </div>
      `;
    }).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Result Details - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .admin-container {
            max-width: 1000px;
            margin: 0 auto;
          }

          .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .admin-header p {
            color: var(--gray);
          }

          .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .result-summary {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .student-info {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1rem;
            margin-bottom: 1.5rem;
          }

          .info-item {
            display: flex;
            flex-direction: column;
          }

          .info-label {
            font-size: 0.9rem;
            color: var(--gray);
            margin-bottom: 0.25rem;
          }

          .info-value {
            font-weight: 600;
            color: var(--light);
          }

          .score-display {
            text-align: center;
            padding: 1.5rem;
            background: rgba(255,255,255,0.05);
            border-radius: var(--radius);
            margin: 1.5rem 0;
          }

          .score-percentage {
            font-size: 3rem;
            font-weight: bold;
            color: ${result.passed ? 'var(--success)' : 'var(--danger)'};
            margin-bottom: 0.5rem;
          }

          .score-text {
            font-size: 1.2rem;
            color: var(--light);
          }

          .answers-container {
            margin-top: 2rem;
          }

          .answer-item {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1.5rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .answer-item.correct {
            border-left: 4px solid var(--success);
          }

          .answer-item.incorrect {
            border-left: 4px solid var(--danger);
          }

          .answer-item h4 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 1rem;
            color: var(--light);
          }

          .answer-item p {
            margin-bottom: 0.5rem;
            color: var(--gray);
          }

          .answer-item strong {
            color: var(--light);
          }

          .admin-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
          }

          .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .admin-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .admin-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .admin-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .student-info {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1><i class="fas fa-file-alt"></i> Test Result Details</h1>
            <p>${test.title} - ${result.studentId.name}</p>
          </div>
          
          <div class="admin-card">
            <div class="result-summary">
              <div class="student-info">
                <div class="info-item">
                  <span class="info-label">Student Name</span>
                  <span class="info-value">${result.studentId.name}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Student Email</span>
                  <span class="info-value">${result.studentId.email}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Test Title</span>
                  <span class="info-value">${test.title}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Course</span>
                  <span class="info-value">${course.title}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Module</span>
                  <span class="info-value">Module ${test.moduleIndex + 1}</span>
                </div>
                <div class="info-item">
                  <span class="info-label">Completed On</span>
                  <span class="info-value">${new Date(result.completedAt).toLocaleString()}</span>
                </div>
              </div>
              
              <div class="score-display">
                <div class="score-percentage">${result.percentage}%</div>
                <div class="score-text">${result.score}/${result.totalPoints} Points • ${result.passed ? 'PASSED' : 'FAILED'}</div>
              </div>
            </div>
            
            <h3>Question-wise Analysis</h3>
            <div class="answers-container">
              ${answersHtml}
            </div>
            
            <div class="admin-links">
              <a href="/admin/test/${test._id}/results"><i class="fas fa-arrow-left"></i> Back to Results</a>
              <a href="/admin/course/${course._id}/tests"><i class="fas fa-question-circle"></i> All Tests</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading test result details: ' + error.message);
  }
});




// Now let me add the missing route for student document access
app.get('/dashboard/my-documents', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const enrolledCourses = await Course.find({ _id: { $in: user.enrolledCourses } });
    
    let documentsHtml = '';
    
    enrolledCourses.forEach(course => {
      course.modules.forEach(module => {
        if (module.resources && module.resources.length > 0) {
          module.resources.forEach(resource => {
            // Check if user has access to this resource (either free or enrolled)
            if (resource.isFree || user.enrolledCourses.includes(course._id.toString())) {
              documentsHtml += `
                <div class="document-item">
                  <div class="document-info">
                    <h4>${resource.title}</h4>
                    <p>${course.title} - Module: ${module.moduleTitle}</p>
                    <span class="document-type">${resource.type}</span>
                    ${resource.isFree ? '<span class="free-badge">Free</span>' : ''}
                  </div>
                  <div class="document-actions">
                    <a href="${resource.fileUrl}" download class="action-btn download-btn">
                      <i class="fas fa-download"></i> Download
                    </a>
                    ${resource.type.includes('pdf') || resource.type.includes('txt') ? `
                      <a href="${resource.fileUrl}" target="_blank" class="action-btn view-btn">
                        <i class="fas fa-eye"></i> View
                      </a>
                    ` : ''}
                  </div>
                </div>
              `;
            }
          });
        }
      });
    });
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>My Documents - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .dashboard-container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .dashboard-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .dashboard-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .dashboard-header p {
            color: var(--gray);
          }

          .dashboard-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .documents-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
          }

          .document-item {
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border: 1px solid rgba(255,255,255,0.05);
            transition: var(--transition);
          }

          .document-item:hover {
            border-color: var(--primary);
            transform: translateY(-2px);
            box-shadow: var(--shadow);
          }

          .document-info h4 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .document-info p {
            color: var(--gray);
            margin-bottom: 0.5rem;
          }

          .document-type {
            background: rgba(76, 110, 245, 0.2);
            color: var(--secondary);
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .free-badge {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
            margin-left: 0.5rem;
          }

          .document-actions {
            display: flex;
            gap: 0.5rem;
          }

          .action-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            text-decoration: none;
            font-size: 0.9rem;
            transition: var(--transition);
          }

          .download-btn {
            background: rgba(76, 110, 245, 0.1);
            color: var(--secondary);
            border: 1px solid rgba(76, 110, 245, 0.2);
          }

          .download-btn:hover {
            background: rgba(76, 110, 245, 0.2);
          }

          .view-btn {
            background: rgba(56, 161, 105, 0.1);
            color: var(--success);
            border: 1px solid rgba(56, 161, 105, 0.2);
          }

          .view-btn:hover {
            background: rgba(56, 161, 105, 0.2);
          }

          .dashboard-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
          }

          .dashboard-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .dashboard-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .dashboard-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .dashboard-links a:hover {
            text-decoration: underline;
            }
            
            .empty-state {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          @media (max-width: 768px) {
            .document-item {
              flex-direction: column;
              align-items: flex-start;
              gap: 1rem;
            }

            .document-actions {
              width: 100%;
              justify-content: space-between;
            }
          }
        </style>
      </head>
      <body>
        <div class="dashboard-container">
          <div class="dashboard-header">
            <h1><i class="fas fa-file-alt"></i> My Documents</h1>
            <p>Access all your course materials and resources</p>
          </div>
          
          <div class="dashboard-card">
            <div class="documents-header">
              <h2>My Learning Resources</h2>
              <a href="/dashboard" class="dashboard-btn">
                <i class="fas fa-arrow-left"></i> Back to Dashboard
              </a>
            </div>
            
            <div class="documents-list">
              ${documentsHtml || `
                <div class="empty-state">
                  <i class="fas fa-file-alt" style="font-size: 3rem; margin-bottom: 1rem; color: var(--gray);"></i>
                  <h3>No Documents Available</h3>
                  <p>You haven't enrolled in any courses with downloadable resources yet.</p>
                </div>
              `}
            </div>
            
            <div class="dashboard-links">
              <a href="/browse-courses"><i class="fas fa-book"></i> Browse Courses</a>
              <a href="/my-courses"><i class="fas fa-graduation-cap"></i> My Courses</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading documents: ' + error.message);
  }
});



// Enhanced Browse Courses with Categories
app.get('/browse-courses', async (req, res) => {
  try {
    const categories = ['CEE Preparation', 'Loksewa Preparation', 'License Exam', 'Others'];
    const selectedCategory = req.query.category || '';
    
    let filter = {};
    if (selectedCategory) {
      filter.category = selectedCategory;
    }
    
    const courses = await Course.find(filter).sort({ createdAt: -1 });
    
    let coursesHtml = courses.map(course => {
      const videosCount = course.modules.reduce((total, module) => total + (module.videos ? module.videos.length : 0), 0);
      const resourcesCount = course.modules.reduce((total, module) => total + (module.resources ? module.resources.length : 0), 0);
      const testsCount = course.modules.reduce((total, module) => total + (module.tests ? module.tests.length : 0), 0);
      
      return `
        <div class="course-card">
          <div class="course-image">
            ${course.imagePath ? `
              <img src="${course.imagePath}" alt="${course.title}">
            ` : course.imageUrl ? `
              <img src="${course.imageUrl}" alt="${course.title}">
            ` : `
              <div class="course-image-placeholder">
                <i class="fas fa-book"></i>
              </div>
            `}
            <div class="course-category">${course.category}</div>
          </div>
          <div class="course-content">
            <h3>${course.title}</h3>
            <p class="course-description">${course.description}</p>
            <div class="course-meta">
              <span><i class="fas fa-film"></i> ${videosCount} videos</span>
              <span><i class="fas fa-file-alt"></i> ${resourcesCount} resources</span>
              <span><i class="fas fa-question-circle"></i> ${testsCount} tests</span>
            </div>
            <div class="course-level">Level: ${course.level}</div>
            <div class="course-footer">
              <div class="course-price">NPR ${course.price}</div>
              <a href="/course-preview/${course._id}" class="view-course-btn">View Course</a>
            </div>
          </div>
        </div>
      `;
    }).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Browse Courses - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .browse-container {
            max-width: 1200px;
            margin: 0 auto;
          }

          .browse-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .browse-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2rem;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .browse-header p {
            color: var(--gray);
          }

          .browse-content {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .categories-filter {
            display: flex;
            gap: 1rem;
            margin-bottom: 2rem;
            flex-wrap: wrap;
          }

          .category-btn {
            padding: 0.75rem 1.5rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
            background: rgba(255,255,255,0.05);
            color: var(--light);
            cursor: pointer;
            transition: var(--transition);
            font-family: inherit;
          }

          .category-btn.active {
            background: var(--primary);
            border-color: var(--primary);
          }

          .category-btn:hover {
            background: rgba(255,255,255,0.1);
          }

          .courses-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
            gap: 2rem;
          }

          .course-card {
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            overflow: hidden;
            border: 1px solid rgba(255,255,255,0.05);
            transition: var(--transition);
          }

          .course-card:hover {
            border-color: var(--primary);
            transform: translateY(-5px);
            box-shadow: var(--shadow);
          }

          .course-image {
            position: relative;
            height: 200px;
            overflow: hidden;
          }

          .course-image img {
            width: 100%;
            height: 100%;
            object-fit: cover;
          }

          .course-image-placeholder {
            width: 100%;
            height: 100%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 3rem;
          }

          .course-category {
            position: absolute;
            top: 1rem;
            left: 1rem;
            background: var(--primary);
            color: white;
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .course-content {
            padding: 1.5rem;
          }

          .course-content h3 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.75rem;
            color: var(--light);
          }

          .course-description {
            color: var(--gray);
            margin-bottom: 1rem;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
          }

          .course-meta {
            display: flex;
            gap: 1rem;
            margin-bottom: 1rem;
            font-size: 0.9rem;
            color: var(--gray);
          }

          .course-meta span {
            display: flex;
            align-items: center;
            gap: 0.25rem;
          }

          .course-level {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
            margin-bottom: 1rem;
            display: inline-block;
          }

          .course-footer {
            display: flex;
            justify-content: space-between;
            align-items: center;
          }

          .course-price {
            font-family: 'Montserrat', sans-serif;
            font-size: 1.25rem;
            font-weight: 600;
            color: var(--primary);
          }

          .view-course-btn {
            padding: 0.5rem 1rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 500;
            transition: var(--transition);
          }

          .view-course-btn:hover {
            background: var(--primary-dark);
          }

          .empty-state {
            text-align: center;
            padding: 3rem;
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          .browse-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
          }

          .browse-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .browse-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .courses-grid {
              grid-template-columns: 1fr;
            }

            .categories-filter {
              justify-content: center;
            }

            .course-footer {
              flex-direction: column;
              gap: 1rem;
              align-items: flex-start;
            }
          }
        </style>
      </head>
      <body>
        <div class="browse-container">
          <div class="browse-header">
            <h1><i class="fas fa-book-open"></i> Browse Courses</h1>
            <p>Discover our comprehensive learning programs designed for your success</p>
          </div>
          
          <div class="browse-content">
            <div class="categories-filter">
              <button class="category-btn ${!selectedCategory ? 'active' : ''}" onclick="window.location.href='/browse-courses'">
                All Courses
              </button>
              ${categories.map(category => `
                <button class="category-btn ${selectedCategory === category ? 'active' : ''}" onclick="window.location.href='/browse-courses?category=${encodeURIComponent(category)}'">
                  ${category}
                </button>
              `).join('')}
            </div>
            
            <div class="courses-grid">
              ${coursesHtml || `
                <div class="empty-state" style="grid-column: 1 / -1;">
                  <i class="fas fa-book" style="font-size: 4rem; margin-bottom: 1rem; color: var(--gray);"></i>
                  <h3>No Courses Available</h3>
                  <p>No courses found in this category. Please check back later.</p>
                </div>
              `}
            </div>
            
            <div class="browse-links">
              <a href="/"><i class="fas fa-home"></i> Home</a>
              ${req.session.userId ? `
                <a href="/dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
                <a href="/my-courses"><i class="fas fa-graduation-cap"></i> My Courses</a>
              ` : `
                <a href="/login"><i class="fas fa-sign-in-alt"></i> Login</a>
                <a href="/register"><i class="fas fa-user-plus"></i> Register</a>
              `}
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading courses: ' + error.message);
  }
});


// Course Preview Page
app.get('/course-preview/:courseId', async (req, res) => {
  try {
    const course = await Course.findById(req.params.courseId);
    if (!course) return res.status(404).send('Course not found');
    
    const isEnrolled = req.session.userId ? 
      await User.exists({ _id: req.session.userId, enrolledCourses: req.params.courseId }) : 
      false;
    
    // Count free content
    const freeVideos = course.modules.reduce((total, module) => 
      total + (module.videos ? module.videos.filter(v => v.isFree).length : 0), 0);
    
    const freeResources = course.modules.reduce((total, module) => 
      total + (module.resources ? module.resources.filter(r => r.isFree).length : 0), 0);
    
    const freeTests = course.modules.reduce((total, module) => 
      total + (module.tests ? module.tests.filter(t => t.isFree).length : 0), 0);
    
    let modulesHtml = course.modules.map((module, idx) => {
      const moduleFreeVideos = module.videos ? module.videos.filter(v => v.isFree).length : 0;
      const moduleFreeResources = module.resources ? module.resources.filter(r => r.isFree).length : 0;
      
      return `
        <div class="module-preview">
          <h3>Module ${idx + 1}: ${module.moduleTitle}</h3>
          <p>${module.moduleDescription}</p>
          ${(moduleFreeVideos > 0 || moduleFreeResources > 0) ? `
            <div class="free-content">
              <h4>Free Preview Content:</h4>
              ${moduleFreeVideos > 0 ? `<p><i class="fas fa-video"></i> ${moduleFreeVideos} free video(s)</p>` : ''}
              ${moduleFreeResources > 0 ? `<p><i class="fas fa-file-alt"></i> ${moduleFreeResources} free resource(s)</p>` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${course.title} - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
        <style>
          :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
          }

          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }

          body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
            padding: 20px;
          }

          .preview-container {
            max-width: 1000px;
            margin: 0 auto;
          }

          .preview-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
          }

          .course-hero {
            display: grid;
            grid-template-columns: 1fr 2fr;
            gap: 2rem;
            margin-bottom: 2rem;
          }

          .course-image {
            width: 100%;
            border-radius: var(--radius);
            overflow: hidden;
          }

          .course-image img {
            width: 100%;
            height: auto;
            object-fit: cover;
          }

          .course-image-placeholder {
            width: 100%;
            height: 200px;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-size: 3rem;
            border-radius: var(--radius);
          }

          .course-info h1 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 1rem;
            color: var(--light);
          }

          .course-meta {
            display: flex;
            gap: 1rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
          }

          .course-category {
            background: rgba(76, 110, 245, 0.2);
            color: var(--secondary);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .course-level {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
            padding: 0.25rem 0.75rem;
            border-radius: 20px;
            font-size: 0.8rem;
            font-weight: 500;
          }

          .course-price {
            font-family: 'Montserrat', sans-serif;
            font-size: 1.5rem;
            font-weight: 600;
            color: var(--primary);
            margin: 1rem 0;
          }

          .free-preview {
            background: rgba(56, 161, 105, 0.1);
            padding: 1rem;
            border-radius: var(--radius);
            margin: 1.5rem 0;
            border-left: 4px solid var(--success);
          }

          .free-preview h3 {
            color: var(--success);
            margin-bottom: 0.5rem;
          }

          .preview-content {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.1);
          }

          .modules-preview {
            margin-bottom: 2rem;
          }

          .module-preview {
            background: rgba(255,255,255,0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            margin-bottom: 1rem;
            border: 1px solid rgba(255,255,255,0.05);
          }

          .module-preview h3 {
            font-family: 'Montserrat', sans-serif;
            margin-bottom: 0.5rem;
            color: var(--light);
          }

          .free-content {
            background: rgba(56, 161, 105, 0.05);
            padding: 1rem;
            border-radius: var(--radius);
            margin-top: 1rem;
          }

          .free-content h4 {
            color: var(--success);
            margin-bottom: 0.5rem;
          }

          .enroll-section {
            text-align: center;
            padding: 2rem;
            background: rgba(255,255,255,0.03);
            border-radius: var(--radius);
            border: 1px solid rgba(255,255,255,0.05);
          }

          .enroll-btn {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 1rem 2rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            font-size: 1.1rem;
          }

          .enroll-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
          }

          .preview-links {
            margin-top: 2rem;
            display: flex;
            gap: 1rem;
            justify-content: center;
          }

          .preview-links a {
            color: var(--primary);
            text-decoration: none;
          }

          .preview-links a:hover {
            text-decoration: underline;
          }

          @media (max-width: 768px) {
            .course-hero {
              grid-template-columns: 1fr;
            }
          }
        </style>
      </head>
      <body>
        <div class="preview-container">
          <div class="preview-header">
            <h1>Course Preview</h1>
            <p>Get a detailed look at what this course offers</p>
          </div>
          
          <div class="course-hero">
            <div class="course-image">
              ${course.imagePath ? `
                <img src="${course.imagePath}" alt="${course.title}">
              ` : course.imageUrl ? `
                <img src="${course.imageUrl}" alt="${course.title}">
              ` : `
                <div class="course-image-placeholder">
                  <i class="fas fa-book"></i>
                </div>
              `}
            </div>
            
            <div class="course-info">
              <h1>${course.title}</h1>
              <div class="course-meta">
                <span class="course-category">${course.category}</span>
                <span class="course-level">${course.level}</span>
              </div>
              <p>${course.description}</p>
              <div class="course-price">NPR ${course.price}</div>
              
              ${(freeVideos > 0 || freeResources > 0 || freeTests > 0) ? `
                <div class="free-preview">
                  <h3><i class="fas fa-gift"></i> Free Preview Available!</h3>
                  <p>This course includes free preview content:</p>
                  <ul>
                    ${freeVideos > 0 ? `<li>${freeVideos} free video(s)</li>` : ''}
                    ${freeResources > 0 ? `<li>${freeResources} free resource(s)</li>` : ''}
                    ${freeTests > 0 ? `<li>${freeTests} free test(s)</li>` : ''}
                  </ul>
                </div>
              ` : ''}
            </div>
          </div>
          
          <div class="preview-content">
            <h2>Course Curriculum</h2>
            <div class="modules-preview">
              ${modulesHtml}
            </div>
            
            <div class="enroll-section">
              ${isEnrolled ? `
                <h3>You're already enrolled in this course!</h3>
                <a href="/my-courses" class="enroll-btn">
                  <i class="fas fa-graduation-cap"></i> Continue Learning
                </a>
              ` : req.session.userId ? `
                <h3>Ready to start learning?</h3>
                <a href="/enroll/${course._id}" class="enroll-btn">
                  <i class="fas fa-shopping-cart"></i> Enroll Now
                </a>
              ` : `
                <h3>Join thousands of students learning with us</h3>
                <a href="/register?redirect=/course-preview/${course._id}" class="enroll-btn">
                  <i class="fas fa-user-plus"></i> Sign Up to Enroll
                </a>
              `}
            </div>
            
            <div class="preview-links">
              <a href="/browse-courses"><i class="fas fa-arrow-left"></i> Back to Courses</a>
              <a href="/"><i class="fas fa-home"></i> Home</a>
            </div>
          </div>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading course preview: ' + error.message);
  }
});


























// Edit test form
app.get('/admin/test/:testId/edit', requireAdmin, async (req, res) => {
  try {
    const test = await Test.findById(req.params.testId);
    const course = await Course.findById(test.courseId);
    
    if (!test || !course) {
      return res.status(404).send('Test or course not found');
    }
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Edit Test - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link rel="stylesheet" href="/admin-style.css">
        <style>
          .image-preview { max-width: 200px; max-height: 200px; margin: 10px 0; }
          .option-image-preview { max-width: 100px; max-height: 100px; margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="admin-container">
          <div class="admin-header">
            <h1>Edit Test: ${test.title}</h1>
            <p>Course: ${course.title} - Module ${test.moduleIndex + 1}</p>
          </div>
          
          <div class="admin-card">
            <form action="/admin/test/${test._id}/update" method="POST" enctype="multipart/form-data">
              <div class="form-group">
                <label for="title">Test Title*</label>
                <input type="text" id="title" name="title" value="${test.title}" required>
              </div>
              
              <div class="form-group">
                <label for="description">Description</label>
                <textarea id="description" name="description">${test.description || ''}</textarea>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="duration">Duration (minutes)*</label>
                  <input type="number" id="duration" name="duration" value="${test.duration}" min="5" required>
                </div>
                
                <div class="form-group">
                  <label for="maxAttempts">Maximum Attempts*</label>
                  <input type="number" id="maxAttempts" name="maxAttempts" value="${test.maxAttempts}" min="1" required>
                </div>
              </div>
              
              <div class="form-row">
                <div class="form-group">
                  <label for="passPercentage">Pass Percentage*</label>
                  <input type="number" id="passPercentage" name="passPercentage" value="${test.passPercentage}" min="0" max="100" required>
                </div>
                
                <div class="form-group">
                  <label for="hasNegativeMarking">
                    <input type="checkbox" id="hasNegativeMarking" name="hasNegativeMarking" value="true" 
                           ${test.hasNegativeMarking ? 'checked' : ''} onchange="toggleNegativeMarking()">
                    Enable Negative Marking
                  </label>
                </div>
              </div>
              
              <div id="negativeMarkingSection" style="${test.hasNegativeMarking ? '' : 'display: none;'}">
                <div class="form-group">
                  <label for="negativeMarkingPercentage">Negative Marking Percentage</label>
                  <input type="number" id="negativeMarkingPercentage" name="negativeMarkingPercentage" 
                         value="${test.negativeMarkingPercentage}" min="0" max="100">
                  <small>Percentage of question points to deduct for wrong answers</small>
                </div>
              </div>
              
              <h3>Questions</h3>
              <div id="questions-container">
                ${test.questions.map((question, index) => `
                  <div class="question-item" style="margin-bottom: 2rem; padding: 1rem; border: 1px solid #ddd; border-radius: 5px;">
                    <div class="form-group">
                      <label>Question ${index + 1}*</label>
                      <textarea name="questions[${index}][questionText]" placeholder="Enter question" rows="3" required>${question.questionText}</textarea>
                    </div>
                    
                    <div class="form-group">
                      <label>Question Image (Optional)</label>
                      ${question.questionImage ? `
                        <div>
                          <img src="${question.questionImage}" class="image-preview">
                          <br>
                          <label>
                            <input type="checkbox" name="questions[${index}][removeQuestionImage]" value="true">
                            Remove current image
                          </label>
                        </div>
                      ` : ''}
                      <input type="file" name="questions[${index}][questionImage]" accept="image/*">
                    </div>
                    
                    <div class="form-group">
                      <label>Question Type*</label>
                      <select name="questions[${index}][questionType]" onchange="toggleOptions(this, ${index})" required>
                        <option value="multiple-choice-single" ${question.questionType === 'multiple-choice-single' ? 'selected' : ''}>Multiple Choice (Single Answer)</option>
                        <option value="multiple-choice-multiple" ${question.questionType === 'multiple-choice-multiple' ? 'selected' : ''}>Multiple Choice (Multiple Answers)</option>
                        <option value="true-false" ${question.questionType === 'true-false' ? 'selected' : ''}>True/False</option>
                        <option value="short-answer" ${question.questionType === 'short-answer' ? 'selected' : ''}>Short Answer</option>
                      </select>
                    </div>
                    
                    <div id="options-${index}" class="options-container" style="${question.questionType === 'short-answer' ? 'display: none;' : ''}">
                      <h4>Options</h4>
                      ${question.options ? question.options.map((option, optIndex) => `
                        <div class="option-item">
                          <div class="form-group">
                            <label>Option ${optIndex + 1}</label>
                            <input type="text" name="questions[${index}][options][${optIndex}][text]" 
                                   value="${option.text}" placeholder="Option text" ${optIndex < 2 ? 'required' : ''}>
                            ${option.image ? `
                              <div>
                                <img src="${option.image}" class="option-image-preview">
                                <br>
                                <label>
                                  <input type="checkbox" name="questions[${index}][options][${optIndex}][removeOptionImage]" value="true">
                                  Remove current image
                                </label>
                              </div>
                            ` : ''}
                            <input type="file" name="questions[${index}][options][${optIndex}][image]" accept="image/*">
                            <label style="display: block; margin-top: 5px;">
                              <input type="checkbox" name="questions[${index}][options][${optIndex}][isCorrect]" value="true" 
                                     ${option.isCorrect ? 'checked' : ''}> Correct Answer
                            </label>
                          </div>
                        </div>
                      `).join('') : ''}
                      <button type="button" onclick="addOption(${index})" class="admin-btn" style="background: #4CAF50;">Add Option</button>
                    </div>
                    
                    ${question.questionType === 'short-answer' ? `
                      <div class="form-group">
                        <label>Correct Answer*</label>
                        <input type="text" name="questions[${index}][correctAnswer]" value="${question.correctAnswer || ''}" required>
                      </div>
                    ` : ''}
                    
                    <div class="form-group">
                      <label>Points*</label>
                      <input type="number" name="questions[${index}][points]" value="${question.points}" min="1" required>
                    </div>
                    
                    <div class="form-group">
                      <label>Answer Description/Explanation (Optional)</label>
                      <textarea name="questions[${index}][description]" placeholder="Explanation for the answer" rows="2">${question.description || ''}</textarea>
                    </div>
                    
                    <button type="button" onclick="removeQuestion(${index})" class="admin-btn" style="background: #f44336;">Remove Question</button>
                  </div>
                `).join('')}
              </div>
              
              <button type="button" onclick="addQuestion()" class="admin-btn" style="background: #2196F3; margin-bottom: 1rem;">Add Question</button>
              <br>
              
              <div class="form-group">
                <label for="isPublished">
                  <input type="checkbox" id="isPublished" name="isPublished" value="true" ${test.isPublished ? 'checked' : ''}>
                  Publish Test (make it available to students)
                </label>
              </div>
              
              <button type="submit" class="admin-btn">Update Test</button>
              <button type="button" onclick="confirmDelete()" class="admin-btn" style="background: #f44336;">Delete Test</button>
            </form>
          </div>
        </div>

        <script>
          let questionCount = ${test.questions.length};
          let optionCounts = [${test.questions.map(q => q.options ? q.options.length : 0).join(',')}];
          
          function toggleNegativeMarking() {
            const negativeMarkingSection = document.getElementById('negativeMarkingSection');
            const hasNegativeMarking = document.getElementById('hasNegativeMarking').checked;
            negativeMarkingSection.style.display = hasNegativeMarking ? 'block' : 'none';
          }
          
          function addQuestion() {
            const container = document.getElementById('questions-container');
            const newQuestion = document.createElement('div');
            newQuestion.className = 'question-item';
            newQuestion.style = 'margin-bottom: 2rem; padding: 1rem; border: 1px solid #ddd; border-radius: 5px;';
            
            optionCounts[questionCount] = 2;
            
            newQuestion.innerHTML = \`
              <div class="form-group">
                <label>Question \${questionCount + 1}*</label>
                <textarea name="questions[\${questionCount}][questionText]" placeholder="Enter question" rows="3" required></textarea>
              </div>
              
              <div class="form-group">
                <label>Question Image (Optional)</label>
                <input type="file" name="questions[\${questionCount}][questionImage]" accept="image/*">
              </div>
              
              <div class="form-group">
                <label>Question Type*</label>
                <select name="questions[\${questionCount}][questionType]" onchange="toggleOptions(this, \${questionCount})" required>
                  <option value="multiple-choice-single">Multiple Choice (Single Answer)</option>
                  <option value="multiple-choice-multiple">Multiple Choice (Multiple Answers)</option>
                  <option value="true-false">True/False</option>
                  <option value="short-answer">Short Answer</option>
                </select>
              </div>
              
              <div id="options-\${questionCount}" class="options-container">
                <h4>Options</h4>
                <div class="option-item">
                  <div class="form-group">
                    <label>Option 1*</label>
                    <input type="text" name="questions[\${questionCount}][options][0][text]" placeholder="Option text" required>
                    <input type="file" name="questions[\${questionCount}][options][0][image]" accept="image/*">
                    <label style="display: block; margin-top: 5px;">
                      <input type="checkbox" name="questions[\${questionCount}][options][0][isCorrect]" value="true"> Correct Answer
                    </label>
                  </div>
                </div>
                
                <div class="option-item">
                  <div class="form-group">
                    <label>Option 2*</label>
                    <input type="text" name="questions[\${questionCount}][options][1][text]" placeholder="Option text" required>
                    <input type="file" name="questions[\${questionCount}][options][1][image]" accept="image/*">
                    <label style="display: block; margin-top: 5px;">
                      <input type="checkbox" name="questions[\${questionCount}][options][1][isCorrect]" value="true"> Correct Answer
                    </label>
                  </div>
                </div>
                
                <button type="button" onclick="addOption(\${questionCount})" class="admin-btn" style="background: #4CAF50;">Add Option</button>
              </div>
              
              <div class="form-group">
                <label>Points*</label>
                <input type="number" name="questions[\${questionCount}][points]" value="1" min="1" required>
              </div>
              
              <div class="form-group">
                <label>Answer Description/Explanation (Optional)</label>
                <textarea name="questions[\${questionCount}][description]" placeholder="Explanation for the answer" rows="2"></textarea>
              </div>
              
              <button type="button" onclick="this.parentElement.remove()" class="admin-btn" style="background: #f44336;">Remove Question</button>
            \`;
            
            container.appendChild(newQuestion);
            questionCount++;
          }
          
          function addOption(questionIndex) {
            const optionsContainer = document.getElementById(\`options-\${questionIndex}\`);
            const optionCount = optionCounts[questionIndex] || 0;
            
            const newOption = document.createElement('div');
            newOption.className = 'option-item';
            newOption.innerHTML = \`
              <div class="form-group">
                <label>Option \${optionCount + 1}</label>
                <input type="text" name="questions[\${questionIndex}][options][\${optionCount}][text]" placeholder="Option text">
                <input type="file" name="questions[\${questionIndex}][options][\${optionCount}][image]" accept="image/*">
                <label style="display: block; margin-top: 5px;">
                  <input type="checkbox" name="questions[\${questionIndex}][options][\${optionCount}][isCorrect]" value="true"> Correct Answer
                </label>
              </div>
            \`;
            
            optionsContainer.insertBefore(newOption, optionsContainer.lastElementChild);
            optionCounts[questionIndex] = optionCount + 1;
          }
          
          function toggleOptions(select, questionIndex) {
            const optionsContainer = document.getElementById(\`options-\${questionIndex}\`);
            if (select.value === 'short-answer') {
              optionsContainer.style.display = 'none';
            } else {
              optionsContainer.style.display = 'block';
            }
          }
          
          function removeQuestion(index) {
            if (confirm('Are you sure you want to remove this question?')) {
              const questionElement = document.querySelector(\`[name="questions[\${index}][questionText]"]\`).closest('.question-item');
              questionElement.remove();
            }
          }
          
          function confirmDelete() {
            if (confirm('Are you sure you want to delete this test? This action cannot be undone.')) {
              window.location.href = '/admin/test/${test._id}/delete';
            }
          }
        </script>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading edit form: ' + error.message);
  }
});





// Delete course route
app.post('/admin/delete-course/:courseId', requireAdmin, async (req, res) => {
  try {
    const courseId = req.params.courseId;
    await Course.findByIdAndDelete(courseId);
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Course Deleted - Learn with Saurab Admin</title>
          <link rel="stylesheet" href="/admin-style.css">
            <link rel="stylesheet" href="/responsive.css">
      </head>
      <body>
          <div class="admin-container">
              <div class="admin-header">
                  <h1>Course Deleted Successfully</h1>
                  <p>The course has been removed from the platform</p>
              </div>
              
              <div class="admin-card">
                  <div class="success-message">
                      <h3>Course has been deleted!</h3>
                  </div>
                  
                  <div style="text-align: center; margin: 2rem 0;">
                      <a href="/admin/manage-courses" class="admin-btn">Manage Courses</a>
                  </div>
                  
                  <div class="admin-links">
                      <a href="/">Home</a>
                      <a href="/admin/new-course">Create New Course</a>
                  </div>
              </div>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
    
  } catch (error) {
    res.status(500).send('Error deleting course: ' + error.message);
  }
});


// Check course schema
app.get('/debug/check-schema', async (req, res) => {
  try {
    const course = await Course.findOne({});
    if (!course) return res.send('No courses found');
    
    const schemaInfo = {
      courseTitle: course.title,
      modules: course.modules.map(module => ({
        moduleTitle: module.moduleTitle,
        resourcesType: Array.isArray(module.resources) ? 'Array' : typeof module.resources,
        resourcesLength: Array.isArray(module.resources) ? module.resources.length : 'N/A',
        resourcesSample: Array.isArray(module.resources) && module.resources.length > 0 ? 
          typeof module.resources[0] : 'N/A'
      }))
    };
    
    res.json(schemaInfo);
  } catch (error) {
    res.status(500).send('Error checking schema: ' + error.message);
  }
});


// Enhanced Test Schema with free preview option
const testSchema = new mongoose.Schema({
  courseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  moduleIndex: { type: Number, required: true },
  title: { type: String, required: true },
  description: { type: String },
  duration: { type: Number, default: 30 },
  maxAttempts: { type: Number, default: 1 },
  passPercentage: { type: Number, default: 60 },
  hasNegativeMarking: { type: Boolean, default: false },
  negativeMarkingPercentage: { type: Number, default: 25 },
  isFree: { type: Boolean, default: false },
  questions: [{
    questionText: { type: String, required: true },
    questionImage: { type: String },
    questionType: { 
      type: String, 
      enum: ['multiple-choice-single', 'multiple-choice-multiple', 'true-false', 'short-answer'],
      default: 'multiple-choice-single'
    },
    options: [{
    text: String,
    image: String,
    isCorrect: Boolean
    }],
    correctAnswer: String,
    points: { type: Number, default: 1 },
    description: String
  }],
  isPublished: { type: Boolean, default: false }
}, { timestamps: true });

const Test = mongoose.model('Test', testSchema);


// Student Test Results Schema
const testResultSchema = new mongoose.Schema({
  testId: { type: mongoose.Schema.Types.ObjectId, ref: 'Test', required: true },
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  answers: [{
    questionIndex: Number,
    selectedOption: Number, // For multiple choice
    answerText: String, // For short answer
    isCorrect: Boolean,
    pointsEarned: Number
  }],
  score: { type: Number, required: true },
  totalPoints: { type: Number, required: true },
  percentage: { type: Number, required: true },
  passed: { type: Boolean, required: true },
  timeSpent: { type: Number }, // in minutes
  completedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const TestResult = mongoose.model('TestResult', testResultSchema);




// Create directory if not exists
if (!fs.existsSync('uploads/question-images')) {
  fs.mkdirSync('uploads/question-images', { recursive: true });
}
app.use('/uploads/question-images', express.static(path.join(__dirname, 'uploads/question-images')));

















// Test results page with matching design
app.get('/test/:testId/results', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const testId = req.params.testId;
    const test = await Test.findById(testId);
    const user = await User.findById(req.session.userId);
    const course = await Course.findById(test.courseId);
    
    if (!test) {
      return res.status(404).send('Test not found');
    }

    // Get all test results for this user and test
    const testResults = await TestResult.find({
      testId: testId,
      studentId: user._id
    }).sort({ completedAt: -1 });

    if (testResults.length === 0) {
      return res.status(404).send('No test results found');
    }

    const latestResult = testResults[0];

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Test Results - ${test.title} - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
          <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
          <style>
            body {
              background: #0c0c0c;
              color: #fff;
              font-family: 'Inter', sans-serif;
            }
            .test-header {
              background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
              padding: 2rem;
              border-radius: 16px;
              margin-bottom: 2rem;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .test-results-container {
              display: grid;
              grid-template-columns: 1fr 2fr;
              gap: 2rem;
              margin-bottom: 2rem;
            }
            .results-summary {
              background: rgba(255,255,255,0.05);
              padding: 2rem;
              border-radius: 16px;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .results-details {
              background: rgba(255,255,255,0.05);
              padding: 2rem;
              border-radius: 16px;
              border: 1px solid rgba(255,255,255,0.1);
              max-height: 80vh;
              overflow-y: auto;
            }
            .score-circle {
              width: 120px;
              height: 120px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              margin: 0 auto 1.5rem;
              font-size: 2rem;
              font-weight: bold;
              border: 4px solid;
              font-family: 'Montserrat', sans-serif;
            }
            .passed {
              background: rgba(56, 161, 105, 0.1);
              border-color: #38a169;
              color: #38a169;
            }
            .failed {
              background: rgba(229, 62, 62, 0.1);
              border-color: #e53e3e;
              color: #e53e3e;
            }
            .question-item {
              background: rgba(255,255,255,0.03);
              padding: 1.5rem;
              border-radius: 12px;
              margin-bottom: 1rem;
              border: 1px solid rgba(255,255,255,0.05);
            }
            .correct-answer {
              background: rgba(56, 161, 105, 0.1);
              border-left: 4px solid #38a169;
            }
            .incorrect-answer {
              background: rgba(229, 62, 62, 0.1);
              border-left: 4px solid #e53e3e;
            }
            .option {
              padding: 0.75rem;
              margin: 0.5rem 0;
              border-radius: 8px;
              background: rgba(255,255,255,0.02);
            }
            .correct {
              background: rgba(56, 161, 105, 0.15);
              border: 1px solid rgba(56, 161, 105, 0.3);
            }
            .incorrect {
              background: rgba(229, 62, 62, 0.15);
              border: 1px solid rgba(229, 62, 62, 0.3);
            }
            .selected {
              background: rgba(76, 110, 245, 0.15);
              border: 1px solid rgba(76, 110, 245, 0.3);
            }
            .stat-item {
              display: flex;
              justify-content: space-between;
              padding: 0.75rem 0;
              border-bottom: 1px solid rgba(255,255,255,0.1);
            }
            .stat-value {
              font-weight: 600;
              color: #fff;
            }
            .attempt-history {
              margin-top: 2rem;
            }
            .attempt-item {
              background: rgba(255,255,255,0.03);
              padding: 1rem;
              border-radius: 8px;
              margin-bottom: 0.5rem;
              display: flex;
              justify-content: space-between;
              align-items: center;
              border: 1px solid rgba(255,255,255,0.05);
            }
            .attempt-item:hover {
              background: rgba(255,255,255,0.05);
            }
            @media (max-width: 968px) {
              .test-results-container {
                grid-template-columns: 1fr;
              }
            }
          </style>
      </head>
      <body>
          <header>
              <nav>
                  <h1 class="logo">Learn with Saurab</h1>
                  <ul class="nav-links">
                      <li><a href="/">Home</a></li>
                          <li><a href="/about">About</a></li>
                      <li><a href="/dashboard">Dashboard</a></li>
                      <li><a href="/course/${course._id}/learn">Back to Course</a></li>
                  </ul>
              </nav>
          </header>

          <main style="padding: 100px 2% 50px; max-width: 1400px; margin: 0 auto;">
            <div class="test-header">
              <div>
                <h1 style="color: #fff; margin-bottom: 0.5rem; font-family: 'Montserrat', sans-serif;">${test.title}</h1>
                <p style="color: #ccc; margin-bottom: 1rem;">${course.title}</p>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                  <span style="background: rgba(225, 6, 0, 0.2); color: #e10600; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                    ${test.questions.length} Questions
                  </span>
                  <span style="background: rgba(76, 110, 245, 0.2); color: #4C6EF5; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                    ${test.duration} Minutes
                  </span>
                  <span style="background: ${latestResult.passed ? 'rgba(56, 161, 105, 0.2)' : 'rgba(229, 62, 62, 0.2)'}; color: ${latestResult.passed ? '#38a169' : '#e53e3e'}; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                    ${latestResult.passed ? 'Passed' : 'Failed'}
                  </span>
                </div>
              </div>
            </div>

            <div class="test-results-container">
              <div class="results-summary">
                <h3 style="color: #fff; margin-bottom: 1.5rem; font-family: 'Montserrat', sans-serif; text-align: center;">Test Summary</h3>
                
                <div class="score-circle ${latestResult.passed ? 'passed' : 'failed'}">
                  ${latestResult.percentage}%
                </div>
                
                <div style="text-align: center; margin-bottom: 2rem;">
                  <h3 style="color: #fff; margin-bottom: 0.5rem;">${latestResult.passed ? 'Congratulations!' : 'Keep Practicing!'}</h3>
                  <p style="color: #ccc;">You scored ${latestResult.score} out of ${latestResult.totalPoints}</p>
                </div>
                
                <div class="stat-item">
                  <span style="color: #ccc;">Correct Answers</span>
                  <span class="stat-value" style="color: #38a169;">${latestResult.correctAnswers}</span>
                </div>
                <div class="stat-item">
                  <span style="color: #ccc;">Incorrect Answers</span>
                  <span class="stat-value" style="color: #e53e3e;">${latestResult.incorrectAnswers}</span>
                </div>
                <div class="stat-item">
                  <span style="color: #ccc;">Time Taken</span>
                  <span class="stat-value" style="color: #fff;">${latestResult.timeTaken} minutes</span>
                </div>
                <div class="stat-item">
                  <span style="color: #ccc;">Completed On</span>
                  <span class="stat-value" style="color: #fff;">${new Date(latestResult.completedAt).toLocaleDateString()}</span>
                </div>
                
                ${testResults.length > 1 ? `
                  <div class="attempt-history">
                    <h4 style="color: #fff; margin-bottom: 1rem;">Attempt History</h4>
                    ${testResults.map((result, index) => `
                      <div class="attempt-item">
                        <div>
                          <span style="color: #ccc;">Attempt ${testResults.length - index}</span>
                          <span style="color: ${result.passed ? '#38a169' : '#e53e3e'}; margin-left: 0.5rem; font-size: 0.9rem;">
                            ${result.passed ? 'Passed' : 'Failed'}
                          </span>
                        </div>
                        <span style="color: #fff; font-weight: 600;">${result.percentage}%</span>
                      </div>
                    `).join('')}
                  </div>
                ` : ''}
                
                <div style="margin-top: 2rem; display: flex; flex-direction: column; gap: 0.5rem;">
                  <a href="/test/${test._id}/take" class="cta-button" style="text-align: center;">Retake Test</a>
                  <a href="/course/${course._id}/learn" class="cta-button secondary" style="text-align: center;">Back to Course</a>
                </div>
              </div>
              
              <div class="results-details">
                <h3 style="color: #fff; margin-bottom: 1.5rem; font-family: 'Montserrat', sans-serif;">Question Review</h3>
                
                ${test.questions.map((question, index) => {
                  const userAnswer = latestResult.answers.find(a => a.questionIndex === index);
                  const isCorrect = userAnswer && userAnswer.isCorrect;
                  
                  return `
                    <div class="question-item ${isCorrect ? 'correct-answer' : 'incorrect-answer'}">
                      <h4 style="color: #fff; margin-bottom: 1rem;">
                        <span style="background: ${isCorrect ? '#38a169' : '#e53e3e'}; color: white; width: 24px; height: 24px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; margin-right: 0.5rem; font-size: 0.8rem;">
                          ${index + 1}
                        </span>
                        ${question.questionText}
                      </h4>
                      
                      <div style="margin-bottom: 1rem;">
                        ${question.options.map((option, optIndex) => {
                          let optionClass = 'option';
                          let prefix = '';
                          
                          if (optIndex === question.correctAnswer) {
                            optionClass += ' correct';
                            prefix = '✓ ';
                          } else if (userAnswer && userAnswer.selectedOption === optIndex && !userAnswer.isCorrect) {
                            optionClass += ' incorrect';
                            prefix = '✗ ';
                          } else if (userAnswer && userAnswer.selectedOption === optIndex) {
                            optionClass += ' selected';
                            prefix = '→ ';
                          }
                          
                          return `
                            <div class="${optionClass}">
                              ${prefix}${option}
                            </div>
                          `;
                        }).join('')}
                      </div>
                      
                      ${question.explanation ? `
                        <div style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin-top: 1rem;">
                          <h5 style="color: #fff; margin-bottom: 0.5rem;">Explanation:</h5>
                          <p style="color: #ccc; margin: 0;">${question.explanation}</p>
                        </div>
                      ` : ''}
                    </div>
                  `;
                }).join('')}
              </div>
            </div>
          </main>

          <script>
            // Add any interactive functionality here if needed
          </script>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading test results:', error);
    res.status(500).send('Error loading test results');
  }
});


// Take test page
app.get('/test/:testId/take', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    
    const test = await Test.findById(req.params.testId);
    const course = await Course.findById(test.courseId);
    const user = await User.findById(req.session.userId);
    
    // Check if user is enrolled
    if (!user.enrolledCourses.includes(test.courseId)) {
      return res.status(403).send('You must be enrolled in this course to take the test');
    }
    
    // Check previous attempts
    const previousAttempts = await TestResult.countDocuments({ 
      testId: test._id, 
      studentId: user._id 
    });
    
    if (previousAttempts >= test.maxAttempts) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Test Attempts Exceeded</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <div style="max-width: 600px; margin: 100px auto; text-align: center; padding: 2rem;">
            <h2>Maximum Attempts Reached</h2>
            <p>You have already taken this test the maximum number of times (${test.maxAttempts}).</p>
            <a href="/course/${test.courseId}/learn" class="cta-button">Back to Course</a>
          </div>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }
    
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>${test.title} - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link rel="stylesheet" href="/style.css">
        <style>
          .test-container { max-width: 800px; margin: 2rem auto; padding: 2rem; background: white; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .question { margin-bottom: 2rem; padding: 1.5rem; border: 1px solid #e0e0e0; border-radius: 5px; }
          .options { margin-left: 1rem; }
          .option { margin: 0.5rem 0; }
          .timer { position: fixed; top: 1rem; right: 1rem; background: #ff4444; color: white; padding: 0.5rem 1rem; border-radius: 5px; font-weight: bold; }
        </style>
      </head>
      <body>
        <header>
          <nav>
            <h1 class="logo">Learn with Saurab</h1>
            <ul class="nav-links">
              <li><a href="/">Home</a></li>
              <li><a href="/dashboard">Dashboard</a></li>
            </ul>
          </nav>
        </header>

        <main style="padding: 100px 2% 50px;">
          <div class="test-container">
            <h1>${test.title}</h1>
            <p>${test.description || ''}</p>
            <p><strong>Duration:</strong> ${test.duration} minutes | <strong>Questions:</strong> ${test.questions.length}</p>
            
            <div id="timer" class="timer">Time remaining: ${test.duration}:00</div>
            
            <form id="test-form" action="/test/${test._id}/submit" method="POST">
              ${test.questions.map((question, index) => `
                <div class="question">
                  <h3>Question ${index + 1} (${question.points} point${question.points !== 1 ? 's' : ''})</h3>
                  <p>${question.questionText}</p>
                  
                  ${question.questionImage ? `<img src="${question.questionImage}" style="max-width: 300px; max-height: 200px; margin: 10px 0;">` : ''}
                  
                  ${question.questionType === 'short-answer' ? `
                    <div class="form-group">
                      <label>Your answer:</label>
                      <textarea name="answers[${index}]" rows="3" style="width: 100%; padding: 0.5rem;" required></textarea>
                    </div>
                  ` : `
                    <div class="options">
                      ${question.options.map((option, optIndex) => `
                        <div class="option">
                          <label>
                            <input type="${question.questionType === 'multiple-choice-multiple' ? 'checkbox' : 'radio'}" 
                                   name="${question.questionType === 'multiple-choice-multiple' ? 'answers[' + index + '][]' : 'answers[' + index + ']'}" 
                                   value="${optIndex}" ${question.questionType === 'multiple-choice-multiple' ? '' : 'required'}>
                            ${option.text}
                            ${option.image ? `<br><img src="${option.image}" style="max-width: 100px; max-height: 80px; margin: 5px 0;">` : ''}
                          </label>
                        </div>
                      `).join('')}
                    </div>
                  `}
                </div>
              `).join('')}
              
              <button type="submit" class="cta-button" style="margin-top: 2rem;">Submit Test</button>
            </form>
          </div>
        </main>

        <script>
          // Timer functionality
          const duration = ${test.duration};
          let timeLeft = duration * 60;
          
          const timer = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
              clearInterval(timer);
              document.getElementById('test-form').submit();
            }
            
            const minutes = Math.floor(timeLeft / 60);
            const seconds = timeLeft % 60;
            document.getElementById('timer').textContent = \`Time remaining: \${minutes}:\${seconds.toString().padStart(2, '0')}\`;
          }, 1000);
        </script>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading test: ' + error.message);
  }
});

// Enhanced test submission with negative marking
app.post('/test/:testId/submit', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    
    const test = await Test.findById(req.params.testId);
    const user = await User.findById(req.session.userId);
    const answers = req.body.answers;
    
    let score = 0;
    let totalPoints = 0;
    const processedAnswers = [];
    
    // Grade the test with negative marking
    test.questions.forEach((question, index) => {
      totalPoints += question.points;
      const userAnswer = answers[index];
      let isCorrect = false;
      let pointsEarned = 0;
      
      if (question.questionType === 'short-answer') {
        // For short answer, check if answer contains keywords
        isCorrect = question.correctAnswer && userAnswer && 
                   (question.correctAnswer.toLowerCase().includes(userAnswer.toLowerCase()) ||
                   userAnswer.toLowerCase().includes(question.correctAnswer.toLowerCase()));
        pointsEarned = isCorrect ? question.points : 0;
      } else {
        // For multiple choice/true-false
        if (question.questionType === 'multiple-choice-multiple') {
          // Multiple correct answers (checkbox)
          const selectedOptions = Array.isArray(userAnswer) ? 
            userAnswer.map(opt => parseInt(opt)) : 
            (userAnswer !== undefined ? [parseInt(userAnswer)] : []);
            
          const correctOptions = question.options.map((opt, i) => opt.isCorrect ? i : -1).filter(i => i !== -1);
          
          isCorrect = arraysEqual(selectedOptions.sort(), correctOptions.sort());
          pointsEarned = isCorrect ? question.points : 0;
        } else {
          // Single correct answer (radio)
          const selectedOption = userAnswer !== undefined ? parseInt(userAnswer) : -1;
          isCorrect = question.options[selectedOption]?.isCorrect || false;
          pointsEarned = isCorrect ? question.points : 0;
        }
        
        // Apply negative marking if enabled
        if (test.hasNegativeMarking && !isCorrect && userAnswer !== undefined) {
          const negativePoints = (question.points * test.negativeMarkingPercentage) / 100;
          pointsEarned = -negativePoints;
        }
      }
      
      score += pointsEarned;
      
      processedAnswers.push({
        questionIndex: index,
        selectedOption: Array.isArray(userAnswer) ? userAnswer.map(opt => parseInt(opt)) : 
                       (userAnswer !== undefined ? parseInt(userAnswer) : undefined),
        answerText: typeof userAnswer === 'string' ? userAnswer : undefined,
        isCorrect,
        pointsEarned
      });
    });
    
    // Ensure score doesn't go below zero
    score = Math.max(0, score);
    
    const percentage = Math.round((score / totalPoints) * 100);
    const passed = percentage >= test.passPercentage;
    
    // Save test result
    const testResult = new TestResult({
      testId: test._id,
      studentId: user._id,
      answers: processedAnswers,
      score,
      totalPoints,
      percentage,
      passed,
      completedAt: new Date()
    });
    
    await testResult.save();
    
    // Show results page with detailed feedback
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Test Results - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <link rel="stylesheet" href="/style.css">
        <style>
          .result-detail { margin: 1rem 0; padding: 1rem; background: #f9f9f9; border-radius: 5px; }
          .correct { border-left: 4px solid #4CAF50; }
          .incorrect { border-left: 4px solid #f44336; }
          .question-image { max-width: 300px; max-height: 200px; margin: 10px 0; }
          .option-image { max-width: 100px; max-height: 80px; margin: 5px 0; }
        </style>
      </head>
      <body>
        <header>
          <nav>
            <h1 class="logo">Learn with Saurab</h1>
            <ul class="nav-links">
              <li><a href="/">Home</a></li>
              <li><a href="/dashboard">Dashboard</a></li>
            </ul>
          </nav>
        </header>

        <main style="padding: 100px 2% 50px;">
          <div style="max-width: 800px; margin: 0 auto; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h1>Test Results: ${test.title}</h1>
            <div style="text-align: center; margin: 2rem 0;">
              <h2 style="color: ${passed ? '#4CAF50' : '#f44336'};">${passed ? 'Passed' : 'Not Passed'}</h2>
              
              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin: 2rem 0;">
                <div style="background: #f5f5f5; padding: 1rem; border-radius: 5px;">
                  <h3>Score</h3>
                  <p style="font-size: 2rem; font-weight: bold;">${score.toFixed(2)}/${totalPoints}</p>
                </div>
                
                <div style="background: #f5f5f5; padding: 1rem; border-radius: 5px;">
                  <h3>Percentage</h3>
                  <p style="font-size: 2rem; font-weight: bold;">${percentage}%</p>
                </div>
                
                <div style="background: #f5f5f5; padding: 1rem; border-radius: 5px;">
                  <h3>Status</h3>
                  <p style="font-size: 1.5rem; font-weight: bold; color: ${passed ? '#4CAF50' : '#f44336'};">
                    ${passed ? 'PASS' : 'FAIL'}
                  </p>
                </div>
              </div>
              
              <p>Passing percentage: ${test.passPercentage}%</p>
              ${test.hasNegativeMarking ? `<p style="color: #ff9800;"><strong>Note:</strong> Negative marking was applied (-${test.negativeMarkingPercentage}% for wrong answers)</p>` : ''}
            </div>
            
            <h3>Question-wise Results</h3>
            ${processedAnswers.map((answer, index) => {
              const question = test.questions[answer.questionIndex];
              return `
                <div class="result-detail ${answer.isCorrect ? 'correct' : 'incorrect'}">
                  <h4>Question ${answer.questionIndex + 1} (${answer.pointsEarned.toFixed(2)}/${question.points} points)</h4>
                  <p>${question.questionText}</p>
                  
                  ${question.questionImage ? `<img src="${question.questionImage}" class="question-image">` : ''}
                  
                  ${question.questionType !== 'short-answer' ? `
                    <div style="margin: 1rem 0;">
                      <h5>Options:</h5>
                      ${question.options.map((option, optIndex) => {
                        const isSelected = Array.isArray(answer.selectedOption) ? 
                          answer.selectedOption.includes(optIndex) : 
                          answer.selectedOption === optIndex;
                          
                        return `
                        <div style="margin: 0.5rem 0; padding: 0.5rem; background: ${option.isCorrect ? '#e8f5e8' : '#f5f5f5'}; 
                             border: ${isSelected ? '2px solid #2196F3' : '1px solid #ddd'}; border-radius: 4px;">
                          <div style="display: flex; align-items: center;">
                            ${option.image ? `<img src="${option.image}" class="option-image" style="margin-right: 10px;">` : ''}
                            <span>${option.text} ${option.isCorrect ? '✓' : ''}</span>
                          </div>
                        </div>
                      `}).join('')}
                    </div>
                  ` : `
                    <div style="margin: 1rem 0;">
                      <p><strong>Your answer:</strong> ${answer.answerText || 'No answer'}</p>
                      <p><strong>Correct answer:</strong> ${question.correctAnswer}</p>
                    </div>
                  `}
                  
                  ${question.description ? `
                    <div style="background: #e3f2fd; padding: 1rem; border-radius: 4px; margin-top: 1rem;">
                      <h5>Explanation:</h5>
                      <p>${question.description}</p>
                    </div>
                  ` : ''}
                </div>
              `;
            }).join('')}
            
            <div style="margin-top: 2rem; text-align: center;">
              <a href="/course/${test.courseId}/learn" class="cta-button">Back to Course</a>
            </div>
          </div>
        </main>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
    
  } catch (error) {
    res.status(500).send('Error submitting test: ' + error.message);
  }
});

// Helper function for array comparison
function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}






// Fix course schema issues
app.get('/debug/fix-course-schema', async (req, res) => {
  try {
    const courses = await Course.find({});
    let fixedCount = 0;

    for (let course of courses) {
      let needsSave = false;

      for (let module of course.modules) {
        // Check if resources exists and has the wrong structure
        if (module.resources && module.resources.length > 0) {
          // Check if the first resource is a string (malformed data)
          if (typeof module.resources[0] === 'string') {
            console.log('Fixing malformed resources in course:', course.title);
            module.resources = []; // Clear malformed data
            needsSave = true;
            fixedCount++;
          }
          
          // Check if resources is defined as a string instead of array
          if (typeof module.resources === 'string') {
            console.log('Fixing string resources in course:', course.title);
            module.resources = []; // Reset to empty array
            needsSave = true;
            fixedCount++;
          }
        }
      }

      if (needsSave) {
        await course.save();
      }
    }

    res.send(`Fixed ${fixedCount} courses with schema issues.`);
  } catch (error) {
    console.error('Error fixing course schema:', error);
    res.status(500).send('Error fixing course schema: ' + error.message);
  }
});


// Add this debug route to check your current data structure
app.get('/debug/check-data', async (req, res) => {
  try {
    const courses = await Course.find({});
    const result = [];
    
    for (let course of courses) {
      const courseData = {
        course: course.title,
        modules: []
      };
      
      for (let module of course.modules) {
        const moduleData = {
          module: module.moduleTitle,
          resources: module.resources ? module.resources.map(r => ({
            type: typeof r,
            value: r
          })) : []
        };
        courseData.modules.push(moduleData);
      }
      
      result.push(courseData);
    }
    
    res.json(result);
  } catch (error) {
    res.status(500).send('Error checking data: ' + error.message);
  }
});


// Fix corrupted resource data
app.get('/debug/fix-resource-data', async (req, res) => {
  try {
    const courses = await Course.find({});
    let fixedCount = 0;
    
    for (let course of courses) {
      let needsSave = false;
      
      for (let module of course.modules) {
        if (module.resources && module.resources.length > 0) {
          for (let i = 0; i < module.resources.length; i++) {
            const resource = module.resources[i];
            
            // Check if resource is a string instead of an object
            if (typeof resource === 'string') {
              try {
                // Try to parse the string as JSON
                const parsedResource = JSON.parse(resource);
                module.resources[i] = {
                  title: parsedResource.title || 'Unknown',
                  fileUrl: parsedResource.fileUrl || '',
                  type: parsedResource.type || 'Unknown'
                };
                needsSave = true;
                fixedCount++;
              } catch (parseError) {
                // If parsing fails, create a new resource object
                module.resources[i] = {
                  title: 'Fixed Resource',
                  fileUrl: '',
                  type: 'Unknown'
                };
                needsSave = true;
                fixedCount++;
              }
            }
          }
        }
      }
      
      if (needsSave) {
        await course.save();
      }
    }
    
    res.send(`Fixed ${fixedCount} corrupted resources.`);
  } catch (error) {
    console.error('Error fixing resource data:', error);
    res.status(500).send('Error fixing resource data: ' + error.message);
  }
});


// Check and fix schema issues
app.get('/debug/fix-schema', async (req, res) => {
  try {
    const courses = await Course.find({});
    let fixedCount = 0;
    
    for (let course of courses) {
      let needsSave = false;
      
      for (let module of course.modules) {
        // Ensure resources array exists
        if (!module.resources) {
          module.resources = [];
          needsSave = true;
        }
        
        // Fix any malformed resource objects
        for (let i = 0; i < module.resources.length; i++) {
          const resource = module.resources[i];
          
          // If resource is malformed (contains nested object)
          if (resource && typeof resource === 'object' && resource.title && typeof resource.title === 'object') {
            module.resources[i] = {
              title: resource.title.title || resource.title,
              fileUrl: resource.title.fileUrl || resource.fileUrl,
              type: resource.title.type || resource.type
            };
            needsSave = true;
            fixedCount++;
          }
        }
      }
      
      if (needsSave) {
        await course.save();
      }
    }
    
    res.send(`Schema check complete. Fixed ${fixedCount} resources.`);
  } catch (error) {
    console.error('Error fixing schema:', error);
    res.status(500).send('Error fixing schema: ' + error.message);
  }
});











// Real Khalti payment initiation
app.post('/khalti-pay', async (req, res) => {
  try {
    const { amount, courseId, courseName, purchaseType } = req.body;
    
    // Validate input
    if (!amount || !courseId || !courseName) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields"
      });
    }

    // Convert amount to paisa (Khalti requires amount in paisa)
    const amountInPaisa = amount * 100;

    // Create unique purchase ID
    const purchaseId = `lws_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Make request to Khalti API
    const payload = {
      return_url: `${req.protocol}://${req.get('host')}/payment-success`,
      website_url: `${req.protocol}://${req.get('host')}`,
      amount: amountInPaisa,
      purchase_order_id: purchaseId,
      purchase_order_name: courseName,
      customer_info: {
        name: req.session.userId ? req.session.username : 'Guest User',
        email: req.session.userId ? req.session.userEmail : 'guest@example.com'
      }
    };

    const response = await axios.post(
      'https://khalti.com/api/v2/epayment/initiate/',
      payload,
      {
        headers: {
          'Authorization': `Key ${process.env.KHALTI_SECRET_KEY}`,
          'Content-Type': 'application/json',
        }
      }
    );

    // Store transaction in database (you'll need to create a Transaction model)
    const transaction = new Transaction({
      transactionId: response.data.pidx,
      purchaseId,
      userId: req.session.userId || null,
      courseId,
      amount,
      status: 'initiated'
    });
    await transaction.save();

    res.json({
      success: true,
      payment_url: response.data.payment_url,
      pidx: response.data.pidx
    });
    
  } catch (error) {
    console.error("Khalti payment error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      message: "Payment initiation failed",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});


// Khalti payment verification webhook
app.post('/khalti-verify', async (req, res) => {
  try {
    const { pidx, transaction_id, amount, purchase_order_id, purchase_order_name, status } = req.body;


    // Find the transaction in database
    const transaction = await Transaction.findOne({ transactionId: pidx });
    if (!transaction) {
      return res.status(404).json({ 
        success: false, 
        message: "Transaction not found" 
      });
    }

    if (status === 'Completed') {
      // Update transaction status
      transaction.status = 'completed';
      transaction.externalTransactionId = transaction_id;
      await transaction.save();

      // Enroll user in course if applicable
      if (transaction.userId) {
        const user = await User.findById(transaction.userId);
        if (user && !user.enrolledCourses.includes(transaction.courseId)) {
          user.enrolledCourses.push(transaction.courseId);
          await user.save();
        }

       // Send enrollment confirmation email
          require('./helpers/emailHelpers').sendEnrollmentEmail(
            user._id, 
            transaction.courseId
          );
          
          // Send payment confirmation email
          require('./helpers/emailHelpers').sendPaymentConfirmationEmail(
            user._id, 
            transaction.courseId, 
            transaction.amount
          );
        }
      }
    

    res.status(200).json({ success: true });

  } catch (error) {
    console.error("Payment verification error:", error);
    res.status(500).json({ success: false, message: "Verification failed" });
  }
});



// Dashboard route with tests
app.get('/dashboard', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId).populate('enrolledCourses');
    const enrolledCourses = user.enrolledCourses || [];

    // Get upcoming tests for enrolled courses
    const tests = await Test.find({
      courseId: { $in: enrolledCourses.map(course => course._id) },
      isPublished: true
    }).populate('courseId');

    // Get test results to show which tests have been taken
    const testResults = await TestResult.find({
      studentId: user._id
    });

    if (!user) {
      req.session.destroy();
      return res.redirect('/login');
    }

    let adminLinks = '';
    if (user.isAdmin) {
      adminLinks = `
        <div style="margin: 2rem 0; padding: 1.5rem; background: rgba(0,100,0,0.1); border-radius: 8px; border-left: 4px solid green;">
          <h3 style="color: green; margin-top: 0;">Admin Panel</h3>
          <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
            <a href="/admin/new-course" class="cta-button" style="background: green;">Create Course</a>
            <a href="/admin/manage-courses" class="cta-button" style="background: green;">Manage Courses</a>
            <a href="/admin" class="cta-button" style="background: green;">Admin Portal</a>
          </div>
        </div>
      `;
    }

    let enrolledCoursesHtml = '';
    if (user.enrolledCourses && user.enrolledCourses.length > 0) {
      enrolledCoursesHtml = user.enrolledCourses.map(course => `
        <div class="course-card">
          <div class="course-image-container">
            <img src="${course.imagePath || course.imageUrl || '/default-course.jpg'}" 
                 alt="${course.title}" class="course-image">
          </div>
          <div class="course-content">
            <h4>${course.title}</h4>
            <p>${course.description.substring(0, 100)}...</p>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${Math.floor(Math.random() * 100)}%"></div>
            </div>
            <p><small>${Math.floor(Math.random() * 100)}% Complete</small></p>
            <button onclick="location.href='/course/${course._id}/learn'" class="cta-button">Continue Learning</button>
          </div>
        </div>
      `).join('');
    } else {
      enrolledCoursesHtml = `
        <div class="empty-state">
          <div style="font-size: 4rem; margin-bottom: 1rem;">📚</div>
          <h3>Your Classroom is Ready</h3>
          <p>You haven't enrolled in any courses yet. Start your learning journey today!</p>
          <a href="/" class="cta-button">Explore Courses</a>
        </div>
      `;
    }

    const testsHtml = tests.map(test => {
      const attemptCount = testResults.filter(tr => tr.testId.toString() === test._id.toString()).length;
      const canTakeTest = attemptCount < test.maxAttempts;
      const lastAttempt = testResults.filter(tr => tr.testId.toString() === test._id.toString())
        .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];

      return `
        <div class="test-card">
          <h4>${test.title}</h4>
          <p><strong>Course:</strong> ${test.courseId.title}</p>
          <p><strong>Duration:</strong> ${test.duration} minutes</p>
          <p><strong>Questions:</strong> ${test.questions.length}</p>
          <p><strong>Attempts:</strong> ${attemptCount}/${test.maxAttempts}</p>
          ${lastAttempt ? `
            <p><strong>Last Score:</strong> ${lastAttempt.score}/${lastAttempt.totalPoints} (${lastAttempt.percentage}%)</p>
            <p><strong>Status:</strong> ${lastAttempt.passed ? 'Passed' : 'Failed'}</p>
          ` : '<p>Not attempted yet</p>'}
          <div class="test-actions">
            ${canTakeTest ? 
              `<a href="/test/${test._id}/take" class="cta-button small">Take Test</a>` : 
              `<span class="disabled-button">Max attempts reached</span>`
            }
            ${attemptCount > 0 ? 
              `<a href="/test/${test._id}/results" class="cta-button small secondary">View Results</a>` : 
              ''
            }
          </div>
        </div>
      `;
    }).join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Dashboard - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
          <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
          <style>
            .dashboard-container {
              max-width: 1200px;
              margin: 0 auto;
              padding: 100px 2% 50px;
            }
            .dashboard-section {
              margin-bottom: 3rem;
            }
            .test-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
              gap: 1.5rem;
              margin-top: 1rem;
            }
            .test-card {
              background: white;
              padding: 1.5rem;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
              border-left: 4px solid #2196F3;
            }
            .test-actions {
              margin-top: 1rem;
              display: flex;
              gap: 0.5rem;
              flex-wrap: wrap;
            }
            .cta-button.small {
              padding: 0.5rem 1rem;
              font-size: 0.9rem;
            }
            .disabled-button {
              padding: 0.5rem 1rem;
              background: #ccc;
              color: #666;
              border-radius: 4px;
              font-size: 0.9rem;
              cursor: not-allowed;
            }
            .courses-grid {
              display: grid;
              grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
              gap: 1.5rem;
              margin-top: 1rem;
            }
            .course-card {
              background: white;
              padding: 1.5rem;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .course-image-container {
              width: 100%;
              height: 200px;
              overflow: hidden;
              border-radius: 8px;
              margin-bottom: 1rem;
            }
            .course-image {
              width: 100%;
              height: 100%;
              object-fit: cover;
            }
            .progress-bar {
              width: 100%;
              height: 8px;
              background: #e9ecef;
              border-radius: 4px;
              overflow: hidden;
              margin: 0.5rem 0;
            }
            .progress-fill {
              height: 100%;
              background: #e10600;
              border-radius: 4px;
            }
            .empty-state {
              text-align: center;
              padding: 2rem;
              background: white;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            }
            .stats-container {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
              gap: 1rem;
              margin: 2rem 0;
            }
            .stat-card {
              background: rgba(255,255,255,0.05);
              padding: 1.5rem;
              border-radius: 12px;
              text-align: center;
              border: 1px solid rgba(255,255,255,0.1);
            }
          </style>
      </head>
      <body>
          <header>
            <nav>
                <h1 class="logo">Learn with Saurab</h1>
                <ul class="nav-links">
                    <li><a href="/">Home</a></li>
                    <li><a href="/dashboard">Dashboard</a></li>
                    <li><a href="/logout">Logout</a></li>
                </ul>
            </nav>
          </header>

          <main class="dashboard-container">
            <div class="dashboard-header">
              <h2>Welcome back, ${user.username}! 👋</h2>
              <p>Your personalized learning dashboard</p>
              ${adminLinks}
              
              <div class="stats-container">
                <div class="stat-card">
                  <h3 style="font-size: 2rem; color: #e10600; margin: 0;">${user.enrolledCourses ? user.enrolledCourses.length : 0}</h3>
                  <p style="color: #ccc; margin: 0.5rem 0 0 0;">Courses Enrolled</p>
                </div>
                <div class="stat-card">
                  <h3 style="font-size: 2rem; color: #e10600; margin: 0;">${user.progress ? user.progress.totalMinutesWatched || 0 : 0}</h3>
                  <p style="color: #ccc; margin: 0.5rem 0 0 0;">Minutes Watched</p>
                </div>
                <div class="stat-card">
                  <h3 style="font-size: 2rem; color: #e10600; margin: 0;">${user.progress ? user.progress.coursesCompleted || 0 : 0}</h3>
                  <p style="color: #ccc; margin: 0.5rem 0 0 0;">Courses Completed</p>
                </div>
                <div class="stat-card">
                  <h3 style="font-size: 2rem; color: #e10600; margin: 0;">${tests.length}</h3>
                  <p style="color: #ccc; margin: 0.5rem 0 0 0;">Upcoming Tests</p>
                </div>
              </div>
            </div>
            
            <div class="dashboard-section">
              <h3 style="color: #fff; font-family: 'Montserrat', sans-serif; margin-bottom: 2rem;">Your Learning Journey</h3>
              <div class="courses-grid">
                ${enrolledCoursesHtml}
              </div>
            </div>

            ${tests.length > 0 ? `
            <div class="dashboard-section">
              <h3 style="color: #fff; font-family: 'Montserrat', sans-serif; margin-bottom: 2rem;">Upcoming Tests</h3>
              <div class="test-grid">
                ${testsHtml}
              </div>
            </div>
            ` : ''}

            <div style="margin-top: 3rem; padding: 2rem; background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%); border-radius: 15px; color: white; text-align: center; border: 1px solid rgba(255,255,255,0.1);">
              <h3>Ready to level up?</h3>
              <p>Continue your learning journey and achieve your goals</p>
              <a href="/browse-courses" class="cta-button" style="background: rgba(203, 21, 21, 0.2); border-color: white; display: inline-block; margin-top: 1rem;">Browse More Courses</a>
            </div>
          </main>

          <footer>
            <p>© 2025 Learn with Saurab. All rights reserved.</p>
          </footer>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Dashboard error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Error - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
      </head>
      <body>
          <header>
            <nav>
                <h1 class="logo">Learn with Saurab</h1>
                <ul class="nav-links">
                    <li><a href="/">Home</a></li>
                    <li><a href="/login">Login</a></li>
                </ul>
            </nav>
          </header>
          <main style="padding: 100px 5%; text-align: center;">
            <h2>Something went wrong</h2>
            <p>We couldn't load your dashboard. Please try logging in again.</p>
            <a href="/login" class="cta-button">Login Again</a>
          </main>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }
});




// Enhanced admin portal route with real data
app.get('/admin', requireAdmin, async (req, res) => {
  try {
    // Get real data from database
    const totalCourses = await Course.countDocuments();
    const totalStudents = await User.countDocuments({ isAdmin: false });
    const totalAdmins = await User.countDocuments({ isAdmin: true });
    
    // Calculate total enrollments
    const enrollmentData = await User.aggregate([
      { $project: { count: { $size: "$enrolledCourses" } } },
      { $group: { _id: null, total: { $sum: "$count" } } }
    ]);
    const totalEnrollments = enrollmentData[0]?.total || 0;
    
    // Calculate this month's new students
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const newStudentsThisMonth = await User.countDocuments({
      isAdmin: false,
      createdAt: { $gte: startOfMonth }
    });
    
    // Get recent users for the table
    const recentUsers = await User.find()
      .sort({ createdAt: -1 })
      .limit(10)
      .select('username email firstName lastName mobile isAdmin createdAt enrolledCourses');
    
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin Portal - Learn with Saurab</title>
      <link rel="stylesheet" href="/responsive.css">
    <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
    <style>
        :root {
            --primary: #e10600;
            --primary-dark: #b30500;
            --secondary: #4C6EF5;
            --dark: #0c0c0c;
            --dark-light: #1a1a1a;
            --light: #ffffff;
            --gray: #718096;
            --gray-light: #e2e8f0;
            --success: #38a169;
            --warning: #ecc94b;
            --danger: #e53e3e;
            --radius: 12px;
            --shadow: 0 10px 30px rgba(0,0,0,0.15);
            --transition: all 0.3s ease;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', sans-serif;
            background: var(--dark);
            color: var(--light);
            line-height: 1.6;
        }

        .admin-container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 20px;
        }

        .admin-header {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border-left: 4px solid var(--primary);
        }

        .admin-header h1 {
            font-family: 'Montserrat', sans-serif;
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
            color: var(--light);
        }

        .admin-header p {
            color: var(--gray);
            font-size: 1.1rem;
        }

        .admin-nav {
            background: var(--dark-light);
            padding: 1rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
        }

        .admin-nav ul {
            display: flex;
            list-style: none;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .admin-nav a {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.25rem;
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            text-decoration: none;
            border-radius: var(--radius);
            transition: var(--transition);
        }

        .admin-nav a:hover, .admin-nav a.active {
            background: var(--primary);
        }

        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 1.5rem;
            margin-bottom: 2rem;
        }

        .stat-card {
            background: var(--dark-light);
            padding: 1.5rem;
            border-radius: var(--radius);
            text-align: center;
            transition: var(--transition);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .stat-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow);
        }

        .stat-icon {
            font-size: 2.5rem;
            margin-bottom: 1rem;
            color: var(--primary);
        }

        .stat-number {
            font-size: 2.5rem;
            font-weight: 700;
            margin-bottom: 0.5rem;
            color: var(--light);
            font-family: 'Montserrat', sans-serif;
        }

        .stat-label {
            color: var(--gray);
            font-size: 1rem;
        }

        .stat-trend {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
            margin-top: 0.5rem;
        }

        .trend-up {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
        }

        .trend-down {
            background: rgba(229, 62, 62, 0.2);
            color: var(--danger);
        }

        .admin-card {
            background: var(--dark-light);
            padding: 2rem;
            border-radius: var(--radius);
            margin-bottom: 2rem;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .admin-card h2 {
            font-family: 'Montserrat', sans-serif;
            font-size: 1.75rem;
            margin-bottom: 1.5rem;
            color: var(--light);
            display: flex;
            align-items: center;
            gap: 0.5rem;
        }

        .quick-actions {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 1.5rem;
        }

        .action-card {
            background: rgba(255, 255, 255, 0.03);
            padding: 1.5rem;
            border-radius: var(--radius);
            text-align: center;
            transition: var(--transition);
            border: 1px solid rgba(255, 255, 255, 0.05);
        }

        .action-card:hover {
            transform: translateY(-5px);
            box-shadow: var(--shadow);
            border-color: var(--primary);
        }

        .action-icon {
            font-size: 2.5rem;
            color: var(--primary);
            margin-bottom: 1rem;
        }

        .action-card h3 {
            font-size: 1.25rem;
            margin-bottom: 0.5rem;
            color: var(--light);
        }

        .action-card p {
            color: var(--gray);
            margin-bottom: 1.5rem;
        }

        .admin-btn {
            display: inline-block;
            padding: 0.75rem 1.5rem;
            background: var(--primary);
            color: white;
            text-decoration: none;
            border-radius: var(--radius);
            font-weight: 600;
            transition: var(--transition);
            border: none;
            cursor: pointer;
            font-family: inherit;
        }

        .admin-btn:hover {
            background: var(--primary-dark);
            transform: translateY(-2px);
        }

        .admin-btn.secondary {
            background: transparent;
            border: 1px solid var(--primary);
            color: var(--primary);
        }

        .admin-btn.secondary:hover {
            background: var(--primary);
            color: white;
        }

        /* User Management Styles */
        .user-management {
            margin-top: 2rem;
        }

        .filters {
            display: flex;
            gap: 1rem;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
        }

        .search-box {
            flex: 1;
            min-width: 250px;
            position: relative;
        }

        .search-box input {
            width: 100%;
            padding: 0.75rem 1rem 0.75rem 40px;
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            font-family: inherit;
        }

        .search-box i {
            position: absolute;
            left: 15px;
            top: 50%;
            transform: translateY(-50%);
            color: var(--gray);
        }

        .filter-select {
            padding: 0.75rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            font-family: inherit;
            min-width: 150px;
        }

        .users-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 1rem;
            background: rgba(255, 255, 255, 0.03);
            border-radius: var(--radius);
            overflow: hidden;
        }

        .users-table th {
            background: rgba(255, 255, 255, 0.05);
            padding: 1rem;
            text-align: left;
            font-weight: 600;
            color: var(--light);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
        }

        .users-table td {
            padding: 1rem;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            color: var(--gray);
        }

        .users-table tr:last-child td {
            border-bottom: none;
        }

        .users-table tr:hover {
            background: rgba(255, 255, 255, 0.02);
        }

        .user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background: var(--primary);
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: 600;
            font-size: 1rem;
        }

        .user-name {
            display: flex;
            align-items: center;
            gap: 0.75rem;
        }

        .user-status {
            display: inline-block;
            padding: 0.25rem 0.5rem;
            border-radius: 20px;
            font-size: 0.8rem;
        }

        .status-active {
            background: rgba(56, 161, 105, 0.2);
            color: var(--success);
        }

        .status-inactive {
            background: rgba(229, 62, 62, 0.2);
            color: var(--danger);
        }

        .user-actions {
            display: flex;
            gap: 0.5rem;
        }

        .action-btn {
            padding: 0.5rem;
            border-radius: var(--radius);
            border: none;
            cursor: pointer;
            transition: var(--transition);
            background: rgba(255, 255, 255, 0.05);
            color: var(--gray);
        }

        .action-btn:hover {
            background: var(--primary);
            color: white;
        }

        .pagination {
            display: flex;
            justify-content: center;
            gap: 0.5rem;
            margin-top: 2rem;
        }

        .page-btn {
            padding: 0.5rem 1rem;
            border-radius: var(--radius);
            border: 1px solid rgba(255, 255, 255, 0.1);
            background: rgba(255, 255, 255, 0.05);
            color: var(--light);
            cursor: pointer;
            transition: var(--transition);
        }

        .page-btn.active {
            background: var(--primary);
            border-color: var(--primary);
        }

        .page-btn:hover:not(.active) {
            background: rgba(255, 255, 255, 0.1);
        }

        /* Responsive styles */
        @media (max-width: 768px) {
            .admin-nav ul {
                flex-direction: column;
            }
            
            .stats-grid {
                grid-template-columns: 1fr;
            }
            
            .quick-actions {
                grid-template-columns: 1fr;
            }
            
            .filters {
                flex-direction: column;
            }
            
            .users-table {
                display: block;
                overflow-x: auto;
            }
        }

        /* Loading animation */
        .loading {
            display: inline-block;
            width: 20px;
            height: 20px;
            border: 3px solid rgba(255,255,255,.3);
            border-radius: 50%;
            border-top-color: var(--primary);
            animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    </style>
</head>
<body>
    <div class="admin-container">
        <div class="admin-header">
            <h1><i class="fas fa-crown"></i> Admin Portal</h1>
            <p>Manage your learning platform effectively</p>
        </div>
        
        <div class="admin-nav">
            <ul>
                <li><a href="/"><i class="fas fa-home"></i> Home</a></li>
                <li><a href="/dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a></li>
                <li><a href="/admin" class="active"><i class="fas fa-cog"></i> Admin Portal</a></li>
                <li><a href="/admin/new-course"><i class="fas fa-plus"></i> Create Course</a></li>
                <li><a href="/admin/manage-courses"><i class="fas fa-book"></i> Manage Courses</a></li>
                <li><a href="/admin/users"><i class="fas fa-users"></i> User Management</a></li>
                <li><a href="/admin/reprocess-videos">Reprocess All Videos</a></li>
                <li><a href="/admin/analytics"><i class="fas fa-chart-line"></i> Analytics</a></li>
                <li><a href="/logout"><i class="fas fa-sign-out-alt"></i> Logout</a></li>
            </ul>
        </div>
        
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-book"></i>
                </div>
                <div class="stat-number" id="total-courses">${totalCourses}</div>
                <div class="stat-label">Total Courses</div>
                <div class="stat-trend trend-up">+2 this month</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-users"></i>
                </div>
                <div class="stat-number" id="total-students">${totalStudents}</div>
                <div class="stat-label">Registered Students</div>
                <div class="stat-trend trend-up">+${newStudentsThisMonth} this month</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-graduation-cap"></i>
                </div>
                <div class="stat-number" id="enrollments">${totalEnrollments}</div>
                <div class="stat-label">Total Enrollments</div>
                <div class="stat-trend trend-up">+${Math.round(totalEnrollments/totalStudents*10)} this week</div>
            </div>
            
            <div class="stat-card">
                <div class="stat-icon">
                    <i class="fas fa-user-shield"></i>
                </div>
                <div class="stat-number">${totalAdmins}</div>
                <div class="stat-label">Administrators</div>
                <div class="stat-trend">System</div>
            </div>
        </div>
        
        <div class="admin-card">
            <h2><i class="fas fa-bolt"></i> Quick Actions</h2>
            <div class="quick-actions">
                <div class="action-card">
                    <div class="action-icon">
                        <i class="fas fa-plus-circle"></i>
                    </div>
                    <h3>Create Course</h3>
                    <p>Add a new course to your platform</p>
                    <a href="/admin/new-course" class="admin-btn">Get Started</a>
                </div>
                
                <div class="action-card">
                    <div class="action-icon">
                        <i class="fas fa-cog"></i>
                    </div>
                    <h3>Manage Content</h3>
                    <p>Edit existing courses and content</p>
                    <a href="/admin/manage-courses" class="admin-btn">Manage</a>
                </div>
                
                <div class="action-card">
                    <div class="action-icon">
                        <i class="fas fa-users"></i>
                    </div>
                    <h3>User Management</h3>
                    <p>View and manage all users</p>
                    <a href="/admin/users" class="admin-btn">View Users</a>
                </div>
                
                <div class="action-card">
                    <div class="action-icon">
                        <i class="fas fa-chart-line"></i>
                    </div>
                    <h3>Analytics</h3>
                    <p>View platform performance metrics</p>
                    <a href="/admin/analytics" class="admin-btn">View Analytics</a>
                </div>
            </div>
        </div>

        <div class="admin-card user-management">
            <h2><i class="fas fa-users"></i> Recent Users</h2>
            
            <div class="filters">
                <div class="search-box">
                    <i class="fas fa-search"></i>
                    <input type="text" id="user-search" placeholder="Search users...">
                </div>
                
                <select class="filter-select" id="status-filter">
                    <option value="all">All Status</option>
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                </select>
                
                <select class="filter-select" id="role-filter">
                    <option value="all">All Roles</option>
                    <option value="student">Students</option>
                    <option value="admin">Admins</option>
                </select>
                
                <select class="filter-select" id="sort-by">
                    <option value="newest">Newest First</option>
                    <option value="oldest">Oldest First</option>
                    <option value="name">By Name</option>
                </select>
            </div>
            
            <div class="table-responsive">
                <table class="users-table">
                    <thead>
                        <tr>
                            <th>User</th>
                            <th>Email</th>
                            <th>Mobile</th>
                            <th>Status</th>
                            <th>Role</th>
                            <th>Joined</th>
                            <th>Courses</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="users-table-body">
                        ${recentUsers.map(user => `
                            <tr>
                                <td>
                                    <div class="user-name">
                                        <div class="user-avatar">${user.firstName ? user.firstName.charAt(0) : ''}${user.lastName ? user.lastName.charAt(0) : ''}</div>
                                        <div>
                                            <div>${user.firstName || ''} ${user.lastName || ''}</div>
                                            <small>@${user.username}</small>
                                        </div>
                                    </div>
                                </td>
                                <td>${user.email}</td>
                                <td>${user.mobile || 'N/A'}</td>
                                <td><span class="user-status status-active">Active</span></td>
                                <td>${user.isAdmin ? 'Admin' : 'Student'}</td>
                                <td>${new Date(user.createdAt).toLocaleDateString()}</td>
                                <td>${user.enrolledCourses?.length || 0}</td>
                                <td>
                                    <div class="user-actions">
                                        <button class="action-btn" title="View Profile" onclick="viewUser('${user._id}')"><i class="fas fa-eye"></i></button>
                                        <button class="action-btn" title="Edit User" onclick="editUser('${user._id}')"><i class="fas fa-edit"></i></button>
                                        <button class="action-btn" title="Message User" onclick="messageUser('${user._id}')"><i class="fas fa-envelope"></i></button>
                                    </div>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            
            <div class="pagination">
                <button class="page-btn active">1</button>
                <button class="page-btn" onclick="loadMoreUsers(2)">2</button>
                <button class="page-btn" onclick="loadMoreUsers(3)">3</button>
                <button class="page-btn" onclick="loadMoreUsers(2)">Next</button>
            </div>
        </div>
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            // Set up event listeners for filters
            document.getElementById('user-search').addEventListener('input', filterUsers);
            document.getElementById('status-filter').addEventListener('change', filterUsers);
            document.getElementById('role-filter').addEventListener('change', filterUsers);
            document.getElementById('sort-by').addEventListener('change', filterUsers);
            
            // Simulate real-time updates (in a real app, this would use WebSockets or polling)
            setInterval(updateLiveStats, 30000);
        });
        
        function filterUsers() {
            const searchTerm = document.getElementById('user-search').value.toLowerCase();
            const statusFilter = document.getElementById('status-filter').value;
            const roleFilter = document.getElementById('role-filter').value;
            
            const rows = document.querySelectorAll('.users-table tbody tr');
            
            rows.forEach(row => {
                const name = row.querySelector('.user-name div:first-child').textContent.toLowerCase();
                const email = row.cells[1].textContent.toLowerCase();
                const status = row.querySelector('.user-status').textContent.toLowerCase();
                const role = row.cells[4].textContent.toLowerCase();
                
                const matchesSearch = name.includes(searchTerm) || email.includes(searchTerm);
                const matchesStatus = statusFilter === 'all' || status === statusFilter;
                const matchesRole = roleFilter === 'all' || role === roleFilter;
                
                if (matchesSearch && matchesStatus && matchesRole) {
                    row.style.display = '';
                } else {
                    row.style.display = 'none';
                }
            });
        }
        
        function viewUser(userId) {
            window.location.href = '/admin/user/' + userId;
        }
        
        function editUser(userId) {
            window.location.href = '/admin/user/' + userId + '/edit';
        }
        
        function messageUser(userId) {
            window.location.href = '/admin/message?user=' + userId;
        }
        
        function loadMoreUsers(page) {
            // Show loading state
            const tableBody = document.getElementById('users-table-body');
            tableBody.style.opacity = '0.5';
            
            // In a real app, this would fetch the next page of users from the server
            setTimeout(() => {
                // Update pagination buttons
                document.querySelectorAll('.page-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.page-btn')[page-1].classList.add('active');
                
                tableBody.style.opacity = '1';
                // Here you would update the table with new data from the server
            }, 800);
        }
        
        function updateLiveStats() {
            // In a real app, this would fetch updated stats from the server
            console.log('Updating live stats...');
            
            // Simulate small changes to make the dashboard feel alive
            const studentCount = document.getElementById('total-students');
            const currentCount = parseInt(studentCount.textContent);
            const change = Math.random() > 0.3 ? 1 : 0; // 70% chance of increase
            const newCount = Math.max(100, currentCount + change);
            
            if (newCount !== currentCount) {
                studentCount.textContent = newCount;
                
                // Update enrollments too (roughly 4x students)
                const enrollmentCount = document.getElementById('enrollments');
                enrollmentCount.textContent = newCount * 4 + Math.floor(Math.random() * 20);
                
                // Update the trend indicator
                const trendElement = studentCount.parentElement.querySelector('.stat-trend');
                trendElement.textContent = '+' + change + ' just now';
                trendElement.className = 'stat-trend trend-up';
                
                // Reset after a few seconds
                setTimeout(() => {
                    trendElement.textContent = '+${newStudentsThisMonth} this month';
                }, 5000);
            }
        }
    </script>
        <script src="/content-protection.js"></script>
        <script src="/mobile-nav.js"></script>
</body>
</html>
    `);
  } catch (error) {
    console.error('Admin portal error:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Error - Admin Portal</title>
          <link rel="stylesheet" href="/responsive.css">
        <style>
          body { font-family: 'Inter', sans-serif; background: #0c0c0c; color: white; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; }
          .error-container { text-align: center; padding: 2rem; background: #1a1a1a; border-radius: 12px; border-left: 4px solid #e10600; }
          h1 { color: #e10600; margin-bottom: 1rem; }
          a { color: #4C6EF5; text-decoration: none; }
        </style>
      </head>
      <body>
        <div class="error-container">
          <h1><i class="fas fa-exclamation-triangle"></i> Error Loading Admin Portal</h1>
          <p>We encountered an issue loading the admin dashboard. Please try again.</p>
          <p><a href="/admin">Retry</a> | <a href="/dashboard">Return to Dashboard</a></p>
        </div>
            <script src="/content-protection.js"></script>
            <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  }
});




// Logout route
app.get('/logout', (req, res) => {
req.session.destroy();
res.redirect('/');
});



// Add to server.js
app.post('/upload-video', upload.single('video'), async (req, res) => {
try {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file uploaded' });
  }
  
  // Here you would typically upload to cloud storage (S3, Cloudinary, etc.)
  // For now, we'll use local storage
  const videoPath = `/uploads/videos/${req.file.filename}`;
  
  res.json({ 
    success: true, 
    videoUrl: videoPath,
    message: 'Video uploaded successfully' 
  });
} catch (error) {
  res.status(500).json({ error: error.message });
}
});



// Course learning page with working video player and tests
app.get('/course/:id/learn', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const course = await Course.findById(req.params.id);
    const user = await User.findById(req.session.userId);
    
    if (!course) {
      return res.status(404).send('Course not found');
    }

    if (!user.enrolledCourses.includes(req.params.id)) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Access Denied - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
        </head>
        <body>
          <header>
            <nav>
              <h1 class="logo">Learn with Saurab</h1>
              <ul class="nav-links">
                <li><a href="/">Home</a></li>
                <li><a href="/dashboard">Dashboard</a></li>
              </ul>
            </nav>
          </header>
          <main style="padding: 100px 5%; text-align: center;">
            <div style="background: white; padding: 3rem; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,0.1);">
              <h2>Course Not Purchased</h2>
              <p>You need to purchase this course to access the content.</p>
              <a href="/" class="cta-button">Browse Courses</a>
            </div>
          </main>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
        </body>
        </html>
      `);
    }

    // Get all tests for this course
    const tests = await Test.find({ 
      courseId: course._id, 
      isPublished: true 
    });

    // Get user's test results
    const testResults = await TestResult.find({
      testId: { $in: tests.map(test => test._id) },
      studentId: user._id
    });

    // Get the first video from the first module for initial playback
    let initialVideo = null;
    let moduleIndex = 0;
    let videoIndex = 0;
    
    if (course.modules && course.modules.length > 0) {
      const firstModule = course.modules[0];
      if (firstModule.videos && firstModule.videos.length > 0) {
        initialVideo = firstModule.videos[0];
      }
    }

    // Generate modules HTML with proper video links and tests
    let modulesHtml = '';
    if (course.modules && course.modules.length > 0) {
      modulesHtml = course.modules.map((module, modIdx) => {
        // Get tests for this module
        const moduleTests = tests.filter(test => test.moduleIndex === modIdx);
        let testsHtml = '';
        
        if (moduleTests.length > 0) {
          testsHtml = moduleTests.map(test => {
            const attemptCount = testResults.filter(tr => tr.testId.toString() === test._id.toString()).length;
            const canTakeTest = attemptCount < test.maxAttempts;
            const lastAttempt = testResults.filter(tr => tr.testId.toString() === test._id.toString())
              .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt))[0];

            return `
              <div class="test-item" style="background: rgba(255,255,255,0.03); padding: 1.5rem; border-radius: 8px; margin: 1rem 0; border-left: 4px solid #4C6EF5;">
                <h4 style="color: #fff; margin-bottom: 0.5rem;">Test: ${test.title}</h4>
                <p style="color: #ccc; margin-bottom: 0.5rem;">${test.description || ''}</p>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem;">
                  <span style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                    Duration: ${test.duration} min
                  </span>
                  <span style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                    Questions: ${test.questions.length}
                  </span>
                  <span style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">
                    Attempts: ${attemptCount}/${test.maxAttempts}
                  </span>
                </div>
                
                ${lastAttempt ? `
                  <div style="margin-bottom: 1rem;">
                    <p style="color: #ccc; margin-bottom: 0.25rem;"><strong>Last Score:</strong> ${lastAttempt.score}/${lastAttempt.totalPoints} (${lastAttempt.percentage}%)</p>
                    <p style="color: #ccc; margin: 0;"><strong>Status:</strong> ${lastAttempt.passed ? '<span style="color: #38a169;">Passed</span>' : '<span style="color: #e53e3e;">Failed</span>'}</p>
                  </div>
                ` : '<p style="color: #718096; margin-bottom: 1rem;">Not attempted yet</p>'}

                <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
                  ${canTakeTest ? 
                    `<a href="/test/${test._id}/take" style="background: #4C6EF5; color: white; padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; font-size: 0.9rem;">Take Test</a>` : 
                    `<span style="background: #718096; color: #ccc; padding: 0.5rem 1rem; border-radius: 4px; font-size: 0.9rem; cursor: not-allowed;">Max attempts reached</span>`
                  }
                  ${attemptCount > 0 ? 
                    `<a href="/test/${test._id}/results" style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.5rem 1rem; border-radius: 4px; text-decoration: none; font-size: 0.9rem;">View Results</a>` : 
                    ''
                  }
                </div>
              </div>
            `;
          }).join('');
        }

        return `
          <div class="module" style="margin-bottom: 2rem;">
            <div style="background: rgba(255,255,255,0.05); padding: 1.5rem; border-radius: 12px; border-left: 4px solid #e10600;">
              <h4 style="color: #fff; margin-bottom: 0.5rem;">Module ${modIdx + 1}: ${module.moduleTitle || 'Untitled Module'}</h4>
              <p style="color: #ccc; margin: 0;">${module.moduleDescription || ''}</p>
            </div>
            
            ${module.content ? `
              <div style="margin-top: 1rem; padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px;">
                <h5 style="color: #fff; margin-bottom: 0.5rem;">Content</h5>
                <p style="color: #ccc; line-height: 1.6;">${module.content}</p>
              </div>
            ` : ''}
            
            <div class="videos-list" style="margin-top: 1rem;">
              ${module.videos && module.videos.length > 0 ? 
                module.videos.map((video, vidIdx) => `
                  <div class="video-item" 
                       style="display: flex; justify-content: space-between; align-items: center; padding: 1rem; background: rgba(255,255,255,0.03); border-radius: 8px; margin-bottom: 0.5rem; border: 1px solid rgba(255,255,255,0.05); cursor: pointer;"
                       onclick="loadVideo('${video.videoUrl}', '${video.videoTitle}', ${video.duration}, ${modIdx}, ${vidIdx})">
                    <div style="display: flex; align-items: center; gap: 1rem;">
                      <div style="width: 24px; height: 24px; background: rgba(255,255,255,0.1); border-radius: 4px; display: flex; align-items: center; justify-content: center;">
                        <span style="color: #ccc; font-size: 0.8rem;">${vidIdx + 1}</span>
                      </div>
                      <span style="color: #fff;">${video.videoTitle || 'Untitled Video'}</span>
                    </div>
                    <div style="display: flex; align-items: center; gap: 1rem;">
                      <span style="color: #ccc; font-size: 0.9rem;">${video.duration || 0} min</span>
                      ${video.isFree ? '<span style="background: #38a169; color: white; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.8rem;">FREE</span>' : ''}
                      <span style="color: #4C6EF5; font-size: 0.9rem;">Watch →</span>
                    </div>
                  </div>
                `).join('') : 
                '<p style="color: #718096; text-align: center; padding: 1rem;">No videos in this module yet</p>'
              }
            </div>

            ${module.resources && module.resources.length > 0 ? `
              <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #fff; margin-bottom: 0.5rem;">Resources</h5>
                ${module.resources.map(resource => `
                  <div style="display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem; background: rgba(255,255,255,0.02); border-radius: 6px; margin-bottom: 0.25rem;">
                    <span style="color: #ccc;">📄</span>
                    <span style="color: #ccc; font-size: 0.9rem;">${resource.title}</span>
                    <span style="color: #718096; font-size: 0.8rem;">(${resource.type})</span>
                    <a href="${resource.fileUrl}" target="_blank" style="color: #4C6EF5; text-decoration: none; margin-left: auto;">Download</a>
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            ${testsHtml ? `
              <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid rgba(255,255,255,0.1);">
                <h5 style="color: #fff; margin-bottom: 0.5rem;">Assessments</h5>
                ${testsHtml}
              </div>
            ` : ''}
          </div>
        `;
      }).join('');
    } else {
      modulesHtml = '<p style="color: #718096; text-align: center; padding: 2rem;">Course content is being prepared. Check back soon!</p>';
    }

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>${course.title} - Learn with Saurab</title>
            <link rel="stylesheet" href="/responsive.css">
          <link rel="stylesheet" href="/style.css">
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
          <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
          <style>
            body {
              background: #0c0c0c;
              color: #fff;
              font-family: 'Inter', sans-serif;
            }
            .course-header {
              background: linear-gradient(135deg, #1a1a1a 0%, #2d2d2d 100%);
              padding: 2rem;
              border-radius: 16px;
              margin-bottom: 2rem;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .course-player-container {
              display: grid;
              grid-template-columns: 2fr 1fr;
              gap: 2rem;
              margin-bottom: 2rem;
            }
            .video-container {
              background: rgba(255,255,255,0.05);
              padding: 2rem;
              border-radius: 16px;
              border: 1px solid rgba(255,255,255,0.1);
            }
            .course-content {
              background: rgba(255,255,255,0.05);
              padding: 2rem;
              border-radius: 16px;
              border: 1px solid rgba(255,255,255,0.1);
              max-height: 80vh;
              overflow-y: auto;
            }
            .video-item:hover {
              background: rgba(255,255,255,0.08) !important;
              transform: translateX(5px);
              transition: all 0.2s ease;
            }
            .active-video {
              background: rgba(76, 110, 245, 0.2) !important;
              border-left: 4px solid #4C6EF5 !important;
            }
            .progress-container {
              background: rgba(255,255,255,0.1);
              height: 6px;
              border-radius: 3px;
              margin: 1rem 0;
              overflow: hidden;
            }
            .progress-bar {
              height: 100%;
              background: #e10600;
              width: 0%;
              transition: width 0.3s ease;
            }
            @media (max-width: 968px) {
              .course-player-container {
                grid-template-columns: 1fr;
              }
            }
          </style>
      </head>
      <body>
          <header>
              <nav>
                  <h1 class="logo">Learn with Saurab</h1>
                  <ul class="nav-links">
                      <li><a href="/">Home</a></li>
                      <li><a href="/dashboard">Dashboard</a></li>
                      <li><a href="/logout">Logout</a></li>
                  </ul>
              </nav>
          </header>

          <main style="padding: 100px 2% 50px; max-width: 1400px; margin: 0 auto;">
            <div class="course-header">
              <div>
                <h1 style="color: #fff; margin-bottom: 1rem; font-family: 'Montserrat', sans-serif;">${course.title}</h1>
                <p style="color: #ccc; line-height: 1.6; margin-bottom: 1.5rem;">${course.description}</p>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
                  <span style="background: rgba(225, 6, 0, 0.2); color: #e10600; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                    ${course.category || 'Education'}
                  </span>
                  <span style="background: rgba(255,255,255,0.1); color: #ccc; padding: 0.5rem 1rem; border-radius: 20px; font-size: 0.9rem;">
                    ${course.level || 'All Levels'}
                  </span>
                </div>
              </div>
            </div>

            <div class="course-player-container">
              <div class="video-container">
                <div id="video-player" style="background: #000; border-radius: 12px; padding: 56.25% 0 0 0; position: relative; margin-bottom: 1.5rem;">
                  ${initialVideo ? `
                    <video id="main-video" controls style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 12px;">
                      <source src="${initialVideo.videoUrl}" type="video/mp4">
                      Your browser does not support the video tag.
                    </video>
                  ` : `
                    <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #1a1a1a; border-radius: 12px;">
                      <div style="text-align: center; color: #666;">
                        <i class="fas fa-video-slash" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                        <p>Select a video to start learning</p>
                      </div>
                    </div>
                  `}
                </div>
                
                <div id="video-info">
                  <h2 style="color: #fff; margin-bottom: 0.5rem;">${initialVideo ? initialVideo.videoTitle : 'No video selected'}</h2>
                  <p style="color: #ccc; line-height: 1.6; margin-bottom: 1rem;">
                    ${initialVideo ? `Duration: ${initialVideo.duration} minutes` : 'Select a video from the list'}
                  </p>
                  
                  <div class="progress-container">
                    <div class="progress-bar" id="progress-bar"></div>
                  </div>
                  
                  <div style="display: flex; justify-content: space-between; color: #ccc; font-size: 0.9rem;">
                    <span id="progress-text">0% Complete</span>
                    <span id="video-duration">${initialVideo ? `${initialVideo.duration}:00` : '00:00'}</span>
                  </div>
                </div>
              </div>
              
              <div class="course-content">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                  <h3 style="color: #fff; font-family: 'Montserrat', sans-serif;">Course Content</h3>
                  <span style="background: #e10600; color: white; padding: 0.25rem 0.75rem; border-radius: 20px; font-size: 0.8rem;">
                    ${course.modules ? course.modules.reduce((total, module) => total + (module.videos ? module.videos.length : 0), 0) : 0} videos
                  </span>
                </div>
                ${modulesHtml}
              </div>
            </div>
          </main>

          <script>
            let currentModuleIndex = ${initialVideo ? '0' : 'null'};
            let currentVideoIndex = ${initialVideo ? '0' : 'null'};
            const videoElement = document.getElementById('main-video');
            
            function loadVideo(videoUrl, videoTitle, duration, moduleIdx, videoIdx) {
              // Update active video highlight
              document.querySelectorAll('.video-item').forEach(item => {
                item.classList.remove('active-video');
              });
              event.currentTarget.classList.add('active-video');
              
              // Update video player
              if (videoElement) {
                videoElement.src = videoUrl;
                videoElement.load();
                videoElement.play();
              } else {
                // Create new video element if it doesn't exist
                const videoContainer = document.getElementById('video-player');
                videoContainer.innerHTML = \`
                  <video id="main-video" controls style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; border-radius: 12px;">
                    <source src="\${videoUrl}" type="video/mp4">
                    Your browser does not support the video tag.
                  </video>
                \`;
                
                // Add event listeners to new video element
                const newVideo = document.getElementById('main-video');
                setupVideoListeners(newVideo);
              }
              
              // Update video info
              document.getElementById('video-info').querySelector('h2').textContent = videoTitle;
              document.getElementById('video-info').querySelector('p').textContent = 'Duration: ' + duration + ' minutes';
              document.getElementById('video-duration').textContent = duration + ':00';
              
              // Reset progress
              document.getElementById('progress-bar').style.width = '0%';
              document.getElementById('progress-text').textContent = '0% Complete';
              
              currentModuleIndex = moduleIdx;
              currentVideoIndex = videoIdx;
              
              // Scroll to top of video player
              document.querySelector('.video-container').scrollIntoView({ behavior: 'smooth' });
            }
            
            function setupVideoListeners(video) {
              video.addEventListener('timeupdate', function() {
                const percent = (video.currentTime / video.duration) * 100;
                document.getElementById('progress-bar').style.width = percent + '%';
                document.getElementById('progress-text').textContent = Math.round(percent) + '% Complete';
                
                // Update time display
                const minutes = Math.floor(video.currentTime / 60);
                const seconds = Math.floor(video.currentTime % 60);
                document.getElementById('video-duration').textContent = 
                  \`\${minutes}:\${seconds < 10 ? '0' : ''}\${seconds} / \${Math.floor(video.duration / 60)}:\${Math.floor(video.duration % 60) < 10 ? '0' : ''}\${Math.floor(video.duration % 60)}\`;
              });
              
              video.addEventListener('ended', function() {
                // Mark as completed (you could send this to the server)
                document.getElementById('progress-bar').style.width = '100%';
                document.getElementById('progress-text').textContent = '100% Complete';
                
                // Auto-play next video if available
                // playNextVideo();
              });
            }
            
            // Initialize video listeners if video exists
            if (videoElement) {
              setupVideoListeners(videoElement);
            }
            
            // Function to play next video (optional)
            function playNextVideo() {
              // Implementation for playing next video in sequence
            }
            
            // Highlight the first video by default if it exists
            window.addEventListener('load', function() {
              if (currentModuleIndex !== null && currentVideoIndex !== null) {
                const firstVideo = document.querySelector('.video-item');
                if (firstVideo) {
                  firstVideo.classList.add('active-video');
                }
              }
            });
          </script>
              <script src="/content-protection.js"></script>
              <script src="/mobile-nav.js"></script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error loading course:', error);
    res.status(500).send('Error loading course content');
  }
});





// Temporary route for testing enrollment - Add before app.listen()
app.get('/enroll-test/:courseId', async (req, res) => {
try {
  if (!req.session.userId) {
    return res.redirect('/login');
  }

  const user = await User.findById(req.session.userId);
  const courseId = req.params.courseId;

  if (!user.enrolledCourses.includes(courseId)) {
    user.enrolledCourses.push(courseId);
    await user.save();
  }

  res.redirect(`/course/${courseId}/learn`);
} catch (error) {
  res.status(500).send('Enrollment error: ' + error.message);
}
});


// Debug route to check user admin status
app.get('/debug/check-admin', async (req, res) => {
if (!req.session.userId) {
  return res.json({ error: 'Not logged in' });
}
  
try {
  const user = await User.findById(req.session.userId);
  res.json({
    userId: req.session.userId,
    username: user.username,
    isAdmin: user.isAdmin,
    email: user.email
  });
} catch (error) {
  res.json({ error: error.message });
}
});

// Debug route to see all users - Add this temporarily
app.get('/debug/users', async (req, res) => {
try {
  const users = await User.find({});
  res.json(users);
} catch (error) {
  res.status(500).json({ error: error.message });
}
});

// Debug route to clear all users - Use carefully!
app.get('/debug/clear-users', async (req, res) => {
  try {
    await User.deleteMany({});
    res.send('All users cleared');
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});




// Serve protection JavaScript
app.get('/content-protection.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'content-protection.js'));
});




// Enhanced video protection with token-based access
app.get('/protected-video/:videoId', requireAuth, async (req, res) => {
  try {
    const videoPath = path.join(__dirname, 'uploads', 'videos', req.params.videoId);
    
    if (!fs.existsSync(videoPath)) {
      return res.status(404).send('Video not found');
    }
    
    // Check if user has access to this video
    const user = await User.findById(req.session.userId).populate('enrolledCourses');
    let hasAccess = false;
    
    // Check all courses for this video
    for (const course of user.enrolledCourses) {
      for (const module of course.modules) {
        if (module.videos) {
          const video = module.videos.find(v => {
            const videoFilename = v.videoUrl.split('/').pop();
            return videoFilename === req.params.videoId;
          });
          if (video) {
            hasAccess = true;
            break;
          }
        }
      }
      if (hasAccess) break;
    }
    
    if (!hasAccess) {
      return res.status(403).send('Access denied. You need to enroll in this course.');
    }
    
    // Set proper headers for video streaming
    const stat = fs.statSync(videoPath);
    const fileSize = stat.size;
    const range = req.headers.range;
    
    if (range) {
      // Handle range requests for video streaming
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = (end - start) + 1;
      const file = fs.createReadStream(videoPath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': 'video/mp4',
      };
      res.writeHead(200, head);
      fs.createReadStream(videoPath).pipe(res);
    }
  } catch (error) {
    console.error('Video streaming error:', error);
    res.status(500).send('Error streaming video');
  }
});



// Route to reprocess all videos with watermarks
app.get('/admin/reprocess-videos', requireAdmin, async (req, res) => {
  try {
    const { reprocessAllVideos } = require('./reprocess-videos');
    await reprocessAllVideos();
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Video Reprocessing - Learn with Saurab</title>
          <link rel="stylesheet" href="/responsive.css">
        <style>body { font-family: Arial, sans-serif; padding: 20px; }</style>
      </head>
      <body>
        <h1>Video Reprocessing Complete</h1>
        <p>All videos have been processed with watermarks.</p>
        <a href="/admin/manage-courses">Back to Course Management</a>
        <script src="/mobile-nav.js"></script>
              </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error reprocessing videos: ' + error.message);
  }
});



// Route for video player page
app.get('/video-player', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'video-player.html'));
});





// Test email route (remove in production)
app.get('/test-email', async (req, res) => {
  try {
    const { sendEmail } = require('./config/email');
    
    await sendEmail(
      'test@example.com', 
      'welcome', 
      ['Test User']
    );
    
    res.send('Test email sent successfully');
  } catch (error) {
    res.status(500).send('Error sending test email: ' + error.message);
  }
});




// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});