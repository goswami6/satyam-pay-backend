const mongoose = require("mongoose");

const qrCodeSchema = new mongoose.Schema(
  {
    qrId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      default: "Payment QR",
    },
    isStatic: {
      type: Boolean,
      default: false,
    },
    amount: {
      type: Number,
      required: function () { return !this.isStatic; },
    },
    description: {
      type: String,
      default: "",
    },
    expiryMinutes: {
      type: Number,
      default: 15,
    },
    expiresAt: {
      type: Date,
      required: function () { return !this.isStatic; },
    },
    status: {
      type: String,
      enum: ["active", "paid", "expired"],
      default: "active",
    },
    razorpayOrderId: {
      type: String,
    },
    razorpayPaymentId: {
      type: String,
    },
    paidAt: {
      type: Date,
    },
    paidBy: {
      name: String,
      email: String,
      phone: String,
    },
    // URL for gateway-generated QR image (PayU DBQR, Razorpay QR, etc.)
    gatewayQrImageUrl: {
      type: String,
      default: null,
    },
    // Direct payment URL from gateway (Razorpay payment link, etc.)
    // When scanned, opens gateway checkout directly
    gatewayPaymentUrl: {
      type: String,
      default: null,
    },
    // Gateway payment link ID for tracking
    gatewayPaymentLinkId: {
      type: String,
      default: null,
    },
    // Which payment gateway was used to create this QR
    gateway: {
      type: String,
      default: null,
    },
  },
  { timestamps: true }
);

// Index for auto-expiry queries
qrCodeSchema.index({ expiresAt: 1, status: 1 });

module.exports = mongoose.model("QRCode", qrCodeSchema);
