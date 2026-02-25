const mongoose = require("mongoose");

const withdrawalSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    withdrawalId: {
      type: String,
      unique: true,
    },
    amount: Number,
    commission: Number,
    total: Number,
    accountName: String,
    accountNumber: String,
    ifsc: String,
    bankName: String,
    type: {
      type: String,
      enum: ["withdrawal", "payout"],
      default: "withdrawal",
    },
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Paid"],
      default: "Pending",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Withdrawal", withdrawalSchema);
