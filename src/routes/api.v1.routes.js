const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const apiAuthMiddleware = require("../middlewares/apiAuth.middleware");
const Order = require("../models/order.model");

/**
 * Public API Routes (v1)
 * 
 * These routes are used by merchants to integrate payment gateway
 * All routes require API Key authentication (HTTP Basic Auth)
 * 
 * Base URL: /api/v1
 */

// Apply API authentication middleware to all routes
router.use(apiAuthMiddleware);

// Helper function to generate unique order ID
const generateOrderId = () => {
  return "order_" + crypto.randomBytes(10).toString("hex");
};

// Helper function to generate unique payment ID
const generatePaymentId = () => {
  return "pay_" + crypto.randomBytes(10).toString("hex");
};

/**
 * ✅ CREATE ORDER
 * POST /api/v1/orders
 * 
 * Creates a new payment order
 * 
 * Request Body:
 * {
 *   "amount": 50000,           // Amount in paise (₹500.00)
 *   "currency": "INR",
 *   "receipt": "order_rcptid_11",
 *   "notes": { ... },
 *   "callback_url": "https://yoursite.com/callback",
 *   "webhook_url": "https://yoursite.com/webhook"
 * }
 */
router.post("/orders", async (req, res) => {
  try {
    const { amount, currency = "INR", receipt, notes, callback_url, webhook_url } = req.body;

    // Validate required fields
    if (!amount || amount <= 0) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "The amount field is required and must be greater than 0",
          source: "business",
          field: "amount"
        }
      });
    }

    // Minimum amount validation (₹1.00 = 100 paise)
    if (amount < 100) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "The minimum amount is 100 paise (₹1.00)",
          source: "business",
          field: "amount"
        }
      });
    }

    const orderId = generateOrderId();
    const createdAt = Math.floor(Date.now() / 1000);

    // Create transaction/order in database
    const transaction = new Order({
      orderId,
      merchantId: req.apiUser.userId,
      amount,
      currency,
      receipt: receipt || null,
      notes: notes || {},
      status: "created",
      callbackUrl: callback_url || null,
      webhookUrl: webhook_url || null,
      mode: req.apiUser.mode,
      createdAt: new Date()
    });

    await transaction.save();

    // Generate payment URL
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const paymentUrl = `${baseUrl}/pay/${orderId}`;

    res.status(200).json({
      id: orderId,
      entity: "order",
      amount,
      amount_paid: 0,
      amount_due: amount,
      currency,
      receipt: receipt || null,
      offer_id: null,
      status: "created",
      attempts: 0,
      notes: notes || {},
      payment_url: paymentUrl,
      created_at: createdAt
    });

  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to create order",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ FETCH ORDER
 * GET /api/v1/orders/:orderId
 * 
 * Fetches details of a specific order
 */
router.get("/orders/:orderId", async (req, res) => {
  try {
    const { orderId } = req.params;

    const transaction = await Order.findOne({
      orderId,
      merchantId: req.apiUser.userId
    });

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: `Order ${orderId} not found`,
          source: "business"
        }
      });
    }

    res.json({
      id: transaction.orderId,
      entity: "order",
      amount: transaction.amount,
      amount_paid: transaction.amountPaid || 0,
      amount_due: transaction.amount - (transaction.amountPaid || 0),
      currency: transaction.currency,
      receipt: transaction.receipt,
      status: transaction.status,
      attempts: transaction.attempts || 0,
      notes: transaction.notes || {},
      created_at: Math.floor(new Date(transaction.createdAt).getTime() / 1000)
    });

  } catch (error) {
    console.error("Fetch Order Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to fetch order",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ FETCH ALL ORDERS
 * GET /api/v1/orders
 * 
 * Fetches all orders for the merchant
 * Query params: count, skip
 */
router.get("/orders", async (req, res) => {
  try {
    const count = parseInt(req.query.count) || 10;
    const skip = parseInt(req.query.skip) || 0;

    const transactions = await Order.find({
      merchantId: req.apiUser.userId
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(count);

    const total = await Order.countDocuments({
      merchantId: req.apiUser.userId
    });

    const items = transactions.map(t => ({
      id: t.orderId,
      entity: "order",
      amount: t.amount,
      amount_paid: t.amountPaid || 0,
      amount_due: t.amount - (t.amountPaid || 0),
      currency: t.currency,
      receipt: t.receipt,
      status: t.status,
      attempts: t.attempts || 0,
      notes: t.notes || {},
      created_at: Math.floor(new Date(t.createdAt).getTime() / 1000)
    }));

    res.json({
      entity: "collection",
      count: items.length,
      items
    });

  } catch (error) {
    console.error("Fetch Orders Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to fetch orders",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ VERIFY PAYMENT SIGNATURE
 * POST /api/v1/payments/verify
 * 
 * Verifies payment signature to confirm payment authenticity
 * 
 * Request Body:
 * {
 *   "order_id": "order_xxx",
 *   "payment_id": "pay_xxx",
 *   "signature": "xxx"
 * }
 */
router.post("/payments/verify", async (req, res) => {
  try {
    const { order_id, payment_id, signature } = req.body;

    if (!order_id || !payment_id || !signature) {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "order_id, payment_id, and signature are required",
          source: "business"
        }
      });
    }

    // Get the secret key from user's API token
    const secret = req.apiUser.mode === "live"
      ? process.env.PAYMENT_SECRET_LIVE
      : process.env.PAYMENT_SECRET_TEST || "test_secret_key";

    // Generate expected signature
    const body = order_id + "|" + payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(body)
      .digest("hex");

    const isValid = expectedSignature === signature;

    if (isValid) {
      // Update transaction status
      await Order.findOneAndUpdate(
        { orderId: order_id, merchantId: req.apiUser.userId },
        { status: "paid", paymentId: payment_id, paidAt: new Date() }
      );

      res.json({
        status: "verified",
        message: "Payment signature verified successfully"
      });
    } else {
      res.status(400).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "Payment signature verification failed",
          source: "business"
        }
      });
    }

  } catch (error) {
    console.error("Verify Payment Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to verify payment",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ FETCH PAYMENT BY ID
 * GET /api/v1/payments/:paymentId
 */
router.get("/payments/:paymentId", async (req, res) => {
  try {
    const { paymentId } = req.params;

    const transaction = await Order.findOne({
      paymentId,
      merchantId: req.apiUser.userId
    });

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: `Payment ${paymentId} not found`,
          source: "business"
        }
      });
    }

    res.json({
      id: transaction.paymentId,
      entity: "payment",
      amount: transaction.amount,
      currency: transaction.currency,
      status: transaction.status === "paid" ? "captured" : transaction.status,
      order_id: transaction.orderId,
      method: transaction.paymentMethod || "upi",
      description: transaction.notes?.description || null,
      email: transaction.customerEmail || null,
      contact: transaction.customerPhone || null,
      created_at: Math.floor(new Date(transaction.createdAt).getTime() / 1000)
    });

  } catch (error) {
    console.error("Fetch Payment Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to fetch payment",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ CREATE REFUND
 * POST /api/v1/payments/:paymentId/refunds
 */
router.post("/payments/:paymentId/refunds", async (req, res) => {
  try {
    const { paymentId } = req.params;
    const { amount, notes } = req.body;

    const transaction = await Order.findOne({
      paymentId,
      merchantId: req.apiUser.userId
    });

    if (!transaction) {
      return res.status(404).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: `Payment ${paymentId} not found`,
          source: "business"
        }
      });
    }

    if (transaction.status !== "paid") {
      return res.status(400).json({
        error: {
          code: "BAD_REQUEST_ERROR",
          description: "Refund can only be initiated for captured payments",
          source: "business"
        }
      });
    }

    const refundAmount = amount || transaction.amount;
    const refundId = "rfnd_" + crypto.randomBytes(10).toString("hex");

    // Update transaction
    transaction.status = "refunded";
    transaction.refundId = refundId;
    transaction.refundAmount = refundAmount;
    transaction.refundedAt = new Date();
    await transaction.save();

    res.json({
      id: refundId,
      entity: "refund",
      amount: refundAmount,
      currency: transaction.currency,
      payment_id: paymentId,
      notes: notes || {},
      status: "processed",
      created_at: Math.floor(Date.now() / 1000)
    });

  } catch (error) {
    console.error("Create Refund Error:", error);
    res.status(500).json({
      error: {
        code: "SERVER_ERROR",
        description: "Failed to create refund",
        source: "internal"
      }
    });
  }
});

/**
 * ✅ TEST API CONNECTION
 * GET /api/v1/test
 * 
 * Simple endpoint to test if API keys are working
 */
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: "API connection successful!",
    user: {
      email: req.apiUser.email,
      mode: req.apiUser.mode,
      keyId: req.apiUser.keyId.substring(0, 15) + "..."
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
