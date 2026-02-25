const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const Order = require("../models/order.model");
const User = require("../models/user.model");
const PayoutRequest = require("../models/payoutRequest.model");

// Get user dashboard stats
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    // Validate userId is a valid ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Invalid userId. Must be a valid MongoDB ObjectId." });
    }
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

// ================= ADMIN STATS =================
router.get("/admin-stats", async (req, res) => {
  try {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // ================= USERS =================
    const totalUsers = await User.countDocuments({ role: "user" });
    const activeUsers = await User.countDocuments({ role: "user", status: "Active" });
    const newUsersThisMonth = await User.countDocuments({ 
      role: "user", 
      createdAt: { $gte: thirtyDaysAgo } 
    });
    const newUsersLastMonth = await User.countDocuments({ 
      role: "user", 
      createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } 
    });

    // ================= TRANSACTIONS =================
    const totalTransactions = await Transaction.aggregate([
      { $match: { type: "Credit" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const recentTransactions = await Transaction.aggregate([
      { $match: { type: "Credit", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const previousTransactions = await Transaction.aggregate([
      { $match: { type: "Credit", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const todayTransactions = await Transaction.aggregate([
      { $match: { type: "Credit", createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // ================= REVENUE (Orders) =================
    const totalRevenue = await Order.aggregate([
      { $match: { status: "paid" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const recentRevenue = await Order.aggregate([
      { $match: { status: "paid", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const previousRevenue = await Order.aggregate([
      { $match: { status: "paid", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const todayRevenue = await Order.aggregate([
      { $match: { status: "paid", createdAt: { $gte: today } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // ================= CUSTOMERS =================
    const totalCustomers = await Order.distinct("customerEmail", { status: "paid" });
    const recentCustomers = await Order.distinct("customerEmail", {
      status: "paid",
      createdAt: { $gte: thirtyDaysAgo }
    });
    const previousCustomers = await Order.distinct("customerEmail", {
      status: "paid",
      createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo }
    });

    // ================= SETTLEMENTS (Withdrawals) =================
    const totalSettlements = await Withdrawal.aggregate([
      { $match: { status: "Approved" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const recentSettlements = await Withdrawal.aggregate([
      { $match: { status: "Approved", createdAt: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const previousSettlements = await Withdrawal.aggregate([
      { $match: { status: "Approved", createdAt: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    const pendingWithdrawals = await Withdrawal.aggregate([
      { $match: { status: "Pending" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } }
    ]);

    // ================= PAYOUT REQUESTS =================
    const pendingPayouts = await PayoutRequest.countDocuments({ status: "requested" });
    const approvedPayouts = await PayoutRequest.countDocuments({ status: "approved" });
    const completedPayouts = await PayoutRequest.countDocuments({ status: "completed" });

    const totalPayoutAmount = await PayoutRequest.aggregate([
      { $match: { status: { $in: ["approved", "completed"] } } },
      { $group: { _id: null, total: { $sum: "$amount" } } }
    ]);

    // ================= PLATFORM BALANCE =================
    const platformBalance = await User.aggregate([
      { $match: { role: "user" } },
      { $group: { _id: null, total: { $sum: "$balance" } } }
    ]);

    // ================= WEEKLY CHART DATA =================
    const weeklyData = await Transaction.aggregate([
      { $match: { type: "Credit", createdAt: { $gte: sevenDaysAgo } } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          total: { $sum: "$amount" },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // ================= RECENT TRANSACTIONS =================
    const latestTransactions = await Transaction.find({ type: "Credit" })
      .sort({ createdAt: -1 })
      .limit(10)
      .populate("userId", "fullName email");

    const calcChange = (recent, previous) => {
      if (previous === 0) return recent > 0 ? 100 : 0;
      return Number(((recent - previous) / previous) * 100).toFixed(1);
    };

    const transTotal = totalTransactions[0]?.total || 0;
    const transCount = totalTransactions[0]?.count || 0;
    const transRecent = recentTransactions[0]?.total || 0;
    const transPrevious = previousTransactions[0]?.total || 0;

    const revTotal = (totalRevenue[0]?.total || 0) / 100; // Convert from paise
    const revCount = totalRevenue[0]?.count || 0;
    const revRecent = (recentRevenue[0]?.total || 0) / 100;
    const revPrevious = (previousRevenue[0]?.total || 0) / 100;

    const settleTotal = totalSettlements[0]?.total || 0;
    const settleCount = totalSettlements[0]?.count || 0;
    const settleRecent = recentSettlements[0]?.total || 0;
    const settlePrevious = previousSettlements[0]?.total || 0;

    res.json({
      stats: {
        // Main Stats
        totalTransactions: transTotal,
        transactionCount: transCount,
        transactionChange: calcChange(transRecent, transPrevious),
        
        totalRevenue: revTotal,
        revenueCount: revCount,
        revenueChange: calcChange(revRecent, revPrevious),
        
        totalCustomers: totalCustomers.length,
        customerChange: calcChange(recentCustomers.length, previousCustomers.length),
        
        totalSettlements: settleTotal,
        settlementCount: settleCount,
        settlementChange: calcChange(settleRecent, settlePrevious),

        // Users
        totalUsers,
        activeUsers,
        newUsersThisMonth,
        userChange: calcChange(newUsersThisMonth, newUsersLastMonth),

        // Today Stats
        todayTransactions: todayTransactions[0]?.total || 0,
        todayTransactionCount: todayTransactions[0]?.count || 0,
        todayRevenue: (todayRevenue[0]?.total || 0) / 100,
        todayRevenueCount: todayRevenue[0]?.count || 0,

        // Pending Items
        pendingWithdrawals: pendingWithdrawals[0]?.total || 0,
        pendingWithdrawalCount: pendingWithdrawals[0]?.count || 0,
        pendingPayouts,
        approvedPayouts,
        completedPayouts,
        totalPayoutAmount: totalPayoutAmount[0]?.total || 0,

        // Platform
        platformBalance: platformBalance[0]?.total || 0,
      },
      weeklyData: weeklyData.map(d => ({
        date: d._id,
        amount: d.total,
        count: d.count
      })),
      recentTransactions: latestTransactions.map(t => ({
        id: t._id,
        transactionId: t.transactionId,
        amount: t.amount,
        type: t.type,
        status: t.status,
        description: t.description,
        user: t.userId ? { name: t.userId.fullName, email: t.userId.email } : null,
        createdAt: t.createdAt
      }))
    });

  } catch (error) {
    console.error("Admin stats error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
