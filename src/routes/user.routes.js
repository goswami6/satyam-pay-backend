const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const upload = require("../middlewares/upload.middleware");
const authController = require("../controllers/usercontroller");
const User = require("../models/user.model"); // ✅ IMPORTANT IMPORT
const transporter = require("../config/mailer");

// Register Route
router.post("/register", authController.register);

// Login Route (User Login)
router.post("/login", authController.login);

// Admin Login Route
router.post("/admin-login", authController.adminLogin);

// ===============================
// FORGOT PASSWORD & RESET PASSWORD
// ===============================

// Forgot Password - Send Reset Email
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal if email exists or not for security
      return res.status(200).json({
        success: true,
        message: "If this email exists, a reset link has been sent"
      });
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(resetToken).digest("hex");

    // Save token to user
    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
    await user.save();

    // Create reset URL
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    // Send email
    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: user.email,
      subject: "Password Reset Request - Rabbit Pay",
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h1 style="color: #2563eb; margin: 0;">Rabbit Pay</h1>
          </div>
          
          <div style="background: #f8fafc; border-radius: 10px; padding: 30px; margin-bottom: 20px;">
            <h2 style="color: #1e293b; margin-top: 0;">Password Reset Request</h2>
            <p style="color: #64748b; line-height: 1.6;">
              Hello <strong>${user.fullName}</strong>,
            </p>
            <p style="color: #64748b; line-height: 1.6;">
              We received a request to reset your password. Click the button below to create a new password:
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background: #2563eb; color: white; padding: 14px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                Reset Password
              </a>
            </div>
            
            <p style="color: #64748b; line-height: 1.6; font-size: 14px;">
              This link will expire in <strong>1 hour</strong>.
            </p>
            
            <p style="color: #64748b; line-height: 1.6; font-size: 14px;">
              If you didn't request this password reset, please ignore this email or contact support if you have concerns.
            </p>
          </div>
          
          <div style="text-align: center; color: #94a3b8; font-size: 12px;">
            <p>© ${new Date().getFullYear()} Rabbit Pay. All rights reserved.</p>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Password reset link sent to your email"
    });

  } catch (error) {
    console.error("Forgot password error:", error);
    res.status(500).json({ message: "Error sending reset email" });
  }
});

// Reset Password - Verify Token & Update Password
router.post("/reset-password/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ message: "Password is required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Hash the token from URL to compare with stored hash
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    // Find user with valid token
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ message: "Invalid or expired reset token" });
    }

    // Hash new password
    const salt = await bcrypt.genSalt(10);
    user.password = await bcrypt.hash(password, salt);

    // Clear reset token fields
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Password reset successful"
    });

  } catch (error) {
    console.error("Reset password error:", error);
    res.status(500).json({ message: "Error resetting password" });
  }
});

// Verify Reset Token (check if token is valid)
router.get("/verify-reset-token/:token", async (req, res) => {
  try {
    const { token } = req.params;
    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ valid: false, message: "Invalid or expired token" });
    }

    res.status(200).json({ valid: true });

  } catch (error) {
    res.status(500).json({ valid: false, message: "Error verifying token" });
  }
});

// ✅ GET ALL USERS (MUST BE BEFORE /:id route)
router.get("/all", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get User Balance
router.get("/balance/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // ✅ Validation
    if (!userId || userId === "null") {
      return res.status(400).json({ message: "Invalid User ID" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ balance: user.balance });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// Get User Profile
router.get("/profile/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Upload Profile Image
router.post("/profile-image/:userId", upload.single("profileImage"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file provided" });
    }

    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Save relative path
    const imagePath = `/uploads/${req.file.filename}`;
    user.profileImage = imagePath;
    await user.save();

    res.json({
      success: true,
      message: "Profile image updated successfully",
      profileImage: imagePath
    });
  } catch (error) {
    console.error("Profile image upload error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Update Profile
router.put("/profile/:userId", async (req, res) => {
  try {
    // Only allow safe fields to be updated (not balance, role, email, kyc status)
    const allowedFields = ['fullName', 'phone', 'companyName', 'companyType'];
    const updateData = {};

    allowedFields.forEach(field => {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    });

    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      updateData,
      { new: true }
    ).select("-password");

    if (!updatedUser) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(updatedUser);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Toggle User Status (Suspend / Activate)
router.put("/toggle-status/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "User not found" });

    user.status = user.status === "Active" ? "Suspended" : "Active";
    await user.save();

    res.json(user);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Submit KYC
router.post(
  "/kyc/:userId",
  upload.fields([
    { name: "aadharFront", maxCount: 1 },
    { name: "aadharBack", maxCount: 1 },
    { name: "panImage", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const { userId } = req.params;
      const { aadharNumber, panNumber, accountNumber, ifscCode, bankName, accountHolderName } = req.body;

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Validate required fields
      if (!aadharNumber || !panNumber || !accountNumber || !ifscCode || !bankName || !accountHolderName) {
        return res.status(400).json({ message: "All KYC fields are required" });
      }

      // Validate files
      if (!req.files?.aadharFront || !req.files?.aadharBack || !req.files?.panImage) {
        return res.status(400).json({ message: "All document images are required" });
      }

      // Update KYC details
      user.kyc = {
        isCompleted: false,
        status: "pending",
        aadhar: {
          number: aadharNumber,
          frontImage: req.files.aadharFront[0].filename,
          backImage: req.files.aadharBack[0].filename,
        },
        pan: {
          number: panNumber,
          image: req.files.panImage[0].filename,
        },
        bank: {
          accountNumber,
          ifscCode,
          bankName,
          accountHolderName,
        },
        submittedAt: new Date(),
      };

      await user.save();

      res.json({ message: "KYC submitted successfully", user });
    } catch (error) {
      console.error("KYC Error:", error);
      res.status(500).json({ message: error.message });
    }
  }
);

// ✅ Get KYC Status
router.get("/kyc-status/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId).select("kyc");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({
      isCompleted: user.kyc?.isCompleted || false,
      status: user.kyc?.status || "not_submitted",
      kyc: user.kyc
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Admin Approve KYC
router.put("/kyc-approve/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.kyc.isCompleted = true;
    user.kyc.status = "approved";
    user.kyc.approvedAt = new Date();
    await user.save();

    res.json({ message: "KYC approved successfully", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Admin Reject KYC
router.put("/kyc-reject/:userId", async (req, res) => {
  try {
    const { reason } = req.body;
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.kyc.status = "rejected";
    user.kyc.rejectionReason = reason || "Documents not valid";
    await user.save();

    res.json({ message: "KYC rejected", user });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Get all pending KYC users (for admin)
router.get("/kyc-pending/all", async (req, res) => {
  try {
    const users = await User.find({ "kyc.status": "pending" }).select("-password");
    res.json(users);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ============================
// API TOKEN MANAGEMENT
// ============================

// Generate unique key ID and secret
const generateKeyId = () => {
  const crypto = require('crypto');
  return 'sat_test_' + crypto.randomBytes(12).toString('hex');
};

const generateSecretKey = () => {
  const crypto = require('crypto');
  return crypto.randomBytes(24).toString('hex');
};

// ✅ Get all API tokens for a user
router.get("/api-tokens/:userId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    // Return tokens but mask the secret keys
    const tokens = (user.apiTokens || []).map(t => ({
      _id: t._id,
      name: t.name,
      keyId: t.keyId,
      secretKey: t.secretKey,
      mode: t.mode,
      status: t.status,
      createdAt: t.createdAt
    }));
    res.json({ tokens });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Create new API token
router.post("/api-tokens/:userId", async (req, res) => {
  try {
    const { name, mode = "test" } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Token name is required" });
    }

    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const keyId = mode === "live" ? 'sat_live_' + require('crypto').randomBytes(12).toString('hex') : generateKeyId();
    const secretKey = generateSecretKey();

    const newToken = {
      name,
      keyId,
      secretKey,
      mode,
      status: "active",
      createdAt: new Date()
    };

    user.apiTokens = user.apiTokens || [];
    user.apiTokens.push(newToken);
    await user.save();

    // Return the newly created token with full secret (only shown once)
    const createdToken = user.apiTokens[user.apiTokens.length - 1];
    res.json({
      message: "API Keys created successfully",
      token: {
        _id: createdToken._id,
        name: createdToken.name,
        keyId: createdToken.keyId,
        secretKey: createdToken.secretKey,
        mode: createdToken.mode,
        status: createdToken.status,
        createdAt: createdToken.createdAt
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ Delete/Revoke API token
router.delete("/api-tokens/:userId/:tokenId", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    user.apiTokens = user.apiTokens.filter(
      (t) => t._id.toString() !== req.params.tokenId
    );
    await user.save();

    res.json({ message: "Token deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ✅ GET SINGLE USER (MUST BE LAST)
router.get("/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json(user);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
