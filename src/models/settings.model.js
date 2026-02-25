const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema(
  {
    // Website Information
    websiteName: {
      type: String,
      default: "Rabbit Pay",
    },
    websiteUrl: {
      type: String,
      default: "https://rabbitpay.in.net",
    },
    websiteEmail: {
      type: String,
      default: "info@rabbitpay.in.net",
    },
    websitePhone: {
      type: String,
      default: "+91 8449968867",
    },
    websiteDescription: {
      type: String,
      default: "Secure payment gateway solution for businesses",
    },
    metaKeywords: {
      type: String,
      default: "payment, gateway, secure, online, transactions",
    },

    // Media Files
    logo: {
      type: String,
      default: null,
    },
    favicon: {
      type: String,
      default: null,
    },

    // Address Information
    address: {
      type: String,
      default: "Shop No. 21, City Center Mall, Hooda Complex",
    },
    city: {
      type: String,
      default: "Rohtak",
    },
    state: {
      type: String,
      default: "Haryana",
    },
    country: {
      type: String,
      default: "India",
    },
    zipCode: {
      type: String,
      default: "124001",
    },

    // Payment Settings
    commissionRate: {
      type: Number,
      default: 1,
      min: 0,
      max: 100,
    },
    minWithdrawal: {
      type: Number,
      default: 50,
    },
    maxWithdrawal: {
      type: Number,
      default: 500000,
    },

    // Social Links (optional)
    socialLinks: {
      facebook: { type: String, default: "" },
      twitter: { type: String, default: "" },
      instagram: { type: String, default: "" },
      linkedin: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

// Ensure only one settings document exists
settingsSchema.statics.getSettings = async function () {
  let settings = await this.findOne();
  if (!settings) {
    settings = await this.create({});
  }
  return settings;
};

module.exports = mongoose.model("Settings", settingsSchema);
