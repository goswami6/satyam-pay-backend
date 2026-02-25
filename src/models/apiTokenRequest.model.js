const mongoose = require("mongoose");

const apiTokenRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    mode: {
      type: String,
      enum: ["test", "live"],
      default: "live",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    keyId: {
      type: String,
    },
    secretKey: {
      type: String,
    },
    fee: {
      type: Number,
      default: 500, // Default fee for API token
    },
    feeDeducted: {
      type: Boolean,
      default: false,
    },
    rejectionReason: {
      type: String,
    },
    approvedAt: {
      type: Date,
    },
    rejectedAt: {
      type: Date,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("ApiTokenRequest", apiTokenRequestSchema);
