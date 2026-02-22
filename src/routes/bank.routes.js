const express = require("express");
const router = express.Router();
const Bank = require("../models/bank.model");

// ➜ Add / Update Bank Account
router.post("/add", async (req, res) => {
  try {
    const { userId, accountHolderName, accountNumber, ifsc, bankName } = req.body;

    if (!userId || !accountHolderName || !accountNumber || !ifsc || !bankName) {
      return res.status(400).json({ message: "All fields are required" });
    }

    let existingBank = await Bank.findOne({ userId });

    if (existingBank) {
      existingBank.accountHolderName = accountHolderName;
      existingBank.accountNumber = accountNumber;
      existingBank.ifsc = ifsc;
      existingBank.bankName = bankName;
      await existingBank.save();

      return res.json({ success: true, message: "Bank details updated" });
    }

    const bank = await Bank.create({
      userId,
      accountHolderName,
      accountNumber,
      ifsc,
      bankName,
    });

    res.json({ success: true, message: "Bank account added", bank });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ➜ Get Bank Account
router.get("/:userId", async (req, res) => {
  try {
    const bank = await Bank.findOne({ userId: req.params.userId });
    res.json(bank);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
