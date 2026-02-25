const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const ApiTokenRequest = require("../models/apiTokenRequest.model");
const User = require("../models/user.model");

// Generate unique key ID (always live mode)
const generateKeyId = () => {
  return "sat_live_" + crypto.randomBytes(12).toString("hex");
};

// Generate secret key
const generateSecretKey = () => {
  return crypto.randomBytes(32).toString("hex");
};

// =============================================
// USER ROUTES
// =============================================

// ✅ Create API Token Request (User)
router.post("/request", async (req, res) => {
  try {
    const { userId, name, mode = "live" } = req.body;

    if (!userId || !name) {
      return res.status(400).json({ message: "User ID and token name are required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user already has a pending request
    const existingRequest = await ApiTokenRequest.findOne({
      userId,
      status: "pending",
    });

    if (existingRequest) {
      return res.status(400).json({
        message: "You already have a pending API token request. Please wait for admin approval.",
      });
    }

    // Create new request
    const request = new ApiTokenRequest({
      userId,
      name,
      mode,
      status: "pending",
    });

    await request.save();

    res.status(201).json({
      message: "API Token request submitted successfully. Waiting for admin approval.",
      request,
    });
  } catch (error) {
    console.error("Error creating API token request:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ Get User's API Tokens (Only Approved)
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Get all requests for this user
    const allRequests = await ApiTokenRequest.find({ userId }).sort({ createdAt: -1 });

    // Separate approved tokens and pending/rejected requests
    const approvedTokens = allRequests.filter((r) => r.status === "approved");
    const pendingRequests = allRequests.filter((r) => r.status === "pending");
    const rejectedRequests = allRequests.filter((r) => r.status === "rejected");

    res.json({
      tokens: approvedTokens,
      pendingRequests,
      rejectedRequests,
    });
  } catch (error) {
    console.error("Error fetching user tokens:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ Delete/Revoke API Token (User)
router.delete("/:tokenId", async (req, res) => {
  try {
    const { tokenId } = req.params;

    const token = await ApiTokenRequest.findById(tokenId);
    if (!token) {
      return res.status(404).json({ message: "Token not found" });
    }

    await ApiTokenRequest.findByIdAndDelete(tokenId);

    res.json({ message: "Token deleted successfully" });
  } catch (error) {
    console.error("Error deleting token:", error);
    res.status(500).json({ message: error.message });
  }
});

// =============================================
// ADMIN ROUTES
// =============================================

// ✅ Get All API Token Requests (Admin)
router.get("/admin/all", async (req, res) => {
  try {
    const { status } = req.query;

    let query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const requests = await ApiTokenRequest.find(query)
      .populate("userId", "fullName email phone companyName balance")
      .populate("approvedBy", "fullName email")
      .sort({ createdAt: -1 });

    // Stats
    const total = await ApiTokenRequest.countDocuments();
    const pending = await ApiTokenRequest.countDocuments({ status: "pending" });
    const approved = await ApiTokenRequest.countDocuments({ status: "approved" });
    const rejected = await ApiTokenRequest.countDocuments({ status: "rejected" });

    res.json({
      requests,
      stats: {
        total,
        pending,
        approved,
        rejected,
      },
    });
  } catch (error) {
    console.error("Error fetching admin requests:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ Get Single Request Details (Admin)
router.get("/admin/:requestId", async (req, res) => {
  try {
    const request = await ApiTokenRequest.findById(req.params.requestId)
      .populate("userId", "fullName email phone companyName balance kyc")
      .populate("approvedBy", "fullName email");

    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json({ request });
  } catch (error) {
    console.error("Error fetching request:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ Approve API Token Request (Admin) - No fee deduction, just generate keys
router.put("/admin/approve/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const { adminId } = req.body;

    const request = await ApiTokenRequest.findById(requestId).populate("userId");
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ message: "This request has already been processed" });
    }

    const user = await User.findById(request.userId._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate keys (always live mode)
    const keyId = generateKeyId();
    const secretKey = generateSecretKey();

    // Update request - No fee deduction
    request.status = "approved";
    request.keyId = keyId;
    request.secretKey = secretKey;
    request.approvedAt = new Date();
    request.approvedBy = adminId;
    await request.save();

    // ✅ IMPORTANT: Also add token to user's apiTokens array for API authentication
    user.apiTokens = user.apiTokens || [];
    user.apiTokens.push({
      name: request.name,
      keyId: keyId,
      secretKey: secretKey,
      mode: request.mode,
      status: "active",
      createdAt: new Date()
    });
    await user.save();

    res.json({
      message: "API Token approved successfully. User can now use these credentials for payout requests.",
      request: {
        _id: request._id,
        name: request.name,
        keyId: request.keyId,
        secretKey: request.secretKey,
        mode: request.mode,
        status: request.status,
        approvedAt: request.approvedAt,
      },
    });
  } catch (error) {
    console.error("Error approving request:", error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ Reject API Token Request (Admin)
router.put("/admin/reject/:requestId", async (req, res) => {
  try {
    const { requestId } = req.params;
    const { reason } = req.body;

    const request = await ApiTokenRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.status !== "pending") {
      return res.status(400).json({ message: "This request has already been processed" });
    }

    request.status = "rejected";
    request.rejectionReason = reason || "Request rejected by admin";
    request.rejectedAt = new Date();
    await request.save();

    res.json({
      message: "API Token request rejected",
      request,
    });
  } catch (error) {
    console.error("Error rejecting request:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
