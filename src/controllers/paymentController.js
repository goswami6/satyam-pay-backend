const razorpay = require("../config/razorpay");
const transporter = require("../config/mailer");
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const crypto = require("crypto");


// =============================
// REQUEST MONEY
// =============================
exports.requestMoney = async (req, res) => {
  try {
    const { name, email, amount, description, userId } = req.body;

    if (!name || !email || !amount || !userId) {
      return res.status(400).json({ message: "All fields required" });
    }

    if (Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    // 1️⃣ Create Razorpay Payment Link
    const paymentLink = await razorpay.paymentLink.create({
      amount: Number(amount) * 100,
      currency: "INR",
      description: description || `Payment from ${name}`,
      customer: {
        name,
        email,
      },
      notify: {
        email: false,
        sms: false,
      },
      callback_url: `${process.env.FRONTEND_URL}/user/transactions`,
      callback_method: "get",
    });

    // 2️⃣ Save transaction as Pending
    await Transaction.create({
      userId,
      transactionId: paymentLink.id,
      description: description || `Payment from ${name}`,
      amount: Number(amount),
      type: "Credit",
      status: "Pending",
      paymentLinkId: paymentLink.id,
    });

    // 3️⃣ Send Email
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: email,
      subject: "Payment Request - SatyamPay",
      html: `
        <h2>Payment Request</h2>
        <p>Hello ${name},</p>
        <p>You have received a payment request of ₹${amount}</p>
        <p>Description: ${description || "-"}</p>
        <br/>
        <a href="${paymentLink.short_url}" 
           style="padding:12px 24px;background:#2563eb;color:white;text-decoration:none;border-radius:6px;display:inline-block;">
           Pay Now
        </a>
        <br/><br/>
        <small>This is a secure payment powered by Razorpay.</small>
      `,
    });

    return res.json({
      success: true,
      message: "Payment request sent successfully",
      paymentLink: paymentLink.short_url,
    });

  } catch (error) {
    console.error("Request Money Error:", error);
    res.status(500).json({ error: error.message });
  }
};


// =============================
// RAZORPAY WEBHOOK
// =============================
exports.razorpayWebhook = async (req, res) => {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;

    const shasum = crypto.createHmac("sha256", secret);
    shasum.update(JSON.stringify(req.body));
    const digest = shasum.digest("hex");

    if (digest !== req.headers["x-razorpay-signature"]) {
      return res.status(400).json({ message: "Invalid signature" });
    }

    const event = req.body;

    // ✅ When payment is successful
    if (event.event === "payment_link.paid") {

      const paymentLinkId = event.payload.payment_link.entity.id;
      const amount = event.payload.payment.entity.amount / 100;

      // Find transaction
      const transaction = await Transaction.findOne({
        paymentLinkId,
      });

      if (!transaction) {
        return res.json({ status: "transaction not found" });
      }

      // Prevent duplicate credit
      if (transaction.status === "Completed") {
        return res.json({ status: "already processed" });
      }

      // 1️⃣ Update transaction status
      transaction.status = "Completed";
      await transaction.save();

      // 2️⃣ Credit user balance
      await User.findByIdAndUpdate(transaction.userId, {
        $inc: { balance: Number(amount) },
      });
    }

    return res.json({ status: "ok" });

  } catch (error) {
    console.error("Webhook Error:", error);
    res.status(500).json({ error: error.message });
  }
};
