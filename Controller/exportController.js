const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const XLSX = require('xlsx');
const User = require('../Models/User');
const Attendance = require('../Models/Attendance');
const path = require('path');
const fs = require('fs');

// Helper function to ensure directory exists
const ensureDirectoryExists = (filePath) => {
  const dirname = path.dirname(filePath);
  if (!fs.existsSync(dirname)) {
    fs.mkdirSync(dirname, { recursive: true });
  }
};

// Export Users Data
const exportUsers = async (req, res) => {
  try {
    const { format = 'csv', search, role, department } = req.query;
    
    // Build query for filtering users
    let query = {};
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { department: { $regex: search, $options: 'i' } }
      ];
    }
    
    if (role && role !== 'all') {
      query.role = role;
    }
    
    if (department && department !== 'all') {
      query.department = department;
    }
    
    // Fetch users
    const users = await User.find(query)
      .select('-password')
      .sort({ createdAt: -1 });
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found matching the criteria' });
    }
    
    // Prepare data for export
    const exportData = users.map(user => ({
      'Name': user.name || '',
      'Email': user.email || '',
      'Role': user.role || '',
      'Department': user.department || '',
      'Position': user.position || '',
      'Phone': user.phone || '',
      'Address': user.address || '',
      'Hourly Rate': user.hourlyRate || 0,
      'Status': user.blocked ? 'Blocked' : 'Active',
      'Created At': new Date(user.createdAt).toLocaleDateString(),
      'Last Updated': new Date(user.updatedAt).toLocaleDateString()
    }));
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `users_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Name', title: 'Name' },
          { id: 'Email', title: 'Email' },
          { id: 'Role', title: 'Role' },
          { id: 'Department', title: 'Department' },
          { id: 'Position', title: 'Position' },
          { id: 'Phone', title: 'Phone' },
          { id: 'Address', title: 'Address' },
          { id: 'Hourly Rate', title: 'Hourly Rate' },
          { id: 'Status', title: 'Status' },
          { id: 'Created At', title: 'Created At' },
          { id: 'Last Updated', title: 'Last Updated' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(exportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported ${users.length} users in ${format} format`);
  } catch (error) {
    console.error('Error exporting users:', error);
    res.status(500).json({ message: 'Failed to export users', error: error.message });
  }
};

// Export Attendance Data
const exportAttendance = async (req, res) => {
  try {
    const { 
      format = 'csv', 
      startDate, 
      endDate, 
      userId, 
      status,
      department 
    } = req.query;
    
    // Build query for filtering attendance
    let query = {};
    
    // Date range filter
    if (startDate && endDate) {
      query.date = { $gte: startDate, $lte: endDate };
    } else if (startDate) {
      query.date = { $gte: startDate };
    } else if (endDate) {
      query.date = { $lte: endDate };
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
    
    // Fetch attendance records with user population
    const attendanceRecords = await Attendance.find(query)
      .populate({
        path: 'userId',
        select: 'name email role department position hourlyRate',
        match: userQuery
      })
      .sort({ date: -1, createdAt: -1 });
    
    // Filter out records where user doesn't match department filter
    const filteredRecords = attendanceRecords.filter(record => record.userId);
    
    if (filteredRecords.length === 0) {
      return res.status(404).json({ message: 'No attendance records found matching the criteria' });
    }
    
    // Prepare data for export
    const exportData = filteredRecords.map(record => ({
      'Date': new Date(record.date).toLocaleDateString(),
      'Employee Name': record.userId?.name || 'Unknown',
      'Email': record.userId?.email || '',
      'Department': record.userId?.department || '',
      'Position': record.userId?.position || '',
      'Status': record.status || '',
      'Check In Time': record.checkInTime || '',
      'Check Out Time': record.checkOutTime || '',
      'Total Hours': record.totalHours || 0,
      'Hourly Rate': record.hourlyRate || record.userId?.hourlyRate || 0,
      'Daily Salary': record.dailySalary || 0,
      'Is Late': record.isLate ? 'Yes' : 'No',
      'Late Minutes': record.lateMinutes || 0,
      'Notes': record.notes || '',
      'Created By': record.createdBy || '',
      'Created At': new Date(record.createdAt).toLocaleString(),
      'Edited By': record.editedBy || '',
      'Edited At': record.editedAt ? new Date(record.editedAt).toLocaleString() : ''
    }));
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `attendance_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Date', title: 'Date' },
          { id: 'Employee Name', title: 'Employee Name' },
          { id: 'Email', title: 'Email' },
          { id: 'Department', title: 'Department' },
          { id: 'Position', title: 'Position' },
          { id: 'Status', title: 'Status' },
          { id: 'Check In Time', title: 'Check In Time' },
          { id: 'Check Out Time', title: 'Check Out Time' },
          { id: 'Total Hours', title: 'Total Hours' },
          { id: 'Hourly Rate', title: 'Hourly Rate' },
          { id: 'Daily Salary', title: 'Daily Salary' },
          { id: 'Is Late', title: 'Is Late' },
          { id: 'Late Minutes', title: 'Late Minutes' },
          { id: 'Notes', title: 'Notes' },
          { id: 'Created By', title: 'Created By' },
          { id: 'Created At', title: 'Created At' },
          { id: 'Edited By', title: 'Edited By' },
          { id: 'Edited At', title: 'Edited At' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(exportData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported ${filteredRecords.length} attendance records in ${format} format`);
  } catch (error) {
    console.error('Error exporting attendance:', error);
    res.status(500).json({ message: 'Failed to export attendance', error: error.message });
  }
};

// Export Salary Data
const exportSalary = async (req, res) => {
  try {
    const { 
      format = 'csv', 
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
    let userQuery = { role: 'user', hourlyRate: { $gt: 0 } };
    if (userId && userId !== 'all') {
      userQuery._id = userId;
    }
    if (department && department !== 'all') {
      userQuery.department = department;
    }
    
    // Get users with hourly rates
    const users = await User.find(userQuery).select('name email hourlyRate department position');
    
    if (users.length === 0) {
      return res.status(404).json({ message: 'No users found with hourly rates matching the criteria' });
    }
    
    const salaryData = [];
    
    for (const user of users) {
      // Get attendance records for the user with automatic salary calculations
      const attendanceRecords = await Attendance.find({
        userId: user._id,
        ...dateFilter,
        status: { $in: ['present', 'late'] }
      }).sort({ date: 1 });
      
      // Calculate salary summary
      let totalHours = 0;
      let totalSalary = 0;
      let totalDays = 0;
      const dailyDetails = [];
      
      for (const record of attendanceRecords) {
        const hoursWorked = record.totalHours || 0;
        const dailySalary = record.dailySalary || 0;
        
        if (hoursWorked > 0) {
          totalHours += hoursWorked;
          totalSalary += dailySalary;
          totalDays++;
          
          dailyDetails.push({
            'Date': new Date(record.date).toLocaleDateString(),
            'Employee Name': user.name,
            'Email': user.email,
            'Department': user.department || '',
            'Position': user.position || '',
            'Status': record.status,
            'Check In': record.checkInTime || '',
            'Check Out': record.checkOutTime || '',
            'Hours Worked': Math.round(hoursWorked * 100) / 100,
            'Hourly Rate': record.hourlyRate || user.hourlyRate,
            'Daily Salary': Math.round(dailySalary * 100) / 100
          });
        }
      }
      
      // Add summary row for each user
      if (totalDays > 0) {
        salaryData.push({
          'Date': 'SUMMARY',
          'Employee Name': user.name,
          'Email': user.email,
          'Department': user.department || '',
          'Position': user.position || '',
          'Status': 'SUMMARY',
          'Check In': '',
          'Check Out': '',
          'Hours Worked': Math.round(totalHours * 100) / 100,
          'Hourly Rate': user.hourlyRate,
          'Daily Salary': Math.round(totalSalary * 100) / 100
        });
        
        // Add daily details
        salaryData.push(...dailyDetails);
        
        // Add separator row
        salaryData.push({
          'Date': '',
          'Employee Name': '',
          'Email': '',
          'Department': '',
          'Position': '',
          'Status': '',
          'Check In': '',
          'Check Out': '',
          'Hours Worked': '',
          'Hourly Rate': '',
          'Daily Salary': ''
        });
      }
    }
    
    if (salaryData.length === 0) {
      return res.status(404).json({ message: 'No salary data found matching the criteria' });
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const filename = `salary_export_${timestamp}`;
    
    if (format.toLowerCase() === 'excel' || format.toLowerCase() === 'xlsx') {
      // Export as Excel
      const worksheet = XLSX.utils.json_to_sheet(salaryData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Salary');
      
      const excelBuffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.xlsx"`);
      res.send(excelBuffer);
    } else {
      // Export as CSV
      const csvWriter = createCsvWriter({
        path: path.join(__dirname, `../exports/${filename}.csv`),
        header: [
          { id: 'Date', title: 'Date' },
          { id: 'Employee Name', title: 'Employee Name' },
          { id: 'Email', title: 'Email' },
          { id: 'Department', title: 'Department' },
          { id: 'Position', title: 'Position' },
          { id: 'Status', title: 'Status' },
          { id: 'Check In', title: 'Check In' },
          { id: 'Check Out', title: 'Check Out' },
          { id: 'Hours Worked', title: 'Hours Worked' },
          { id: 'Hourly Rate', title: 'Hourly Rate' },
          { id: 'Daily Salary', title: 'Daily Salary' }
        ]
      });
      
      ensureDirectoryExists(path.join(__dirname, '../exports/'));
      await csvWriter.writeRecords(salaryData);
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.download(path.join(__dirname, `../exports/${filename}.csv`));
    }
    
    console.log(`Exported salary data for ${users.length} users in ${format} format`);
  } catch (error) {
    console.error('Error exporting salary:', error);
    res.status(500).json({ message: 'Failed to export salary', error: error.message });
  }
};

// Get export options (users list, departments, etc.)
const getExportOptions = async (req, res) => {
  try {
    // Get all users for selection
    const users = await User.find({ role: 'user' })
      .select('name email department')
      .sort({ name: 1 });
    
    // Get unique departments
    const departments = await User.distinct('department');
    const filteredDepartments = departments.filter(dept => dept && dept.trim() !== '');
    
    // Get unique roles
    const roles = await User.distinct('role');
    
    res.json({
      users: users.map(user => ({
        id: user._id,
        name: user.name,
        email: user.email,
        department: user.department
      })),
      departments: filteredDepartments,
      roles: roles,
      statuses: ['present', 'absent', 'leave', 'late']
    });
  } catch (error) {
    console.error('Error getting export options:', error);
    res.status(500).json({ message: 'Failed to get export options', error: error.message });
  }
};

module.exports = {
  exportUsers,
  exportAttendance,
  exportSalary,
  getExportOptions
};
