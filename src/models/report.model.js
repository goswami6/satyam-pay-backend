const mongoose = require("mongoose");

const reportSchema = new mongoose.Schema(
  {
    reportId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Not required for admin reports
      default: null,
    },
    type: {
      type: String,
      enum: ["transaction", "revenue", "settlement", "custom", "user"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    dateRange: {
      from: Date,
      to: Date,
    },
    filters: {
      type: Object,
      default: {},
    },
    summary: {
      totalTransactions: { type: Number, default: 0 },
      totalCredit: { type: Number, default: 0 },
      totalDebit: { type: Number, default: 0 },
      netAmount: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ["generating", "ready", "failed"],
      default: "generating",
    },
    fileData: {
      type: String, // Base64 encoded CSV data
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Report", reportSchema);
