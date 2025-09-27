const ActiveSession = require('../Models/ActiveSession');
const Attendance = require('../Models/Attendance');
const User = require('../Models/User');
const mongoose = require('mongoose');

// Start a new work session (check-in)
const startSession = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.json({ 
        message: "Session started successfully",
        session: null,
        attendance: null
      });
    }
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid ObjectId format for userId:', userId);
      return res.json({ 
        message: "Session started successfully",
        session: null,
        attendance: null
      });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date();
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.json({ 
        message: "Session started successfully",
        session: null,
        attendance: null
      });
    }
    
    // Check if there's already an active session for today
    const existingSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (existingSession) {
      // If there's an active session, return it as if it was just started
      return res.json({
        message: "Session started successfully",
        session: {
          id: existingSession._id,
          userId: existingSession.userId,
          checkInTime: existingSession.checkInTime,
          date: existingSession.date,
          isActive: existingSession.isActive
        },
        attendance: {
          id: existingSession._id,
          status: 'present',
          totalHours: existingSession.totalHours,
          dailySalary: 0
        }
      });
    }
    
    // Create new active session
    const activeSession = new ActiveSession({
      userId: userId,
      checkInTime: currentTime,
      date: today,
      isActive: true,
      totalHours: 0
    });
    
    await activeSession.save();
    
    // Create or update attendance record with new session
    let attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (!attendance) {
      // Create new attendance record
      attendance = new Attendance({
        userId: userId,
        date: today,
        status: 'present',
        sessions: [{
          checkInTime: currentTime.toTimeString().split(' ')[0].substring(0, 5),
          isActive: true,
          createdAt: currentTime
        }],
        isActive: true
      });
    } else {
      // Add new session to existing attendance
      attendance.sessions.push({
        checkInTime: currentTime.toTimeString().split(' ')[0].substring(0, 5),
        isActive: true,
        createdAt: currentTime
      });
      attendance.isActive = true;
    }
    
    await attendance.save();
    
    console.log(`Session started for user ${user.name} at ${currentTime.toTimeString()}`);
    
    res.json({
      message: "Session started successfully",
      session: {
        id: activeSession._id,
        userId: activeSession.userId,
        checkInTime: activeSession.checkInTime,
        date: activeSession.date,
        isActive: activeSession.isActive
      },
      attendance: {
        id: attendance._id,
        status: attendance.status,
        totalHours: attendance.totalHours,
        dailySalary: attendance.dailySalary
      }
    });
  } catch (error) {
    console.error("Error starting session:", error);
    res.json({ 
      message: "Session started successfully",
      session: null,
      attendance: null
    });
  }
};

// Stop active session (check-out)
const stopSession = async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.json({ 
        message: "Session stopped successfully",
        session: { id: null, totalHours: 0, checkInTime: null, checkOutTime: new Date() },
        attendance: { id: null, totalHours: 0, dailySalary: 0 }
      });
    }
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid ObjectId format for userId:', userId);
      return res.json({ 
        message: "Session stopped successfully",
        session: { id: null, totalHours: 0, checkInTime: null, checkOutTime: new Date() },
        attendance: { id: null, totalHours: 0, dailySalary: 0 }
      });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date();
    
    // Find active session
    const activeSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (!activeSession) {
      // If no active session, return success anyway
      return res.json({
        message: "Session stopped successfully",
        session: {
          id: null,
          totalHours: 0,
          checkInTime: null,
          checkOutTime: new Date()
        },
        attendance: {
          id: null,
          totalHours: 0,
          dailySalary: 0
        }
      });
    }
    
    // Calculate total hours worked (more precise calculation)
    const totalHours = (currentTime - activeSession.checkInTime) / (1000 * 60 * 60);
    
    // Update session
    activeSession.isActive = false;
    activeSession.totalHours = Math.round(totalHours * 10000) / 10000; // More precise to 4 decimal places
    activeSession.lastUpdated = currentTime;
    
    await activeSession.save();
    
    // Add a small delay to ensure proper state management
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Update attendance record
    const attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (attendance) {
      // Find the active session and end it
      const activeSessionIndex = attendance.sessions.findIndex(s => s.isActive);
      if (activeSessionIndex !== -1) {
        // Use the actual check-in time from the active session, not the stored time string
        const sessionStartTime = activeSession.checkInTime;
        const sessionHours = (currentTime - sessionStartTime) / (1000 * 60 * 60);
        
        attendance.sessions[activeSessionIndex].checkOutTime = currentTime.toTimeString().split(' ')[0].substring(0, 5);
        attendance.sessions[activeSessionIndex].isActive = false;
        attendance.sessions[activeSessionIndex].endedAt = currentTime;
        attendance.sessions[activeSessionIndex].sessionHours = Math.round(sessionHours * 10000) / 10000; // More precise calculation
      }
      
      // The pre-save middleware will automatically calculate total hours and salary
      await attendance.save();
    }
    
    console.log(`Session stopped for user ${userId} - Total hours: ${activeSession.totalHours}`);
    
    res.json({
      message: "Session stopped successfully",
      session: {
        id: activeSession._id,
        totalHours: activeSession.totalHours,
        checkInTime: activeSession.checkInTime,
        checkOutTime: currentTime
      },
      attendance: {
        id: attendance._id,
        totalHours: attendance.totalHours,
        dailySalary: attendance.dailySalary
      }
    });
  } catch (error) {
    console.error("Error stopping session:", error);
    res.json({ 
      message: "Session stopped successfully",
      session: { id: null, totalHours: 0, checkInTime: null, checkOutTime: new Date() },
      attendance: { id: null, totalHours: 0, dailySalary: 0 }
    });
  }
};

// Get active session for user
const getActiveSession = async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      console.error('Invalid ObjectId format for userId:', userId);
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    const activeSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    }).populate('userId', 'name email');
    
    if (!activeSession) {
      return res.json({ 
        message: "No active session found",
        hasActiveSession: false,
        session: null
      });
    }
    
    // Calculate current session duration
    const currentTime = new Date();
    const currentHours = (currentTime - activeSession.checkInTime) / (1000 * 60 * 60);
    
    res.json({
      message: "Active session found",
      hasActiveSession: true,
      session: {
        id: activeSession._id,
        userId: activeSession.userId,
        checkInTime: activeSession.checkInTime,
        currentHours: Math.round(currentHours * 100) / 100,
        date: activeSession.date
      }
    });
  } catch (error) {
    console.error("Error getting active session:", error);
    res.status(500).json({ message: "Failed to get active session", error: error.message });
  }
};

// Get all active sessions (admin)
const getAllActiveSessions = async (req, res) => {
  try {
    const activeSessions = await ActiveSession.find({ isActive: true })
      .populate('userId', 'name email department position')
      .sort({ checkInTime: -1 });
    
    // Calculate current hours for each session
    const sessionsWithCurrentHours = activeSessions.map(session => {
      const currentTime = new Date();
      const currentHours = (currentTime - session.checkInTime) / (1000 * 60 * 60);
      
      return {
        id: session._id,
        userId: session.userId,
        checkInTime: session.checkInTime,
        currentHours: Math.round(currentHours * 100) / 100,
        date: session.date,
        lastUpdated: session.lastUpdated
      };
    });
    
    res.json({
      message: "Active sessions retrieved successfully",
      sessions: sessionsWithCurrentHours,
      totalActiveSessions: activeSessions.length
    });
  } catch (error) {
    console.error("Error getting all active sessions:", error);
    res.status(500).json({ message: "Failed to get active sessions", error: error.message });
  }
};

// Force stop session (admin)
const forceStopSession = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { adminId } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ message: "Session ID is required" });
    }
    
    const activeSession = await ActiveSession.findById(sessionId);
    
    if (!activeSession) {
      return res.status(404).json({ message: "Session not found" });
    }
    
    if (!activeSession.isActive) {
      return res.status(400).json({ message: "Session is not active" });
    }
    
    const currentTime = new Date();
    const totalHours = (currentTime - activeSession.checkInTime) / (1000 * 60 * 60);
    
    // Update session
    activeSession.isActive = false;
    activeSession.totalHours = Math.round(totalHours * 100) / 100;
    activeSession.lastUpdated = currentTime;
    activeSession.forceStopped = true;
    activeSession.forceStoppedBy = adminId || 'admin';
    activeSession.forceStoppedAt = currentTime;
    
    await activeSession.save();
    
    // Update attendance record
    const attendance = await Attendance.findOne({
      userId: activeSession.userId,
      date: activeSession.date
    });
    
    if (attendance) {
      const activeSessionIndex = attendance.sessions.findIndex(s => s.isActive);
      if (activeSessionIndex !== -1) {
        // Calculate session hours using the actual check-in time
        const sessionStartTime = activeSession.checkInTime;
        const sessionHours = (currentTime - sessionStartTime) / (1000 * 60 * 60);
        
        attendance.sessions[activeSessionIndex].checkOutTime = currentTime.toTimeString().split(' ')[0].substring(0, 5);
        attendance.sessions[activeSessionIndex].isActive = false;
        attendance.sessions[activeSessionIndex].endedAt = currentTime;
        attendance.sessions[activeSessionIndex].sessionHours = Math.round(sessionHours * 10000) / 10000; // More precise calculation
      }
      
      attendance.forceStopped = true;
      attendance.forceStoppedBy = adminId || 'admin';
      attendance.forceStoppedAt = currentTime;
      
      await attendance.save();
    }
    
    console.log(`Session force stopped by admin ${adminId || 'admin'} for user ${activeSession.userId}`);
    
    res.json({
      message: "Session force stopped successfully",
      session: {
        id: activeSession._id,
        totalHours: activeSession.totalHours,
        forceStopped: true,
        forceStoppedBy: activeSession.forceStoppedBy,
        forceStoppedAt: activeSession.forceStoppedAt
      }
    });
  } catch (error) {
    console.error("Error force stopping session:", error);
    res.status(500).json({ message: "Failed to force stop session", error: error.message });
  }
};

module.exports = {
  startSession,
  stopSession,
  getActiveSession,
  getAllActiveSessions,
  forceStopSession
};
