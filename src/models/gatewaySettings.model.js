const mongoose = require("mongoose");

const gatewaySettingsSchema = new mongoose.Schema(
  {
    gateway: {
      type: String,
      enum: ["razorpay", "payu"],
      required: true,
      unique: true,
    },
    label: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "",
    },
    keyId: {
      type: String,
      default: "",
    },
    keySecret: {
      type: String,
      default: "",
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    isTestMode: {
      type: Boolean,
      default: true,
    },
    isActive: {
      type: Boolean,
      default: false,
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GatewaySettings", gatewaySettingsSchema);
