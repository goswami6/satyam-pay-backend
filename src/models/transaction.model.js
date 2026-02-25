const mongoose = require("mongoose");

const transactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    transactionId: {
      type: String,
      unique: true,
      sparse: true,
    },
    description: String,
    type: {
      type: String,
      enum: ["Credit", "Debit"],
    },
    amount: Number,
    status: {
      type: String,
      enum: ["Pending", "Completed", "Success", "Failed"],
      default: "Pending",
    },
    // Additional details
    customerName: String,
    method: {
      type: String,
      enum: ["bank", "upi", "qr", "wallet", "razorpay", "payu", "other"],
    },
    category: {
      type: String,
      enum: ["payout", "withdrawal", "deposit", "payment", "refund", "transfer", "other"],
      default: "other",
    },
    referenceId: String, // Link to original request/order
    notes: String,
    fee: {
      type: Number,
      default: 0,
    },
    netAmount: Number,
    // Bank/UPI details for payouts
    accountNumber: String,
    ifscCode: String,
    upiId: String,
    bankName: String,
  },
  { timestamps: true }
);

// Indexes for faster queries
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ status: 1 });
transactionSchema.index({ category: 1 });

module.exports = mongoose.model("Transaction", transactionSchema);
