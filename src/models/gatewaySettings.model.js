const mongoose = require("mongoose");
const { SUPPORTED_GATEWAY_IDS } = require("../config/supportedGateways");

const gatewaySettingsSchema = new mongoose.Schema(
  {
    gateway: {
      type: String,
      enum: SUPPORTED_GATEWAY_IDS,
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
    keyIdLabel: {
      type: String,
      default: "Key ID",
    },
    keySecretLabel: {
      type: String,
      default: "Key Secret",
    },
    docsUrl: {
      type: String,
      default: "",
    },
    setupNote: {
      type: String,
      default: "",
    },
    checkoutMode: {
      type: String,
      enum: ["native", "redirect"],
      default: "redirect",
    },
    isIntegrated: {
      type: Boolean,
      default: false,
    },
    checkoutUrl: {
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
