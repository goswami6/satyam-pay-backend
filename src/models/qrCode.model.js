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
  },
  { timestamps: true }
);

// Index for auto-expiry queries
qrCodeSchema.index({ expiresAt: 1, status: 1 });

module.exports = mongoose.model("QRCode", qrCodeSchema);
