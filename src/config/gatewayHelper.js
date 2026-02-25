const Razorpay = require("razorpay");
const crypto = require("crypto");
const GatewaySettings = require("../models/gatewaySettings.model");

const CASHFREE_API_VERSION = "2023-08-01";

const getCashfreeBaseUrl = (isTestMode) =>
  isTestMode ? "https://sandbox.cashfree.com/pg" : "https://api.cashfree.com/pg";

const cashfreeRequest = async (path, settings, options = {}) => {
  const baseUrl = getCashfreeBaseUrl(settings.isTestMode);
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      "x-client-id": settings.keyId,
      "x-client-secret": settings.keySecret,
      "x-api-version": CASHFREE_API_VERSION,
      "x-request-id": options.requestId || `req_${Date.now()}`,
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data?.message || data?.error_description || `Cashfree API error (${response.status})`;
    throw new Error(message);
  }

  return data;
};

const createCashfreeOrder = async (settings, amountInRupees, metadata = {}) => {
  const orderId = metadata.orderId || `CF_${Date.now()}`;
  const returnBase = process.env.FRONTEND_URL || "http://localhost:5173";

  const returnParams = new URLSearchParams({
    flow: metadata.flowType || "deposit",
    cf_order_id: orderId,
  });

  if (metadata.linkId) returnParams.set("linkId", metadata.linkId);
  if (metadata.qrId) returnParams.set("qrId", metadata.qrId);

  const payload = {
    order_id: orderId,
    order_amount: Number(amountInRupees),
    order_currency: "INR",
    customer_details: {
      customer_id: metadata.customerId || metadata.udf1 || "customer_001",
      customer_name: metadata.firstname || "Customer",
      customer_email: metadata.email || "customer@example.com",
      customer_phone: metadata.phone || "9999999999",
    },
    order_meta: {
      return_url: `${returnBase}/payment/success?${returnParams.toString()}`,
    },
    order_note: metadata.productinfo || "Payment",
  };

  const created = await cashfreeRequest("/orders", settings, {
    method: "POST",
    body: payload,
    requestId: `create_${orderId}`,
  });

  return {
    orderId: created.order_id,
    paymentSessionId: created.payment_session_id,
  };
};

const fetchCashfreeOrder = async (settings, orderId) =>
  cashfreeRequest(`/orders/${orderId}`, settings, {
    method: "GET",
    requestId: `fetch_${orderId}`,
  });

const createOrderForSettings = async (settings, amountInRupees, metadata = {}) => {
  if (settings.gateway === "razorpay") {
    const rzp = new Razorpay({
      key_id: settings.keyId,
      key_secret: settings.keySecret,
    });

    try {
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
    } catch (err) {
      const msg = err.message || (err.error && err.error.description) || "Razorpay order creation failed";
      const error = new Error(msg);
      error.statusCode = err.statusCode || 500;
      throw error;
    }
  }

  if (settings.gateway === "payu") {
    const txnid = metadata.txnid || "TXN" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();
    const isPayUQrFlow = metadata.flowType === "qr";

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
      ...(isPayUQrFlow
        ? {
          pg: metadata.pg || "DBQR",
          bankcode: metadata.bankcode || "UPIDBQR",
          txn_s2s_flow: String(metadata.txn_s2s_flow || 4),
          s2s_client_ip: metadata.s2s_client_ip || "127.0.0.1",
          s2s_device_info: metadata.s2s_device_info || "Mozilla/5.0",
          expiry_time: String(metadata.expiry_time || process.env.PAYU_QR_EXPIRY_MINUTES || 30),
        }
        : {}),
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

  if (settings.gateway === "cashfree") {
    const cashfreeOrder = await createCashfreeOrder(settings, amountInRupees, {
      ...metadata,
      orderId: metadata.orderId || `CF_${Date.now()}`,
      customerId: metadata.customerId || metadata.udf1,
    });

    return {
      gateway: "cashfree",
      key: settings.keyId,
      isTestMode: settings.isTestMode,
      cashfreeData: {
        orderId: cashfreeOrder.orderId,
        paymentSessionId: cashfreeOrder.paymentSessionId,
        mode: settings.isTestMode ? "sandbox" : "production",
      },
    };
  }

  return null;
};

const getFallbackProcessorSettings = async (excludeGateway) => {
  const candidates = await GatewaySettings.find({
    gateway: { $in: ["cashfree", "razorpay", "payu"], $ne: excludeGateway },
    isEnabled: true,
    keyId: { $ne: "" },
    keySecret: { $ne: "" },
  });

  if (!candidates.length) return null;

  const order = ["cashfree", "razorpay", "payu"];
  const sorted = candidates.sort(
    (left, right) => order.indexOf(left.gateway) - order.indexOf(right.gateway)
  );

  return {
    gateway: sorted[0].gateway,
    label: sorted[0].label,
    keyId: sorted[0].keyId,
    keySecret: sorted[0].keySecret,
    isTestMode: sorted[0].isTestMode,
  };
};

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
    checkoutMode: active.checkoutMode || "redirect",
    checkoutUrl: active.checkoutUrl || "",
    docsUrl: active.docsUrl || "",
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
      checkoutMode: "native",
      checkoutUrl: "",
      docsUrl: "https://razorpay.com/docs/api/",
    };
  }

  // Try with active gateway settings first
  try {
    const directOrder = await createOrderForSettings(settings, amountInRupees, metadata);
    if (directOrder) {
      return directOrder;
    }
  } catch (primaryErr) {
    console.warn(`[createGatewayOrder] Primary gateway (${settings.gateway}) failed:`, primaryErr.message);

    // If Razorpay auth failed, try .env credentials as fallback (ONLY for Razorpay)
    if (
      settings.gateway === "razorpay" &&
      process.env.RAZORPAY_KEY_ID &&
      process.env.RAZORPAY_KEY_SECRET &&
      (process.env.RAZORPAY_KEY_ID !== settings.keyId || process.env.RAZORPAY_KEY_SECRET !== settings.keySecret)
    ) {
      console.log("[createGatewayOrder] Retrying Razorpay with .env credentials...");
      try {
        const envSettings = {
          gateway: "razorpay",
          label: "Razorpay",
          keyId: process.env.RAZORPAY_KEY_ID,
          keySecret: process.env.RAZORPAY_KEY_SECRET,
          isTestMode: false,
        };
        const envOrder = await createOrderForSettings(envSettings, amountInRupees, metadata);
        if (envOrder) return envOrder;
      } catch (envErr) {
        console.warn("[createGatewayOrder] .env Razorpay fallback also failed:", envErr.message);
      }
    }

    // DO NOT silently fall back to a different gateway (e.g. Cashfree when Razorpay is active)
    // This was causing Cashfree to show up on user side when admin set Razorpay as active
    // Instead, throw a clear error so admin knows to fix credentials
    throw new Error(
      `Payment failed: ${settings.label || settings.gateway} order creation failed. Please verify your ${settings.label || settings.gateway} credentials in Admin > Payment Gateway Settings. Error: ${primaryErr.message}`
    );
  }

  // This should not be reached normally — but handle edge case where createOrderForSettings returns null
  throw new Error(
    `${settings.label || settings.gateway} did not return a valid order. Please check gateway configuration.`
  );
};

module.exports = {
  getActiveGatewaySettings,
  getRazorpayInstance,
  generatePayUHash,
  verifyPayUHash,
  createGatewayOrder,
  fetchCashfreeOrder,
};
