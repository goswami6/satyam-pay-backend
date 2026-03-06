const express = require("express");
const router = express.Router();
const Transaction = require("../models/transaction.model");
const User = require("../models/user.model");
const Settings = require("../models/settings.model");
const transporter = require("../config/mailer");
const puppeteer = require("puppeteer");

// Generate PDF from HTML
const generatePDF = async (html) => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  const pdfBuffer = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '20px', right: '20px', bottom: '20px', left: '20px' }
  });
  await browser.close();
  return pdfBuffer;
};

// Get all transactions (for admin) - MUST be before /:userId
router.get("/admin/all", async (req, res) => {
  try {
    const transactions = await Transaction.find()
      .populate("userId", "fullName email phone")
      .sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Fix existing deposit transactions (admin)
router.post("/fix-deposits", async (req, res) => {
  try {
    const result = await Transaction.updateMany(
      { description: { $regex: /Wallet Deposit/i } },
      {
        $set: {
          category: "deposit",
          method: "razorpay"
        }
      }
    );
    res.json({
      success: true,
      message: `Updated ${result.modifiedCount} deposit transactions`,
      matched: result.matchedCount
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get all receipts (admin) - MUST be before /:userId
router.get("/receipts/all", async (req, res) => {
  try {
    const receipts = await Transaction.find({ receiptGenerated: true })
      .populate("userId", "fullName email phone")
      .sort({ receiptSentAt: -1 });

    res.json(receipts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get transactions by user - This catches /:userId so must be LAST among GET routes with single param
router.get("/:userId", async (req, res) => {
  try {
    const transactions = await Transaction.find({
      userId: req.params.userId,
    }).sort({ createdAt: -1 });

    res.json(transactions);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Generate receipt number
const generateReceiptNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RCP-${timestamp}-${random}`;
};

// Generate receipt HTML
const generateReceiptHTML = async (transaction, user, settings) => {
  const formattedDate = new Date(transaction.createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 0; background: #f5f7fa; }
        .container { max-width: 600px; margin: 0 auto; background: white; }
        .header { background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); padding: 30px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .header p { color: rgba(255,255,255,0.8); margin: 5px 0 0; font-size: 14px; }
        .receipt-badge { display: inline-block; background: rgba(255,255,255,0.2); color: white; padding: 5px 15px; border-radius: 20px; font-size: 12px; margin-top: 15px; }
        .content { padding: 30px; }
        .success-icon { width: 60px; height: 60px; background: #10b981; border-radius: 50%; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center; }
        .success-icon svg { width: 30px; height: 30px; }
        .amount-box { background: #f0fdf4; border: 2px solid #10b981; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0; }
        .amount-box .label { color: #6b7280; font-size: 14px; margin-bottom: 5px; }
        .amount-box .amount { color: #059669; font-size: 32px; font-weight: bold; }
        .details-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        .details-table td { padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
        .details-table td:first-child { color: #6b7280; font-size: 14px; }
        .details-table td:last-child { text-align: right; font-weight: 600; color: #1f2937; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .status-success { background: #d1fae5; color: #059669; }
        .status-pending { background: #fef3c7; color: #d97706; }
        .footer { background: #f9fafb; padding: 20px 30px; text-align: center; border-top: 1px solid #e5e7eb; }
        .footer p { color: #6b7280; font-size: 12px; margin: 5px 0; }
        .company-info { margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>${settings?.websiteName || 'SatyamPay'}</h1>
          <p>Payment Receipt</p>
          <span class="receipt-badge">Receipt #${transaction.receiptNumber}</span>
        </div>
        
        <div class="content">
          <div style="text-align: center;">
            <div class="success-icon">
              <svg fill="white" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>
            </div>
            <h2 style="color: #1f2937; margin: 0;">Payment Successful</h2>
            <p style="color: #6b7280; margin-top: 5px;">Your payment has been processed successfully</p>
          </div>
          
          <div class="amount-box">
            <div class="label">Amount Received</div>
            <div class="amount">₹${transaction.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>
          </div>
          
          <table class="details-table">
            <tr>
              <td>Transaction ID</td>
              <td>${transaction.transactionId || transaction._id}</td>
            </tr>
            <tr>
              <td>Date & Time</td>
              <td>${formattedDate}</td>
            </tr>
            <tr>
              <td>Payment Method</td>
              <td style="text-transform: uppercase;">${transaction.method || 'N/A'}</td>
            </tr>
            <tr>
              <td>Category</td>
              <td style="text-transform: capitalize;">${transaction.category || 'Payment'}</td>
            </tr>
            ${transaction.customerName ? `
            <tr>
              <td>Customer Name</td>
              <td>${transaction.customerName}</td>
            </tr>
            ` : ''}
            ${transaction.fee > 0 ? `
            <tr>
              <td>Processing Fee</td>
              <td>₹${transaction.fee?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            <tr>
              <td>Net Amount</td>
              <td>₹${transaction.netAmount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
            </tr>
            ` : ''}
            <tr>
              <td>Status</td>
              <td><span class="status-badge ${transaction.status === 'Success' || transaction.status === 'Completed' ? 'status-success' : 'status-pending'}">${transaction.status}</span></td>
            </tr>
          </table>
          
          ${transaction.notes ? `
          <div style="background: #f3f4f6; padding: 15px; border-radius: 8px; margin-top: 20px;">
            <p style="margin: 0; color: #6b7280; font-size: 12px;">Notes</p>
            <p style="margin: 5px 0 0; color: #1f2937;">${transaction.notes}</p>
          </div>
          ` : ''}
        </div>
        
        <div class="footer">
          <div class="company-info">
            <p><strong>${settings?.websiteName || 'SatyamPay'}</strong></p>
            <p>${settings?.websiteEmail || 'support@satyampay.com'} | ${settings?.websitePhone || '+91 1800 123 456'}</p>
            <p>${settings?.address || ''}, ${settings?.city || ''}, ${settings?.state || ''}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
};

// Generate and send receipt
router.post("/receipt/send/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;
    const { email } = req.body; // Optional custom email

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const user = await User.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const settings = await Settings.getSettings();

    // Generate receipt number if not exists
    if (!transaction.receiptNumber) {
      transaction.receiptNumber = generateReceiptNumber();
    }

    const recipientEmail = email || user.email;
    const receiptHTML = await generateReceiptHTML(transaction, user, settings);

    // Generate PDF from HTML
    const pdfBuffer = await generatePDF(receiptHTML);

    // Send email with PDF attachment
    await transporter.sendMail({
      from: `"${settings?.websiteName || 'SatyamPay'}" <${process.env.EMAIL_USER}>`,
      to: recipientEmail,
      subject: `Payment Receipt - ${transaction.receiptNumber}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="color: white; margin: 0; font-size: 24px;">${settings?.websiteName || 'SatyamPay'}</h1>
            <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0;">Payment Receipt</p>
          </div>
          <div style="background: #f9fafb; padding: 30px; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb; border-top: none;">
            <p style="color: #1f2937; font-size: 16px; margin-bottom: 20px;">Dear ${user.fullName || 'Valued Customer'},</p>
            <p style="color: #6b7280; line-height: 1.6;">
              Thank you for your payment. Please find your payment receipt attached as a PDF document.
            </p>
            <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">
              <p style="color: #6b7280; font-size: 14px; margin: 0 0 5px 0;">Amount Received</p>
              <p style="color: #059669; font-size: 28px; font-weight: bold; margin: 0;">₹${transaction.amount?.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</p>
            </div>
            <div style="background: white; border-radius: 8px; padding: 15px; margin: 20px 0;">
              <p style="margin: 5px 0; color: #6b7280;"><strong>Receipt Number:</strong> <span style="color: #4f46e5;">${transaction.receiptNumber}</span></p>
              <p style="margin: 5px 0; color: #6b7280;"><strong>Transaction ID:</strong> ${transaction.transactionId || transaction._id}</p>
              <p style="margin: 5px 0; color: #6b7280;"><strong>Date:</strong> ${new Date(transaction.createdAt).toLocaleString('en-IN')}</p>
            </div>
            <p style="color: #6b7280; font-size: 14px; margin-top: 20px;">
              📎 <strong>PDF Receipt Attached</strong> - Please download and save for your records.
            </p>
            <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
            <p style="color: #9ca3af; font-size: 12px; text-align: center;">
              This is an auto-generated email. Please do not reply to this email.<br>
              ${settings?.websiteName || 'SatyamPay'} | ${settings?.websiteEmail || ''} | ${settings?.websitePhone || ''}
            </p>
          </div>
        </div>
      `,
      attachments: [
        {
          filename: `Receipt_${transaction.receiptNumber}.pdf`,
          content: pdfBuffer,
          contentType: 'application/pdf'
        }
      ]
    });

    // Update transaction
    transaction.receiptGenerated = true;
    transaction.receiptSentAt = new Date();
    transaction.receiptSentTo = recipientEmail;
    await transaction.save();

    res.json({
      success: true,
      message: `Receipt sent successfully to ${recipientEmail}`,
      receiptNumber: transaction.receiptNumber,
    });
  } catch (error) {
    console.error("Receipt send error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get receipt details
router.get("/receipt/:transactionId", async (req, res) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate("userId", "fullName email phone");

    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const settings = await Settings.getSettings();

    // Generate receipt number if not exists
    if (!transaction.receiptNumber) {
      transaction.receiptNumber = generateReceiptNumber();
      await transaction.save();
    }

    res.json({
      transaction,
      settings: {
        websiteName: settings?.websiteName,
        websiteEmail: settings?.websiteEmail,
        websitePhone: settings?.websitePhone,
        address: settings?.address,
        city: settings?.city,
        state: settings?.state,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Download receipt PDF
router.get("/receipt/download/:transactionId", async (req, res) => {
  try {
    const { transactionId } = req.params;

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: "Transaction not found" });
    }

    const user = await User.findById(transaction.userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const settings = await Settings.getSettings();

    // Generate receipt number if not exists
    if (!transaction.receiptNumber) {
      transaction.receiptNumber = generateReceiptNumber();
      await transaction.save();
    }

    const receiptHTML = await generateReceiptHTML(transaction, user, settings);

    // Generate PDF from HTML
    const pdfBuffer = await generatePDF(receiptHTML);

    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=Receipt_${transaction.receiptNumber}.pdf`);
    res.setHeader('Content-Length', pdfBuffer.length);

    res.send(pdfBuffer);
  } catch (error) {
    console.error("Receipt download error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
