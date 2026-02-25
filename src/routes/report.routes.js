const express = require("express");
const router = express.Router();
const Report = require("../models/report.model");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const mongoose = require("mongoose");

// ============================
// GET USER'S REPORTS
// ============================
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const reports = await Report.find({ userId })
      .sort({ createdAt: -1 })
      .limit(20);

    res.json({
      success: true,
      reports,
    });
  } catch (error) {
    console.error("Get Reports Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET REPORT STATS
// ============================
router.get("/stats/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Get current month date range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    // Get previous month date range
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Current month transactions
    const currentMonthStats = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "Completed",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ["$type", "Debit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // Previous month transactions for comparison
    const prevMonthStats = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "Completed",
          createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // All time stats
    const allTimeStats = await Transaction.aggregate([
      {
        $match: {
          userId: userObjectId,
          status: "Completed",
        },
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ["$type", "Debit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // Reports generated
    const reportsCount = await Report.countDocuments({ userId: userObjectId });

    const current = currentMonthStats[0] || { totalTransactions: 0, totalCredit: 0, totalDebit: 0 };
    const prev = prevMonthStats[0] || { totalCredit: 0 };
    const allTime = allTimeStats[0] || { totalTransactions: 0, totalCredit: 0, totalDebit: 0 };

    // Calculate growth percentage
    const growthPercent = prev.totalCredit > 0
      ? (((current.totalCredit - prev.totalCredit) / prev.totalCredit) * 100).toFixed(1)
      : 0;

    res.json({
      success: true,
      stats: {
        currentMonth: {
          transactions: current.totalTransactions,
          revenue: current.totalCredit,
          expenses: current.totalDebit,
          net: current.totalCredit - current.totalDebit,
        },
        allTime: {
          transactions: allTime.totalTransactions,
          revenue: allTime.totalCredit,
          expenses: allTime.totalDebit,
          net: allTime.totalCredit - allTime.totalDebit,
        },
        reportsGenerated: reportsCount,
        growthPercent: Number(growthPercent),
      },
    });
  } catch (error) {
    console.error("Get Report Stats Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GENERATE REPORT
// ============================
router.post("/generate", async (req, res) => {
  try {
    const { userId, type, dateFrom, dateTo } = req.body;

    if (!userId || !type) {
      return res.status(400).json({ message: "User ID and report type are required" });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);

    // Set date range
    const from = dateFrom ? new Date(dateFrom) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const to = dateTo ? new Date(dateTo) : new Date();
    to.setHours(23, 59, 59, 999);

    // Generate report ID
    const reportId = "RPT" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

    // Get title based on type
    const typeNames = {
      transaction: "Transaction Report",
      revenue: "Revenue Report",
      settlement: "Settlement Report",
      custom: "Custom Export",
    };

    const monthYear = to.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const title = `${typeNames[type]} - ${monthYear}`;

    // Fetch transactions based on type
    let matchQuery = {
      userId: userObjectId,
      createdAt: { $gte: from, $lte: to },
    };

    if (type === "revenue") {
      matchQuery.type = "Credit";
      matchQuery.status = "Completed";
    } else if (type === "settlement") {
      matchQuery.type = "Debit";
    }

    const transactions = await Transaction.find(matchQuery).sort({ createdAt: -1 });

    // Calculate summary
    let totalCredit = 0;
    let totalDebit = 0;
    transactions.forEach((t) => {
      if (t.type === "Credit") totalCredit += t.amount;
      else totalDebit += t.amount;
    });

    // Generate CSV data
    let csvContent = "Transaction ID,Date,Description,Type,Amount,Status\n";
    transactions.forEach((t) => {
      const date = new Date(t.createdAt).toLocaleDateString("en-IN");
      csvContent += `${t.transactionId},${date},"${t.description || ""}",${t.type},${t.amount},${t.status}\n`;
    });

    // Convert to base64
    const fileData = Buffer.from(csvContent).toString("base64");

    // Create report
    const report = await Report.create({
      reportId,
      userId,
      type,
      title,
      dateRange: { from, to },
      summary: {
        totalTransactions: transactions.length,
        totalCredit,
        totalDebit,
        netAmount: totalCredit - totalDebit,
      },
      status: "ready",
      fileData,
    });

    res.json({
      success: true,
      message: "Report generated successfully",
      report: {
        reportId: report.reportId,
        title: report.title,
        type: report.type,
        summary: report.summary,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error("Generate Report Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// DOWNLOAD REPORT
// ============================
router.get("/download/:reportId", async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await Report.findOne({ reportId });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    if (report.status !== "ready" || !report.fileData) {
      return res.status(400).json({ message: "Report is not ready for download" });
    }

    // Decode base64
    const csvBuffer = Buffer.from(report.fileData, "base64");

    // Set headers
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${report.title.replace(/\s+/g, "_")}.csv"`);

    res.send(csvBuffer);
  } catch (error) {
    console.error("Download Report Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// DELETE REPORT
// ============================
router.delete("/:reportId", async (req, res) => {
  try {
    const { reportId } = req.params;

    const report = await Report.findOneAndDelete({ reportId });

    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }

    res.json({
      success: true,
      message: "Report deleted successfully",
    });
  } catch (error) {
    console.error("Delete Report Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// ADMIN: GET ALL REPORTS
// ============================
router.get("/admin/all", async (req, res) => {
  try {
    const reports = await Report.find()
      .sort({ createdAt: -1 })
      .limit(100)
      .populate("userId", "name email");

    res.json({
      success: true,
      reports,
    });
  } catch (error) {
    console.error("Admin Get All Reports Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// ADMIN: GET PLATFORM STATS
// ============================
router.get("/admin/stats", async (req, res) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const endOfPrevMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

    // Current month transactions (all users)
    const currentMonthStats = await Transaction.aggregate([
      {
        $match: {
          status: "Completed",
          createdAt: { $gte: startOfMonth, $lte: endOfMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ["$type", "Debit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // Previous month for comparison
    const prevMonthStats = await Transaction.aggregate([
      {
        $match: {
          status: "Completed",
          createdAt: { $gte: startOfPrevMonth, $lte: endOfPrevMonth },
        },
      },
      {
        $group: {
          _id: null,
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // All time stats
    const allTimeStats = await Transaction.aggregate([
      {
        $match: { status: "Completed" },
      },
      {
        $group: {
          _id: null,
          totalTransactions: { $sum: 1 },
          totalCredit: {
            $sum: { $cond: [{ $eq: ["$type", "Credit"] }, "$amount", 0] },
          },
          totalDebit: {
            $sum: { $cond: [{ $eq: ["$type", "Debit"] }, "$amount", 0] },
          },
        },
      },
    ]);

    // Total reports generated
    const reportsCount = await Report.countDocuments();

    // Active users count
    const User = require("../models/user.model");
    const activeUsers = await User.countDocuments({ isActive: true });

    // Settlement stats
    const settlementStats = await Withdrawal.aggregate([
      { $match: { status: "Approved" } },
      { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]);

    const current = currentMonthStats[0] || { totalTransactions: 0, totalCredit: 0, totalDebit: 0 };
    const prev = prevMonthStats[0] || { totalCredit: 0 };
    const allTime = allTimeStats[0] || { totalTransactions: 0, totalCredit: 0, totalDebit: 0 };
    const settlements = settlementStats[0] || { total: 0, count: 0 };

    const growthPercent = prev.totalCredit > 0
      ? (((current.totalCredit - prev.totalCredit) / prev.totalCredit) * 100).toFixed(1)
      : current.totalCredit > 0 ? 100 : 0;

    res.json({
      success: true,
      stats: {
        currentMonth: {
          transactions: current.totalTransactions,
          revenue: current.totalCredit,
          expenses: current.totalDebit,
          net: current.totalCredit - current.totalDebit,
        },
        allTime: {
          transactions: allTime.totalTransactions,
          revenue: allTime.totalCredit,
          expenses: allTime.totalDebit,
          net: allTime.totalCredit - allTime.totalDebit,
        },
        settlements: {
          total: settlements.total,
          count: settlements.count,
        },
        reportsGenerated: reportsCount,
        activeUsers,
        growthPercent: Number(growthPercent),
      },
    });
  } catch (error) {
    console.error("Admin Report Stats Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// ADMIN: GENERATE PLATFORM REPORT
// ============================
router.post("/admin/generate", async (req, res) => {
  try {
    const { type, dateFrom, dateTo } = req.body;

    if (!type) {
      return res.status(400).json({ message: "Report type is required" });
    }

    // Set date range
    const from = dateFrom ? new Date(dateFrom) : new Date(new Date().setMonth(new Date().getMonth() - 1));
    const to = dateTo ? new Date(dateTo) : new Date();
    to.setHours(23, 59, 59, 999);

    // Generate report ID
    const reportId = "ADMIN_RPT" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

    const typeNames = {
      transaction: "Platform Transaction Report",
      revenue: "Platform Revenue Report",
      settlement: "Platform Settlement Report",
      user: "User Activity Report",
    };

    const monthYear = to.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    const title = `${typeNames[type] || "Platform Report"} - ${monthYear}`;

    let csvContent = "";
    let summary = { totalTransactions: 0, totalCredit: 0, totalDebit: 0, netAmount: 0 };

    if (type === "transaction" || type === "revenue") {
      let matchQuery = {
        createdAt: { $gte: from, $lte: to },
      };
      if (type === "revenue") {
        matchQuery.type = "Credit";
        matchQuery.status = "Completed";
      }

      const transactions = await Transaction.find(matchQuery)
        .sort({ createdAt: -1 })
        .populate("userId", "name email");

      csvContent = "Transaction ID,Date,User,Email,Description,Type,Amount,Status\n";
      transactions.forEach((t) => {
        const date = new Date(t.createdAt).toLocaleDateString("en-IN");
        const userName = t.userId?.name || "N/A";
        const userEmail = t.userId?.email || "N/A";
        csvContent += `${t.transactionId},${date},"${userName}","${userEmail}","${t.description || ""}",${t.type},${t.amount},${t.status}\n`;
        if (t.type === "Credit") summary.totalCredit += t.amount;
        else summary.totalDebit += t.amount;
      });
      summary.totalTransactions = transactions.length;
      summary.netAmount = summary.totalCredit - summary.totalDebit;

    } else if (type === "settlement") {
      const withdrawals = await Withdrawal.find({
        createdAt: { $gte: from, $lte: to },
      })
        .sort({ createdAt: -1 })
        .populate("userId", "name email");

      csvContent = "Withdrawal ID,Date,User,Email,Amount,Status,Bank,Account\n";
      withdrawals.forEach((w) => {
        const date = new Date(w.createdAt).toLocaleDateString("en-IN");
        const userName = w.userId?.name || "N/A";
        const userEmail = w.userId?.email || "N/A";
        csvContent += `${w._id},${date},"${userName}","${userEmail}",${w.amount},${w.status},"${w.bankName || ""}","${w.accountNumber || ""}"\n`;
        summary.totalDebit += w.amount;
      });
      summary.totalTransactions = withdrawals.length;
      summary.netAmount = -summary.totalDebit;

    } else if (type === "user") {
      const User = require("../models/user.model");
      const users = await User.find({
        createdAt: { $gte: from, $lte: to },
      }).sort({ createdAt: -1 });

      csvContent = "User ID,Name,Email,Phone,KYC Status,Balance,Created At\n";
      users.forEach((u) => {
        const date = new Date(u.createdAt).toLocaleDateString("en-IN");
        csvContent += `${u._id},"${u.name || ""}","${u.email}","${u.phone || ""}",${u.kycStatus || "pending"},${u.balance || 0},${date}\n`;
        summary.totalCredit += u.balance || 0;
      });
      summary.totalTransactions = users.length;
    }

    const fileData = Buffer.from(csvContent).toString("base64");

    const report = await Report.create({
      reportId,
      userId: null, // Admin report, no specific user
      type,
      title,
      dateRange: { from, to },
      summary,
      status: "ready",
      fileData,
    });

    res.json({
      success: true,
      message: "Admin report generated successfully",
      report: {
        reportId: report.reportId,
        title: report.title,
        type: report.type,
        summary: report.summary,
        createdAt: report.createdAt,
      },
    });
  } catch (error) {
    console.error("Admin Generate Report Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
