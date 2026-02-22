const mongoose = require("mongoose");

/**
 * Order Model
 * 
 * Stores payment orders created via API
 * Used by merchants for payment integration
 */
const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true
    },
    merchantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    amount: {
      type: Number,
      required: true,
      min: 100 // Minimum 100 paise = ₹1
    },
    amountPaid: {
      type: Number,
      default: 0
    },
    currency: {
      type: String,
      default: "INR"
    },
    receipt: {
      type: String,
      default: null
    },
    notes: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    status: {
      type: String,
      enum: ["created", "attempted", "paid", "failed", "refunded", "expired"],
      default: "created"
    },
    attempts: {
      type: Number,
      default: 0
    },
    // Payment details (after successful payment)
    paymentId: {
      type: String,
      default: null
    },
    paymentMethod: {
      type: String,
      enum: ["upi", "card", "netbanking", "wallet", "emi", null],
      default: null
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "authorized", "captured", "failed", "refunded", null],
      default: null
    },
    // Customer details
    customerEmail: String,
    customerPhone: String,
    customerName: String,
    // URLs
    callbackUrl: String,
    webhookUrl: String,
    // Mode (test/live)
    mode: {
      type: String,
      enum: ["test", "live"],
      default: "test"
    },
    // Timestamps
    paidAt: Date,
    expiredAt: Date,
    // Refund details
    refundId: String,
    refundAmount: Number,
    refundedAt: Date,
    // Signature for verification
    signature: String,
    signatureVerified: {
      type: Boolean,
      default: false
    }
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtual for amount in rupees
orderSchema.virtual("amountInRupees").get(function () {
  return this.amount / 100;
});

// Virtual for amount due
orderSchema.virtual("amountDue").get(function () {
  return this.amount - this.amountPaid;
});

// Index for common queries
orderSchema.index({ merchantId: 1, createdAt: -1 });
orderSchema.index({ orderId: 1, merchantId: 1 });
orderSchema.index({ status: 1, merchantId: 1 });

module.exports = mongoose.model("Order", orderSchema);
