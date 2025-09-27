const express = require('express');
const dbConnect = require('./Controller/dbConnect');

const cors = require('cors');
const mongoose = require('mongoose');
const app = express();
const Product = require('./Models/product.model');
const User = require('./Models/User.js');

const productRoute = require('./Routes/product-route.js');
const { verifyAdmin, verifyToken, verifyUserOrAdmin } = require('./middleware/auth.js');

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cors({
    origin: [
      "http://localhost:3000", // local development
      "https://demo-frontend-three-pi.vercel.app", // your deployed frontend
      "https://demo-frontend-o8yzw3o0d-arbazs-projects-f7599764.vercel.app", // previous domain
      "https://*.vercel.app" // Allow any Vercel subdomain
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    credentials: true,
    optionsSuccessStatus: 200
  }));

// Initialize DB connection
dbConnect();

// Routes
app.use("/api/products", productRoute);
app.use("/api/auth", require("./Routes/auth.js"));
app.use("/api/attendance", verifyToken, require("./Routes/attendance.js"));
app.use("/api/admin", verifyAdmin, require("./Routes/admin"));
app.use("/api/holidays", require("./Routes/holidays.js"));
app.use("/api/sessions", verifyToken, require("./Routes/sessions.js"));

// User profile update route (allows users to update their own profile)
app.use("/api/user", verifyUserOrAdmin, require("./Routes/userProfile.js"));

// Connect to MongoDB
//mongoose.connect(process.env.MONGODB_URI || "mongodb+srv://arbazarif4:HUYNNkELy5O5MiH6@backenddb.weji4w9.mongodb.net/?retryWrites=true&w=majority&appName=backendDB")
   // .then(() => {
   //    console.log("Connected to database");
  //  })
  //  .catch(() => {
        //console.log("database not Connected");
//    });

app.get('/', (req, res) => {
    res.send('Attendance Management API is running!');
});

// Debug route for CORS testing
app.get('/ping', (req, res) => {
    res.json({ 
        message: 'pong', 
        timestamp: new Date().toISOString(),
        origin: req.headers.origin || 'no-origin'
    });
});

// (health endpoint removed)

// For Vercel deployment
const PORT = process.env.PORT || 5000;

// Only start server if not in Vercel environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}

// Export for Vercel
module.exports = app; 