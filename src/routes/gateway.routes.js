const express = require("express");
const router = express.Router();
const GatewaySettings = require("../models/gatewaySettings.model");

// Seed default gateways if none exist
const seedDefaults = async () => {
  const count = await GatewaySettings.countDocuments();
  if (count === 0) {
    await GatewaySettings.insertMany([
      {
        gateway: "razorpay",
        label: "Razorpay",
        description: "Credit/Debit Cards, UPI, Net Banking",
        keyId: "",
        keySecret: "",
        isEnabled: false,
        isTestMode: true,
        isActive: false,
      },
      {
        gateway: "payu",
        label: "PayU",
        description: "UPI, Net Banking, Wallets",
        keyId: "",
        keySecret: "",
        isEnabled: false,
        isTestMode: true,
        isActive: false,
      },
    ]);
  }
};
seedDefaults();

// ============================
// GET ALL GATEWAY SETTINGS
// ============================
router.get("/", async (req, res) => {
  try {
    const gateways = await GatewaySettings.find().sort({ gateway: 1 });
    // Mask secrets for frontend
    const masked = gateways.map((g) => ({
      ...g.toObject(),
      keySecret: g.keySecret ? "••••••••••••••••••••••••" : "",
    }));
    const activeGateway = gateways.find((g) => g.isActive);
    res.json({
      success: true,
      gateways: masked,
      activeGateway: activeGateway
        ? {
          gateway: activeGateway.gateway,
          label: activeGateway.label,
          mode: activeGateway.isTestMode ? "Test Mode" : "Live Mode",
          updatedAt: activeGateway.updatedAt,
        }
        : null,
    });
  } catch (error) {
    console.error("Get Gateway Settings Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// UPDATE GATEWAY SETTINGS
// ============================
router.put("/:gateway", async (req, res) => {
  try {
    const { gateway } = req.params;
    const { keyId, keySecret, isEnabled, isTestMode } = req.body;

    if (!["razorpay", "payu"].includes(gateway)) {
      return res.status(400).json({ message: "Invalid gateway" });
    }

    const settings = await GatewaySettings.findOne({ gateway });
    if (!settings) {
      return res.status(404).json({ message: "Gateway not found" });
    }

    if (keyId !== undefined) settings.keyId = keyId;
    // Only update secret if a new one is provided (not masked)
    if (keySecret && !keySecret.startsWith("••")) {
      settings.keySecret = keySecret;
    }
    if (isEnabled !== undefined) settings.isEnabled = isEnabled;
    if (isTestMode !== undefined) settings.isTestMode = isTestMode;

    await settings.save();

    // Auto-activate: if this gateway is now enabled with credentials and no other gateway is active, set it as active
    if (settings.isEnabled && settings.keyId && settings.keySecret) {
      const anyActive = await GatewaySettings.findOne({ isActive: true });
      if (!anyActive) {
        await GatewaySettings.updateMany({}, { isActive: false });
        settings.isActive = true;
        await settings.save();
      }
    }

    // If gateway is disabled and was active, deactivate it
    if (!settings.isEnabled && settings.isActive) {
      settings.isActive = false;
      await settings.save();
    }

    res.json({
      success: true,
      message: "Gateway settings updated successfully",
      gateway: {
        ...settings.toObject(),
        keySecret: settings.keySecret ? "••••••••••••••••••••••••" : "",
      },
    });
  } catch (error) {
    console.error("Update Gateway Settings Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// SET ACTIVE GATEWAY
// ============================
router.post("/set-active/:gateway", async (req, res) => {
  try {
    const { gateway } = req.params;

    if (!["razorpay", "payu"].includes(gateway)) {
      return res.status(400).json({ message: "Invalid gateway" });
    }

    const settings = await GatewaySettings.findOne({ gateway });
    if (!settings) {
      return res.status(404).json({ message: "Gateway not found" });
    }

    if (!settings.isEnabled) {
      return res
        .status(400)
        .json({ message: "Enable the gateway first before setting it active" });
    }

    if (!settings.keyId || !settings.keySecret) {
      return res
        .status(400)
        .json({ message: "Configure gateway credentials first" });
    }

    // Deactivate all, then activate selected
    await GatewaySettings.updateMany({}, { isActive: false });
    settings.isActive = true;
    await settings.save();

    res.json({
      success: true,
      message: `${settings.label} is now the active payment gateway`,
      activeGateway: {
        gateway: settings.gateway,
        label: settings.label,
        mode: settings.isTestMode ? "Test Mode" : "Live Mode",
        updatedAt: settings.updatedAt,
      },
    });
  } catch (error) {
    console.error("Set Active Gateway Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET ACTIVE GATEWAY (PUBLIC - used by payment flow)
// ============================
router.get("/active", async (req, res) => {
  try {
    const active = await GatewaySettings.findOne({ isActive: true });
    if (!active) {
      return res.status(404).json({ message: "No active gateway configured" });
    }

    res.json({
      success: true,
      gateway: active.gateway,
      label: active.label,
      keyId: active.keyId,
      isTestMode: active.isTestMode,
    });
  } catch (error) {
    console.error("Get Active Gateway Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
