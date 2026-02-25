const express = require("express");
const router = express.Router();
const GatewaySettings = require("../models/gatewaySettings.model");
const {
  SUPPORTED_GATEWAYS,
  SUPPORTED_GATEWAY_IDS,
  getGatewayMeta,
} = require("../config/supportedGateways");

const isGatewayReadyForPayments = (gatewayDoc) => {
  if (!gatewayDoc || !gatewayDoc.isEnabled) return false;
  if (!gatewayDoc.keyId || !gatewayDoc.keySecret) return false;
  return true;
};

// Seed and sync default gateways
const seedDefaults = async () => {
  for (const gateway of SUPPORTED_GATEWAYS) {
    await GatewaySettings.updateOne(
      { gateway: gateway.id },
      {
        $setOnInsert: {
          gateway: gateway.id,
          keyId: "",
          keySecret: "",
          isEnabled: false,
          isTestMode: true,
          isActive: false,
          checkoutUrl: "",
        },
        $set: {
          label: gateway.label,
          description: gateway.description,
          docsUrl: gateway.docsUrl,
          setupNote: gateway.setupNote,
          keyIdLabel: gateway.keyIdLabel,
          keySecretLabel: gateway.keySecretLabel,
          checkoutMode: gateway.checkoutMode,
          isIntegrated: Boolean(gateway.isIntegrated),
        },
      },
      { upsert: true }
    );
  }
};
seedDefaults().catch((error) => {
  console.error("Gateway seed sync failed:", error.message);
});

// ============================
// GET ALL GATEWAY SETTINGS
// ============================
router.get("/", async (req, res) => {
  try {
    const gateways = await GatewaySettings.find().sort({ gateway: 1 });

    // Self-heal invalid active gateway records
    const invalidActive = gateways.find(
      (gatewayDoc) => gatewayDoc.isActive && !isGatewayReadyForPayments(gatewayDoc)
    );
    if (invalidActive) {
      invalidActive.isActive = false;
      await invalidActive.save();
    }

    const refreshedGateways = invalidActive
      ? await GatewaySettings.find().sort({ gateway: 1 })
      : gateways;

    // Mask secrets for frontend
    const masked = refreshedGateways.map((g) => ({
      ...g.toObject(),
      keySecret: g.keySecret ? "••••••••••••••••••••••••" : "",
    }));
    const activeGateway = refreshedGateways.find((g) => g.isActive);
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
    const { keyId, keySecret, isEnabled, isTestMode, checkoutUrl } = req.body;

    if (!SUPPORTED_GATEWAY_IDS.includes(gateway)) {
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
    if (checkoutUrl !== undefined) settings.checkoutUrl = String(checkoutUrl || "").trim();

    const meta = getGatewayMeta(gateway);
    if (meta) {
      settings.label = meta.label;
      settings.description = meta.description;
      settings.docsUrl = meta.docsUrl;
      settings.setupNote = meta.setupNote;
      settings.keyIdLabel = meta.keyIdLabel;
      settings.keySecretLabel = meta.keySecretLabel;
      settings.checkoutMode = meta.checkoutMode;
      settings.isIntegrated = Boolean(meta.isIntegrated);
    }

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

    if (!SUPPORTED_GATEWAY_IDS.includes(gateway)) {
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

    if (!isGatewayReadyForPayments(active)) {
      active.isActive = false;
      await active.save();
      return res.status(404).json({
        message: `${active.label} is marked active but not fully configured. Configure required settings and set it active again.`,
      });
    }

    res.json({
      success: true,
      gateway: active.gateway,
      label: active.label,
      keyId: active.keyId,
      isTestMode: active.isTestMode,
      isIntegrated: active.isIntegrated,
    });
  } catch (error) {
    console.error("Get Active Gateway Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
