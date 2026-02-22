const mongoose = require("mongoose");

const bankSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    accountHolderName: {
      type: String,
      required: true,
    },
    accountNumber: {
      type: String,
      required: true,
    },
    ifsc: {
      type: String,
      required: true,
    },
    bankName: {
      type: String,
      required: true,
    },
    isPrimary: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Bank", bankSchema);
