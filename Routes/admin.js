const express = require("express");
const Attendance = require("../Models/Attendance");
const User = require("../Models/User");
const Leave = require("../Models/Leave");
const Holiday = require("../Models/Holiday");
const ActiveSession = require("../Models/ActiveSession");
const { exportUsers, exportAttendance, exportSalary, getExportOptions } = require("../Controller/exportController");
const { startSession, stopSession, getActiveSession, getAllActiveSessions, forceStopSession } = require("../Controller/sessionController");
const { verifyUserOrAdmin } = require("../middleware/auth");
const router = express.Router();

router.get("/users", async (req, res) => {
  try {
    const { page = 1, limit = 1000, search, role, department } = req.query;
    
    let query = {};
    
    // Search functionality
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } }
      ];
    }
    
    // Filter by role (if specified, otherwise include all roles including admin)
    if (role && role !== 'all') {
      query.role = role;
    }
    
    // Filter by department
    if (department && department !== 'all') {
      query.department = department;
    }
    
    const skip = (page - 1) * limit;
    
    // Fetch all users including admins, with all required fields
    const users = await User.find(query)
      .select('name email role department position phone address hourlyRate createdAt updatedAt')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalUsers = await User.countDocuments(query);
    const totalPages = Math.ceil(totalUsers / limit);
    
    // Log the query and results for debugging
    console.log(`Admin fetched users - Query:`, JSON.stringify(query));
    console.log(`Total users found: ${totalUsers} (including admins)`);
    console.log(`Users returned: ${users.length}`);
    console.log(`Users details:`, users.map(u => ({ name: u.name, email: u.email, role: u.role })));
    
    // Return users with pagination info
    res.json({
      users,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalUsers,
        limit: parseInt(limit),
        hasNext: parseInt(page) < totalPages,
        hasPrev: parseInt(page) > 1
      }
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
  }
});

// Create new user (admin only)
router.post("/users", async (req, res) => {
  try {
    const { name, email, password, role = 'user', department, position, phone, address, hourlyRate = 0 } = req.body;
    
    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    
    // Validate role
    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'user' or 'admin'" });
    }
    
    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }
    
    // Create new user
    const newUser = new User({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      password: password,
      role: role,
      department: department ? department.trim() : '',
      position: position ? position.trim() : '',
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : '',
      hourlyRate: parseFloat(hourlyRate) || 0
    });
    
    await newUser.save();
    
    // Log the user creation
    try {
      await AuditLog.create({
        action: 'user_created',
        adminId: req.user._id,
        targetUserId: newUser._id,
        changes: {
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
          department: newUser.department,
          position: newUser.position
        },
        ipAddress: req.ip || req.connection.remoteAddress,
        userAgent: req.get('User-Agent')
      });
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
    }
    
    // Remove password from response
    const userResponse = newUser.toObject();
    delete userResponse.password;
    
    console.log(`Admin created new user: ${newUser.name} (${newUser._id})`);
    res.status(201).json({ 
      message: "User created successfully", 
      user: userResponse 
    });
  } catch (error) {
    console.error("Error creating user:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ message: "Failed to create user", error: error.message });
  }
});

// Get user profile by ID
router.get("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    const user = await User.findById(id).select('-password');
    
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    console.log(`Admin fetched user profile: ${user.name} (${id})`);
    res.json(user);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    res.status(500).json({ message: "Failed to fetch user profile", error: error.message });
  }
});

// Update user profile (allows users to update their own profile or admins to update any profile)
router.put("/users/:id", verifyUserOrAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, role, department, position, phone, address, blocked, hourlyRate } = req.body;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    // Get the current user from the token (you'll need to implement this middleware)
    const currentUser = req.user; // Assuming you have auth middleware that sets req.user
    
    // Check if user exists
    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Check if current user is admin or updating their own profile
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isOwnProfile = currentUser && currentUser.id === id;
    
    if (!isAdmin && !isOwnProfile) {
      return res.status(403).json({ message: "Access denied. You can only update your own profile." });
    }
    
    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({ message: "Name and email are required" });
    }
    
    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }
    
    // Validate role (only admins can change roles)
    if (role && !['user', 'admin'].includes(role)) {
      return res.status(400).json({ message: "Invalid role. Must be 'user' or 'admin'" });
    }
    
    // Check if email already exists for another user
    const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists for another user" });
    }
    
    // Build update data based on user permissions
    const updateData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      department: department ? department.trim() : '',
      position: position ? position.trim() : '',
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : ''
    };
    
    // Only admins can update role, blocked status, and hourly rate
    if (isAdmin) {
      updateData.role = role || userToUpdate.role;
      updateData.blocked = blocked !== undefined ? blocked : userToUpdate.blocked;
      updateData.hourlyRate = hourlyRate !== undefined ? parseFloat(hourlyRate) : userToUpdate.hourlyRate;
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    // Log the user update
    try {
      const changes = {};
      Object.keys(updateData).forEach(key => {
        if (userToUpdate[key] !== updatedUser[key]) {
          changes[key] = {
            from: userToUpdate[key],
            to: updatedUser[key]
          };
        }
      });

      if (Object.keys(changes).length > 0) {
        await AuditLog.create({
          action: 'user_updated',
          adminId: req.user._id,
          targetUserId: id,
          changes: changes,
          ipAddress: req.ip || req.connection.remoteAddress,
          userAgent: req.get('User-Agent')
        });
      }
    } catch (auditError) {
      console.error('Error creating audit log:', auditError);
    }
    
    console.log(`Admin updated user: ${updatedUser.name} (${id})`);
    res.json({ 
      message: "User updated successfully", 
      user: updatedUser 
    });
  } catch (error) {
    console.error("Error updating user:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

// Block/Unblock user (admin only)
router.put("/users/:id/block", async (req, res) => {
  try {
    const { id } = req.params;
    const { blocked } = req.body;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    if (typeof blocked !== 'boolean') {
      return res.status(400).json({ message: "Blocked status must be a boolean value" });
    }
    
    const updatedUser = await User.findByIdAndUpdate(
      id, 
      { blocked: blocked }, 
      { new: true, runValidators: true }
    ).select('-password');
    
    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }
    
    console.log(`Admin ${blocked ? 'blocked' : 'unblocked'} user: ${updatedUser.name} (${id})`);
    res.json({ 
      message: `User ${blocked ? 'blocked' : 'unblocked'} successfully`, 
      user: updatedUser 
    });
  } catch (error) {
    console.error("Error updating user block status:", error);
    res.status(500).json({ message: "Failed to update user block status", error: error.message });
  }
});

// Delete user
router.delete("/users/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    // Check if user exists
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Prevent admin from deleting themselves
    if (req.user && req.user.id === id) {
      return res.status(400).json({ message: "Cannot delete your own account" });
    }
    
    // Delete all associated records first
    const attendanceResult = await Attendance.deleteMany({ userId: id });
    console.log(`Deleted ${attendanceResult.deletedCount} attendance records for user: ${user.name}`);
    
    // Delete salary records if they exist
    try {
      const Salary = require('../models/Salary');
      const salaryResult = await Salary.deleteMany({ userId: id });
      console.log(`Deleted ${salaryResult.deletedCount} salary records for user: ${user.name}`);
    } catch (salaryError) {
      console.log('No salary records to delete or salary model not found:', salaryError.message);
    }
    
    // Delete leave records if they exist
    try {
      const Leave = require('../models/Leave');
      const leaveResult = await Leave.deleteMany({ userId: id });
      console.log(`Deleted ${leaveResult.deletedCount} leave records for user: ${user.name}`);
    } catch (leaveError) {
      console.log('No leave records to delete or leave model not found:', leaveError.message);
    }
    
    // Delete active sessions for this user
    try {
      const ActiveSession = require('../models/ActiveSession');
      const sessionResult = await ActiveSession.deleteMany({ userId: id });
      console.log(`Deleted ${sessionResult.deletedCount} active sessions for user: ${user.name}`);
    } catch (sessionError) {
      console.log('No active sessions to delete or session model not found:', sessionError.message);
    }
    
    // Finally delete the user
    await User.findByIdAndDelete(id);
    console.log(`Admin deleted user: ${user.name} (${id})`);
    
    res.json({ 
      message: "User and all associated records deleted successfully",
      deletedRecords: {
        attendance: attendanceResult.deletedCount
      }
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    res.status(500).json({ message: "Failed to delete user", error: error.message });
  }
});

// Get all attendance records (admin view)
router.get("/attendance", async (req, res) => {
  try {
    const { page = 1, limit = 50, status, date, userId } = req.query;
    
    let query = {};
    
    // Filter by status if provided
    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }
    
    // Filter by date if provided
    if (date) {
      query.date = date;
    }
    
    // Filter by user if provided
    if (userId) {
      query.userId = userId;
    }
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    const attendanceRecords = await Attendance.find(query)
      .populate('userId', 'name email role department')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalRecords = await Attendance.countDocuments(query);
    
    console.log(`Admin fetched ${attendanceRecords.length} attendance records (page ${page}, total: ${totalRecords})`);
    
    // Return with pagination info
    res.json({
      records: attendanceRecords,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRecords / parseInt(limit)),
        totalRecords,
        hasNextPage: parseInt(page) * parseInt(limit) < totalRecords,
        hasPrevPage: parseInt(page) > 1,
        limit: parseInt(limit)
      }
    });
  } catch (error) {
    console.error("Error fetching attendance records:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance records",
      error: error.message 
    });
  }
});

// Get all attendance records for export (admin only)
router.get("/attendance/all", async (req, res) => {
  try {
    const { status, startDate, endDate, userId } = req.query;
    
    let query = {};
    
    // Filter by status if provided
    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }
    
    // Filter by date range if provided
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.date = { $gte: startDate };
    } else if (endDate) {
      query.date = { $lte: endDate };
    }
    
    // Filter by user if provided
    if (userId) {
      query.userId = userId;
    }
    
    const attendanceRecords = await Attendance.find(query)
      .populate('userId', 'name email role department position')
      .sort({ date: -1, createdAt: -1 });
    
    console.log(`Admin exported ${attendanceRecords.length} attendance records`);
    
    // Return just the records array for export
    res.json(attendanceRecords);
  } catch (error) {
    console.error("Error fetching all attendance records for export:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance records for export",
      error: error.message 
    });
  }
});

// Get attendance statistics for all users
router.get("/attendance/stats", async (req, res) => {
  try {
    const { month, year, department } = req.query;
    
    if (!month || !year) {
      return res.status(400).json({ message: "Month and year are required" });
    }
    
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const endDate = `${year}-${month.padStart(2, '0')}-31`;
    
    console.log(`Admin fetching attendance stats for ${month}/${year}`);
    
    // Build user query
    let userQuery = {};
    if (department) {
      userQuery.department = department;
    }
    
    // Get all users (with optional department filter)
    const users = await User.find(userQuery).select('name email role department');
    
    // Get all attendance records for the month
    const attendanceRecords = await Attendance.find({
      date: { $gte: startDate, $lte: endDate }
    }).populate('userId', 'name email role department');
    
    // Calculate statistics
    const stats = {
      month: parseInt(month),
      year: parseInt(year),
      totalUsers: users.length,
      totalRecords: attendanceRecords.length,
      overallStats: {
        present: attendanceRecords.filter(r => r.status === 'present').length,
        absent: attendanceRecords.filter(r => r.status === 'absent').length,
        leave: attendanceRecords.filter(r => r.status === 'leave').length,
        late: attendanceRecords.filter(r => r.status === 'late').length
      },
      userStats: []
    };
    
    // Calculate stats for each user
    for (const user of users) {
      const userRecords = attendanceRecords.filter(r => r.userId._id.toString() === user._id.toString());
      
      const presentDays = userRecords.filter(r => r.status === 'present').length;
      const absentDays = userRecords.filter(r => r.status === 'absent').length;
      const leaveDays = userRecords.filter(r => r.status === 'leave').length;
      const lateDays = userRecords.filter(r => r.status === 'late').length;
      const totalDays = presentDays + absentDays + leaveDays + lateDays;
      
      const totalLateMinutes = userRecords
        .filter(r => r.isLate)
        .reduce((total, r) => total + (r.lateMinutes || 0), 0);
      
      stats.userStats.push({
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
        userRole: user.role,
        department: user.department,
        presentDays,
        absentDays,
        leaveDays,
        lateDays,
        totalDays,
        totalLateMinutes,
        averageLateMinutes: lateDays > 0 ? Math.round(totalLateMinutes / lateDays) : 0,
        attendanceRate: totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 100) : 0
      });
    }
    
    // Sort users by attendance rate (descending)
    stats.userStats.sort((a, b) => b.attendanceRate - a.attendanceRate);
    
    console.log(`Admin generated attendance stats for ${month}/${year}: ${stats.userStats.length} users`);
    
    res.json(stats);
  } catch (error) {
    console.error("Error generating attendance stats:", error);
    res.status(500).json({ message: "Failed to generate attendance statistics", error: error.message });
  }
});

// Get attendance summary for a specific user
router.get("/attendance/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { month, year } = req.query;
    
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    if (!month || !year) {
      return res.status(400).json({ message: "Month and year are required" });
    }
    
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const startDate = `${year}-${month.padStart(2, '0')}-01`;
    const endDate = `${year}-${month.padStart(2, '0')}-31`;
    
    const attendanceRecords = await Attendance.find({
      userId,
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 });
    
    const presentDays = attendanceRecords.filter(r => r.status === 'present').length;
    const absentDays = attendanceRecords.filter(r => r.status === 'absent').length;
    const leaveDays = attendanceRecords.filter(r => r.status === 'leave').length;
    const lateDays = attendanceRecords.filter(r => r.status === 'late').length;
    const totalDays = presentDays + absentDays + leaveDays + lateDays;
    
    const totalLateMinutes = attendanceRecords
      .filter(r => r.isLate)
      .reduce((total, r) => total + (r.lateMinutes || 0), 0);
    
    const summary = {
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department
      },
      month: parseInt(month),
      year: parseInt(year),
      presentDays,
      absentDays,
      leaveDays,
      lateDays,
      totalDays,
      totalLateMinutes,
      averageLateMinutes: lateDays > 0 ? Math.round(totalLateMinutes / lateDays) : 0,
      attendanceRate: totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 100) : 0,
      records: attendanceRecords
    };
    
    console.log(`Admin fetched attendance summary for user: ${user.name} (${userId})`);
    res.json(summary);
  } catch (error) {
    console.error("Error fetching user attendance summary:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    res.status(500).json({ message: "Failed to fetch user attendance summary", error: error.message });
  }
});

// Update attendance record (admin override)
router.put("/attendance/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, checkInTime, checkOutTime, notes, isLate, lateMinutes } = req.body;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid attendance record ID is required" });
    }
    
    const existingAttendance = await Attendance.findById(id);
    if (!existingAttendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    
    // Validate status if provided
    if (status) {
      const validStatuses = ['present', 'absent', 'leave', 'late'];
      if (!validStatuses.includes(status.toLowerCase())) {
        return res.status(400).json({ 
          message: "Invalid status. Must be one of: present, absent, leave, late" 
        });
      }
    }
    
    // Validate time format if provided
    if (checkInTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(checkInTime)) {
      return res.status(400).json({ message: "Invalid check-in time format. Use HH:MM format" });
    }
    
    if (checkOutTime && !/^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(checkOutTime)) {
      return res.status(400).json({ message: "Invalid check-out time format. Use HH:MM format" });
    }
    
    const updateData = {
      ...(status && { status: status.toLowerCase() }),
      ...(checkInTime && { checkInTime }),
      ...(checkOutTime && { checkOutTime }),
      ...(notes !== undefined && { notes: notes.trim() }),
      ...(isLate !== undefined && { isLate }),
      ...(lateMinutes !== undefined && { lateMinutes: parseInt(lateMinutes) || 0 }),
      editedAt: new Date(),
      editedBy: 'admin' // Mark as admin edit
    };
    
    // Store original status if it's the first edit
    if (!existingAttendance.originalStatus) {
      updateData.originalStatus = existingAttendance.status;
    }
    
    const updatedAttendance = await Attendance.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    ).populate('userId', 'name email');
    
    console.log(`Admin updated attendance record: ${id}`);
    
    res.json({ 
      message: "Attendance updated successfully by admin",
      attendance: updatedAttendance
    });
  } catch (error) {
    console.error("Error updating attendance:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid attendance record ID format" });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ 
      message: "Failed to update attendance", 
      error: error.message 
    });
  }
});

// Delete attendance record (admin only)
router.delete("/attendance/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid attendance record ID is required" });
    }
    
    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    
    await Attendance.findByIdAndDelete(id);
    console.log(`Admin deleted attendance record: ${id}`);
    
    res.json({ message: "Attendance record deleted successfully by admin" });
  } catch (error) {
    console.error("Error deleting attendance record:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid attendance record ID format" });
    }
    res.status(500).json({ 
      message: "Failed to delete attendance record", 
      error: error.message 
    });
  }
});

// Test endpoint to check all users in database
router.get("/test-users", async (req, res) => {
  try {
    console.log('=== TEST USERS ENDPOINT ===');
    const allUsers = await User.find({}).select('name email role department position phone address createdAt');
    console.log('All users in database:', allUsers.map(u => ({ name: u.name, email: u.email, role: u.role })));
    
    const adminUsers = await User.find({ role: 'admin' }).select('name email role department position phone address createdAt');
    console.log('Admin users found:', adminUsers.map(u => ({ name: u.name, email: u.email, role: u.role })));
    
    const regularUsers = await User.find({ role: 'user' }).select('name email role department position phone address createdAt');
    console.log('Regular users found:', regularUsers.map(u => ({ name: u.name, email: u.email, role: u.role })));
    
    res.json({
      totalUsers: allUsers.length,
      allUsers: allUsers,
      adminUsers: adminUsers,
      regularUsers: regularUsers,
      message: 'Test endpoint - check console for details'
    });
  } catch (error) {
    console.error('Error in test-users endpoint:', error);
    res.status(500).json({ message: 'Error testing users', error: error.message });
  }
});

// Get system overview statistics
router.get("/overview", async (req, res) => {
  try {
    // Count all users including admins (no filters applied)
    const totalUsers = await User.countDocuments({});
    const totalAttendanceRecords = await Attendance.countDocuments();
    
    // Get current month stats
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const startDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const endDate = `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`;
    
    const currentMonthRecords = await Attendance.countDocuments({
      date: { $gte: startDate, $lte: endDate }
    });
    
    // Get department stats
    const departmentStats = await User.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get role stats
    const roleStats = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    const overview = {
      totalUsers,
      totalAttendanceRecords,
      currentMonth: {
        month: currentMonth,
        year: currentYear,
        records: currentMonthRecords
      },
      departmentStats,
      roleStats,
      lastUpdated: new Date()
    };
    
    console.log(`Admin fetched system overview - Total Users: ${totalUsers} (including admins)`);
    console.log(`Role breakdown:`, roleStats);
    res.json(overview);
  } catch (error) {
    console.error("Error fetching system overview:", error);
    res.status(500).json({ message: "Failed to fetch system overview", error: error.message });
  }
});

// Create new attendance record (admin only)
router.post("/attendance", async (req, res) => {
  try {
    const { userId, date, status, checkInTime, checkOutTime, notes, createdBy } = req.body;
    
    // Validate required fields
    if (!userId || !date || !status) {
      return res.status(400).json({ message: "User ID, date, and status are required" });
    }
    
    // Validate status
    if (!['present', 'absent', 'late', 'leave'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be 'present', 'absent', 'late', or 'leave'" });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Check if attendance record already exists for this user and date
    const existingRecord = await Attendance.findOne({ userId, date });
    if (existingRecord) {
      return res.status(400).json({ message: "Attendance record already exists for this user and date" });
    }
    
    // Calculate if late (if check-in time is provided and status is present)
    let isLate = false;
    let lateMinutes = 0;
    
    if (checkInTime && status === 'present') {
      const [hours, minutes] = checkInTime.split(':').map(Number);
      const checkInMinutes = hours * 60 + minutes;
      const standardTime = 9 * 60; // 9:00 AM in minutes
      
      if (checkInMinutes > standardTime) {
        isLate = true;
        lateMinutes = checkInMinutes - standardTime;
      }
    }
    
    // Create new attendance record
    const newAttendance = new Attendance({
      userId,
      date: new Date(date).toISOString().split('T')[0],
      status: status.toLowerCase(),
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      isLate,
      lateMinutes,
      notes: notes || '',
      createdBy: createdBy || 'admin',
      createdAt: new Date()
    });
    
    await newAttendance.save();
    
    // Populate user info for response
    await newAttendance.populate('userId', 'name email');
    
    console.log(`Admin created attendance record: ${user.name} - ${status} on ${date}`);
    res.status(201).json({ 
      message: "Attendance record created successfully", 
      attendance: newAttendance 
    });
  } catch (error) {
    console.error("Error creating attendance record:", error);
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ message: "Failed to create attendance record", error: error.message });
  }
});

// Update attendance record (admin only)
router.put("/attendance/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { userId, date, status, checkInTime, checkOutTime, notes, editedBy } = req.body;
    
    // Validate required fields
    if (!userId || !date || !status) {
      return res.status(400).json({ message: "User ID, date, and status are required" });
    }
    
    // Validate status
    if (!['present', 'absent', 'late', 'leave'].includes(status)) {
      return res.status(400).json({ message: "Invalid status. Must be 'present', 'absent', 'late', or 'leave'" });
    }
    
    // Check if attendance record exists
    const existingRecord = await Attendance.findById(id);
    if (!existingRecord) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Check if another attendance record exists for this user and date (excluding current record)
    const duplicateRecord = await Attendance.findOne({ 
      userId, 
      date, 
      _id: { $ne: id } 
    });
    if (duplicateRecord) {
      return res.status(400).json({ message: "Another attendance record already exists for this user and date" });
    }
    
    // Update attendance record
    const updatedAttendance = await Attendance.findByIdAndUpdate(
      id,
      {
        userId,
        date,
        status,
        checkInTime: checkInTime || null,
        checkOutTime: checkOutTime || null,
        notes: notes || '',
        editedBy: editedBy || 'admin',
        editedAt: new Date()
      },
      { new: true, runValidators: true }
    ).populate('userId', 'name email');
    
    console.log(`Admin updated attendance record: ${user.name} - ${status} on ${date}`);
    res.json({ 
      message: "Attendance record updated successfully", 
      attendance: updatedAttendance 
    });
  } catch (error) {
    console.error("Error updating attendance record:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid attendance record ID format" });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ message: "Failed to update attendance record", error: error.message });
  }
});

// Delete attendance record (admin only)
router.delete("/attendance/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid attendance record ID is required" });
    }
    
    // Check if attendance record exists
    const attendanceRecord = await Attendance.findById(id);
    if (!attendanceRecord) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    
    await Attendance.findByIdAndDelete(id);
    console.log(`Admin deleted attendance record: ${id}`);
    
    res.json({ message: "Attendance record deleted successfully" });
  } catch (error) {
    console.error("Error deleting attendance record:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid attendance record ID format" });
    }
    res.status(500).json({ message: "Failed to delete attendance record", error: error.message });
  }
});

// Bulk operations for attendance
router.post("/attendance/bulk", async (req, res) => {
  try {
    const { operations } = req.body;
    
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      return res.status(400).json({ message: "Operations array is required" });
    }
    
    if (operations.length > 100) {
      return res.status(400).json({ message: "Maximum 100 operations allowed per request" });
    }
    
    const results = [];
    
    for (const operation of operations) {
      try {
        const { action, recordId, data } = operation;
        
        if (action === 'update' && recordId && data) {
          const updatedRecord = await Attendance.findByIdAndUpdate(
            recordId,
            { ...data, editedAt: new Date(), editedBy: 'admin' },
            { new: true, runValidators: true }
          ).populate('userId', 'name email');
          
          if (updatedRecord) {
            results.push({ success: true, recordId, action, data: updatedRecord });
          } else {
            results.push({ success: false, recordId, action, error: "Record not found" });
          }
        } else if (action === 'delete' && recordId) {
          const deletedRecord = await Attendance.findByIdAndDelete(recordId);
          if (deletedRecord) {
            results.push({ success: true, recordId, action });
          } else {
            results.push({ success: false, recordId, action, error: "Record not found" });
          }
        } else {
          results.push({ success: false, recordId, action, error: "Invalid operation" });
        }
      } catch (opError) {
        results.push({ 
          success: false, 
          recordId: operation.recordId, 
          action: operation.action, 
          error: opError.message 
        });
      }
    }
    
    const successCount = results.filter(r => r.success).length;
    const failureCount = results.length - successCount;
    
    console.log(`Admin bulk operation: ${successCount} successful, ${failureCount} failed`);
    
    res.json({
      message: `Bulk operation completed: ${successCount} successful, ${failureCount} failed`,
      results,
      summary: { total: results.length, successful: successCount, failed: failureCount }
    });
  } catch (error) {
    console.error("Error in bulk attendance operation:", error);
    res.status(500).json({ message: "Failed to process bulk operations", error: error.message });
  }
});

// ==================== LEAVE MANAGEMENT ROUTES ====================

// Get all leave applications (admin only)
router.get("/leaves", async (req, res) => {
  try {
    const { page = 1, limit = 50, status, userId } = req.query;
    
    let query = {};
    
    // Filter by status if provided
    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }
    
    // Filter by user if provided
    if (userId) {
      query.userId = userId;
    }
    
    const skip = (page - 1) * limit;
    
    const leaves = await Leave.find(query)
      .populate('userId', 'name email role department')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalLeaves = await Leave.countDocuments(query);
    
    console.log(`Admin fetched ${leaves.length} leave applications`);
    
    res.json({
      leaves,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalLeaves / limit),
        totalLeaves,
        hasNextPage: page * limit < totalLeaves,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error("Error fetching leave applications:", error);
    res.status(500).json({ 
      message: "Failed to fetch leave applications",
      error: error.message 
    });
  }
});

// Update leave application status (admin only)
router.put("/leaves/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes, reviewedBy } = req.body;
    
    // Validate required fields
    if (!status) {
      return res.status(400).json({ message: "Status is required" });
    }
    
    // Validate status
    if (!['pending', 'approved', 'rejected', 'on-hold'].includes(status)) {
      return res.status(400).json({ 
        message: "Invalid status. Must be one of: pending, approved, rejected, on-hold" 
      });
    }
    
    // Check if leave application exists
    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ message: "Leave application not found" });
    }
    
    // Update leave application
    const updatedLeave = await Leave.findByIdAndUpdate(
      id,
      {
        status: status.toLowerCase(),
        adminNotes: adminNotes || "",
        reviewedBy: reviewedBy || "admin",
        reviewedAt: new Date()
      },
      { new: true }
    ).populate('userId', 'name email role department');
    
    console.log(`Admin updated leave application ${id} to status: ${status}`);
    
    res.json({
      message: `Leave application ${status} successfully`,
      leave: updatedLeave
    });
  } catch (error) {
    console.error("Error updating leave application:", error);
    res.status(500).json({ 
      message: "Failed to update leave application",
      error: error.message 
    });
  }
});

// Delete leave application (admin only)
router.delete("/leaves/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Check if leave application exists
    const leave = await Leave.findById(id);
    if (!leave) {
      return res.status(404).json({ message: "Leave application not found" });
    }
    
    await Leave.findByIdAndDelete(id);
    
    console.log(`Admin deleted leave application ${id}`);
    
    res.json({ message: "Leave application deleted successfully" });
  } catch (error) {
    console.error("Error deleting leave application:", error);
    res.status(500).json({ 
      message: "Failed to delete leave application",
      error: error.message 
    });
  }
});

// ==================== HOLIDAY MANAGEMENT ====================

// Get all holidays
router.get("/holidays", async (req, res) => {
  try {
    const { year, month } = req.query;
    let query = {};
    
    if (year && month) {
      // Get holidays for specific month
      const startDate = `${year}-${month.padStart(2, '0')}-01`;
      const endDate = `${year}-${month.padStart(2, '0')}-31`;
      query.date = { $gte: startDate, $lte: endDate };
    } else if (year) {
      // Get holidays for specific year
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      query.date = { $gte: startDate, $lte: endDate };
    }
    
    const holidays = await Holiday.find(query).sort({ date: 1 });
    res.json(holidays);
  } catch (error) {
    console.error("Error fetching holidays:", error);
    res.status(500).json({ message: "Failed to fetch holidays", error: error.message });
  }
});

// Create new holiday
router.post("/holidays", async (req, res) => {
  try {
    const { name, date, type, description, isRecurring } = req.body;
    
    if (!name || !date) {
      return res.status(400).json({ message: "Holiday name and date are required" });
    }
    
    // Check if holiday already exists for this date
    const existingHoliday = await Holiday.findOne({ date });
    if (existingHoliday) {
      return res.status(400).json({ message: "Holiday already exists for this date" });
    }
    
    const holiday = new Holiday({
      name: name.trim(),
      date,
      type: type || 'national',
      description: description ? description.trim() : '',
      isRecurring: isRecurring || false,
      createdBy: req.user ? req.user.name || 'Admin' : 'Admin'
    });
    
    await holiday.save();
    console.log(`Admin created holiday: ${name} on ${date}`);
    res.status(201).json({ message: "Holiday created successfully", holiday });
  } catch (error) {
    console.error("Error creating holiday:", error);
    res.status(500).json({ message: "Failed to create holiday", error: error.message });
  }
});

// Initialize Canadian holidays for current year
router.post("/holidays/initialize-canada", async (req, res) => {
  try {
    const currentYear = new Date().getFullYear();
    
    // Canadian holidays for the current year
    const canadianHolidays = [
      {
        name: "New Year's Day",
        date: `${currentYear}-01-01`,
        type: "national",
        description: "New Year's Day celebration",
        isRecurring: true
      },
      {
        name: "Good Friday",
        date: getGoodFriday(currentYear),
        type: "religious",
        description: "Good Friday - Christian holiday",
        isRecurring: true
      },
      {
        name: "Easter Monday",
        date: getEasterMonday(currentYear),
        type: "religious",
        description: "Easter Monday - Christian holiday",
        isRecurring: true
      },
      {
        name: "Victoria Day",
        date: getVictoriaDay(currentYear),
        type: "national",
        description: "Victoria Day - Queen's birthday",
        isRecurring: true
      },
      {
        name: "Canada Day",
        date: `${currentYear}-07-01`,
        type: "national",
        description: "Canada Day - National holiday",
        isRecurring: true
      },
      {
        name: "Civic Holiday",
        date: getCivicHoliday(currentYear),
        type: "national",
        description: "Civic Holiday - First Monday in August",
        isRecurring: true
      },
      {
        name: "Labour Day",
        date: getLabourDay(currentYear),
        type: "national",
        description: "Labour Day - First Monday in September",
        isRecurring: true
      },
      {
        name: "Thanksgiving",
        date: getThanksgiving(currentYear),
        type: "national",
        description: "Thanksgiving - Second Monday in October",
        isRecurring: true
      },
      {
        name: "Remembrance Day",
        date: `${currentYear}-11-11`,
        type: "national",
        description: "Remembrance Day - Honoring veterans",
        isRecurring: true
      },
      {
        name: "Christmas Day",
        date: `${currentYear}-12-25`,
        type: "religious",
        description: "Christmas Day - Christian holiday",
        isRecurring: true
      },
      {
        name: "Boxing Day",
        date: `${currentYear}-12-26`,
        type: "national",
        description: "Boxing Day - Day after Christmas",
        isRecurring: true
      }
    ];

    // Check which holidays already exist
    const existingHolidays = await Holiday.find({ 
      date: { $in: canadianHolidays.map(h => h.date) } 
    });
    const existingDates = existingHolidays.map(h => h.date);

    // Create only new holidays
    const newHolidays = canadianHolidays.filter(h => !existingDates.includes(h.date));
    
    if (newHolidays.length > 0) {
      await Holiday.insertMany(newHolidays.map(holiday => ({
        ...holiday,
        createdBy: 'System'
      })));
    }

    res.json({ 
      message: `Initialized ${newHolidays.length} Canadian holidays for ${currentYear}`,
      holidays: newHolidays
    });
  } catch (error) {
    console.error("Error initializing Canadian holidays:", error);
    res.status(500).json({ message: "Failed to initialize Canadian holidays", error: error.message });
  }
});

// Helper functions for Canadian holidays
function getGoodFriday(year) {
  const easter = getEaster(year);
  const goodFriday = new Date(easter);
  goodFriday.setDate(easter.getDate() - 2);
  return goodFriday.toISOString().split('T')[0];
}

function getEasterMonday(year) {
  const easter = getEaster(year);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easter.getDate() + 1);
  return easterMonday.toISOString().split('T')[0];
}

function getEaster(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const n = Math.floor((h + l - 7 * m + 114) / 31);
  const p = (h + l - 7 * m + 114) % 31;
  return new Date(year, n - 1, p + 1);
}

function getVictoriaDay(year) {
  // Last Monday before May 25
  const may25 = new Date(year, 4, 25); // May is month 4 (0-indexed)
  const dayOfWeek = may25.getDay();
  const daysToSubtract = dayOfWeek === 1 ? 7 : (dayOfWeek + 6) % 7;
  const victoriaDay = new Date(may25);
  victoriaDay.setDate(may25.getDate() - daysToSubtract);
  return victoriaDay.toISOString().split('T')[0];
}

function getCivicHoliday(year) {
  // First Monday in August
  const august1 = new Date(year, 7, 1); // August is month 7 (0-indexed)
  const dayOfWeek = august1.getDay();
  const daysToAdd = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7;
  const civicHoliday = new Date(august1);
  civicHoliday.setDate(august1.getDate() + daysToAdd);
  return civicHoliday.toISOString().split('T')[0];
}

function getLabourDay(year) {
  // First Monday in September
  const september1 = new Date(year, 8, 1); // September is month 8 (0-indexed)
  const dayOfWeek = september1.getDay();
  const daysToAdd = dayOfWeek === 1 ? 0 : (8 - dayOfWeek) % 7;
  const labourDay = new Date(september1);
  labourDay.setDate(september1.getDate() + daysToAdd);
  return labourDay.toISOString().split('T')[0];
}

function getThanksgiving(year) {
  // Second Monday in October
  const october1 = new Date(year, 9, 1); // October is month 9 (0-indexed)
  const dayOfWeek = october1.getDay();
  const daysToAdd = dayOfWeek === 1 ? 7 : (8 - dayOfWeek) % 7 + 7;
  const thanksgiving = new Date(october1);
  thanksgiving.setDate(october1.getDate() + daysToAdd);
  return thanksgiving.toISOString().split('T')[0];
}

// Calculate salary for a user based on automatic calculations
router.get("/users/:id/salary", async (req, res) => {
  try {
    const { id } = req.params;
    const { startDate, endDate } = req.query;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    // Find the user
    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    if (user.hourlyRate <= 0) {
      return res.status(400).json({ message: "User does not have an hourly rate set" });
    }
    
    // Build date filter
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      dateFilter.date = { $gte: startDate };
    } else if (endDate) {
      dateFilter.date = { $lte: endDate };
    }
    
    // Get attendance records for the user with automatic calculations
    const attendanceRecords = await Attendance.find({
      userId: id,
      ...dateFilter,
      status: { $in: ['present', 'late'] } // Only count present and late as working days
    }).sort({ date: 1 });
    
    // Sum up the automatically calculated values
    let totalHours = 0;
    let totalSalary = 0;
    let totalDays = 0;
    const dailyHours = [];
    
    for (const record of attendanceRecords) {
      const hoursWorked = record.totalHours || 0;
      const dailySalary = record.dailySalary || 0;
      
      if (hoursWorked > 0) {
        totalHours += hoursWorked;
        totalSalary += dailySalary;
        totalDays++;
        
        dailyHours.push({
          date: record.date,
          checkIn: record.checkInTime || 'Not recorded',
          checkOut: record.checkOutTime || 'Not recorded',
          hoursWorked: Math.round(hoursWorked * 100) / 100,
          hourlyRate: record.hourlyRate || user.hourlyRate,
          dailySalary: Math.round(dailySalary * 100) / 100,
          status: record.status
        });
      }
    }
    
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        hourlyRate: user.hourlyRate,
        department: user.department || 'N/A'
      },
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'All time'
      },
      summary: {
        totalDays: totalDays,
        totalHours: Math.round(totalHours * 100) / 100,
        hourlyRate: user.hourlyRate,
        totalSalary: Math.round(totalSalary * 100) / 100,
        averageHoursPerDay: totalDays > 0 ? Math.round((totalHours / totalDays) * 100) / 100 : 0
      },
      dailyHours: dailyHours
    });
  } catch (error) {
    console.error("Error calculating salary:", error);
    res.status(500).json({ message: "Failed to calculate salary", error: error.message });
  }
});

// Get salary summary for all users (using automatic calculations)
router.get("/salary-summary", async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Build date filter
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      dateFilter.date = { $gte: startDate };
    } else if (endDate) {
      dateFilter.date = { $lte: endDate };
    }
    
    // Get all users with hourly rates
    const users = await User.find({ 
      role: 'user', 
      hourlyRate: { $gt: 0 } 
    }).select('name email hourlyRate department');
    
    const salarySummary = [];
    
    for (const user of users) {
      // Get attendance records for the user with automatic salary calculations
      const attendanceRecords = await Attendance.find({
        userId: user._id,
        ...dateFilter,
        status: { $in: ['present', 'late'] }
      });
      
      // Sum up the automatically calculated values
      let totalHours = 0;
      let totalSalary = 0;
      let totalDays = 0;
      
      for (const record of attendanceRecords) {
        totalHours += record.totalHours || 0;
        totalSalary += record.dailySalary || 0;
        if (record.totalHours > 0) {
          totalDays++;
        }
      }
      
      salarySummary.push({
        userId: user._id,
        name: user.name,
        email: user.email,
        department: user.department || 'N/A',
        hourlyRate: user.hourlyRate,
        totalDays: totalDays,
        totalHours: Math.round(totalHours * 100) / 100,
        totalSalary: Math.round(totalSalary * 100) / 100,
        averageHoursPerDay: totalDays > 0 ? Math.round((totalHours / totalDays) * 100) / 100 : 0
      });
    }
    
    // Sort by total salary (highest first)
    salarySummary.sort((a, b) => b.totalSalary - a.totalSalary);
    
    res.json({
      period: {
        startDate: startDate || 'All time',
        endDate: endDate || 'All time'
      },
      summary: salarySummary
    });
  } catch (error) {
    console.error("Error getting salary summary:", error);
    res.status(500).json({ message: "Failed to get salary summary", error: error.message });
  }
});

// Start active session (check-in with stopwatch)
router.post("/sessions/start", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    const today = new Date().toISOString().split('T')[0];
    
    // Check if there's already an active session for today
    const existingSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    });
    
    if (existingSession) {
      return res.status(400).json({ message: "User already has an active session for today" });
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
      createdBy: 'System'
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

// Stop active session (check-out with stopwatch)
router.post("/sessions/stop", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
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
    
    // Update attendance record with new session
    const attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (attendance) {
      // Find the active session and end it
      const activeSessionIndex = attendance.sessions.findIndex(s => s.isActive);
      if (activeSessionIndex !== -1) {
        attendance.sessions[activeSessionIndex].checkOutTime = checkOutTime.toTimeString().split(' ')[0].substring(0, 5);
        attendance.sessions[activeSessionIndex].isActive = false;
        attendance.sessions[activeSessionIndex].endedAt = checkOutTime;
      }
      
      await attendance.save();
    }
    
    res.json({
      message: "Session stopped successfully",
      session: activeSession,
      totalHours: activeSession.totalHours
    });
  } catch (error) {
    console.error("Error stopping session:", error);
    res.status(500).json({ message: "Failed to stop session", error: error.message });
  }
});

// Multiple check-in/check-out functionality
router.post("/attendance/checkin", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
    
    // Find or create attendance record for today
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
        sessions: []
      });
    }
    
    // Check if user is already checked in
    const activeSession = attendance.sessions.find(s => s.isActive);
    if (activeSession) {
      return res.status(400).json({ message: "User is already checked in. Please check out first." });
    }
    
    // Add new check-in session
    attendance.sessions.push({
      checkInTime: currentTime,
      isActive: true,
      createdAt: new Date()
    });
    
    attendance.isActive = true;
    await attendance.save();
    
    res.json({
      message: "Checked in successfully",
      checkInTime: currentTime,
      attendance: attendance
    });
  } catch (error) {
    console.error("Error checking in:", error);
    res.status(500).json({ message: "Failed to check in", error: error.message });
  }
});

router.post("/attendance/checkout", async (req, res) => {
  try {
    const { userId } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    const today = new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
    
    // Find attendance record for today
    const attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (!attendance) {
      return res.status(404).json({ message: "No attendance record found for today" });
    }
    
    // Find active session
    const activeSessionIndex = attendance.sessions.findIndex(s => s.isActive);
    if (activeSessionIndex === -1) {
      return res.status(400).json({ message: "User is not currently checked in" });
    }
    
    // End the active session
    attendance.sessions[activeSessionIndex].checkOutTime = currentTime;
    attendance.sessions[activeSessionIndex].isActive = false;
    attendance.sessions[activeSessionIndex].endedAt = new Date();
    
    // Check if there are any other active sessions
    const hasActiveSessions = attendance.sessions.some(s => s.isActive);
    attendance.isActive = hasActiveSessions;
    
    await attendance.save();
    
    res.json({
      message: "Checked out successfully",
      checkOutTime: currentTime,
      attendance: attendance
    });
  } catch (error) {
    console.error("Error checking out:", error);
    res.status(500).json({ message: "Failed to check out", error: error.message });
  }
});

// Admin force stop work session
router.post("/attendance/force-stop", async (req, res) => {
  try {
    const { userId, adminId, date } = req.body;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }
    
    // Use provided date or default to today
    const targetDate = date || new Date().toISOString().split('T')[0];
    const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
    
    // Find attendance record for the specified date
    const attendance = await Attendance.findOne({
      userId: userId,
      date: targetDate
    });
    
    if (!attendance) {
      return res.status(404).json({ message: `No attendance record found for ${targetDate}` });
    }
    
    // Find and force stop all active sessions
    let forceStoppedSessions = 0;
    for (let session of attendance.sessions) {
      if (session.isActive) {
        session.checkOutTime = currentTime;
        session.isActive = false;
        session.endedAt = new Date();
        session.forceStopped = true;
        session.forceStoppedBy = adminId || 'admin';
        session.forceStoppedAt = new Date();
        forceStoppedSessions++;
      }
    }
    
    if (forceStoppedSessions === 0) {
      return res.status(400).json({ message: "No active sessions found to force stop" });
    }
    
    // Mark attendance as force stopped
    attendance.isActive = false;
    attendance.forceStopped = true;
    attendance.forceStoppedBy = adminId || 'admin';
    attendance.forceStoppedAt = new Date();
    
    await attendance.save();
    
    // Also stop any active session in ActiveSession model for this date
    await ActiveSession.updateMany(
      { userId: userId, date: targetDate, isActive: true },
      { 
        isActive: false, 
        lastUpdated: new Date(),
        forceStopped: true,
        forceStoppedBy: adminId || 'admin'
      }
    );
    
    res.json({
      message: `Force stopped ${forceStoppedSessions} active session(s) for ${targetDate}`,
      forceStoppedAt: currentTime,
      forceStoppedBy: adminId || 'admin',
      date: targetDate,
      attendance: attendance
    });
  } catch (error) {
    console.error("Error force stopping session:", error);
    res.status(500).json({ message: "Failed to force stop session", error: error.message });
  }
});

// Force stop attendance record by ID (for any day)
router.post("/attendance/force-stop-by-id", async (req, res) => {
  try {
    const { attendanceId, adminId } = req.body;
    
    if (!attendanceId) {
      return res.status(400).json({ message: "Attendance ID is required" });
    }
    
    const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
    
    // Find attendance record by ID
    const attendance = await Attendance.findById(attendanceId);
    
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    
    // Find and force stop all active sessions
    let forceStoppedSessions = 0;
    for (let session of attendance.sessions) {
      if (session.isActive) {
        session.checkOutTime = currentTime;
        session.isActive = false;
        session.endedAt = new Date();
        session.forceStopped = true;
        session.forceStoppedBy = adminId || 'admin';
        session.forceStoppedAt = new Date();
        forceStoppedSessions++;
      }
    }
    
    if (forceStoppedSessions === 0) {
      return res.status(400).json({ message: "No active sessions found to force stop" });
    }
    
    // Mark attendance as force stopped
    attendance.isActive = false;
    attendance.forceStopped = true;
    attendance.forceStoppedBy = adminId || 'admin';
    attendance.forceStoppedAt = new Date();
    
    await attendance.save();
    
    // Also stop any active session in ActiveSession model for this date
    await ActiveSession.updateMany(
      { userId: attendance.userId, date: attendance.date, isActive: true },
      { 
        isActive: false, 
        lastUpdated: new Date(),
        forceStopped: true,
        forceStoppedBy: adminId || 'admin'
      }
    );
    
    res.json({
      message: `Force stopped ${forceStoppedSessions} active session(s) for ${attendance.date}`,
      forceStoppedAt: currentTime,
      forceStoppedBy: adminId || 'admin',
      date: attendance.date,
      attendance: attendance
    });
  } catch (error) {
    console.error("Error force stopping attendance by ID:", error);
    res.status(500).json({ message: "Failed to force stop attendance", error: error.message });
  }
});

// Get current check-in status for user
router.get("/attendance/status/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    const attendance = await Attendance.findOne({
      userId: userId,
      date: today
    });
    
    if (!attendance) {
      return res.json({
        isCheckedIn: false,
        currentSession: null,
        totalSessions: 0,
        totalHours: 0
      });
    }
    
    const activeSession = attendance.sessions.find(s => s.isActive);
    const totalSessions = attendance.sessions.length;
    
    res.json({
      isCheckedIn: !!activeSession,
      currentSession: activeSession,
      totalSessions: totalSessions,
      totalHours: attendance.totalHours || 0,
      dailySalary: attendance.dailySalary || 0,
      sessions: attendance.sessions
    });
  } catch (error) {
    console.error("Error getting attendance status:", error);
    res.status(500).json({ message: "Failed to get attendance status", error: error.message });
  }
});

// Get active session for user
router.get("/sessions/active/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const today = new Date().toISOString().split('T')[0];
    
    const activeSession = await ActiveSession.findOne({
      userId: userId,
      date: today,
      isActive: true
    }).populate('userId', 'name email');
    
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

// Get all active sessions (admin only)
router.get("/sessions/active", async (req, res) => {
  try {
    // First, clean up any dummy sessions
    await ActiveSession.deleteMany({
      $or: [
        { userName: { $regex: /dummy/i } },
        { userName: { $regex: /test/i } },
        { userName: { $regex: /unknown/i } },
        { userName: { $regex: /employee/i } }
      ]
    });
    
    const activeSessions = await ActiveSession.find({ isActive: true })
      .populate('userId', 'name email department position hourlyRate')
      .sort({ checkInTime: -1 });
    
    // Calculate current hours for each session
    const sessionsWithCurrentHours = activeSessions.map(session => {
      const currentTime = new Date();
      const currentHours = (currentTime - session.checkInTime) / (1000 * 60 * 60);
      const duration = Math.floor((currentTime - session.checkInTime) / 1000);
      
      return {
        ...session.toObject(),
        currentHours: Math.round(currentHours * 100) / 100,
        currentDuration: duration
      };
    });
    
    res.json({
      sessions: sessionsWithCurrentHours,
      count: sessionsWithCurrentHours.length
    });
  } catch (error) {
    console.error("Error getting active sessions:", error);
    res.status(500).json({ message: "Failed to get active sessions", error: error.message });
  }
});

// Update holiday
router.put("/holidays/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, date, type, description, isRecurring } = req.body;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid holiday ID is required" });
    }
    
    if (!name || !date) {
      return res.status(400).json({ message: "Holiday name and date are required" });
    }
    
    // Check if another holiday exists for this date (excluding current one)
    const existingHoliday = await Holiday.findOne({ date, _id: { $ne: id } });
    if (existingHoliday) {
      return res.status(400).json({ message: "Another holiday already exists for this date" });
    }
    
    const updatedHoliday = await Holiday.findByIdAndUpdate(
      id,
      {
        name: name.trim(),
        date,
        type: type || 'national',
        description: description ? description.trim() : '',
        isRecurring: isRecurring || false
      },
      { new: true, runValidators: true }
    );
    
    if (!updatedHoliday) {
      return res.status(404).json({ message: "Holiday not found" });
    }
    
    console.log(`Admin updated holiday: ${name} on ${date}`);
    res.json({ message: "Holiday updated successfully", holiday: updatedHoliday });
  } catch (error) {
    console.error("Error updating holiday:", error);
    res.status(500).json({ message: "Failed to update holiday", error: error.message });
  }
});

// Delete holiday
router.delete("/holidays/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid holiday ID is required" });
    }
    
    const deletedHoliday = await Holiday.findByIdAndDelete(id);
    
    if (!deletedHoliday) {
      return res.status(404).json({ message: "Holiday not found" });
    }
    
    console.log(`Admin deleted holiday: ${deletedHoliday.name} on ${deletedHoliday.date}`);
    res.json({ message: "Holiday deleted successfully", holiday: deletedHoliday });
  } catch (error) {
    console.error("Error deleting holiday:", error);
    res.status(500).json({ message: "Failed to delete holiday", error: error.message });
  }
});

// ==================== EXPORT ROUTES ====================

// Get export options (users, departments, etc.)
router.get("/export/options", getExportOptions);

// Export users data
router.get("/export/users", exportUsers);

// Export attendance data
router.get("/export/attendance", exportAttendance);

// Export salary data
router.get("/export/salary", exportSalary);

// Export leaves data
router.get("/export/leaves", async (req, res) => {
  try {
    const { 
      format = 'csv', 
      startDate, 
      endDate, 
      userId, 
      status,
      department 
    } = req.query;
    
    // Build query for filtering leaves
    let query = {};
    
    // Date range filter
    if (startDate && endDate) {
      query.startDate = { $gte: startDate };
      query.endDate = { $lte: endDate };
    } else if (startDate) {
      query.startDate = { $gte: startDate };
    } else if (endDate) {
      query.endDate = { $lte: endDate };
    }
    
    // User filter
    if (userId && userId !== 'all') {
      query.userId = userId;
    }
    
    // Status filter
    if (status && status !== 'all') {
      query.status = status.toLowerCase();
    }
    
    // Department filter - need to join with User collection
    let userQuery = {};
    if (department && department !== 'all') {
      userQuery.department = department;
    }
    
    // Fetch leave records with user population
    const leaveRecords = await Leave.find(query)
      .populate({
        path: 'userId',
        select: 'name email role department position',
        match: userQuery
      })
      .sort({ createdAt: -1 });
    
    // Filter out records where user doesn't match department filter
    const filteredRecords = leaveRecords.filter(record => record.userId);
    
    if (filteredRecords.length === 0) {
      return res.status(404).json({ message: 'No leave records found matching the criteria' });
    }
    
    // Prepare data for export
    const exportData = filteredRecords.map(record => ({
      'Employee Name': record.userId?.name || 'Unknown',
      'Email': record.userId?.email || '',
      'Department': record.userId?.department || '',
      'Position': record.userId?.position || '',
      'Leave Type': record.leaveType || '',
      'Start Date': new Date(record.startDate).toLocaleDateString(),
      'End Date': new Date(record.endDate).toLocaleDateString(),
      'Duration (Days)': record.duration || 0,
      'Reason': record.reason || '',
      'Status': record.status || '',
      'Applied Date': new Date(record.createdAt).toLocaleDateString(),
      'Reviewed By': record.reviewedBy || '',
      'Reviewed At': record.reviewedAt ? new Date(record.reviewedAt).toLocaleDateString() : '',
      'Admin Notes': record.adminNotes || ''
    }));
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `leaves_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel
      const XLSX = require('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Leaves');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV
      const createCsvWriter = require('csv-writer').createObjectCsvWriter;
      const path = require('path');
      const fs = require('fs');
      
      // Ensure directory exists
      const ensureDirectoryExists = (filePath) => {
        const dirname = path.dirname(filePath);
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }
      };
      
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Employee Name', title: 'Employee Name' },
          { id: 'Email', title: 'Email' },
          { id: 'Department', title: 'Department' },
          { id: 'Position', title: 'Position' },
          { id: 'Leave Type', title: 'Leave Type' },
          { id: 'Start Date', title: 'Start Date' },
          { id: 'End Date', title: 'End Date' },
          { id: 'Duration (Days)', title: 'Duration (Days)' },
          { id: 'Reason', title: 'Reason' },
          { id: 'Status', title: 'Status' },
          { id: 'Applied Date', title: 'Applied Date' },
          { id: 'Reviewed By', title: 'Reviewed By' },
          { id: 'Reviewed At', title: 'Reviewed At' },
          { id: 'Admin Notes', title: 'Admin Notes' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(exportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported ${filteredRecords.length} leave records in ${format} format`);
  } catch (error) {
    console.error('Error exporting leaves:', error);
    res.status(500).json({ message: 'Failed to export leaves', error: error.message });
  }
});

// Export all data (comprehensive export)
router.get("/export/all", async (req, res) => {
  try {
    const { 
      format = 'excel', 
      startDate, 
      endDate, 
      userId, 
      department 
    } = req.query;
    
    // Build date filter
    let dateFilter = {};
    if (startDate && endDate) {
      dateFilter.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      dateFilter.date = { $gte: startDate };
    } else if (endDate) {
      dateFilter.date = { $lte: endDate };
    }
    
    // Build user query
    let userQuery = {};
    if (userId && userId !== 'all') {
      userQuery._id = userId;
    }
    if (department && department !== 'all') {
      userQuery.department = department;
    }
    
    // Get all data
    const [users, attendanceRecords, leaveRecords] = await Promise.all([
      User.find(userQuery).select('-password').sort({ createdAt: -1 }),
      Attendance.find(dateFilter).populate('userId', 'name email department position').sort({ date: -1 }),
      Leave.find({
        ...(startDate && endDate ? {
          startDate: { $lte: endDate },
          endDate: { $gte: startDate }
        } : {}),
        ...(userId && userId !== 'all' ? { userId } : {}),
        ...(department && department !== 'all' ? { 'userId': { $in: await User.find({ department }).select('_id') } } : {})
      }).populate('userId', 'name email department position').sort({ createdAt: -1 })
    ]);
    
    // Filter leave records by department if needed
    const filteredLeaveRecords = department && department !== 'all' 
      ? leaveRecords.filter(record => record.userId?.department === department)
      : leaveRecords;
    
    // Get salary data
    const salaryData = [];
    const usersWithRates = users.filter(user => user.hourlyRate > 0);
    
    for (const user of usersWithRates) {
      const userAttendanceRecords = attendanceRecords.filter(r => r.userId?._id.toString() === user._id.toString());
      
      let totalHours = 0;
      let totalSalary = 0;
      let totalDays = 0;
      
      for (const record of userAttendanceRecords) {
        const hoursWorked = record.totalHours || 0;
        const dailySalary = record.dailySalary || 0;
        
        if (hoursWorked > 0) {
          totalHours += hoursWorked;
          totalSalary += dailySalary;
          totalDays++;
        }
      }
      
      if (totalDays > 0) {
        salaryData.push({
          'Employee Name': user.name,
          'Email': user.email,
          'Department': user.department || '',
          'Position': user.position || '',
          'Total Days': totalDays,
          'Total Hours': Math.round(totalHours * 100) / 100,
          'Hourly Rate': user.hourlyRate,
          'Total Salary': Math.round(totalSalary * 100) / 100
        });
      }
    }
    
    // Prepare data for different sheets
    const usersData = users.map(user => ({
      'Name': user.name || '',
      'Email': user.email || '',
      'Role': user.role || '',
      'Department': user.department || '',
      'Position': user.position || '',
      'Phone': user.phone || '',
      'Address': user.address || '',
      'Hourly Rate': user.hourlyRate || 0,
      'Status': user.blocked ? 'Blocked' : 'Active',
      'Created At': new Date(user.createdAt).toLocaleDateString()
    }));
    
    const attendanceData = attendanceRecords.map(record => ({
      'Date': new Date(record.date).toLocaleDateString(),
      'Employee Name': record.userId?.name || 'Unknown',
      'Email': record.userId?.email || '',
      'Department': record.userId?.department || '',
      'Status': record.status || '',
      'Check In Time': record.checkInTime || '',
      'Check Out Time': record.checkOutTime || '',
      'Total Hours': record.totalHours || 0,
      'Daily Salary': record.dailySalary || 0,
      'Is Late': record.isLate ? 'Yes' : 'No',
      'Late Minutes': record.lateMinutes || 0,
      'Notes': record.notes || ''
    }));
    
    const leavesData = filteredLeaveRecords.map(record => ({
      'Employee Name': record.userId?.name || 'Unknown',
      'Email': record.userId?.email || '',
      'Department': record.userId?.department || '',
      'Leave Type': record.leaveType || '',
      'Start Date': new Date(record.startDate).toLocaleDateString(),
      'End Date': new Date(record.endDate).toLocaleDateString(),
      'Duration (Days)': record.duration || 0,
      'Reason': record.reason || '',
      'Status': record.status || '',
      'Applied Date': new Date(record.createdAt).toLocaleDateString(),
      'Reviewed By': record.reviewedBy || '',
      'Admin Notes': record.adminNotes || ''
    }));
    
    // Get overview statistics
    const overviewData = [
      { 'Metric': 'Total Users', 'Value': users.length, 'Period': 'All Time' },
      { 'Metric': 'Total Attendance Records', 'Value': attendanceRecords.length, 'Period': 'All Time' },
      { 'Metric': 'Total Leave Applications', 'Value': filteredLeaveRecords.length, 'Period': 'All Time' },
      { 'Metric': 'Users with Salary Data', 'Value': salaryData.length, 'Period': 'All Time' },
      { 'Metric': 'Present Records', 'Value': attendanceRecords.filter(r => r.status === 'present').length, 'Period': 'All Time' },
      { 'Metric': 'Absent Records', 'Value': attendanceRecords.filter(r => r.status === 'absent').length, 'Period': 'All Time' },
      { 'Metric': 'Leave Records', 'Value': attendanceRecords.filter(r => r.status === 'leave').length, 'Period': 'All Time' },
      { 'Metric': 'Late Records', 'Value': attendanceRecords.filter(r => r.status === 'late').length, 'Period': 'All Time' }
    ];
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `complete_data_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel with multiple sheets
      const XLSX = require('xlsx');
      const workbook = XLSX.utils.book_new();
      
      // Add sheets
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(overviewData), 'Overview');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(usersData), 'Users');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceData), 'Attendance');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(leavesData), 'Leaves');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salaryData), 'Salary');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV (combine all data)
      const createCsvWriter = require('csv-writer').createObjectCsvWriter;
      const path = require('path');
      const fs = require('fs');
      
      // Ensure directory exists
      const ensureDirectoryExists = (filePath) => {
        const dirname = path.dirname(filePath);
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }
      };
      
      // Combine all data into one comprehensive CSV
      const combinedData = [
        // Overview section
        { 'Section': 'OVERVIEW', 'Data Type': 'Total Users', 'Value': users.length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Total Attendance Records', 'Value': attendanceRecords.length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Total Leave Applications', 'Value': filteredLeaveRecords.length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Users with Salary Data', 'Value': salaryData.length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Present Records', 'Value': attendanceRecords.filter(r => r.status === 'present').length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Absent Records', 'Value': attendanceRecords.filter(r => r.status === 'absent').length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Leave Records', 'Value': attendanceRecords.filter(r => r.status === 'leave').length, 'Details': 'All Time' },
        { 'Section': 'OVERVIEW', 'Data Type': 'Late Records', 'Value': attendanceRecords.filter(r => r.status === 'late').length, 'Details': 'All Time' },
        
        // Users section
        ...usersData.map(user => ({
          'Section': 'USERS',
          'Data Type': 'User Record',
          'Value': user.Name,
          'Details': `${user.Email} - ${user.Department} - ${user.Role}`
        })),
        
        // Attendance section
        ...attendanceData.map(att => ({
          'Section': 'ATTENDANCE',
          'Data Type': 'Attendance Record',
          'Value': att.EmployeeName,
          'Details': `${att.Date} - ${att.Status} - ${att['Check In Time']} to ${att['Check Out Time']}`
        })),
        
        // Leaves section
        ...leavesData.map(leave => ({
          'Section': 'LEAVES',
          'Data Type': 'Leave Application',
          'Value': leave['Employee Name'],
          'Details': `${leave['Leave Type']} - ${leave['Start Date']} to ${leave['End Date']} - ${leave.Status}`
        })),
        
        // Salary section
        ...salaryData.map(salary => ({
          'Section': 'SALARY',
          'Data Type': 'Salary Summary',
          'Value': salary['Employee Name'],
          'Details': `${salary['Total Hours']} hours - $${salary['Total Salary']}`
        }))
      ];
      
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Section', title: 'Section' },
          { id: 'Data Type', title: 'Data Type' },
          { id: 'Value', title: 'Value' },
          { id: 'Details', title: 'Details' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(combinedData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported complete data: ${users.length} users, ${attendanceRecords.length} attendance records, ${filteredLeaveRecords.length} leave records, ${salaryData.length} salary records in ${format} format`);
  } catch (error) {
    console.error('Error exporting all data:', error);
    res.status(500).json({ message: 'Failed to export all data', error: error.message });
  }
});

// Export overview data
router.get("/export/overview", async (req, res) => {
  try {
    const { 
      format = 'csv', 
      startDate, 
      endDate 
    } = req.query;
    
    // Get overview statistics
    const totalUsers = await User.countDocuments();
    const totalAttendanceRecords = await Attendance.countDocuments();
    const totalLeaves = await Leave.countDocuments();
    
    // Get current month stats
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const startDateFilter = startDate || `${currentYear}-${String(currentMonth).padStart(2, '0')}-01`;
    const endDateFilter = endDate || `${currentYear}-${String(currentMonth).padStart(2, '0')}-31`;
    
    // Get attendance records for the period
    const attendanceRecords = await Attendance.find({
      date: { $gte: startDateFilter, $lte: endDateFilter }
    }).populate('userId', 'name email department');
    
    // Get leave records for the period
    const leaveRecords = await Leave.find({
      startDate: { $lte: endDateFilter },
      endDate: { $gte: startDateFilter }
    }).populate('userId', 'name email department');
    
    // Calculate statistics
    const presentCount = attendanceRecords.filter(r => r.status === 'present').length;
    const absentCount = attendanceRecords.filter(r => r.status === 'absent').length;
    const leaveCount = attendanceRecords.filter(r => r.status === 'leave').length;
    const lateCount = attendanceRecords.filter(r => r.status === 'late').length;
    
    // Get department stats
    const departmentStats = await User.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Get role stats
    const roleStats = await User.aggregate([
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    
    // Prepare data for export
    const exportData = [
      {
        'Metric': 'Total Users',
        'Value': totalUsers,
        'Period': `${startDateFilter} to ${endDateFilter}`
      },
      {
        'Metric': 'Total Attendance Records',
        'Value': totalAttendanceRecords,
        'Period': 'All Time'
      },
      {
        'Metric': 'Total Leave Applications',
        'Value': totalLeaves,
        'Period': 'All Time'
      },
      {
        'Metric': 'Present Today',
        'Value': presentCount,
        'Period': `${startDateFilter} to ${endDateFilter}`
      },
      {
        'Metric': 'Absent Today',
        'Value': absentCount,
        'Period': `${startDateFilter} to ${endDateFilter}`
      },
      {
        'Metric': 'On Leave Today',
        'Value': leaveCount,
        'Period': `${startDateFilter} to ${endDateFilter}`
      },
      {
        'Metric': 'Late Today',
        'Value': lateCount,
        'Period': `${startDateFilter} to ${endDateFilter}`
      }
    ];
    
    // Add department breakdown
    departmentStats.forEach(dept => {
      exportData.push({
        'Metric': `Department: ${dept._id || 'Not Specified'}`,
        'Value': dept.count,
        'Period': 'All Time'
      });
    });
    
    // Add role breakdown
    roleStats.forEach(role => {
      exportData.push({
        'Metric': `Role: ${role._id}`,
        'Value': role.count,
        'Period': 'All Time'
      });
    });
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `overview_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel
      const XLSX = require('xlsx');
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Overview');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV
      const createCsvWriter = require('csv-writer').createObjectCsvWriter;
      const path = require('path');
      const fs = require('fs');
      
      // Ensure directory exists
      const ensureDirectoryExists = (filePath) => {
        const dirname = path.dirname(filePath);
        if (!fs.existsSync(dirname)) {
          fs.mkdirSync(dirname, { recursive: true });
        }
      };
      
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Metric', title: 'Metric' },
          { id: 'Value', title: 'Value' },
          { id: 'Period', title: 'Period' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(exportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported overview data in ${format} format`);
  } catch (error) {
    console.error('Error exporting overview:', error);
    res.status(500).json({ message: 'Failed to export overview', error: error.message });
  }
});

// ==================== SESSION MANAGEMENT ROUTES ====================
router.get("/sessions/active/:userId", getActiveSession);

// ==================== ADMIN SESSION MANAGEMENT ROUTES ====================
// Admin can start session for any employee
router.post("/admin-sessions/start", async (req, res) => {
  try {
    const { employeeId, employeeName, hourlyRate } = req.body;
    const adminId = req.user.id;
    
    if (!employeeId) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }
    
    // Check if employee exists
    const employee = await User.findById(employeeId);
    if (!employee) {
      return res.status(404).json({ message: 'Employee not found' });
    }
    
    // Check if employee already has an active session
    const today = new Date().toISOString().split('T')[0];
    const existingSession = await ActiveSession.findOne({
      userId: employeeId,
      date: today,
      isActive: true
    });
    
    if (existingSession) {
      return res.status(400).json({ message: 'Employee already has an active session' });
    }
    
    // Create new session
    const session = new ActiveSession({
      userId: employeeId,
      checkInTime: new Date(),
      date: today,
      isActive: true,
      totalHours: 0,
      hourlyRate: hourlyRate || employee.hourlyRate || 0,
      lastUpdated: new Date()
    });
    
    await session.save();
    
    res.json({
      message: `Work session started for ${employeeName || employee.name}`,
      session: {
        id: session._id,
        userId: session.userId,
        userName: employeeName || employee.name,
        checkInTime: session.checkInTime,
        date: session.date,
        isActive: session.isActive
      }
    });
  } catch (error) {
    console.error('Error starting admin session:', error);
    res.status(500).json({ message: 'Failed to start session', error: error.message });
  }
});

// Admin can stop session for any employee
router.post("/admin-sessions/stop", async (req, res) => {
  try {
    const { employeeId, employeeName, sessionDuration, sessionSalary } = req.body;
    const adminId = req.user.id;
    
    if (!employeeId) {
      return res.status(400).json({ message: 'Employee ID is required' });
    }
    
    // Find active session for employee
    const today = new Date().toISOString().split('T')[0];
    const session = await ActiveSession.findOne({
      userId: employeeId,
      date: today,
      isActive: true
    });
    
    if (!session) {
      return res.status(404).json({ message: 'No active session found for this employee' });
    }
    
    // Use provided duration or calculate from session
    const endTime = new Date();
    const duration = sessionDuration || Math.floor((endTime - session.checkInTime) / 1000);
    const hoursWorked = duration / 3600; // Convert to hours
    const sessionSalaryAmount = sessionSalary || (hoursWorked * (session.hourlyRate || 0));
    
    // Update session
    session.isActive = false;
    session.totalHours = hoursWorked;
    session.lastUpdated = endTime;
    session.forceStopped = true;
    session.forceStoppedBy = 'admin';
    session.forceStoppedAt = endTime;
    
    await session.save();
    
    // Update employee's total hours and salary
    const employee = await User.findById(employeeId);
    if (employee) {
      const hoursWorked = duration / 3600; // Convert seconds to hours
      const hourlyRate = employee.hourlyRate || 0;
      const sessionSalary = hoursWorked * hourlyRate;
      
      // Update or create attendance record for today
      const today = new Date().toISOString().split('T')[0];
      let attendance = await Attendance.findOne({
        userId: employeeId,
        date: today
      });
      
      if (!attendance) {
        // Create new attendance record
        attendance = new Attendance({
          userId: employeeId,
          date: today,
          status: 'present',
          checkInTime: session.checkInTime.toLocaleTimeString(),
          checkOutTime: endTime.toLocaleTimeString(),
          totalHours: hoursWorked,
          dailySalary: sessionSalary,
          sessions: [{
            checkInTime: session.checkInTime.toLocaleTimeString(),
            checkOutTime: endTime.toLocaleTimeString(),
            hoursWorked: hoursWorked,
            isActive: false,
            endedAt: endTime
          }]
        });
      } else {
        // Update existing attendance record
        attendance.totalHours = (attendance.totalHours || 0) + hoursWorked;
        attendance.dailySalary = (attendance.dailySalary || 0) + sessionSalary;
        attendance.checkOutTime = endTime.toLocaleTimeString();
        
        // Add session to sessions array
        attendance.sessions.push({
          checkInTime: session.checkInTime.toLocaleTimeString(),
          checkOutTime: endTime.toLocaleTimeString(),
          hoursWorked: hoursWorked,
          isActive: false,
          endedAt: endTime
        });
      }
      
      await attendance.save();
      
      res.json({
        message: `Work session stopped for ${employeeName || employee.name}`,
        session: {
          id: session._id,
          userId: session.userId,
          userName: employeeName || employee.name,
          checkInTime: session.checkInTime,
          endTime: endTime,
          duration: duration,
          hoursWorked: hoursWorked,
          hourlyRate: session.hourlyRate,
          sessionSalary: sessionSalaryAmount,
          stoppedBy: 'admin'
        },
        attendance: {
          totalHours: attendance.totalHours,
          dailySalary: attendance.dailySalary
        }
      });
    } else {
      res.json({
        message: `Work session stopped for ${employeeName}`,
        session: {
          id: session._id,
          userId: session.userId,
          userName: employeeName,
          checkInTime: session.checkInTime,
          endTime: endTime,
          duration: duration,
          stoppedBy: 'admin'
        }
      });
    }
  } catch (error) {
    console.error('Error stopping admin session:', error);
    res.status(500).json({ message: 'Failed to stop session', error: error.message });
  }
});

router.post("/sessions/force-stop/:sessionId", forceStopSession);

// Clear all dummy sessions (for cleanup)
router.delete("/admin-sessions/clear-dummy", async (req, res) => {
  try {
    const result = await ActiveSession.deleteMany({
      $or: [
        { userName: { $regex: /dummy/i } },
        { userName: { $regex: /test/i } },
        { userName: { $regex: /unknown/i } },
        { userName: { $regex: /employee/i } }
      ]
    });
    
    res.json({
      message: `Cleared ${result.deletedCount} dummy sessions`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error clearing dummy sessions:', error);
    res.status(500).json({ message: 'Failed to clear dummy sessions', error: error.message });
  }
});

// Clear all active sessions (emergency cleanup)
router.delete("/admin-sessions/clear-all", async (req, res) => {
  try {
    const result = await ActiveSession.deleteMany({});
    
    res.json({
      message: `Cleared all ${result.deletedCount} active sessions`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error('Error clearing all sessions:', error);
    res.status(500).json({ message: 'Failed to clear all sessions', error: error.message });
  }
});

// Delete all attendance records for a specific user
router.delete("/attendance/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId || userId === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }
    
    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    
    // Delete all attendance records for this user
    const result = await Attendance.deleteMany({ userId: userId });
    
    console.log(`Admin deleted ${result.deletedCount} attendance records for user: ${user.name} (${userId})`);
    
    res.json({ 
      message: `Deleted ${result.deletedCount} attendance records for user ${user.name}`,
      deletedCount: result.deletedCount
    });
  } catch (error) {
    console.error("Error deleting attendance records for user:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    res.status(500).json({ message: "Failed to delete attendance records", error: error.message });
  }
});

module.exports = router;