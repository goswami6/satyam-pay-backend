const express = require("express");
const router = express.Router();
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");


// ================= USER REQUEST WITHDRAW =================
router.post("/request", async (req, res) => {
  try {
    const { userId, amount, accountName, accountNumber, ifsc } = req.body;

    if (!userId || !amount || !accountName || !accountNumber || !ifsc) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const withdrawAmount = Number(amount);

    if (withdrawAmount < 50) {
      return res.status(400).json({ message: "Minimum withdrawal is ₹50" });
    }

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: "User not found" });

    const commission = withdrawAmount * 0.01;
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
      type: "withdrawal",
      status: "Pending",
    });

    // Create Pending Transaction
    await Transaction.create({
      userId,
      transactionId: withdrawal.withdrawalId,
      description: `Withdrawal Request to Bank (${accountNumber.slice(-4)})`,
      type: "Debit",
      amount: withdrawAmount,
      status: "Pending",
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

    // Deduct Balance
    await User.findByIdAndUpdate(withdrawal.userId, {
      $inc: { balance: -withdrawal.total },
    });

    withdrawal.status = "Approved";
    await withdrawal.save();

    // Update Transaction Status
    await Transaction.findOneAndUpdate(
      { transactionId: withdrawal.withdrawalId },
      { status: "Completed" }
    );

    res.json({ message: "Withdrawal approved successfully" });

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
