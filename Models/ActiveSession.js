const mongoose = require("mongoose");

const activeSessionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  checkInTime: {
    type: Date,
    required: true
  },
  date: {
    type: String, // YYYY-MM-DD format
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  totalHours: {
    type: Number,
    default: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  forceStopped: {
    type: Boolean,
    default: false
  },
  forceStoppedBy: {
    type: String,
    default: null
  },
  forceStoppedAt: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Add indexes for better performance
activeSessionSchema.index({ userId: 1, date: 1 });
activeSessionSchema.index({ isActive: 1 });

module.exports = mongoose.model("ActiveSession", activeSessionSchema);
