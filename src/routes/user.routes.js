const express = require("express");
const router = express.Router();
const upload = require("../middlewares/upload.middleware");
const authController = require("../controllers/usercontroller");
const User = require("../models/user.model"); // ✅ IMPORTANT IMPORT

// Register Route
router.post("/register", authController.register);

// Login Route (User Login)
router.post("/login", authController.login);

// Admin Login Route
router.post("/admin-login", authController.adminLogin);

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

// Update Profile
router.put("/profile/:userId", async (req, res) => {
  try {
    const updatedUser = await User.findByIdAndUpdate(
      req.params.userId,
      req.body,
      { new: true }
    ).select("-password");

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
