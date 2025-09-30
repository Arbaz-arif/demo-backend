const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("../Models/User");

const router = express.Router();


// Debug endpoint
router.get("/debug", async (req, res) => {
  try {
    const users = await User.find({}, 'name email role');
    res.json({ users: users.map(u => ({ name: u.name, email: u.email, role: u.role })) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test password endpoint
router.post("/test-password", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.json({ found: false });
    }
    
    const isValid = await user.comparePassword(password);
    res.json({ found: true, valid: isValid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create test user endpoint
router.post("/create-test-user", async (req, res) => {
  try {
    const testUser = new User({
      name: "Test User",
      email: "test@example.com",
      password: "password123",
      role: "user",
      department: "IT",
      position: "Developer",
      phone: "1234567890",
      address: "Test Address",
      hourlyRate: 25,
      totalWorkTime: 0,
      currentSalary: 0
    });
    
    await testUser.save();
    res.json({ 
      message: "Test user created successfully",
      email: "test@example.com",
      password: "password123"
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const passwordValid = await user.comparePassword(password);

    if (!passwordValid) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    // Check if user is blocked
    if (user.blocked) {
      return res.status(403).json({ message: "Account is blocked. Please contact administrator." });
    }

    const token = jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        name: user.name,
        email: user.email
      },
      process.env.JWT_SECRET || "your-secret-key",
      { expiresIn: "1d" }
    );
    res.json({ token });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// Get user profile
router.get("/profile", async (req, res) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    const user = await User.findById(decoded.id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (err) {
    console.error("Profile fetch error:", err);
    res.status(401).json({ message: "Invalid token" });
  }
});

module.exports = router;