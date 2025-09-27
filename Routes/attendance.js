const express = require("express");
const Attendance = require("../Models/Attendance");
const Leave = require("../Models/Leave");
const router = express.Router();
const User = require("../Models/User");
const { startSession, stopSession, getActiveSession } = require("../Controller/sessionController");
const mongoose = require("mongoose");

// Mark attendance with time tracking (admin route)
router.post("/", async (req, res) => {
  try {
    const { userId, status, date, checkInTime, checkOutTime, notes } = req.body;
    
    // Validate required fields
    if (!userId || !status || !date) {
      return res.status(400).json({ 
        message: "Missing required fields: userId, status, and date are required" 
      });
    }

    // Validate status
    const validStatuses = ['present', 'absent', 'leave', 'late'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ 
        message: "Invalid status. Must be one of: present, absent, leave, late" 
      });
    }

    // Check if attendance already exists for this user and date
    const existingAttendance = await Attendance.findOne({ 
      userId, 
      date: new Date(date).toISOString().split('T')[0] 
    });

    if (existingAttendance) {
      return res.status(409).json({ 
        message: "Attendance already marked for this date",
        existingStatus: existingAttendance.status,
        canEdit: true
      });
    }

    // Calculate if late (if check-in time is provided)
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
    const attendance = new Attendance({ 
      userId, 
      status: status.toLowerCase(),
      date: new Date(date).toISOString().split('T')[0],
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      isLate,
      lateMinutes,
      notes: notes || "",
      originalStatus: status.toLowerCase()
    });
    
    await attendance.save();

    res.status(201).json({ 
      message: "Attendance marked successfully",
      attendance: {
        id: attendance._id,
        userId: attendance.userId,
        status: attendance.status,
        date: attendance.date,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        isLate: attendance.isLate,
        lateMinutes: attendance.lateMinutes,
        notes: attendance.notes
      }
    });
  } catch (error) {
    console.error("Error marking attendance:", error);
    res.status(500).json({ 
      message: "Failed to mark attendance",
      error: error.message 
    });
  }
});

// Mark attendance for current user (user route)
router.post("/mark", async (req, res) => {
  try {
    const { status, date, checkInTime, checkOutTime, notes } = req.body;
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    // Validate required fields
    if (!status || !date) {
      return res.status(400).json({ 
        message: "Missing required fields: status and date are required" 
      });
    }

    // Validate status
    const validStatuses = ['present', 'absent', 'leave', 'late'];
    if (!validStatuses.includes(status.toLowerCase())) {
      return res.status(400).json({ 
        message: "Invalid status. Must be one of: present, absent, leave, late" 
      });
    }

    // Check if attendance already exists for this user and date
    const existingAttendance = await Attendance.findOne({ 
      userId, 
      date: new Date(date).toISOString().split('T')[0] 
    });

    if (existingAttendance) {
      // If attendance already exists, update it to present instead of returning error
      if (existingAttendance.status !== 'present') {
        existingAttendance.status = 'present';
        if (checkInTime) {
          existingAttendance.checkInTime = checkInTime;
        }
        existingAttendance.updatedAt = new Date();
        await existingAttendance.save();
        
        return res.json({ 
          message: "Attendance updated to present",
          attendance: {
            id: existingAttendance._id,
            userId: existingAttendance.userId,
            status: existingAttendance.status,
            date: existingAttendance.date,
            checkInTime: existingAttendance.checkInTime,
            updatedAt: existingAttendance.updatedAt
          }
        });
      } else {
        return res.status(409).json({ 
          message: "Attendance already marked as present for this date",
          existingStatus: existingAttendance.status,
          canEdit: true
        });
      }
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
    const attendance = new Attendance({ 
      userId, 
      status: status.toLowerCase(),
      date: new Date(date).toISOString().split('T')[0],
      checkInTime: checkInTime || null,
      checkOutTime: checkOutTime || null,
      isLate,
      lateMinutes,
      notes: notes || "",
      originalStatus: status.toLowerCase(),
      createdBy: "user"
    });
    
    await attendance.save();

    res.status(201).json({ 
      message: "Attendance marked successfully",
      attendance: {
        id: attendance._id,
        userId: attendance.userId,
        status: attendance.status,
        date: attendance.date,
        checkInTime: attendance.checkInTime,
        checkOutTime: attendance.checkOutTime,
        isLate: attendance.isLate,
        lateMinutes: attendance.lateMinutes,
        notes: attendance.notes
      }
    });
  } catch (error) {
    console.error("Error marking attendance:", error);
    res.status(500).json({ 
      message: "Failed to mark attendance",
      error: error.message 
    });
  }
});

// Update attendance with time and salary (when timer stops)
router.put("/update", async (req, res) => {
  try {
    const { date, checkOutTime, totalHours, dailySalary } = req.body;
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    if (!date) {
      return res.status(400).json({ 
        message: "Date is required" 
      });
    }

    // Find existing attendance record for this user and date
    const existingAttendance = await Attendance.findOne({ 
      userId, 
      date: new Date(date).toISOString().split('T')[0] 
    });

    if (!existingAttendance) {
      return res.status(404).json({ 
        message: "No attendance record found for this date" 
      });
    }

    // Update the attendance record with time and salary
    if (checkOutTime) {
      existingAttendance.checkOutTime = checkOutTime;
    }
    if (totalHours !== undefined) {
      existingAttendance.totalHours = totalHours;
    }
    if (dailySalary !== undefined) {
      existingAttendance.dailySalary = dailySalary;
    }
    existingAttendance.updatedAt = new Date();
    
    await existingAttendance.save();

    res.json({ 
      message: "Attendance updated successfully",
      attendance: {
        id: existingAttendance._id,
        userId: existingAttendance.userId,
        status: existingAttendance.status,
        date: existingAttendance.date,
        checkInTime: existingAttendance.checkInTime,
        checkOutTime: existingAttendance.checkOutTime,
        totalHours: existingAttendance.totalHours,
        dailySalary: existingAttendance.dailySalary,
        updatedAt: existingAttendance.updatedAt
      }
    });
  } catch (error) {
    console.error("Error updating attendance:", error);
    res.status(500).json({ 
      message: "Failed to update attendance",
      error: error.message 
    });
  }
});

// Get all attendance records (admin route)
router.get("/all", async (req, res) => {
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
    
    const skip = (page - 1) * limit;
    
    const attendanceRecords = await Attendance.find(query)
      .populate('userId', 'name email role department')
      .sort({ date: -1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    
    const totalRecords = await Attendance.countDocuments(query);
    
    res.json({
      records: attendanceRecords,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRecords / limit),
        totalRecords,
        hasNextPage: page * limit < totalRecords,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error("Error fetching all attendance records:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance records",
      error: error.message 
    });
  }
});

// Get user's own attendance records
router.get("/user", async (req, res) => {
  try {
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    const attendance = await Attendance.find({ userId }).sort({ date: -1 });
    res.json(attendance);
  } catch (error) {
    console.error("Error fetching user attendance:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance records",
      error: error.message 
    });
  }
});

// Get attendance statistics for current user
router.get("/stats", async (req, res) => {
  try {
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }
    
    const attendanceRecords = await Attendance.find({ userId });
    
    const presentDays = attendanceRecords.filter(r => r.status === 'present').length;
    const absentDays = attendanceRecords.filter(r => r.status === 'absent').length;
    const leaveDays = attendanceRecords.filter(r => r.status === 'leave').length;
    const lateDays = attendanceRecords.filter(r => r.status === 'late').length;
    const totalDays = presentDays + absentDays + leaveDays + lateDays;
    
    const stats = {
      presentDays,
      absentDays,
      leaveDays,
      lateDays,
      totalDays,
      attendanceRate: totalDays > 0 ? Math.round(((presentDays + lateDays) / totalDays) * 100) : 0
    };
    
    res.json(stats);
  } catch (error) {
    console.error("Error fetching attendance stats:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance statistics",
      error: error.message 
    });
  }
});

// Edit existing attendance
router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, checkInTime, checkOutTime, notes } = req.body;
    const { id: userId } = req.user || {}; // From auth middleware

    // Find existing attendance
    const existingAttendance = await Attendance.findById(id);
    if (!existingAttendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    // Check if user can edit this record (own record or admin)
    if (existingAttendance.userId.toString() !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({ message: "You can only edit your own attendance records" });
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

    // Calculate if late (if check-in time is provided)
    let isLate = false;
    let lateMinutes = 0;
    
    if (checkInTime && (status === 'present' || existingAttendance.status === 'present')) {
      const [hours, minutes] = checkInTime.split(':').map(Number);
      const checkInMinutes = hours * 60 + minutes;
      const standardTime = 9 * 60; // 9:00 AM in minutes
      
      if (checkInMinutes > standardTime) {
        isLate = true;
        lateMinutes = checkInMinutes - standardTime;
      }
    }

    // Update attendance record
    const updateData = {
      ...(status && { status: status.toLowerCase() }),
      ...(checkInTime && { checkInTime }),
      ...(checkOutTime && { checkOutTime }),
      ...(notes !== undefined && { notes }),
      isLate,
      lateMinutes,
      editedAt: new Date(),
      editedBy: userId
    };

    // Store original status if it's the first edit
    if (!existingAttendance.originalStatus) {
      updateData.originalStatus = existingAttendance.status;
    }

    const updatedAttendance = await Attendance.findByIdAndUpdate(
      id, 
      updateData, 
      { new: true, runValidators: true }
    );

    res.json({ 
      message: "Attendance updated successfully",
      attendance: updatedAttendance
    });
  } catch (error) {
    console.error("Error updating attendance:", error);
    res.status(500).json({ 
      message: "Failed to update attendance",
      error: error.message 
    });
  }
});

// Get user's own leave applications (moved before /:userId route)
router.get("/leave", async (req, res) => {
  try {
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    const leaves = await Leave.find({ userId }).sort({ createdAt: -1 });
    res.json(leaves);
  } catch (error) {
    console.error("Error fetching user leaves:", error);
    res.status(500).json({ 
      message: "Failed to fetch leave applications",
      error: error.message 
    });
  }
});

// Get user attendance records
router.get("/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    const attendance = await Attendance.find({ userId }).sort({ date: -1 });
    res.json(attendance);
  } catch (error) {
    console.error("Error fetching user attendance:", error);
    res.status(500).json({ 
      message: "Failed to fetch attendance records",
      error: error.message 
    });
  }
});

// Get attendance summary with enhanced stats
router.get("/summary/:userId", async (req, res) => {
  const { userId } = req.params;
  const { year, month } = req.query;

  try {
    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid user ID format" });
    }

    if (!year || !month) {
      return res.status(400).json({ message: "Year and Month are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const startDate = new Date(`${year}-${month}-01`)
      .toISOString()
      .slice(0, 10);
    const endDate = new Date(`${year}-${month}-31`).toISOString().slice(0, 10);

    const attendanceRecords = await Attendance.find({
      userId,
      date: { $gte: startDate, $lte: endDate },
    });

    const presentDays = attendanceRecords.filter(
      (record) => record.status === "present"
    ).length;
    const absentDays = attendanceRecords.filter(
      (record) => record.status === "absent"
    ).length;
    const leaveDays = attendanceRecords.filter(
      (record) => record.status === "leave"
    ).length;
    const lateDays = attendanceRecords.filter(
      (record) => record.status === "late"
    ).length;
    const onTimeDays = attendanceRecords.filter(
      (record) => record.status === "present" && !record.isLate
    ).length;

    const totalLateMinutes = attendanceRecords
      .filter(record => record.isLate)
      .reduce((total, record) => total + (record.lateMinutes || 0), 0);

    const summary = {
      userName: user.name,
      userEmail: user.email,
      year: parseInt(year),
      month: parseInt(month),
      presentDays,
      absentDays,
      leaveDays,
      lateDays,
      onTimeDays,
      totalDays: presentDays + absentDays + leaveDays + lateDays,
      totalLateMinutes,
      averageLateMinutes: lateDays > 0 ? Math.round(totalLateMinutes / lateDays) : 0,
      attendanceRate: presentDays + absentDays + leaveDays + lateDays > 0 
        ? Math.round(((presentDays + lateDays) / (presentDays + absentDays + leaveDays + lateDays)) * 100) 
        : 0
    };

    res.json(summary);
  } catch (err) {
    console.error("Server Error:", err);
    res.status(500).json({ message: "Server Error", error: err.message });
  }
});

// Get detailed attendance records
router.get("/details/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const { year, month } = req.query;

    if (!userId || !year || !month) {
      return res
        .status(400)
        .json({ error: "Missing required query parameters" });
    }

    const yearInt = parseInt(year, 10);
    const monthInt = parseInt(month, 10);

    if (isNaN(yearInt) || isNaN(monthInt) || monthInt < 1 || monthInt > 12) {
      return res.status(400).json({ error: "Invalid year or month format" });
    }

    const startDate = `${yearInt}-${String(monthInt).padStart(2, "0")}-01`;
    const endDate = `${yearInt}-${String(monthInt + 1).padStart(2, "0")}-01`;

    const records = await Attendance.find({
      userId,
      date: { $gte: startDate, $lt: endDate },
    }).sort({ date: 1 });

    res.json(records);
  } catch (error) {
    console.error("Server Error Fetching Attendance:", error);
    res.status(500).json({ error: "Failed to fetch attendance records" });
  }
});

// Delete attendance record (admin only or own record)
router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { id: userId } = req.user || {};

    const attendance = await Attendance.findById(id);
    if (!attendance) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    // Check permissions
    if (attendance.userId.toString() !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({ message: "You can only delete your own attendance records" });
    }

    await Attendance.findByIdAndDelete(id);
    res.json({ message: "Attendance record deleted successfully" });
  } catch (error) {
    console.error("Error deleting attendance:", error);
    res.status(500).json({ 
      message: "Failed to delete attendance record",
      error: error.message 
    });
  }
});

// ==================== LEAVE APPLICATION ROUTES ====================

// Apply for leave (user route)
router.post("/leave", async (req, res) => {
  try {
    const { leaveType, startDate, endDate, reason } = req.body;
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    // Validate required fields
    if (!leaveType || !startDate || !endDate || !reason) {
      return res.status(400).json({ 
        message: "Missing required fields: leaveType, startDate, endDate, and reason are required" 
      });
    }

    // Validate leave type
    const validLeaveTypes = ['sick', 'casual', 'annual', 'emergency', 'other'];
    if (!validLeaveTypes.includes(leaveType.toLowerCase())) {
      return res.status(400).json({ 
        message: "Invalid leave type. Must be one of: sick, casual, annual, emergency, other" 
      });
    }

    // Check if dates are valid
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (start < today) {
      return res.status(400).json({ 
        message: "Start date cannot be in the past" 
      });
    }
    
    if (end < start) {
      return res.status(400).json({ 
        message: "End date cannot be before start date" 
      });
    }

    // Check if user already has pending leave for these dates
    const existingLeave = await Leave.findOne({
      userId,
      status: { $in: ['pending', 'approved'] },
      $or: [
        { startDate: { $lte: end, $gte: start } },
        { endDate: { $gte: start, $lte: end } }
      ]
    });

    if (existingLeave) {
      return res.status(409).json({ 
        message: "You already have a leave application for these dates",
        existingLeave
      });
    }

    // Calculate total days
    const diffTime = Math.abs(end - start);
    const totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

    // Create new leave application
    const leave = new Leave({ 
      userId, 
      leaveType: leaveType.toLowerCase(),
      startDate: start,
      endDate: end,
      reason: reason.trim(),
      appliedBy: "user",
      totalDays: totalDays
    });
    
    await leave.save();

    res.status(201).json({ 
      message: "Leave application submitted successfully",
      leave: {
        id: leave._id,
        leaveType: leave.leaveType,
        startDate: leave.startDate,
        endDate: leave.endDate,
        reason: leave.reason,
        status: leave.status,
        totalDays: leave.totalDays
      }
    });
  } catch (error) {
    console.error("Error applying for leave:", error);
    res.status(500).json({ 
      message: "Failed to submit leave application",
      error: error.message 
    });
  }
});


// Cancel leave application (user route)
router.delete("/leave/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id; // From auth middleware
    
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    // Check if leave application exists and belongs to user
    const leave = await Leave.findOne({ _id: id, userId });
    if (!leave) {
      return res.status(404).json({ message: "Leave application not found" });
    }
    
    // Only allow cancellation of pending applications
    if (leave.status !== 'pending') {
      return res.status(400).json({ 
        message: "Only pending leave applications can be cancelled" 
      });
    }
    
    await Leave.findByIdAndDelete(id);
    
    res.json({ message: "Leave application cancelled successfully" });
  } catch (error) {
    console.error("Error cancelling leave application:", error);
    res.status(500).json({ 
      message: "Failed to cancel leave application",
      error: error.message 
    });
  }
});

// ==================== SESSION MANAGEMENT ROUTES ====================
// Start session (check-in) for current user
router.post("/session/start", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    req.body.userId = userId;
    await startSession(req, res);
  } catch (error) {
    console.error("Error in user session start:", error);
    res.status(500).json({ message: "Failed to start session", error: error.message });
  }
});

// Stop session (check-out) for current user
router.post("/session/stop", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    req.body.userId = userId;
    await stopSession(req, res);
  } catch (error) {
    console.error("Error in user session stop:", error);
    res.status(500).json({ message: "Failed to stop session", error: error.message });
  }
});

// Get active session for current user
router.get("/session/active", async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "User not authenticated" });
    }
    
    req.params.userId = userId;
    await getActiveSession(req, res);
  } catch (error) {
    console.error("Error in user active session:", error);
    res.status(500).json({ message: "Failed to get active session", error: error.message });
  }
});

module.exports = router;