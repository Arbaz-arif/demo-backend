const mongoose = require('mongoose');

const dbConnect = () => {
    const mongoUri = process.env.DB ||   "mongodb+srv://arbazarif4:HUYNNkELy5O5MiH6@backenddb.weji4w9.mongodb.net/Crud-Api?retryWrites=true&w=majority&appName=backendDB";
    
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
