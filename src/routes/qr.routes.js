const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const QRCode = require("../models/qrCode.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const razorpay = require("../config/razorpay");
const { getRazorpayInstance, createGatewayOrder, verifyPayUHash } = require("../config/gatewayHelper");

// ============================
// GENERATE QR CODE (Dynamic)
// ============================
router.post("/generate", async (req, res) => {
  try {
    const { userId, amount, name, description, expiryMinutes = 15 } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: "User ID and amount are required" });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate unique QR ID
    const qrId = "QR" + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Create QR record
    const qrCode = await QRCode.create({
      qrId,
      userId,
      name: name || "Payment QR",
      amount: Number(amount),
      description: description || "",
      expiryMinutes,
      expiresAt,
      isStatic: false,
      status: "active",
    });

    // Generate QR URL
    const qrUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/qr/${qrId}`;

    res.json({
      success: true,
      message: "QR Code generated successfully",
      qrCode: {
        qrId: qrCode.qrId,
        amount: qrCode.amount,
        name: qrCode.name,
        expiresAt: qrCode.expiresAt,
        qrUrl,
      },
    });
  } catch (error) {
    console.error("Generate QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GENERATE STATIC QR CODE
// ============================
router.post("/generate-static", async (req, res) => {
  try {
    const { userId, name, description } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user already has a static QR
    const existingStatic = await QRCode.findOne({ userId, isStatic: true });
    if (existingStatic) {
      return res.status(400).json({
        message: "You already have a static QR code",
        qrCode: existingStatic
      });
    }

    // Generate unique QR ID
    const qrId = "SQR" + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create static QR record (no amount, no expiry)
    const qrCode = await QRCode.create({
      qrId,
      userId,
      name: name || "Static Payment QR",
      description: description || "Accept any amount",
      isStatic: true,
      status: "active",
    });

    // Generate QR URL
    const qrUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/qr/${qrId}`;

    res.json({
      success: true,
      message: "Static QR Code generated successfully",
      qrCode: {
        qrId: qrCode.qrId,
        name: qrCode.name,
        isStatic: true,
        qrUrl,
      },
    });
  } catch (error) {
    console.error("Generate Static QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET USER'S QR CODES
// ============================
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Update expired QR codes (only dynamic ones)
    await QRCode.updateMany(
      { userId, isStatic: { $ne: true }, status: "active", expiresAt: { $lt: new Date() } },
      { status: "expired" }
    );

    const qrCodes = await QRCode.find({ userId, isStatic: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50);

    // Get static QR
    const staticQR = await QRCode.findOne({ userId, isStatic: true });

    // Get stats
    const stats = await QRCode.aggregate([
      { $match: { userId: require("mongoose").Types.ObjectId.createFromHexString(userId), isStatic: { $ne: true } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          totalAmount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      qrCodes,
      staticQR,
      stats: stats[0] || { total: 0, active: 0, paid: 0, totalAmount: 0 },
    });
  } catch (error) {
    console.error("Get QR Codes Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET QR CODE DETAILS (for checkout page)
// ============================
router.get("/checkout/:qrId", async (req, res) => {
  try {
    const { qrId } = req.params;

    const qrCode = await QRCode.findOne({ qrId }).populate("userId", "fullName email");

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    // For static QR, no expiry check needed
    if (!qrCode.isStatic) {
      // Check if expired
      if (qrCode.status === "active" && new Date(qrCode.expiresAt) < new Date()) {
        qrCode.status = "expired";
        await qrCode.save();
      }

      if (qrCode.status === "paid") {
        return res.status(400).json({ message: "Payment already completed", status: "paid" });
      }

      if (qrCode.status === "expired") {
        return res.status(400).json({ message: "QR Code has expired", status: "expired" });
      }
    }

    // Calculate remaining time (only for dynamic QR)
    let remainingSeconds = null;
    if (!qrCode.isStatic && qrCode.expiresAt) {
      const remainingMs = new Date(qrCode.expiresAt) - new Date();
      remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    }

    res.json({
      success: true,
      qrCode: {
        qrId: qrCode.qrId,
        amount: qrCode.amount || null,
        name: qrCode.name,
        description: qrCode.description,
        merchant: qrCode.userId?.fullName || "Merchant",
        merchantEmail: qrCode.userId?.email,
        isStatic: qrCode.isStatic || false,
        expiresAt: qrCode.expiresAt,
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Get QR Checkout Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// CREATE ORDER FOR QR PAYMENT
// ============================
router.post("/checkout/create-order", async (req, res) => {
  try {
    const { qrId, amount: dynamicAmount } = req.body;

    const qrCode = await QRCode.findOne({ qrId });

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    // For static QR, amount is required from request
    if (qrCode.isStatic) {
      if (!dynamicAmount || Number(dynamicAmount) <= 0) {
        return res.status(400).json({ message: "Please enter a valid amount" });
      }
    } else {
      // Check expiry for dynamic QR
      if (qrCode.status === "active" && new Date(qrCode.expiresAt) < new Date()) {
        qrCode.status = "expired";
        await qrCode.save();
        return res.status(400).json({ message: "QR Code has expired" });
      }

      if (qrCode.status !== "active") {
        return res.status(400).json({ message: "QR Code is no longer valid" });
      }
    }

    // Use dynamic amount for static QR, or stored amount for dynamic QR
    const paymentAmount = qrCode.isStatic ? Number(dynamicAmount) : qrCode.amount;

    // Create order using active gateway (Razorpay or PayU)
    const result = await createGatewayOrder(paymentAmount, {
      receipt: `qr_${qrId}`,
      productinfo: qrCode.description || "QR Payment",
      firstname: "Customer",
      email: "customer@example.com",
      udf1: qrCode.userId?.toString() || "",
      udf2: qrId,
      udf3: "qr",
      surl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`,
      furl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`,
      notes: { qrId, isStatic: qrCode.isStatic },
    });

    // Save order ID for Razorpay
    if (result.gateway === "razorpay" && result.order) {
      qrCode.razorpayOrderId = result.order.id;
    }
    if (qrCode.isStatic) {
      qrCode.amount = paymentAmount;
    }
    await qrCode.save();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Create QR Order Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// VERIFY QR PAYMENT
// ============================
router.post("/checkout/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      qrId,
      payerName,
      payerEmail,
      payerPhone,
    } = req.body;

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !qrId) {
      return res.status(400).json({ success: false, message: "Missing payment details" });
    }

    const qrCode = await QRCode.findOne({ qrId });
    if (!qrCode) {
      return res.status(404).json({ success: false, message: "QR Code not found" });
    }

    // Verify signature using active gateway secret
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const { settings: qrGwSettings } = await getRazorpayInstance();
    const expectedSign = crypto
      .createHmac("sha256", qrGwSettings.keySecret)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      // Update QR status
      qrCode.status = "paid";
      qrCode.razorpayPaymentId = razorpay_payment_id;
      qrCode.paidAt = new Date();
      qrCode.paidBy = {
        name: payerName || "Customer",
        email: payerEmail || "",
        phone: payerPhone || "",
      };
      await qrCode.save();

      // Credit merchant balance
      await User.findByIdAndUpdate(qrCode.userId, {
        $inc: { balance: Number(qrCode.amount) },
      });

      // Create transaction record
      await Transaction.create({
        userId: qrCode.userId,
        transactionId: razorpay_payment_id,
        description: `QR Payment from ${payerName || "Customer"}`,
        type: "Credit",
        amount: Number(qrCode.amount),
        status: "Completed",
      });

      return res.json({
        success: true,
        message: "Payment successful",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }
  } catch (error) {
    console.error("Verify QR Payment Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ============================
// DELETE QR CODE
// ============================
router.delete("/:qrId", async (req, res) => {
  try {
    const { qrId } = req.params;

    const qrCode = await QRCode.findOneAndDelete({ qrId });

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    res.json({
      success: true,
      message: "QR Code deleted successfully",
    });
  } catch (error) {
    console.error("Delete QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
