const mongoose = require("mongoose");

const payoutRowSchema = new mongoose.Schema({
  accountHolderName: String,
  accountNumber: String,
  ifsc: String,
  bankName: String,
  amount: Number,
  status: {
    type: String,
    enum: ["Pending", "Completed", "Failed"],
    default: "Pending",
  },
});

const bulkPayoutSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    fileName: String,
    totalAmount: Number,
    totalRows: Number,
    status: {
      type: String,
      enum: ["Pending", "Approved", "Rejected", "Processing", "Completed"],
      default: "Pending",
    },
    payoutData: [payoutRowSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model("BulkPayout", bulkPayoutSchema);
