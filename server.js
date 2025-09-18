// server.js
require('dotenv').config();
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto'); // For generating reset tokens
const axios = require('axios'); // For Khalti API calls - MOVED TO TOP
const path = require('path');

const app = express();
const port = 3000;

// Connect to MongoDB Atlas
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ Connected to MongoDB Atlas'))
  .catch(err => {
    console.error('❌ MongoDB connection error:');
    console.error(err.message);
  });

// Define a User Schema
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  // Add these for password reset:
  resetPasswordToken: String,
  resetPasswordExpires: Date,
  enrolledCourses: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Course' }]
});
const User = mongoose.model('User', userSchema);

// Define a Course Schema
const courseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  price: { type: Number, required: true },
  imageUrl: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});
const Course = mongoose.model('Course', courseSchema);

// Middleware
app.use(express.static(__dirname));
app.use(express.urlencoded({ extended: true }));
app.use(express.json()); 
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Route to serve the homepage with dynamic courses
app.get('/', async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    
    let coursesHtml = '';
    if (courses.length > 0) {
      coursesHtml = '<h2>Available Courses</h2><div style="display: flex; flex-wrap: wrap; gap: 20px;">';
      courses.forEach(course => {
        coursesHtml += `
          <div style="border: 1px solid #ccc; padding: 15px; border-radius: 5px; width: 300px;">
            <h3>${course.title}</h3>
            <p>${course.description}</p>
            <p><strong>Price: NPR ${course.price}</strong></p>
<div style="display: flex; gap: 10px; margin-top: 15px;">
    <button onclick="buyCourse('${course._id}', ${course.price}, '${course.title.replace(/'/g, "\\'")}')" 
            style="flex: 1; padding: 10px; background: linear-gradient(135deg, #4C6EF5 0%, #3B5BDB 100%); color: white; border: none; border-radius: 8px; cursor: pointer;">
        Buy Now - NPR ${course.price}
    </button>
    <button onclick="enrollFree('${course._id}')" 
            style="flex: 1; padding: 10px; background: #38A169; color: white; border: none; border-radius: 8px; cursor: pointer;">
        Free Preview
    </button>
</div>
        `;
      });
      coursesHtml += '</div>';
    } else {
      coursesHtml = '<p>No courses available yet.</p>';
    }

res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Learn with Saurab - Ace CEE & LokSewa Exams</title>
    <link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
    <nav>
        <h1 class="logo">Learn with Saurab</h1>
        <ul class="nav-links">
            <li><a href="/">Home</a></li>
            ${req.session.userId ? `
                <li><a href="/dashboard">Dashboard</a></li>
                <li><a href="/logout">Logout</a></li>
            ` : `
                <li><a href="/login">Login</a></li>
                <li><a href="/signup">Sign Up</a></li>
            `}
            <li><a href="/admin/new-course">Admin</a></li>
        </ul>
    </nav>
</header>

    <main>
        <!-- Hero Section -->
        <section class="hero">
            <div class="hero-content">
                <h2>Ace Your CEE, License & LokSewa Exams</h2>
                <p>Expert CEE, License & IQ Preparation from an MBBS Student. Get structured courses, proven strategies, and personal guidance to secure your future in medical and paramedical fields.</p>
                <div>
                    <a href="/login" class="cta-button">View Free Course</a>
                    <a href="/signup" class="cta-button secondary">Explore Paid Courses</a>
                </div>
            </div>
            <div class="hero-image">
                <img src="Logo.png" alt="Saurab Acharya - MBBS Student & MAT Expert">
            </div>
        </section>

        <!-- Courses Section -->
        <section class="courses-section">
            <h2>Available Courses</h2>
            <div class="courses-container">
                ${coursesHtml}
            </div>
        </section>

        <!-- Why Choose Us Section -->
        <section class="features">
            <h2>Why Choose Learn with Saurab?</h2>
            <div class="features-container">
                <div class="feature">
                    <h3>Expert Guidance</h3>
                    <p>Gain the unique advantage of learning from a current MBBS student with 6+ years of coaching experience. I bridge the gap between textbook knowledge and the practical, strategic insights needed to ace your competitive exams, because I've sat for them myself.</p>
                </div>
                <div class="feature">
                    <h3>Focused Content</h3>
                    <p>Master with Curriculum Designed Specifically for Your Exam:CEE Preparation, Loksewa Preparation and Liscense Exam Preparation. We target exactly what you need to know, eliminating irrelevent content and saving your precious time.</p>
                </div>
                <div class="feature">
                    <h3>Clear Explanation</h3>
                    <p>Complex concepts broken down into simple, easy-to-understand lessons. Learn from the Author of a Definitive MAT Book for CEE. Get insights straight from the source, not just from someone who teaches the material.</p>
                </div>
            </div>
        </section>
    </main>

    <footer>
        <p>© 2024 Learn with Saurab. All rights reserved.</p>
    </footer>

    <script src="/script.js"></script>
</body>
</html>
`);

  } catch (error) {
    res.status(500).send('Error loading courses');
  }
});

// Route to serve a professional login form
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Login - Learn with Saurab</title>
        <link rel="stylesheet" href="/auth-style.css">
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <h2>Welcome Back</h2>
                    <p>Sign in to continue your learning journey</p>
                </div>
                <form class="auth-form" action="/login" method="POST">
                    <div class="form-group">
                        <input type="text" name="username" placeholder="Username" required>
                    </div>
                    <div class="form-group">
                        <input type="password" name="password" placeholder="Password" required>
                    </div>
                    <button type="submit" class="auth-btn">Login</button>
                </form>
                <div class="auth-links">
                    <a href="/signup">Create Account</a> • 
                    <a href="/forgot-password">Forgot Password?</a> • 
                    <a href="/">Back to Home</a>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
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
        <link rel="stylesheet" href="/auth-style.css">
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <h2>Create Account</h2>
                    <p>Join thousands of students achieving their dreams</p>
                </div>
                <form class="auth-form" action="/signup" method="POST">
                    <div class="form-group">
                        <input type="text" name="username" placeholder="Choose a Username" required>
                    </div>
                    <div class="form-group">
                        <input type="email" name="email" placeholder="Your Email Address" required>
                    </div>
                    <div class="form-group">
                        <input type="password" name="password" placeholder="Create a Password" required>
                    </div>
                    <button type="submit" class="auth-btn">Create Account</button>
                </form>
                <div class="auth-links">
                    <a href="/login">Already have an account?</a> • 
                    <a href="/">Back to Home</a>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Forgot Password - Show form (Professional)
app.get('/forgot-password', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Reset Password - Learn with Saurab</title>
        <link rel="stylesheet" href="/auth-style.css">
    </head>
    <body>
        <div class="auth-container">
            <div class="auth-card">
                <div class="auth-header">
                    <h2>Reset Password</h2>
                    <p>Enter your email to receive a reset link</p>
                </div>
                <form class="auth-form" action="/forgot-password" method="POST">
                    <div class="form-group">
                        <input type="email" name="email" placeholder="Your registered email" required>
                    </div>
                    <button type="submit" class="auth-btn">Send Reset Link</button>
                </form>
                <div class="auth-links">
                    <a href="/login">Back to Login</a> • 
                    <a href="/signup">Create New Account</a> • 
                    <a href="/">Back to Home</a>
                </div>
            </div>
        </div>
    </body>
    </html>
  `);
});

// Forgot Password - Process request (Professional)
app.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  try {
    const user = await User.findOne({ email });
    
    // Always show success message for security
    const resetToken = crypto.randomBytes(20).toString('hex');
    if (user) {
      user.resetPasswordToken = resetToken;
      user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
      await user.save();
    }

    // Create reset URL
    const resetUrl = `http://localhost:3000/reset-password/${resetToken}`;
    
    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Check Your Email - Learn with Saurab</title>
          <link rel="stylesheet" href="/auth-style.css">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Check Your Email</h2>
                      <p>If an account exists with this email, you'll receive a password reset link shortly.</p>
                  </div>
                  
                  <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
                      <p style="margin: 0; color: #666; font-size: 14px;">
                          <strong>Demo Link (would be emailed):</strong><br>
                          <a href="${resetUrl}" style="word-break: break-all;">${resetUrl}</a>
                      </p>
                      <p style="margin: 10px 0 0 0; color: #888; font-size: 12px;">
                          This link expires in 1 hour.
                      </p>
                  </div>

                  <div class="auth-links">
                      <a href="/login">Back to Login</a> • 
                      <a href="/">Back to Home</a>
                  </div>
              </div>
          </div>
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
          <title>Error - Learn with Saurab</title>
          <link rel="stylesheet" href="/auth-style.css">
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
                      <a href="/">Back to Home</a>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  }
});

// Reset Password - Show form (Professional)
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
            <link rel="stylesheet" href="/auth-style.css">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Invalid or Expired Link</h2>
                        <p>This password reset link is invalid or has expired</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/forgot-password" class="auth-btn" style="display: inline-block; width: auto; padding: 10px 20px;">Get New Reset Link</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Back to Home</a>
                    </div>
                </div>
            </div>
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
          <title>Set New Password - Learn with Saurab</title>
          <link rel="stylesheet" href="/auth-style.css">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Set New Password</h2>
                      <p>Create a strong new password for your account</p>
                  </div>
                  <form class="auth-form" action="/reset-password/${req.params.token}" method="POST">
                      <div class="form-group">
                          <input type="password" name="password" placeholder="Enter new password" required>
                      </div>
                      <button type="submit" class="auth-btn">Reset Password</button>
                  </form>
                  <div class="auth-links">
                      <a href="/login">Back to Login</a> • 
                      <a href="/">Back to Home</a>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading reset page');
  }
});

// Reset Password - Process reset (Professional)
app.post('/reset-password/:token', async (req, res) => {
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
            <link rel="stylesheet" href="/auth-style.css">
        </head>
        <body>
            <div class="auth-container">
                <div class="auth-card">
                    <div class="auth-header">
                        <h2>Invalid or Expired Link</h2>
                        <p>This password reset link is invalid or has expired</p>
                    </div>
                    <div style="text-align: center; margin: 20px 0;">
                        <a href="/forgot-password" class="auth-btn" style="display: inline-block; width: auto; padding: 10px 20px;">Get New Reset Link</a>
                    </div>
                    <div class="auth-links">
                        <a href="/login">Back to Login</a> • 
                        <a href="/">Back to Home</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
      `);
    }

    // Hash new password and update user
    user.password = await bcrypt.hash(req.body.password, 12);
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
          <link rel="stylesheet" href="/auth-style.css">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Password Reset Successful! ✅</h2>
                      <p>Your password has been updated successfully</p>
                  </div>
                  <div style="text-align: center; margin: 30px 0;">
                      <div style="font-size: 48px; color: #28a745;">🎉</div>
                  </div>
                  <div style="text-align: center;">
                      <a href="/login" class="auth-btn" style="display: inline-block; width: auto; padding: 12px 30px;">Login Now</a>
                  </div>
                  <div class="auth-links">
                      <a href="/">Back to Home</a>
                  </div>
              </div>
          </div>
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
          <title>Error - Learn with Saurab</title>
          <link rel="stylesheet" href="/auth-style.css">
      </head>
      <body>
          <div class="auth-container">
              <div class="auth-card">
                  <div class="auth-header">
                      <h2>Something Went Wrong</h2>
                      <p>Please try resetting your password again</p>
                  </div>
                  <div class="auth-links">
                      <a href="/forgot-password">Try Again</a> • 
                      <a href="/">Back to Home</a>
                  </div>
              </div>
          </div>
      </body>
      </html>
    `);
  }
});

// Route to handle login form submission
app.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (user && await bcrypt.compare(password, user.password)) {
      req.session.userId = user._id;
      return res.redirect('/');
    }
    res.send('Invalid username or password');
  } catch (error) {
    res.status(500).send('Error logging in');
  }
});

// Route to handle signup form submission
app.post('/signup', async (req, res) => {
  const { username, email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 12);
    const newUser = new User({ username, email, password: hashedPassword });
    await newUser.save();
    res.redirect('/login');
  } catch (error) {
    res.send('Could not create user. Maybe username/email already exists.');
  }
});

// Admin Route: Form to create a new course
app.get('/admin/new-course', (req, res) => {
  res.send(`
    <h2>Create New Course</h2>
    <form action="/admin/new-course" method="POST">
      <input type="text" name="title" placeholder="Course Title" required><br>
      <textarea name="description" placeholder="Course Description" required></textarea><br>
      <input type="number" name="price" placeholder="Price (NPR)" required><br>
      <input type="text" name="imageUrl" placeholder="Image URL (optional)"><br>
      <button type="submit">Create Course</button>
    </form>
  `);
});

// Admin Route: Handle the course creation form submission
app.post('/admin/new-course', async (req, res) => {
  const { title, description, price, imageUrl } = req.body;
  try {
    const newCourse = new Course({ title, description, price, imageUrl });
    await newCourse.save();
    res.send('Course created successfully! <a href="/">View Homepage</a>');
  } catch (error) {
    res.status(500).send('Error creating course: ' + error.message);
  }
});

// Route to initiate Khalti payment (SIMPLIFIED FOR TESTING)
app.post('/khalti-pay', async (req, res) => {
  try {
    const { amount, courseId, courseName } = req.body;
    console.log("✅ Received payment request for:", courseName, "NPR", amount);
    
    // SIMULATE SUCCESS - return simple JSON
    res.json({
      success: true,
      message: "Payment simulation successful - would redirect to Khalti with real keys",
      payment_url: "https://khalti.com/simulation"
    });
    
  } catch (error) {
    console.error("❌ Error in khalti-pay route:", error.message);
    // Return proper JSON error, not HTML
    res.status(500).json({
      success: false,
      message: "Server error: " + error.message
    });
  }
});

// Route to handle successful payment return
app.get('/payment-success', async (req, res) => {
  // This is where Khalti will redirect users after successful payment
  // We would verify the payment here and enroll the student
  res.send(`
    <h2>Payment Successful! 🎉</h2>
    <p>Thank you for your purchase. You have been enrolled in the course.</p>
    <a href="/">Return to Home</a>
  `);
});

// Student Dashboard - Beautiful Design
app.get('/dashboard', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId).populate('enrolledCourses');
    
    let enrolledCoursesHtml = '';
    if (user.enrolledCourses && user.enrolledCourses.length > 0) {
      enrolledCoursesHtml = `
        <div class="dashboard-courses">
          <h3>Your Learning Journey</h3>
          <div class="courses-container">
      `;
      
      user.enrolledCourses.forEach(course => {
        enrolledCoursesHtml += `
          <div class="course-card">
            <h4>${course.title}</h4>
            <p>${course.description}</p>
            <div class="progress-bar">
  <div class="progress-fill" style="width: ${Math.floor(Math.random() * 100)}%"></div>
</div>
<p><small>${Math.floor(Math.random() * 100)}% Complete</small></p>
            <button onclick="startLearning('${course._id}')">Continue Learning</button>
          </div>
        `;
      });
      
      enrolledCoursesHtml += `
          </div>
        </div>
      `;
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

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Dashboard - Learn with Saurab</title>
          <link rel="stylesheet" href="/style.css">
      </head>
      <body>
          <header>
            <nav>
              <h1 class="logo">Learn with Saurab</h1>
              <ul class="nav-links">
                <li><a href="/">Home</a></li>
                <li><a href="/dashboard" class="active">Dashboard</a></li>
                <li><a href="/logout">Logout</a></li>
              </ul>
            </nav>
          </header>

          <main style="padding: 100px 5% 50px; min-height: 70vh;">
            <div class="dashboard-header">
              <h2>Welcome back, ${user.username}! 👋</h2>
              <p>Your personalized learning dashboard</p>
            </div>
            
            ${enrolledCoursesHtml}

            <div style="margin-top: 3rem; padding: 2rem; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 15px; color: white; text-align: center;">
              <h3>Ready to level up?</h3>
              <p>Continue your learning journey and achieve your goals</p>
              <a href="/" class="cta-button" style="background: rgba(255, 255, 255, 0.2); border-color: white;">Browse More Courses</a>
            </div>
          </main>

          <footer>
            <p>© 2024 Learn with Saurab. All rights reserved.</p>
          </footer>

          <script>
            function startLearning(courseId) {
              alert("This will open the course player for: " + courseId);
              // We'll implement the actual video player here next
            }
          </script>
      </body>
      </html>
    `);
  } catch (error) {
    res.status(500).send('Error loading dashboard');
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});


// Temporary enrollment for testing (will replace with real payment later)
app.post('/enroll-free/:courseId', async (req, res) => {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);
    const courseId = req.params.courseId;

    // Check if already enrolled
    if (!user.enrolledCourses.includes(courseId)) {
      user.enrolledCourses.push(courseId);
      await user.save();
    }

    res.redirect('/dashboard');
    
  } catch (error) {
    res.status(500).send('Enrollment error: ' + error.message);
  }
});


// Start the server
app.listen(port, () => {
  console.log(`➡️ Server running at http://localhost:${port}`);
});