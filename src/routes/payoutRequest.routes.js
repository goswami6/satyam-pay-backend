const express = require("express");
const router = express.Router();
const PayoutRequest = require("../models/payoutRequest.model");
const User = require("../models/user.model");
const authMiddleware = require("../middlewares/auth.middleware");

// ========================
// VENDOR/USER ROUTES
// ========================

// Create a new payout request
router.post("/request", authMiddleware, async (req, res) => {
  try {
    const {
      amount,
      method,
      accountNumber,
      ifscCode,
      accountHolderName,
      bankName,
      upiId,
    } = req.body;

    // Validation
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    if (!method || !["bank", "upi"].includes(method)) {
      return res.status(400).json({ error: "Invalid method. Must be 'bank' or 'upi'" });
    }

    // Method-specific validation
    if (method === "bank") {
      if (!accountNumber || !ifscCode || !accountHolderName) {
        return res.status(400).json({
          error: "Bank transfer requires accountNumber, ifscCode, and accountHolderName",
        });
      }
    } else if (method === "upi") {
      if (!upiId) {
        return res.status(400).json({ error: "UPI transfer requires upiId" });
      }
    }

    // Check user balance
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.balance < amount) {
      return res.status(400).json({
        error: "Insufficient balance",
        balance: user.balance,
        requested: amount,
      });
    }

    // Create payout request
    const payoutRequest = new PayoutRequest({
      vendorId: req.user.id,
      amount,
      method,
      accountNumber: method === "bank" ? accountNumber : undefined,
      ifscCode: method === "bank" ? ifscCode : undefined,
      accountHolderName: method === "bank" ? accountHolderName : undefined,
      bankName: method === "bank" ? bankName : undefined,
      upiId: method === "upi" ? upiId : undefined,
      status: "requested",
    });

    await payoutRequest.save();

    res.status(201).json({
      success: true,
      message: "Payout request submitted successfully. Waiting for admin approval.",
      request: payoutRequest,
    });
  } catch (error) {
    console.error("Payout request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get user's payout requests
router.get("/my-requests", authMiddleware, async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = { vendorId: req.user.id };
    if (status) {
      query.status = status;
    }

    const requests = await PayoutRequest.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PayoutRequest.countDocuments(query);

    res.json({
      success: true,
      requests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Get payout requests error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Get single request details
router.get("/request/:id", authMiddleware, async (req, res) => {
  try {
    const request = await PayoutRequest.findOne({
      _id: req.params.id,
      vendorId: req.user.id,
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    res.json({ success: true, request });
  } catch (error) {
    console.error("Get request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Cancel pending request
router.put("/cancel/:id", authMiddleware, async (req, res) => {
  try {
    const request = await PayoutRequest.findOne({
      _id: req.params.id,
      vendorId: req.user.id,
      status: "requested",
    });

    if (!request) {
      return res.status(404).json({ error: "Request not found or cannot be cancelled" });
    }

    request.status = "rejected";
    request.rejectionReason = "Cancelled by user";
    request.rejectedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Payout request cancelled",
      request,
    });
  } catch (error) {
    console.error("Cancel request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// ========================
// ADMIN ROUTES
// ========================

// Get all payout requests (admin only)
router.get("/admin/all", authMiddleware, async (req, res) => {
  try {
    // Check if admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { status, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    const requests = await PayoutRequest.find(query)
      .populate("vendorId", "name email phone businessName balance")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));

    const total = await PayoutRequest.countDocuments(query);

    // Get stats
    const stats = await PayoutRequest.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          totalAmount: { $sum: "$amount" },
        },
      },
    ]);

    res.json({
      success: true,
      requests,
      stats,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Admin get requests error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Approve payout request (admin only)
router.put("/admin/approve/:id", authMiddleware, async (req, res) => {
  try {
    // Check if admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { fee = 0, adminNote } = req.body;

    const request = await PayoutRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "requested") {
      return res.status(400).json({ error: "Request already processed" });
    }

    // Get vendor/user
    const vendor = await User.findById(request.vendorId);
    if (!vendor) {
      return res.status(404).json({ error: "Vendor not found" });
    }

    const totalDeduction = request.amount + fee;

    // Check balance
    if (vendor.balance < totalDeduction) {
      return res.status(400).json({
        error: "Insufficient vendor balance",
        balance: vendor.balance,
        required: totalDeduction,
      });
    }

    // Deduct from vendor balance
    vendor.balance -= totalDeduction;
    await vendor.save();

    // Update request
    request.status = "approved";
    request.fee = fee;
    request.netAmount = request.amount;
    request.adminNote = adminNote;
    request.approvedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Payout request approved. Amount deducted from vendor balance.",
      request,
      vendorNewBalance: vendor.balance,
      deducted: totalDeduction,
    });
  } catch (error) {
    console.error("Approve request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Reject payout request (admin only)
router.put("/admin/reject/:id", authMiddleware, async (req, res) => {
  try {
    // Check if admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { rejectionReason } = req.body;

    if (!rejectionReason) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const request = await PayoutRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "requested") {
      return res.status(400).json({ error: "Request already processed" });
    }

    // Update request
    request.status = "rejected";
    request.rejectionReason = rejectionReason;
    request.rejectedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Payout request rejected",
      request,
    });
  } catch (error) {
    console.error("Reject request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Mark as completed (admin only)
router.put("/admin/complete/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }

    const { transactionId } = req.body;

    const request = await PayoutRequest.findById(req.params.id);
    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (request.status !== "approved") {
      return res.status(400).json({ error: "Only approved requests can be marked as completed" });
    }

    request.status = "completed";
    request.transactionId = transactionId;
    request.completedAt = new Date();
    await request.save();

    res.json({
      success: true,
      message: "Payout marked as completed",
      request,
    });
  } catch (error) {
    console.error("Complete request error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;
