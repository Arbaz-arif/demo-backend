const express = require("express");
const User = require("../Models/User");
const Attendance = require("../Models/Attendance");
const AuditLog = require("../Models/AuditLog");
const mongoose = require("mongoose");
const { verifyUserOrAdmin } = require("../middleware/auth");
const router = express.Router();

// Get current user's profile (without ID parameter)
router.get("/profile", verifyUserOrAdmin, async (req, res) => {
  try {
    console.log('Profile route hit - no ID parameter');
    console.log('User from middleware:', req.user);
    
    const currentUser = req.user;
    
    if (!currentUser) {
      console.log('No current user found');
      return res.status(401).json({ message: "User not authenticated" });
    }

    console.log('Current user ID:', currentUser.id || currentUser._id);

    // Get user details
    const user = await User.findById(currentUser.id || currentUser._id).select('-password');
    if (!user) {
      console.log('User not found in database');
      return res.status(404).json({ message: "User not found" });
    }

    console.log('User found:', user.name, 'Hourly Rate:', user.hourlyRate);

    // Return just the user data
    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      department: user.department || 'Not specified',
      position: user.position || 'Not specified',
      phone: user.phone || 'Not specified',
      address: user.address || 'Not specified',
      hourlyRate: user.hourlyRate || 0,
      blocked: user.blocked || false,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    });
  } catch (error) {
    console.error("Error fetching current user profile:", error);
    res.status(500).json({ message: "Failed to fetch user profile", error: error.message });
  }
});

// Get user profile with working hours and salary calculation
router.get("/profile/:id", async (req, res) => {
  try {
    console.log('Profile route hit with ID:', req.params.id);
    console.log('User from middleware:', req.user);
    
    const { id } = req.params;

    if (!id || id === 'undefined') {
      console.log('Invalid ID provided');
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Invalid ObjectId format:', id);
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // Get user details
    const user = await User.findById(id).select('-password');
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get all attendance records for this user
    const attendanceRecords = await Attendance.find({ userId: id });
    
    // Calculate total working hours and salary
    let totalWorkingHours = 0;
    let totalSalary = 0;
    let totalDaysWorked = 0;
    let presentDays = 0;
    let absentDays = 0;
    let leaveDays = 0;

    attendanceRecords.forEach(record => {
      if (record.totalHours) {
        totalWorkingHours += record.totalHours;
        totalSalary += record.dailySalary || 0;
      }
      
      totalDaysWorked++;
      
      switch (record.status) {
        case 'present':
        case 'late':
          presentDays++;
          break;
        case 'absent':
          absentDays++;
          break;
        case 'leave':
          leaveDays++;
          break;
      }
    });

    // Calculate attendance percentage
    const attendancePercentage = totalDaysWorked > 0 ? Math.round((presentDays / totalDaysWorked) * 100) : 0;

    // Get current month stats
    const currentDate = new Date();
    const currentMonth = currentDate.getMonth() + 1;
    const currentYear = currentDate.getFullYear();
    
    const currentMonthRecords = attendanceRecords.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate.getMonth() + 1 === currentMonth && recordDate.getFullYear() === currentYear;
    });

    let currentMonthHours = 0;
    let currentMonthSalary = 0;
    let currentMonthDays = 0;

    currentMonthRecords.forEach(record => {
      if (record.totalHours) {
        currentMonthHours += record.totalHours;
        currentMonthSalary += record.dailySalary || 0;
      }
      currentMonthDays++;
    });

    // Get recent sessions (last 10)
    const recentSessions = attendanceRecords
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 10)
      .map(record => ({
        date: record.date,
        status: record.status,
        checkInTime: record.checkInTime,
        checkOutTime: record.checkOutTime,
        totalHours: record.totalHours || 0,
        dailySalary: record.dailySalary || 0,
        sessions: record.sessions || []
      }));

    const profileData = {
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        department: user.department || 'Not specified',
        position: user.position || 'Not specified',
        phone: user.phone || 'Not specified',
        address: user.address || 'Not specified',
        hourlyRate: user.hourlyRate || 0,
        blocked: user.blocked || false,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
      stats: {
        totalWorkingHours: Math.round(totalWorkingHours * 100) / 100,
        totalSalary: Math.round(totalSalary * 100) / 100,
        totalDaysWorked,
        presentDays,
        absentDays,
        leaveDays,
        attendancePercentage,
        currentMonthHours: Math.round(currentMonthHours * 100) / 100,
        currentMonthSalary: Math.round(currentMonthSalary * 100) / 100,
        currentMonthDays,
        averageHoursPerDay: totalDaysWorked > 0 ? Math.round((totalWorkingHours / totalDaysWorked) * 100) / 100 : 0
      },
      recentSessions
    };

    console.log(`Profile data fetched for ${user.name}: ${totalWorkingHours} hours, $${totalSalary} salary`);
    res.json(profileData);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    res.status(500).json({ message: "Failed to fetch user profile", error: error.message });
  }
});

// Update user profile (allows users to update their own profile)
router.put("/profile/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, currentPassword, newPassword, department, position, phone, address } = req.body;

    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    // Get the current user from the token (set by verifyUserOrAdmin middleware)
    const currentUser = req.user;

    // Check if user exists
    const userToUpdate = await User.findById(id);
    if (!userToUpdate) {
      return res.status(404).json({ message: "User not found" });
    }

    // Ensure the current user is either an admin or is updating their own profile
    const isAdmin = currentUser && currentUser.role === 'admin';
    const isOwnProfile = currentUser && currentUser._id.toString() === id;

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

    // Check if email already exists for another user
    const existingUser = await User.findOne({ email: email.toLowerCase(), _id: { $ne: id } });
    if (existingUser) {
      return res.status(400).json({ message: "Email already exists for another user" });
    }

    // Build update data - regular users can only update these fields
    const updateData = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      department: department ? department.trim() : '',
      position: position ? position.trim() : '',
      phone: phone ? phone.trim() : '',
      address: address ? address.trim() : ''
    };

    // Handle password update if provided
    if (newPassword && newPassword.trim() !== '') {
      if (!currentPassword || currentPassword.trim() === '') {
        return res.status(400).json({ message: "Current password is required to change password" });
      }
      
      // Verify current password
      const isCurrentPasswordValid = await userToUpdate.comparePassword(currentPassword);
      if (!isCurrentPasswordValid) {
        return res.status(400).json({ message: "Current password is incorrect" });
      }
      
      updateData.password = newPassword.trim();
    }

    // Admins can update additional fields like role, blocked, hourlyRate
    if (isAdmin) {
      const { role, blocked, hourlyRate } = req.body;
      if (role !== undefined) {
        updateData.role = role;
      }
      if (blocked !== undefined) {
        updateData.blocked = blocked;
      }
      if (hourlyRate !== undefined) {
        updateData.hourlyRate = parseFloat(hourlyRate);
      }
    }

    const updatedUser = await User.findByIdAndUpdate(
      id,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found after update" });
    }

    console.log(`User profile updated: ${updatedUser.name} (${updatedUser._id}) by ${currentUser.role}`);
    res.json({ 
      success: true,
      message: "Profile updated successfully", 
      user: updatedUser 
    });
  } catch (error) {
    console.error("Error updating user profile:", error);
    if (error.name === 'CastError') {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    if (error.name === 'ValidationError') {
      return res.status(400).json({ message: "Validation error", error: error.message });
    }
    res.status(500).json({ message: "Failed to update user profile", error: error.message });
  }
});

// Get recent changes for a user
router.get("/profile/:id/changes", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || id === 'undefined') {
      return res.status(400).json({ message: "Valid user ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    // Get recent changes for this user (last 7 days)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const recentChanges = await AuditLog.find({
      targetUserId: id,
      timestamp: { $gte: sevenDaysAgo }
    })
    .populate('adminId', 'name email')
    .sort({ timestamp: -1 })
    .limit(10);

    res.json({
      changes: recentChanges,
      totalChanges: recentChanges.length
    });
  } catch (error) {
    console.error("Error fetching user changes:", error);
    res.status(500).json({ message: "Failed to fetch user changes", error: error.message });
  }
});

module.exports = router;