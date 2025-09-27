const mongoose = require("mongoose");

// Define holiday schema
const holidaySchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  date: {
    type: String,
    required: true,
    validate: {
      validator: function(v) {
        return /^\d{4}-\d{2}-\d{2}$/.test(v);
      },
      message: 'Date must be in YYYY-MM-DD format'
    }
  },
  type: {
    type: String,
    enum: ['national', 'religious', 'company', 'other'],
    default: 'national'
  },
  description: {
    type: String,
    trim: true
  },
  isRecurring: {
    type: Boolean,
    default: false
  },
  createdBy: {
    type: String,
    default: 'Admin'
  }
}, {
  timestamps: true // Automatically adds createdAt & updatedAt
});

// Create index on date for faster queries
holidaySchema.index({ date: 1 });

// Export the model
module.exports = mongoose.model("Holiday", holidaySchema);
