const express = require("express");
const Holiday = require("../Models/Holiday");
const router = express.Router();

// Get holidays (public route - accessible by both users and admins)
router.get("/", async (req, res) => {
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

module.exports = router;
