const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    // ✅ Optimized MongoDB connection options
    const options = {
      maxPoolSize: 10,           // Connection pool size
      minPoolSize: 2,            // Min connections to keep
      serverSelectionTimeoutMS: 5000,  // Timeout for server selection
      socketTimeoutMS: 45000,    // Socket timeout
      bufferCommands: false,     // Disable buffering
      autoIndex: process.env.NODE_ENV !== "production", // Disable auto-index in prod
    };

    await mongoose.connect(process.env.MONGO_URI, options);
    console.log("Database Connected");

    // ✅ Handle connection events
    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    mongoose.connection.on("disconnected", () => {
      console.log("MongoDB disconnected. Attempting reconnect...");
    });

  } catch (error) {
    console.error("Database connection failed:", error);
    process.exit(1);
  }
};

module.exports = connectDB;
