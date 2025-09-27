const mongoose = require("mongoose");

const leaveSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true
  },
  leaveType: {
    type: String,
    required: true,
    enum: ["sick", "casual", "annual", "emergency", "other"]
  },
  startDate: {
    type: Date,
    required: true
  },
  endDate: {
    type: Date,
    required: true
  },
  reason: {
    type: String,
    required: true,
    trim: true
  },
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "approved", "rejected", "on-hold"]
  },
  adminNotes: {
    type: String,
    default: "",
    trim: true
  },
  appliedBy: {
    type: String,
    required: true
  },
  reviewedBy: {
    type: String,
    default: null
  },
  reviewedAt: {
    type: Date,
    default: null
  },
  totalDays: {
    type: Number,
    required: true
  }
}, {
  timestamps: true
});

// Calculate total days before saving
leaveSchema.pre('save', function(next) {
  if (this.startDate && this.endDate) {
    const start = new Date(this.startDate);
    const end = new Date(this.endDate);
    const diffTime = Math.abs(end - start);
    this.totalDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates
  }
  next();
});

module.exports = mongoose.model("Leave", leaveSchema);
