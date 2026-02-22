const express = require("express");
const router = express.Router();
const BulkPayout = require("../models/bulkPayout.model");
const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");

// ========================================
// ✅ GET ALL BULK PAYOUTS
// ========================================
router.get("/bulk-payouts", async (req, res) => {
  try {
    const payouts = await BulkPayout.find()
      .populate("userId", "fullName email")
      .sort({ createdAt: -1 });

    res.json(payouts);
  } catch (error) {
    console.error("Fetch Bulk Payouts Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ========================================
// ✅ APPROVE BULK PAYOUT
// ========================================
router.put("/bulk-payouts/:id/approve", async (req, res) => {
  try {
    const payout = await BulkPayout.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({ message: "Bulk payout not found" });
    }

    if (payout.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    const user = await User.findById(payout.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // ✅ Check balance
    if (payout.totalAmount > user.balance) {
      return res.status(400).json({
        message: "Insufficient user balance",
      });
    }

    // ✅ Deduct balance
    user.balance -= payout.totalAmount;
    await user.save();

    // ✅ Create transaction record
    await Transaction.create({
      userId: user._id,
      transactionId: "BULK_" + Date.now(),
      description: `Bulk payout (${payout.totalRows} entries)`,
      amount: payout.totalAmount,
      type: "Debit",
      status: "Completed",
    });

    payout.status = "Approved";
    await payout.save();

    res.json({
      success: true,
      message: "Bulk payout approved successfully",
    });

  } catch (error) {
    console.error("Approve Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ========================================
// ❌ REJECT BULK PAYOUT
// ========================================
router.put("/bulk-payouts/:id/reject", async (req, res) => {
  try {
    const payout = await BulkPayout.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({ message: "Bulk payout not found" });
    }

    if (payout.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    payout.status = "Rejected";
    await payout.save();

    res.json({
      success: true,
      message: "Bulk payout rejected",
    });

  } catch (error) {
    console.error("Reject Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ========================================
// 📥 DOWNLOAD BULK PAYOUT AS CSV
// ========================================
router.get("/bulk-payouts/:id/download", async (req, res) => {
  try {
    const payout = await BulkPayout.findById(req.params.id);

    if (!payout) {
      return res.status(404).json({ message: "Bulk payout not found" });
    }

    if (!payout.payoutData || payout.payoutData.length === 0) {
      return res.status(400).json({ message: "No data available for download" });
    }

    // Generate CSV content
    const headers = ["Account Holder Name", "Account Number", "IFSC", "Bank Name", "Amount", "Status"];
    const csvRows = [headers.join(",")];

    payout.payoutData.forEach((row) => {
      csvRows.push([
        `"${row.accountHolderName || ""}"`,
        `"${row.accountNumber || ""}"`,
        `"${row.ifsc || ""}"`,
        `"${row.bankName || ""}"`,
        row.amount || 0,
        `"${row.status || "Pending"}"`
      ].join(","));
    });

    const csvContent = csvRows.join("\n");

    // Set headers for file download
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${payout.fileName || "bulk_payout.csv"}"`);
    res.send(csvContent);

  } catch (error) {
    console.error("Download Error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
