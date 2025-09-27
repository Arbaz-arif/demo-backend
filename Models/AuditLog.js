const mongoose = require("mongoose");

// Define audit log schema
const auditLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: ['user_created', 'user_updated', 'user_deleted', 'user_blocked', 'user_unblocked']
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  changes: {
    type: Object,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  },
  ipAddress: {
    type: String
  },
  userAgent: {
    type: String
  }
}, {
  timestamps: true
});

// Index for efficient queries
auditLogSchema.index({ targetUserId: 1, timestamp: -1 });
auditLogSchema.index({ adminId: 1, timestamp: -1 });

module.exports = mongoose.model("AuditLog", auditLogSchema);
