const express = require("express");
const router = express.Router();
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const Settings = require("../models/settings.model");


// ================= USER REQUEST WITHDRAW =================
router.post("/request", async (req, res) => {
  try {
    const { userId, amount, accountName, accountNumber, ifsc, bankName } = req.body;

    if (!userId || !amount || !accountName || !accountNumber || !ifsc) {
      return res.status(400).json({ message: "All fields are required" });
    }

    // Get payment settings from admin
    const settings = await Settings.getSettings();
    const minWithdrawal = settings.minWithdrawal || 50;
    const maxWithdrawal = settings.maxWithdrawal || 500000;
    const commissionRate = settings.commissionRate || 2;

    const withdrawAmount = Number(amount);

    if (withdrawAmount < minWithdrawal) {
      return res.status(400).json({ message: `Minimum withdrawal is ₹${minWithdrawal}` });
    }

    if (withdrawAmount > maxWithdrawal) {
      return res.status(400).json({ message: `Maximum withdrawal is ₹${maxWithdrawal.toLocaleString()}` });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    // Calculate commission dynamically from settings
    const commission = (withdrawAmount * commissionRate) / 100;
    const total = withdrawAmount + commission;

    if (total > user.balance) {
      return res.status(400).json({
        message: `Insufficient balance. Required ₹${total.toFixed(
          2
        )}, Available ₹${user.balance.toFixed(2)}`,
      });
    }

    // Create Withdrawal Request
    const withdrawal = await Withdrawal.create({
      userId,
      withdrawalId: "WD" + Date.now(),
      amount: withdrawAmount,
      commission,
      total,
      accountName,
      accountNumber,
      ifsc,
      bankName: bankName || "",
      type: "withdrawal",
      status: "Pending",
    });

    // Create Pending Transaction with full details
    await Transaction.create({
      userId,
      transactionId: withdrawal.withdrawalId,
      description: `Withdrawal Request to ${bankName || "Bank"} (${accountNumber.slice(-4)})`,
      type: "Debit",
      amount: withdrawAmount,
      fee: commission,
      netAmount: total,
      category: "withdrawal",
      method: "bank",
      accountNumber: accountNumber,
      ifscCode: ifsc,
      bankName: bankName || "",
      status: "Pending",
      notes: `Platform Fee: ${commissionRate}% (₹${commission.toFixed(2)})`
    });

    res.json({
      success: true,
      message: "Withdrawal request submitted. Awaiting admin approval.",
      withdrawal,
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// ================= ADMIN: GET ALL WITHDRAWALS =================
router.get("/admin/all", async (req, res) => {
  try {
    const { type } = req.query;
    const filter = type ? { type } : {};

    const withdrawals = await Withdrawal.find(filter)
      .populate("userId", "fullName email")
      .sort({ createdAt: -1 });

    res.json(withdrawals);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// ================= ADMIN: APPROVE WITHDRAWAL =================
router.post("/admin/approve/:id", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (withdrawal.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    // Get user and check balance first
    const user = await User.findById(withdrawal.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check if user has sufficient balance
    if (user.balance < withdrawal.total) {
      return res.status(400).json({
        message: "Insufficient user balance",
        currentBalance: user.balance,
        required: withdrawal.total,
        shortfall: withdrawal.total - user.balance
      });
    }

    // Deduct Balance only if sufficient
    user.balance -= withdrawal.total;
    await user.save();

    withdrawal.status = "Approved";
    await withdrawal.save();

    // Update Transaction Status
    await Transaction.findOneAndUpdate(
      { transactionId: withdrawal.withdrawalId },
      { status: "Completed" }
    );

    res.json({
      message: "Withdrawal approved successfully",
      newBalance: user.balance
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// ================= ADMIN: REJECT WITHDRAWAL =================
router.post("/admin/reject/:id", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);
    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (withdrawal.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    withdrawal.status = "Rejected";
    await withdrawal.save();

    // Update Transaction Status
    await Transaction.findOneAndUpdate(
      { transactionId: withdrawal.withdrawalId },
      { status: "Failed" }
    );

    res.json({ message: "Withdrawal rejected" });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
