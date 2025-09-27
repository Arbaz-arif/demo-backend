
const User = require('../Models/User');

async function handleUserSignup(req, res) {
    try {
        const { name, email, password } = req.body;
        
        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: "User already exists" });
        }
        
        await User.create({
            name,
            email,
            password,
        });
        
        return res.status(201).json({ message: "User created successfully" });
    } catch (error) {
        return res.status(500).json({ message: error.message });
    }
}

module.exports = {
    handleUserSignup
};