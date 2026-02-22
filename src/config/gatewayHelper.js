const Razorpay = require("razorpay");
const crypto = require("crypto");
const GatewaySettings = require("../models/gatewaySettings.model");

/**
 * Get the currently active gateway settings from DB
 * Returns { gateway, label, keyId, keySecret, isTestMode }
 */
const getActiveGatewaySettings = async () => {
  const active = await GatewaySettings.findOne({ isActive: true, isEnabled: true });
  if (!active) {
    throw new Error("No active payment gateway configured. Please configure one in admin settings.");
  }
  if (!active.keyId || !active.keySecret) {
    throw new Error(`${active.label} gateway credentials are not configured.`);
  }
  return {
    gateway: active.gateway,
    label: active.label,
    keyId: active.keyId,
    keySecret: active.keySecret,
    isTestMode: active.isTestMode,
  };
};

/**
 * Get a Razorpay instance using the active gateway's credentials from DB
 * Falls back to env variables if no active gateway is configured
 */
const getRazorpayInstance = async () => {
  try {
    const settings = await getActiveGatewaySettings();
    if (settings.gateway !== "razorpay") {
      // If PayU is active, return settings but no Razorpay instance
      return { instance: null, settings };
    }
    const instance = new Razorpay({
      key_id: settings.keyId,
      key_secret: settings.keySecret,
    });
    return { instance, settings };
  } catch (error) {
    // Fallback to env variables
    console.warn("Falling back to env Razorpay credentials:", error.message);
    const instance = new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    });
    return {
      instance,
      settings: {
        gateway: "razorpay",
        label: "Razorpay",
        keyId: process.env.RAZORPAY_KEY_ID,
        keySecret: process.env.RAZORPAY_KEY_SECRET,
        isTestMode: false,
      },
    };
  }
};

/**
 * Generate PayU hash for payment initiation
 */
const generatePayUHash = (params, salt) => {
  // PayU hash formula: sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||salt)
  const hashString = `${params.key}|${params.txnid}|${params.amount}|${params.productinfo}|${params.firstname}|${params.email}|${params.udf1 || ""}|${params.udf2 || ""}|${params.udf3 || ""}|${params.udf4 || ""}|${params.udf5 || ""}||||||${salt}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
};

/**
 * Verify PayU response hash
 */
const verifyPayUHash = (params, salt) => {
  // Reverse hash: sha512(salt|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
  const hashString = `${salt}|${params.status}||||||${params.udf5 || ""}|${params.udf4 || ""}|${params.udf3 || ""}|${params.udf2 || ""}|${params.udf1 || ""}|${params.email}|${params.firstname}|${params.productinfo}|${params.amount}|${params.txnid}|${params.key}`;
  return crypto.createHash("sha512").update(hashString).digest("hex");
};

/**
 * Create a payment using the active gateway
 * Returns gateway-specific data for frontend to handle
 * Falls back to env Razorpay credentials if no active gateway is configured
 */
const createGatewayOrder = async (amountInRupees, metadata = {}) => {
  let settings;
  try {
    settings = await getActiveGatewaySettings();
  } catch (error) {
    // Fallback to env Razorpay credentials
    console.warn("No active gateway configured, falling back to env Razorpay credentials:", error.message);
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      throw new Error("No payment gateway configured. Please configure one in admin settings or set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET environment variables.");
    }
    settings = {
      gateway: "razorpay",
      label: "Razorpay",
      keyId: process.env.RAZORPAY_KEY_ID,
      keySecret: process.env.RAZORPAY_KEY_SECRET,
      isTestMode: false,
    };
  }

  if (settings.gateway === "razorpay") {
    const rzp = new Razorpay({
      key_id: settings.keyId,
      key_secret: settings.keySecret,
    });

    const order = await rzp.orders.create({
      amount: Number(amountInRupees) * 100,
      currency: "INR",
      receipt: metadata.receipt || "receipt_" + Date.now(),
      notes: metadata.notes || {},
    });

    return {
      gateway: "razorpay",
      key: settings.keyId,
      order,
      isTestMode: settings.isTestMode,
    };
  } else if (settings.gateway === "payu") {
    const txnid = metadata.txnid || "TXN" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const payuParams = {
      key: settings.keyId,
      txnid,
      amount: Number(amountInRupees).toFixed(2),
      productinfo: metadata.productinfo || "Payment",
      firstname: metadata.firstname || "Customer",
      email: metadata.email || "customer@example.com",
      phone: metadata.phone || "",
      surl: metadata.surl || `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`,
      furl: metadata.furl || `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`,
      udf1: metadata.udf1 || "",
      udf2: metadata.udf2 || "",
      udf3: metadata.udf3 || "",
      udf4: metadata.udf4 || "",
      udf5: metadata.udf5 || "",
    };

    const hash = generatePayUHash(payuParams, settings.keySecret);

    return {
      gateway: "payu",
      key: settings.keyId,
      isTestMode: settings.isTestMode,
      payuData: {
        ...payuParams,
        hash,
        payuUrl: settings.isTestMode
          ? "https://test.payu.in/_payment"
          : "https://secure.payu.in/_payment",
      },
    };
  }

  throw new Error("Unsupported gateway: " + settings.gateway);
};

module.exports = { getActiveGatewaySettings, getRazorpayInstance, generatePayUHash, verifyPayUHash, createGatewayOrder };
