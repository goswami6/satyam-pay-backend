const User = require("../models/user.model");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ================= REGISTER =================
exports.register = async (req, res) => {
  try {
    const {
      fullName,
      email,
      phone,
      password,
    } = req.body;

    // 🔹 Basic validation
    if (!fullName || !email || !phone || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // 🔹 Check duplicate email
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(400).json({
        message: "User with this email already exists",
      });
    }

    // 🔹 Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔹 Create user
    const user = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      role: "user", // default role
    });

    // 🔹 Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    res.status(201).json({
      message: "Registration Successful",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        balance: user.balance,
      },
    });
  } catch (error) {
    console.error("Register Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= LOGIN =================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 🔹 Validate input
    if (!email || !password) {
      return res.status(400).json({ message: "Email and Password required" });
    }

    // 🔹 Find user by email
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔹 Check account status
    if (user.status === "Suspended") {
      return res.status(403).json({ message: "Account is suspended. Contact support." });
    }

    // 🔹 Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔹 Generate JWT
    const token = jwt.sign(
      { id: user._id, role: user.role, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    // 🔹 Prepare response based on role
    const responseData = {
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      role: user.role,
    };

    // 🔹 Role-based response data
    if (user.role === "admin") {
      responseData.adminAccess = true;
      responseData.permissions = ["all"]; // Admin gets all permissions
    } else if (user.role === "user") {
      responseData.balance = user.balance;
      responseData.companyName = user.companyName;
      responseData.companyType = user.companyType;
    }

    res.status(200).json({
      message: "Login successful",
      token,
      user: responseData,
      role: user.role,
    });
  } catch (error) {
    console.error("Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

// ================= ADMIN LOGIN =================
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 🔹 Validate input
    if (!email || !password) {
      return res.status(400).json({ message: "Email and Password required" });
    }

    // 🔹 Find user and verify they are admin
    const user = await User.findOne({ email, role: "admin" });

    if (!user) {
      return res.status(401).json({ message: "Admin account not found or invalid credentials" });
    }

    // 🔹 Check account status
    if (user.status === "Suspended") {
      return res.status(403).json({ message: "Admin account is suspended" });
    }

    // 🔹 Compare password
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    // 🔹 Generate JWT with extended expiry for admin
    const token = jwt.sign(
      { id: user._id, role: user.role, isAdmin: true, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "7d" } // Longer expiry for admin
    );

    res.status(200).json({
      message: "Admin login successful",
      token,
      user: {
        _id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        status: user.status,
        adminAccess: true,
      },
    });
  } catch (error) {
    console.error("Admin Login Error:", error);
    res.status(500).json({ message: "Server error" });
  }
};
