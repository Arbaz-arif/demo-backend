const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true },
  status: {
    type: String,
    enum: ["present", "absent", "leave", "late"],
    default: "present",
  },
  // Multiple check-in/check-out sessions
  sessions: [{
    checkInTime: { type: String, required: true }, // Format: "HH:MM"
    checkOutTime: { type: String, default: null }, // Format: "HH:MM"
    sessionHours: { type: Number, default: 0 }, // Hours for this session
    sessionSalary: { type: Number, default: 0 }, // Salary for this session
    isActive: { type: Boolean, default: true }, // Whether this session is currently active
    createdAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null }
  }],
  // Legacy fields for backward compatibility
  checkInTime: { type: String, default: null }, // First check-in of the day
  checkOutTime: { type: String, default: null }, // Last check-out of the day
  totalHours: { type: Number, default: 0 }, // Total hours worked (in decimal format)
  hourlyRate: { type: Number, default: 0 }, // Hourly rate at time of attendance
  dailySalary: { type: Number, default: 0 }, // Automatically calculated daily salary
  isLate: { type: Boolean, default: false },
  lateMinutes: { type: Number, default: 0 }, // Minutes late
  notes: { type: String, default: "" }, // User notes
  createdBy: { type: String, default: "admin" }, // Who created the record
  createdAt: { type: Date, default: Date.now() }, // When record was created
  editedAt: { type: Date, default: null }, // When record was last edited
  editedBy: { type: String, default: null }, // Who last edited the record
  originalStatus: { type: String, default: null }, // Track original status for audit
  isActive: { type: Boolean, default: false }, // Whether user is currently checked in
  forceStopped: { type: Boolean, default: false }, // Whether session was force stopped by admin
  forceStoppedBy: { type: String, default: null }, // Admin who force stopped
  forceStoppedAt: { type: Date, default: null } // When it was force stopped
}, {
  timestamps: true
});

// Index for efficient queries
AttendanceSchema.index({ userId: 1, date: 1 }, { unique: true });

// Function to calculate hours worked from check-in and check-out times
function calculateHoursWorked(checkInTime, checkOutTime) {
  if (!checkInTime || !checkOutTime) {
    return 0;
  }
  
  try {
    const [checkInHour, checkInMin] = checkInTime.split(':').map(Number);
    const [checkOutHour, checkOutMin] = checkOutTime.split(':').map(Number);
    
    const checkInMinutes = checkInHour * 60 + checkInMin;
    const checkOutMinutes = checkOutHour * 60 + checkOutMin;
    
    // Handle case where check-out is next day
    let totalMinutes = checkOutMinutes - checkInMinutes;
    if (totalMinutes < 0) {
      totalMinutes += 24 * 60; // Add 24 hours
    }
    
    return Math.round((totalMinutes / 60) * 10000) / 10000; // Round to 4 decimal places for more precision
  } catch (error) {
    console.error('Error calculating hours worked:', error);
    return 0;
  }
}

// Function to calculate daily salary
function calculateDailySalary(hoursWorked, hourlyRate, status) {
  // Only calculate salary for present and late status
  if (status === 'present' || status === 'late') {
    return Math.round((hoursWorked * hourlyRate) * 10000) / 10000; // Round to 4 decimal places for more precision
  }
  return 0; // No salary for absent or leave
}

// Pre-save middleware to calculate salary automatically
AttendanceSchema.pre('save', async function(next) {
  try {
    // Get user's current hourly rate
    const User = mongoose.model('User');
    const user = await User.findById(this.userId);
    
    if (user && user.hourlyRate > 0) {
      this.hourlyRate = user.hourlyRate;
      
      // Calculate total hours and salary from all sessions
      let totalHours = 0;
      let totalSalary = 0;
      
      // Process each session
      for (let session of this.sessions) {
        if (session.checkOutTime) {
          // Calculate hours for completed session
          session.sessionHours = calculateHoursWorked(session.checkInTime, session.checkOutTime);
          session.sessionSalary = calculateDailySalary(session.sessionHours, this.hourlyRate, this.status);
          session.isActive = false;
          session.endedAt = new Date();
        } else {
          // Active session - calculate current hours
          const currentTime = new Date().toTimeString().split(' ')[0].substring(0, 5);
          session.sessionHours = calculateHoursWorked(session.checkInTime, currentTime);
          session.sessionSalary = calculateDailySalary(session.sessionHours, this.hourlyRate, this.status);
          session.isActive = true;
        }
        
        totalHours += session.sessionHours;
        totalSalary += session.sessionSalary;
      }
      
      // Update totals
      this.totalHours = Math.round(totalHours * 10000) / 10000; // More precise calculation
      this.dailySalary = Math.round(totalSalary * 10000) / 10000; // More precise calculation
      
      // Update legacy fields for backward compatibility
      if (this.sessions.length > 0) {
        this.checkInTime = this.sessions[0].checkInTime; // First check-in
        const lastSession = this.sessions[this.sessions.length - 1];
        this.checkOutTime = lastSession.checkOutTime || null; // Last check-out
        this.isActive = this.sessions.some(s => s.isActive);
      }
    } else {
      this.hourlyRate = 0;
      this.totalHours = 0;
      this.dailySalary = 0;
      this.isActive = false;
    }
    
    next();
  } catch (error) {
    console.error('Error in attendance pre-save middleware:', error);
    next(error);
  }
});

// Pre-update middleware to recalculate salary when attendance is updated
AttendanceSchema.pre(['updateOne', 'findOneAndUpdate'], async function(next) {
  try {
    const update = this.getUpdate();
    
    // Only recalculate if relevant fields are being updated
    if (update.checkInTime || update.checkOutTime || update.status || update.hourlyRate) {
      const User = mongoose.model('User');
      const attendance = await this.model.findOne(this.getQuery());
      
      if (attendance) {
        const user = await User.findById(attendance.userId);
        
        if (user && user.hourlyRate > 0) {
          const newCheckInTime = update.checkInTime || attendance.checkInTime;
          const newCheckOutTime = update.checkOutTime || attendance.checkOutTime;
          const newStatus = update.status || attendance.status;
          
          const totalHours = calculateHoursWorked(newCheckInTime, newCheckOutTime);
          const dailySalary = calculateDailySalary(totalHours, user.hourlyRate, newStatus);
          
          update.hourlyRate = user.hourlyRate;
          update.totalHours = totalHours;
          update.dailySalary = dailySalary;
        }
      }
    }
    
    next();
  } catch (error) {
    console.error('Error in attendance pre-update middleware:', error);
    next(error);
  }
});

module.exports = mongoose.model("Attendance", AttendanceSchema);