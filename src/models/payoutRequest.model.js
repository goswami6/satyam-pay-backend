const mongoose = require("mongoose");

const payoutRequestSchema = new mongoose.Schema(
  {
    payoutId: {
      type: String,
      unique: true,
      sparse: true,
    },
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    method: {
      type: String,
      enum: ["bank", "upi"],
      required: true,
    },
    // Bank Details
    accountNumber: {
      type: String,
    },
    ifscCode: {
      type: String,
    },
    accountHolderName: {
      type: String,
    },
    bankName: {
      type: String,
    },
    // UPI Details
    upiId: {
      type: String,
    },
    // Status
    status: {
      type: String,
      enum: ["requested", "approved", "rejected", "processing", "completed", "failed", "cancelled"],
      default: "requested",
    },
    // Admin Notes
    rejectionReason: {
      type: String,
    },
    adminNote: {
      type: String,
    },
    // Timestamps for status changes
    approvedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    completedAt: {
      type: Date,
    },
    // Transaction reference after completion
    transactionId: {
      type: String,
    },
    // Fee deducted (if any)
    fee: {
      type: Number,
      default: 0,
    },
    netAmount: {
      type: Number,
    },
    // API Integration fields
    notes: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    source: {
      type: String,
      enum: ["dashboard", "api"],
      default: "dashboard",
    },
    apiKeyId: {
      type: String,
    },
  },
  { timestamps: true }
);

// Index for faster queries
payoutRequestSchema.index({ vendorId: 1, status: 1 });
payoutRequestSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model("PayoutRequest", payoutRequestSchema);
