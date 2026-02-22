const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const Order = require("../models/order.model");
const User = require("../models/user.model");

// Get user dashboard stats
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get date range for comparison (last 30 days vs previous 30 days)
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

    // Total Transactions (Credit type - money received)
    const totalTransactions = await Transaction.aggregate([
      { $match: { userId: userObjectId, type: "Credit" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const recentTransactions = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          type: "Credit",
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const previousTransactions = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          type: "Credit",
          createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // Total Settlements (Approved withdrawals)
    const totalSettlements = await Withdrawal.aggregate([
      { $match: { userId: userObjectId, status: "Approved" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const recentSettlements = await Withdrawal.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "Approved",
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const previousSettlements = await Withdrawal.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "Approved",
          createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // Revenue (Total paid orders)
    const totalRevenue = await Order.aggregate([
      { $match: { merchantId: userObjectId, status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const recentRevenue = await Order.aggregate([
      {
        $match: {
          merchantId: userObjectId,
          status: "paid",
          createdAt: { $gte: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    const previousRevenue = await Order.aggregate([
      {
        $match: {
          merchantId: userObjectId,
          status: "paid",
          createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
        }
      },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // Customer count (unique customers from paid orders)
    const totalCustomers = await Order.distinct("customerEmail", {
      merchantId: userObjectId,
      status: "paid"
    });

    const recentCustomers = await Order.distinct("customerEmail", {
      merchantId: userObjectId,
      status: "paid",
      createdAt: { $gte: thirtyDaysAgo }
    });

    const previousCustomers = await Order.distinct("customerEmail", {
      merchantId: userObjectId,
      status: "paid",
      createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
    });

    // Calculate percentage changes
    const calcChange = (recent, previous) => {
      if (previous === 0) return recent > 0 ? 100 : 0;
      return ((recent - previous) / previous * 100).toFixed(1);
    };

    const transTotal = totalTransactions[0]?.total || 0;
    const transRecent = recentTransactions[0]?.total || 0;
    const transPrevious = previousTransactions[0]?.total || 0;

    const settleTotal = totalSettlements[0]?.total || 0;
    const settleRecent = recentSettlements[0]?.total || 0;
    const settlePrevious = previousSettlements[0]?.total || 0;

    const revTotal = totalRevenue[0]?.total || 0;
    const revRecent = recentRevenue[0]?.total || 0;
    const revPrevious = previousRevenue[0]?.total || 0;

    const custTotal = totalCustomers.length;
    const custRecent = recentCustomers.length;
    const custPrevious = previousCustomers.length;

    res.json({
      stats: {
        totalTransactions: transTotal,
        transactionChange: calcChange(transRecent, transPrevious),
        totalSettlements: settleTotal,
        settlementChange: calcChange(settleRecent, settlePrevious),
        totalRevenue: revTotal,
        revenueChange: calcChange(revRecent, revPrevious),
        totalCustomers: custTotal,
        customerChange: calcChange(custRecent, custPrevious)
      }
    });

  } catch (error) {
    console.error("Dashboard stats error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get recent transactions for dashboard
router.get("/recent-transactions/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 5;

    const transactions = await Transaction.find({ userId })
      .sort({ createdAt: -1 })
      .limit(limit);

    // Format transactions for dashboard
    const formatted = transactions.map(txn => ({
      id: txn.transactionId || txn._id,
      description: txn.description || (txn.type === "Credit" ? "Payment Received" : "Payout"),
      amount: txn.amount,
      type: txn.type,
      status: txn.status,
      date: txn.createdAt
    }));

    res.json(formatted);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get user balances summary
router.get("/balance-summary/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const user = await User.findById(userId).select("balance");

    // Pending withdrawals
    const pendingWithdrawals = await Withdrawal.aggregate([
      { $match: { userId: userObjectId, status: "Pending" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // Total withdrawn
    const totalWithdrawn = await Withdrawal.aggregate([
      { $match: { userId: userObjectId, status: "Approved" } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    res.json({
      availableBalance: user?.balance || 0,
      pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
      totalWithdrawn: totalWithdrawn[0]?.total || 0
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
