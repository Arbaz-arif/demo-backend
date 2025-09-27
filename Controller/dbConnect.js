const mongoose = require('mongoose');

const dbConnect = () => {
    const mongoUri = process.env.DB ||   "mongodb+srv://arbazarif4_db_user:klEOVdkycvfn26lB@cluster0.r9u2shv.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
    
    if (!mongoUri) {
        console.log("Failed to Connect: Missing DB/MONGODB_URI env variable");
        return;
    }
    mongoose.connect(mongoUri);
    
    mongoose.connection.on("connected", () => {
        console.log("Database Connected Successfully");
    });
    
    mongoose.connection.on("error", (error) => {
        console.log("Failed to Connect " + error);
    });
    
    mongoose.connection.on("disconnected", () => {
        console.log("Database Disconnected");
    });
};

module.exports = dbConnect;
