const express = require("express");
const router = express.Router();
// ============================
// RAZORPAY DYNAMIC QR VIA PAYMENT LINK
// ============================
router.post("/razorpay-create-link", async (req, res) => {
  try {
    const { amount, description } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }
    const paymentLink = await razorpay.paymentLink.create({
      amount: Number(amount) * 100, // in paise
      currency: "INR",
      description: description || "Dynamic UPI QR Payment",
      accept_partial: false,
      notify: { sms: false, email: false },
      reminder_enable: false,
      upi_link: true
    });
    res.json({
      success: true,
      qr_link: paymentLink.short_url,
      payment_id: paymentLink.id
    });
  } catch (error) {
    console.error("Razorpay QR Link Error:", error);
    let message = "QR creation failed";
    if (error.error && error.error.description) {
      message = error.error.description;
    } else if (error.message) {
      message = error.message;
    }
    res.status(500).json({ message });
  }
});
const crypto = require("crypto");
const QRCode = require("../models/qrCode.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const GatewaySettings = require("../models/gatewaySettings.model");
const razorpay = require("../config/razorpay");
const { getRazorpayInstance, createGatewayOrder, verifyPayUHash } = require("../config/gatewayHelper");

const buildQrPaymentUrl = async ({ qrId, amount, merchantName, description, isStatic = false, gatewayPaymentUrl = null }) => {
  const frontendBase = process.env.FRONTEND_URL || "http://localhost:5173";
  const hostedCheckoutUrl = `${frontendBase}/qr/${qrId}`;

  // If gateway payment URL is available (e.g. Razorpay payment link),
  // use it as the QR value so scanning opens gateway checkout directly
  if (gatewayPaymentUrl) {
    return {
      qrUrl: gatewayPaymentUrl,
      paymentUri: gatewayPaymentUrl,
      paymentMode: "gateway-direct",
      hostedCheckoutUrl,
      gatewayPaymentUrl,
    };
  }

  return {
    qrUrl: hostedCheckoutUrl,
    paymentUri: hostedCheckoutUrl,
    paymentMode: "hosted",
    hostedCheckoutUrl,
  };
};

const resolveGatewaySettingsForVerification = async (gatewayHint) => {
  if (gatewayHint) {
    const hinted = await GatewaySettings.findOne({ gateway: gatewayHint, isEnabled: true });
    if (hinted?.keySecret) {
      return hinted;
    }
  }

  const { settings } = await getRazorpayInstance();
  return settings;
};

// ============================
// GENERATE QR CODE (Dynamic)
// ============================
router.post("/generate", async (req, res) => {
  try {
    const { userId, amount, name, description, expiryMinutes = 15 } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ message: "User ID and amount are required" });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate unique QR ID
    const qrId = "QR" + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Calculate expiry time
    const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000);

    // Create QR record
    const qrCode = await QRCode.create({
      qrId,
      userId,
      name: name || "Payment QR",
      amount: Number(amount),
      description: description || "",
      expiryMinutes,
      expiresAt,
      isStatic: false,
      status: "active",
    });

    // Try to create a native UPI QR code at generation time via active gateway
    // This creates a REAL UPI QR - scanning directly opens UPI app for payment (no "open URL" prompt)
    let gatewayPaymentUrl = null;
    let gatewayPaymentLinkId = null;
    let gatewayQrImageUrl = null;
    let gatewayName = null;
    try {
      const activeGateway = await GatewaySettings.findOne({ isActive: true, isEnabled: true });
      if (activeGateway && activeGateway.keyId && activeGateway.keySecret) {
        gatewayName = activeGateway.gateway;

        if (activeGateway.gateway === "razorpay") {
          // Try multiple credential sources for Razorpay QR Code API
          const credSources = [
            { keyId: activeGateway.keyId, keySecret: activeGateway.keySecret, label: "DB" },
          ];
          // Also add .env credentials as fallback if they differ
          if (
            process.env.RAZORPAY_KEY_ID &&
            process.env.RAZORPAY_KEY_SECRET &&
            (process.env.RAZORPAY_KEY_ID !== activeGateway.keyId || process.env.RAZORPAY_KEY_SECRET !== activeGateway.keySecret)
          ) {
            credSources.push({ keyId: process.env.RAZORPAY_KEY_ID, keySecret: process.env.RAZORPAY_KEY_SECRET, label: "ENV" });
          }

          const closeBy = Math.floor(expiresAt.getTime() / 1000);

          // Try QR Code API with each credential source
          for (const cred of credSources) {
            try {
              const auth = Buffer.from(`${cred.keyId}:${cred.keySecret}`).toString("base64");
              const rzpResponse = await fetch("https://api.razorpay.com/v1/payments/qr_codes", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Authorization": `Basic ${auth}`,
                },
                body: JSON.stringify({
                  type: "upi_qr",
                  name: name || "Payment QR",
                  usage: "single_use",
                  fixed_amount: true,
                  payment_amount: Number(amount) * 100,
                  description: description || "QR Payment",
                  close_by: closeBy,
                  notes: { qrId, userId: userId.toString() },
                }),
              });
              const rzpData = await rzpResponse.json();
              if (rzpResponse.ok && rzpData.image_url) {
                gatewayQrImageUrl = rzpData.image_url;
                gatewayPaymentLinkId = rzpData.id;
                gatewayPaymentUrl = rzpData.short_url || null;
                console.log(`[QR Generate] Razorpay UPI QR created (${cred.label}):`, rzpData.id);
                break; // success, stop trying
              } else {
                console.warn(`[QR Generate] Razorpay QR API error (${cred.label}):`, rzpData.error?.description || JSON.stringify(rzpData));
              }
            } catch (rzpErr) {
              console.warn(`[QR Generate] Razorpay QR API fetch error (${cred.label}):`, rzpErr.message);
            }
          }

          // Fallback: If QR Code API failed (feature not enabled), try Payment Link API with upi_link
          if (!gatewayQrImageUrl) {
            console.log("[QR Generate] QR Code API failed, trying Payment Link API as fallback...");
            for (const cred of credSources) {
              try {
                const auth = Buffer.from(`${cred.keyId}:${cred.keySecret}`).toString("base64");
                const linkResponse = await fetch("https://api.razorpay.com/v1/payment_links", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Basic ${auth}`,
                  },
                  body: JSON.stringify({
                    amount: Number(amount) * 100,
                    currency: "INR",
                    description: description || "QR Payment",
                    accept_partial: false,
                    upi_link: true,
                    notify: { sms: false, email: false },
                    reminder_enable: false,
                    notes: { qrId, userId: userId.toString() },
                    expire_by: closeBy,
                  }),
                });
                const linkData = await linkResponse.json();
                if (linkResponse.ok && linkData.short_url) {
                  gatewayPaymentUrl = linkData.short_url;
                  gatewayPaymentLinkId = linkData.id;
                  // Payment Link API doesn't return image_url,
                  // but short_url is a UPI-enabled link that opens UPI apps directly
                  console.log(`[QR Generate] Razorpay Payment Link created (${cred.label}):`, linkData.id);
                  break;
                } else {
                  console.warn(`[QR Generate] Razorpay Payment Link error (${cred.label}):`, linkData.error?.description || JSON.stringify(linkData));
                }
              } catch (linkErr) {
                console.warn(`[QR Generate] Razorpay Payment Link fetch error (${cred.label}):`, linkErr.message);
              }
            }
          }

        } else if (activeGateway.gateway === "payu") {
          // PayU Dynamic QR (DBQR) - Uses S2S API to get QR image
          const payuBase = activeGateway.isTestMode
            ? "https://test.payu.in"
            : "https://info.payu.in";

          const txnid = `TXN_QR_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
          const productinfo = description || "QR Payment";
          const firstname = "Customer";
          const email = "customer@example.com";
          const payuKey = activeGateway.keyId;
          const salt = activeGateway.keySecret;
          const amountStr = Number(amount).toFixed(2);

          // Generate PayU hash
          const hashStr = `${payuKey}|${txnid}|${amountStr}|${productinfo}|${firstname}|${email}|||||||||||${salt}`;
          const payuHash = require("crypto").createHash("sha512").update(hashStr).digest("hex");

          const surl = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`;
          const furl = `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`;

          const payuPayload = {
            key: payuKey,
            txnid,
            amount: amountStr,
            productinfo,
            firstname,
            email,
            surl,
            furl,
            hash: payuHash,
            pg: "DBQR",
            bankcode: "UPIDBQR",
            txn_s2s_flow: "4",
            udf1: userId.toString(),
            udf2: qrId,
            udf3: "qr",
          };

          // PayU S2S call for DBQR
          const formBody = Object.entries(payuPayload)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v || "")}`)
            .join("&");

          const payuResponse = await fetch(`${payuBase}/_payment`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: formBody,
            redirect: "manual",
          });

          // PayU DBQR returns a JSON with QR image URL
          const contentType = payuResponse.headers.get("content-type") || "";
          if (contentType.includes("json")) {
            const payuData = await payuResponse.json();
            if (payuData.qrCodeUrl || payuData.intent_url || payuData.data?.qrCodeUrl) {
              gatewayQrImageUrl = payuData.qrCodeUrl || payuData.data?.qrCodeUrl || null;
              gatewayPaymentUrl = payuData.intent_url || payuData.data?.intent_url || null;
              gatewayPaymentLinkId = txnid;
              console.log("[QR Generate] PayU DBQR created:", txnid);
            } else {
              console.warn("[QR Generate] PayU DBQR response:", JSON.stringify(payuData).substring(0, 300));
            }
          } else {
            console.warn("[QR Generate] PayU DBQR non-JSON response, status:", payuResponse.status);
          }

        } else if (activeGateway.gateway === "cashfree") {
          // Cashfree QR Code API
          const cfBase = activeGateway.isTestMode
            ? "https://sandbox.cashfree.com/pg"
            : "https://api.cashfree.com/pg";

          const cfPayload = {
            link_id: qrId,
            link_amount: Number(amount),
            link_currency: "INR",
            link_purpose: description || "QR Payment",
            link_minimum_partial_amount: Number(amount),
            customer_details: {
              customer_phone: "9999999999",
              customer_name: "Customer",
            },
            link_meta: {
              upi_intent: true,
              return_url: `${process.env.FRONTEND_URL || "http://localhost:5173"}/payment/success?qrId=${qrId}`,
            },
            link_expiry_time: expiresAt.toISOString(),
            link_notify: { send_sms: false, send_email: false },
          };

          const cfResponse = await fetch(`${cfBase}/links`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-client-id": activeGateway.keyId,
              "x-client-secret": activeGateway.keySecret,
              "x-api-version": "2023-08-01",
            },
            body: JSON.stringify(cfPayload),
          });

          const cfData = await cfResponse.json();
          if (cfResponse.ok && cfData.link_qrcode) {
            // Cashfree returns base64 QR image in link_qrcode
            gatewayQrImageUrl = cfData.link_qrcode;
            gatewayPaymentUrl = cfData.link_url || null;
            gatewayPaymentLinkId = cfData.cf_link_id?.toString() || cfData.link_id || null;
            console.log("[QR Generate] Cashfree QR created:", cfData.link_id);
          } else {
            console.warn("[QR Generate] Cashfree QR API error:", cfData.message || JSON.stringify(cfData).substring(0, 300));
          }
        }

        // Save gateway QR data to record
        if (gatewayQrImageUrl || gatewayPaymentUrl) {
          qrCode.gatewayQrImageUrl = gatewayQrImageUrl;
          qrCode.gatewayPaymentUrl = gatewayPaymentUrl;
          qrCode.gatewayPaymentLinkId = gatewayPaymentLinkId;
          qrCode.gateway = gatewayName;
          await qrCode.save();
        }
      }
    } catch (gwErr) {
      console.warn("[QR Generate] Could not create gateway UPI QR, falling back to hosted checkout:", gwErr.message || gwErr.error?.description);
    }

    const paymentData = await buildQrPaymentUrl({
      qrId,
      amount: qrCode.amount,
      merchantName: user.fullName,
      description: qrCode.description,
      isStatic: false,
      gatewayPaymentUrl,
    });

    res.json({
      success: true,
      message: "QR Code generated successfully",
      qrCode: {
        qrId: qrCode.qrId,
        amount: qrCode.amount,
        name: qrCode.name,
        expiresAt: qrCode.expiresAt,
        ...paymentData,
        gatewayPaymentUrl,
        gatewayQrImageUrl,
        gateway: gatewayName,
        isUpiQr: !!gatewayQrImageUrl,
      },
    });
  } catch (error) {
    console.error("Generate QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GENERATE STATIC QR CODE
// ============================
router.post("/generate-static", async (req, res) => {
  try {
    const { userId, name, description } = req.body;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user already has a static QR
    const existingStatic = await QRCode.findOne({ userId, isStatic: true });
    if (existingStatic) {
      return res.status(400).json({
        message: "You already have a static QR code",
        qrCode: existingStatic
      });
    }

    // Generate unique QR ID
    const qrId = "SQR" + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Create static QR record (no amount, no expiry)
    const qrCode = await QRCode.create({
      qrId,
      userId,
      name: name || "Static Payment QR",
      description: description || "Accept any amount",
      isStatic: true,
      status: "active",
    });

    const paymentData = await buildQrPaymentUrl({
      qrId,
      amount: null,
      merchantName: user.fullName,
      description: qrCode.description,
      isStatic: true,
    });

    res.json({
      success: true,
      message: "Static QR Code generated successfully",
      qrCode: {
        qrId: qrCode.qrId,
        name: qrCode.name,
        isStatic: true,
        ...paymentData,
        isUpiQr: paymentData.paymentMode === "upi",
      },
    });
  } catch (error) {
    console.error("Generate Static QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET USER'S QR CODES
// ============================
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Update expired QR codes (only dynamic ones)
    await QRCode.updateMany(
      { userId, isStatic: { $ne: true }, status: "active", expiresAt: { $lt: new Date() } },
      { status: "expired" }
    );

    const qrCodes = await QRCode.find({ userId, isStatic: { $ne: true } })
      .sort({ createdAt: -1 })
      .limit(50);

    // Get static QR
    const staticQR = await QRCode.findOne({ userId, isStatic: true });

    const user = await User.findById(userId).select("fullName");

    const qrCodesWithUrls = await Promise.all(qrCodes.map(async (qr) => {
      const paymentData = await buildQrPaymentUrl({
        qrId: qr.qrId,
        amount: qr.amount,
        merchantName: user?.fullName,
        description: qr.description,
        isStatic: false,
        gatewayPaymentUrl: qr.gatewayPaymentUrl || null,
      });
      return {
        ...qr.toObject(),
        ...paymentData,
        isUpiQr: !!qr.gatewayQrImageUrl || paymentData.paymentMode === "gateway-direct",
        gateway: qr.gateway || null,
      };
    }));

    let staticQRWithUrl = null;
    if (staticQR) {
      const staticPaymentData = await buildQrPaymentUrl({
        qrId: staticQR.qrId,
        amount: null,
        merchantName: user?.fullName,
        description: staticQR.description,
        isStatic: true,
      });
      staticQRWithUrl = {
        ...staticQR.toObject(),
        ...staticPaymentData,
      };
    }

    // Get stats
    const stats = await QRCode.aggregate([
      { $match: { userId: require("mongoose").Types.ObjectId.createFromHexString(userId), isStatic: { $ne: true } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          totalAmount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      qrCodes: qrCodesWithUrls,
      staticQR: staticQRWithUrl,
      stats: stats[0] || { total: 0, active: 0, paid: 0, totalAmount: 0 },
    });
  } catch (error) {
    console.error("Get QR Codes Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET QR CODE DETAILS (for checkout page)
// ============================
router.get("/checkout/:qrId", async (req, res) => {
  try {
    const { qrId } = req.params;

    const qrCode = await QRCode.findOne({ qrId }).populate("userId", "fullName email");

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    // For static QR, no expiry check needed
    if (!qrCode.isStatic) {
      // Check if expired
      if (qrCode.status === "active" && new Date(qrCode.expiresAt) < new Date()) {
        qrCode.status = "expired";
        await qrCode.save();
      }

      if (qrCode.status === "paid") {
        return res.status(400).json({ message: "Payment already completed", status: "paid" });
      }

      if (qrCode.status === "expired") {
        return res.status(400).json({ message: "QR Code has expired", status: "expired" });
      }
    }

    // Calculate remaining time (only for dynamic QR)
    let remainingSeconds = null;
    if (!qrCode.isStatic && qrCode.expiresAt) {
      const remainingMs = new Date(qrCode.expiresAt) - new Date();
      remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
    }

    // Gateway QR image URL (PayU DBQR, Razorpay QR, etc.)
    const gatewayQrImageUrl = qrCode.gatewayQrImageUrl || null;
    res.json({
      success: true,
      qrCode: {
        qrId: qrCode.qrId,
        amount: qrCode.amount || null,
        name: qrCode.name,
        description: qrCode.description,
        merchant: qrCode.userId?.fullName || "Merchant",
        merchantEmail: qrCode.userId?.email,
        isStatic: qrCode.isStatic || false,
        expiresAt: qrCode.expiresAt,
        gatewayQrImageUrl,
        remainingSeconds,
      },
    });
  } catch (error) {
    console.error("Get QR Checkout Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// CREATE ORDER FOR QR PAYMENT
// ============================
router.post("/checkout/create-order", async (req, res) => {
  try {
    const {
      qrId,
      amount: dynamicAmount,
      payerName,
      payerEmail,
      payerPhone,
    } = req.body;
    const clientIp =
      req.headers["x-forwarded-for"]?.toString().split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      "127.0.0.1";
    const deviceInfo = req.headers["user-agent"] || "Mozilla/5.0";

    const qrCode = await QRCode.findOne({ qrId });

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    // Prevent duplicate payment attempts on the same QR (PayU E2025 fix)
    if (!qrCode.isStatic) {
      // Check expiry for dynamic QR
      if (qrCode.status === "active" && new Date(qrCode.expiresAt) < new Date()) {
        qrCode.status = "expired";
        await qrCode.save();
        return res.status(400).json({ message: "QR Code has expired. Please generate a new QR for payment." });
      }
      if (qrCode.status !== "active") {
        return res.status(400).json({ message: "QR Code is no longer valid. Please generate a new QR for payment." });
      }
    } else {
      // For static QR, amount is required from request
      if (!dynamicAmount || Number(dynamicAmount) <= 0) {
        return res.status(400).json({ message: "Please enter a valid amount" });
      }
      // Prevent duplicate payment attempts on static QR (PayU E2025 fix)
      if (qrCode.status === "paid") {
        return res.status(400).json({ message: "This static QR has already been paid. Please generate a new QR for another payment." });
      }
    }

    // Use dynamic amount for static QR, or stored amount for dynamic QR
    const paymentAmount = qrCode.isStatic ? Number(dynamicAmount) : qrCode.amount;

    // Create order using active gateway (Razorpay or PayU)
    // Use unique txnid + receipt per attempt to avoid "Duplicate Request" (E2025) errors
    const uniqueSuffix = `${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 6)}`;
    const uniqueTxnId = `TXN_QR_${uniqueSuffix}`;
    const uniqueReceipt = `qr_${uniqueSuffix}`;
    const uniqueOrderId = `CF_QR_${uniqueSuffix}`;
    // Log for debugging duplicate errors
    console.log('[QR CREATE ORDER]', {
      qrId,
      txnid: uniqueTxnId,
      receipt: uniqueReceipt,
      orderId: uniqueOrderId,
      time: new Date().toISOString(),
    });
    // Use UPI QR flow for dynamic QR, web checkout for static QR
    let orderPayload = {
      receipt: uniqueReceipt,
      txnid: uniqueTxnId,
      orderId: uniqueOrderId,
      productinfo: qrCode.description || "QR Payment",
      firstname: payerName || "Customer",
      email: payerEmail || "customer@example.com",
      phone: payerPhone || "9999999999",
      udf1: qrCode.userId?.toString() || "",
      udf2: qrId,
      udf3: "qr",
      surl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`,
      furl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`,
      notes: { qrId, isStatic: qrCode.isStatic },
    };
    if (!qrCode.isStatic) {
      // Dynamic QR: use UPI QR flow
      orderPayload = {
        ...orderPayload,
        pg: "DBQR",
        bankcode: "UPIDBQR",
        txn_s2s_flow: 4,
        s2s_client_ip: clientIp,
        s2s_device_info: deviceInfo,
        expiry_time: process.env.PAYU_QR_EXPIRY_MINUTES || 30,
      };
    }
    const result = await createGatewayOrder(paymentAmount, orderPayload);

    // Debug log for PayU response
    if (result.gateway === "payu") {
      console.log("[PAYU ORDER RESPONSE]", JSON.stringify(result, null, 2));
    }
    // Save order ID for Razorpay
    if (result.gateway === "razorpay" && result.order) {
      qrCode.razorpayOrderId = result.order.id;
    } else if (result.gateway === "cashfree" && result.cashfreeData?.orderId) {
      qrCode.razorpayOrderId = result.cashfreeData.orderId;
    }
    if (qrCode.isStatic) {
      qrCode.amount = paymentAmount;
    }
    await qrCode.save();

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Create QR Order Error:", error);
    let errMsg = error.message || (error.error && error.error.description) || "Payment order creation failed.";
    // Make auth errors more descriptive for the user
    if (errMsg.toLowerCase().includes("authentication") || errMsg.toLowerCase().includes("unauthorized") || error.statusCode === 401) {
      errMsg = "Payment gateway authentication failed. Please verify gateway credentials in Admin Settings.";
    }
    res.status(error.statusCode || 500).json({ message: errMsg });
  }
});

// ============================
// VERIFY QR PAYMENT
// ============================
router.post("/checkout/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      qrId,
      gateway,
      amount,
      payerName,
      payerEmail,
      payerPhone,
    } = req.body;

    console.log("[QR VERIFY] Incoming verify request:", {
      razorpay_order_id,
      razorpay_payment_id,
      qrId,
      gateway,
      amount,
      payerName,
      payerEmail,
      payerPhone,
    });

    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !qrId) {
      return res.status(400).json({ success: false, message: "Missing payment details" });
    }

    const qrCode = await QRCode.findOne({ qrId });
    if (!qrCode) {
      return res.status(404).json({ success: false, message: "QR Code not found" });
    }

    console.log("[QR VERIFY] Found QR:", qrCode.qrId, qrCode.status, qrCode.amount);

    const creditedAmount = qrCode.isStatic
      ? Number(amount || qrCode.amount || 0)
      : Number(qrCode.amount || amount || 0);

    if (!creditedAmount || creditedAmount <= 0) {
      return res.status(400).json({ success: false, message: "Invalid payment amount" });
    }

    // Verify signature using active gateway secret
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const qrGwSettings = await resolveGatewaySettingsForVerification(gateway);
    const expectedSign = crypto
      .createHmac("sha256", qrGwSettings.keySecret)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      console.log("[QR VERIFY] Signature valid. Proceeding to update QR and create transaction.");
      if (!qrCode.isStatic && qrCode.status === "paid") {
        return res.json({
          success: true,
          message: "Payment already verified",
        });
      }

      const existingTransaction = await Transaction.findOne({
        userId: qrCode.userId,
        transactionId: razorpay_payment_id,
      });

      if (existingTransaction) {
        return res.json({
          success: true,
          message: "Payment already verified",
        });
      }

      // Update QR status
      if (!qrCode.isStatic) {
        qrCode.status = "paid";
      }
      qrCode.razorpayPaymentId = razorpay_payment_id;
      qrCode.paidAt = new Date();
      qrCode.paidBy = {
        name: payerName || "Customer",
        email: payerEmail || "",
        phone: payerPhone || "",
      };
      await qrCode.save();

      console.log("[QR VERIFY] QR updated. Status:", qrCode.status, "PaymentId:", qrCode.razorpayPaymentId);

      // Credit merchant balance
      await User.findByIdAndUpdate(qrCode.userId, {
        $inc: { balance: creditedAmount },
      });

      console.log("[QR VERIFY] User balance credited:", qrCode.userId, creditedAmount);

      // Create transaction record
      await Transaction.create({
        userId: qrCode.userId,
        transactionId: razorpay_payment_id,
        description: `QR Payment from ${payerName || "Customer"}`,
        type: "Credit",
        amount: creditedAmount,
        status: "Completed",
      });

      console.log("[QR VERIFY] Transaction created for:", qrCode.userId, razorpay_payment_id);

      return res.json({
        success: true,
        message: "Payment successful",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }
  } catch (error) {
    console.error("Verify QR Payment Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});

// ============================
// RAZORPAY QR CODE WEBHOOK (handles direct UPI scan payments)
// When Razorpay UPI QR is scanned & paid, Razorpay sends a webhook
// ============================
router.post("/webhook/razorpay-qr", async (req, res) => {
  try {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (webhookSecret) {
      const shasum = crypto.createHmac("sha256", webhookSecret);
      shasum.update(JSON.stringify(req.body));
      const digest = shasum.digest("hex");
      if (digest !== req.headers["x-razorpay-signature"]) {
        console.warn("[QR Webhook] Invalid Razorpay signature");
        return res.status(400).json({ message: "Invalid signature" });
      }
    }

    const event = req.body;
    console.log("[QR Webhook] Event:", event.event);

    // Handle qr_code.credited event (UPI payment received on QR)
    if (event.event === "qr_code.credited") {
      const qrEntity = event.payload?.qr_code?.entity;
      const paymentEntity = event.payload?.payment?.entity;

      if (!qrEntity || !paymentEntity) {
        return res.json({ status: "missing_payload" });
      }

      const rzpQrId = qrEntity.id;
      const qrIdFromNotes = qrEntity.notes?.qrId;
      const userIdFromNotes = qrEntity.notes?.userId;
      const amountPaid = paymentEntity.amount / 100; // paise to rupees
      const paymentId = paymentEntity.id;

      console.log("[QR Webhook] QR credited:", { rzpQrId, qrIdFromNotes, amountPaid, paymentId });

      // Find our QR code record
      const qrCode = await QRCode.findOne({
        $or: [
          { gatewayPaymentLinkId: rzpQrId },
          { qrId: qrIdFromNotes },
        ],
      });

      if (!qrCode) {
        console.warn("[QR Webhook] QR code not found for:", rzpQrId, qrIdFromNotes);
        return res.json({ status: "qr_not_found" });
      }

      // Prevent duplicate crediting
      if (!qrCode.isStatic && qrCode.status === "paid") {
        return res.json({ status: "already_processed" });
      }

      const existingTx = await Transaction.findOne({ userId: qrCode.userId, transactionId: paymentId });
      if (existingTx) {
        return res.json({ status: "already_processed" });
      }

      // Update QR status
      if (!qrCode.isStatic) {
        qrCode.status = "paid";
      }
      qrCode.razorpayPaymentId = paymentId;
      qrCode.paidAt = new Date();
      qrCode.paidBy = {
        name: paymentEntity.notes?.name || paymentEntity.description || "UPI Scan",
        email: paymentEntity.email || "",
        phone: paymentEntity.contact || "",
      };
      await qrCode.save();

      // Credit merchant balance
      await User.findByIdAndUpdate(qrCode.userId, {
        $inc: { balance: amountPaid },
      });

      // Create transaction record
      await Transaction.create({
        userId: qrCode.userId,
        transactionId: paymentId,
        description: `UPI QR Payment (Direct Scan)`,
        type: "Credit",
        amount: amountPaid,
        status: "Completed",
      });

      console.log("[QR Webhook] Payment credited:", qrCode.userId, amountPaid);
      return res.json({ status: "ok" });
    }

    // Handle qr_code.closed event
    if (event.event === "qr_code.closed") {
      const qrEntity = event.payload?.qr_code?.entity;
      const qrIdFromNotes = qrEntity?.notes?.qrId;
      if (qrIdFromNotes) {
        await QRCode.updateOne({ qrId: qrIdFromNotes, status: "active" }, { status: "expired" });
      }
      return res.json({ status: "ok" });
    }

    return res.json({ status: "ignored" });
  } catch (error) {
    console.error("[QR Webhook] Error:", error);
    return res.status(500).json({ message: error.message });
  }
});

// ============================
// ADMIN: GET ALL QR CODES (all users)
// ============================
router.get("/admin/all", async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status && status !== "all") {
      query.status = status;
    }

    if (search) {
      query.$or = [
        { qrId: { $regex: search, $options: "i" } },
        { name: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const total = await QRCode.countDocuments(query);

    const qrCodes = await QRCode.find(query)
      .populate("userId", "fullName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    // Stats
    const stats = await QRCode.aggregate([
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          active: { $sum: { $cond: [{ $eq: ["$status", "active"] }, 1, 0] } },
          paid: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, 1, 0] } },
          expired: { $sum: { $cond: [{ $eq: ["$status", "expired"] }, 1, 0] } },
          totalAmount: { $sum: { $cond: [{ $eq: ["$status", "paid"] }, "$amount", 0] } },
        },
      },
    ]);

    res.json({
      success: true,
      qrCodes: qrCodes.map((qr) => ({
        ...qr.toObject(),
        userName: qr.userId?.fullName || "N/A",
        userEmail: qr.userId?.email || "N/A",
        gateway: qr.gateway || null,
        isUpiQr: !!qr.gatewayQrImageUrl,
      })),
      stats: stats[0] || { total: 0, active: 0, paid: 0, expired: 0, totalAmount: 0 },
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Admin Get All QR Codes Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// DELETE QR CODE
// ============================
router.delete("/:qrId", async (req, res) => {
  try {
    const { qrId } = req.params;

    const qrCode = await QRCode.findOneAndDelete({ qrId });

    if (!qrCode) {
      return res.status(404).json({ message: "QR Code not found" });
    }

    res.json({
      success: true,
      message: "QR Code deleted successfully",
    });
  } catch (error) {
    console.error("Delete QR Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
