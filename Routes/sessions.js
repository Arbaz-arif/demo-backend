const express = require("express");
const jwt = require("jsonwebtoken");
const ActiveSession = require("../Models/ActiveSession");
const Attendance = require("../Models/Attendance");
const User = require("../Models/User");
const router = express.Router();



// Start session (check-in with stopwatch)
router.post("/start", async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date().toISOString().split('T')[0];
    
    // Check if there's already an active session for today
    const existingSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (existingSession) {
      return res.status(400).json({ message: "You already have an active session for today" });
    }
    
    // Create new active session
    const activeSession = new ActiveSession({
      userId: userId,
      checkInTime: new Date(),
      date: today,
      isActive: true,
      totalHours: 0
    });
    
    await activeSession.save();
    
    // Also create attendance record
    const attendance = new Attendance({
      userId: userId,
      date: today,
      status: 'present',
      checkInTime: new Date().toTimeString().split(' ')[0].substring(0, 5),
      createdBy: 'User'
    });
    
    await attendance.save();
    
    res.json({
      message: "Session started successfully",
      session: activeSession,
      attendance: attendance
    });
  } catch (error) {
    console.error("Error starting session:", error);
    res.status(500).json({ message: "Failed to start session", error: error.message });
  }
});

// Stop session (check-out with stopwatch)
router.post("/stop", async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date().toISOString().split('T')[0];
    
    // Find active session
    const activeSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (!activeSession) {
      return res.status(404).json({ message: "No active session found for today" });
    }
    
    // Calculate total hours worked
    const checkOutTime = new Date();
    const totalHours = (checkOutTime - activeSession.checkInTime) / (1000 * 60 * 60);
    
    // Update session
    activeSession.isActive = false;
    activeSession.totalHours = Math.round(totalHours * 100) / 100;
    activeSession.lastUpdated = checkOutTime;
    
    await activeSession.save();
    
    // Update attendance record
    const attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (attendance) {
      attendance.checkOutTime = checkOutTime.toTimeString().split(' ')[0].substring(0, 5);
      attendance.totalHours = activeSession.totalHours;
      
      // Calculate daily salary based on user's hourly rate
      const user = await User.findById(userId);
      const hourlyRate = user?.hourlyRate || 15;
      attendance.dailySalary = activeSession.totalHours * hourlyRate;
      
      await attendance.save();
    }
    
    // Get user's total work time from all sessions
    const allSessions = await ActiveSession.find({
      userId: userId,
      isActive: false
    });
    
    const totalWorkTime = allSessions.reduce((total, session) => {
      return total + (session.totalHours || 0);
    }, 0);
    
    const totalSalary = totalWorkTime * (user?.hourlyRate || 15);
    
    res.json({
      message: "Session stopped successfully",
      session: activeSession,
      totalHours: activeSession.totalHours,
      totalWorkTime: totalWorkTime,
      totalSalary: totalSalary,
      dailySalary: attendance?.dailySalary || 0
    });
  } catch (error) {
    console.error("Error stopping session:", error);
    res.status(500).json({ message: "Failed to stop session", error: error.message });
  }
});

// Get current active session
router.get("/active", async (req, res) => {
  try {
    const userId = req.user._id;
    const today = new Date().toISOString().split('T')[0];
    
    const activeSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (!activeSession) {
      return res.json({ hasActiveSession: false });
    }
    
    // Calculate current hours if session is still active
    const currentTime = new Date();
    const currentHours = (currentTime - activeSession.checkInTime) / (1000 * 60 * 60);
    
    res.json({
      hasActiveSession: true,
      session: {
        ...activeSession.toObject(),
        currentHours: Math.round(currentHours * 100) / 100
      }
    });
  } catch (error) {
    console.error("Error getting active session:", error);
    res.status(500).json({ message: "Failed to get active session", error: error.message });
  }
});

// Get user's session history
router.get("/history", async (req, res) => {
  try {
    const userId = req.user._id;
    const { startDate, endDate } = req.query;
    
    let query = { userId: userId };
    
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.date = { $gte: startDate };
    } else if (endDate) {
      query.date = { $lte: endDate };
    }
    
    const sessions = await ActiveSession.find(query)
      .sort({ date: -1 })
      .limit(30); // Last 30 sessions
    
    res.json(sessions);
  } catch (error) {
    console.error("Error getting session history:", error);
    res.status(500).json({ message: "Failed to get session history", error: error.message });
  }
});

// Get user's total work time and salary
router.get("/totals", async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Get user's hourly rate
    const user = await User.findById(userId);
    const hourlyRate = user?.hourlyRate || 15;
    
    // Get all completed sessions
    const allSessions = await ActiveSession.find({
      userId: userId,
      isActive: false
    });
    
    // Calculate total work time and salary
    const totalWorkTime = allSessions.reduce((total, session) => {
      return total + (session.totalHours || 0);
    }, 0);
    
    const totalSalary = totalWorkTime * hourlyRate;
    
    res.json({
      totalWorkTime: totalWorkTime,
      totalSalary: totalSalary,
      hourlyRate: hourlyRate,
      totalSessions: allSessions.length
    });
  } catch (error) {
    console.error("Error getting user totals:", error);
    res.status(500).json({ message: "Failed to get user totals", error: error.message });
  }
});

module.exports = router;
