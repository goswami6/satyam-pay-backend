const express = require("express");
const router = express.Router();
const razorpay = require("../config/razorpay");
const { getRazorpayInstance, getActiveGatewaySettings, createGatewayOrder, verifyPayUHash } = require("../config/gatewayHelper");
const upload = require("../middlewares/upload.middleware");
const crypto = require("crypto");

const User = require("../models/user.model");
const Transaction = require("../models/transaction.model");
const Withdrawal = require("../models/withdrawal.model");
const PaymentLink = require("../models/paymentLink.model");
const paymentController = require("../controllers/paymentController");


// ============================
// CREATE ORDER (Wallet Deposit)
// ============================
router.post("/create-order", async (req, res) => {
  try {
    const { amount, userId } = req.body;

    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: "Invalid amount" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const result = await createGatewayOrder(amount, {
      receipt: "deposit_" + Date.now(),
      productinfo: "Wallet Deposit",
      firstname: "User",
      email: "user@satyampay.com",
      udf1: userId || "",
      surl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`,
      furl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`,
    });

    return res.json({
      success: true,
      ...result,
    });

  } catch (error) {
    console.error("Create Order Error:", error);
    res.status(500).json({ error: error.message });
  }
});


// ============================
// VERIFY PAYMENT (Wallet Deposit)
// ============================
router.post("/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      userId,
      amount,
    } = req.body;

    // Validate input
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !userId || !amount) {
      return res.status(400).json({ success: false, message: "Missing payment details" });
    }

    // Generate signature using active gateway secret
    const { settings: gwSettings } = await getRazorpayInstance();
    const sign = razorpay_order_id + "|" + razorpay_payment_id;

    const expectedSign = crypto
      .createHmac("sha256", gwSettings.keySecret)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      // ✅ Update user balance
      await User.findByIdAndUpdate(userId, {
        $inc: { balance: Number(amount) }
      });

      // 📝 Create transaction record
      await Transaction.create({
        userId,
        transactionId: razorpay_payment_id,
        description: "Wallet Deposit via Razorpay",
        type: "Credit",
        amount: Number(amount),
        status: "Completed",
      });

      return res.json({
        success: true,
        message: "Payment verified & balance updated"
      });

    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid signature"
      });
    }
  } catch (error) {
    console.error("Verify Error:", error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});


// ============================
// PAYU SUCCESS CALLBACK
// ============================
router.post("/payu/success", async (req, res) => {
  try {
    const { mihpayid, status, txnid, amount, productinfo, firstname, email, hash, key, udf1, udf2, udf3, udf4, udf5 } = req.body;

    const { settings } = await getRazorpayInstance();

    // Verify hash
    const expectedHash = verifyPayUHash(
      { status, txnid, amount, productinfo, firstname, email, key: settings.keyId, udf1, udf2, udf3, udf4, udf5 },
      settings.keySecret
    );

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

    if (hash === expectedHash && status === "success") {
      // udf1 contains userId for deposits, udf2 contains linkId/qrId for checkouts
      const userId = udf1;
      const linkId = udf2;
      const flowType = udf3 || "deposit"; // deposit, checkout, qr

      if (flowType === "deposit" && userId) {
        await User.findByIdAndUpdate(userId, {
          $inc: { balance: Number(amount) },
        });

        await Transaction.create({
          userId,
          transactionId: mihpayid || txnid,
          description: "Wallet Deposit via PayU",
          type: "Credit",
          amount: Number(amount),
          status: "Completed",
        });

        return res.redirect(`${frontendUrl}/user/deposit-money?status=success&amount=${amount}`);
      } else if (flowType === "checkout" && linkId) {
        const paymentLink = await PaymentLink.findOne({ linkId });
        if (paymentLink) {
          paymentLink.status = "paid";
          paymentLink.razorpayPaymentId = mihpayid || txnid;
          paymentLink.paidAt = new Date();
          await paymentLink.save();

          await User.findByIdAndUpdate(paymentLink.userId, {
            $inc: { balance: Number(paymentLink.amount) },
          });

          await Transaction.create({
            userId: paymentLink.userId,
            transactionId: mihpayid || txnid,
            description: `Payment from ${paymentLink.customerName} via PayU`,
            type: "Credit",
            amount: Number(paymentLink.amount),
            status: "Completed",
          });
        }
        return res.redirect(`${frontendUrl}/payment/success?linkId=${linkId}`);
      } else if (flowType === "qr" && linkId) {
        const QRCode = require("../models/qrCode.model");
        const qrCode = await QRCode.findOne({ qrId: linkId });
        if (qrCode) {
          qrCode.status = "paid";
          qrCode.razorpayPaymentId = mihpayid || txnid;
          qrCode.paidAt = new Date();
          qrCode.paidBy = {
            name: firstname || "Customer",
            email: email || "",
          };
          await qrCode.save();

          await User.findByIdAndUpdate(qrCode.userId, {
            $inc: { balance: Number(qrCode.amount) },
          });

          await Transaction.create({
            userId: qrCode.userId,
            transactionId: mihpayid || txnid,
            description: `QR Payment from ${firstname || "Customer"} via PayU`,
            type: "Credit",
            amount: Number(qrCode.amount),
            status: "Completed",
          });
        }
        return res.redirect(`${frontendUrl}/payment/success?qrId=${linkId}`);
      }

      return res.redirect(`${frontendUrl}/user/deposit-money?status=success`);
    } else {
      return res.redirect(`${frontendUrl}/payment/failed?reason=hash_mismatch`);
    }
  } catch (error) {
    console.error("PayU Success Callback Error:", error);
    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    return res.redirect(`${frontendUrl}/payment/failed?reason=server_error`);
  }
});

// ============================
// PAYU FAILURE CALLBACK
// ============================
router.post("/payu/failure", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const { udf2, udf3 } = req.body;

  if (udf3 === "checkout" && udf2) {
    return res.redirect(`${frontendUrl}/payment/failed?linkId=${udf2}`);
  } else if (udf3 === "qr" && udf2) {
    return res.redirect(`${frontendUrl}/payment/failed?qrId=${udf2}`);
  }

  return res.redirect(`${frontendUrl}/user/deposit-money?status=failed`);
});


// ============================
// REQUEST MONEY
// ============================
router.post("/request-money", paymentController.requestMoney);


// ============================
// RAZORPAY WEBHOOK
// IMPORTANT: Must use RAW body
// ============================
router.post(
  "/webhook",
  express.raw({ type: "application/json" }),
  paymentController.razorpayWebhook
);


// ============================
// BULK PAYOUT UPLOAD
// ============================
const fs = require("fs");
const csv = require("csv-parser");
const BulkPayout = require("../models/bulkPayout.model");

router.post("/bulk-upload", upload.single("file"), async (req, res) => {
  try {
    console.log("📁 Bulk upload request received");
    console.log("📁 req.body:", req.body);
    console.log("📁 req.file:", req.file);

    const { userId } = req.body;

    if (!userId || userId === "null") {
      return res.status(400).json({ message: "User ID required" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "File required" });
    }

    // Validate file type
    const allowedTypes = ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'];
    if (!allowedTypes.includes(req.file.mimetype)) {
      return res.status(400).json({ message: "Only Excel or CSV files allowed" });
    }

    // ✅ Parse CSV file
    const filePath = req.file.path;
    const results = [];
    let totalAmount = 0;
    let firstRow = null;

    // Helper to normalize column names (trim whitespace, remove BOM, lowercase, remove spaces)
    const normalizeKey = (key) => key.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/\s+/g, '');

    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csv())
        .on("data", (data) => {
          // Log first row to see column names
          if (!firstRow) {
            firstRow = data;
            console.log("📊 CSV Columns detected:", Object.keys(data));
            console.log("📊 First row data:", data);
          }

          // Normalize keys to handle BOM, whitespace, and case
          const normalizedData = {};
          Object.keys(data).forEach(key => {
            normalizedData[normalizeKey(key)] = data[key];
          });

          // Map column names for bank transfer payout
          const row = {
            accountHolderName: normalizedData.accountholdername || normalizedData.name || "",
            accountNumber: normalizedData.accountnumber || normalizedData.account || "",
            ifsc: normalizedData.ifsc || normalizedData.ifsccode || "",
            bankName: normalizedData.bankname || normalizedData.bank || "",
            amount: parseFloat(normalizedData.amount) || 0,
          };

          if (row.accountHolderName && row.accountNumber && row.ifsc && row.bankName && row.amount > 0) {
            results.push(row);
            totalAmount += row.amount;
          }
        })
        .on("end", async () => {
          try {
            if (results.length === 0) {
              fs.unlinkSync(filePath); // Delete file if no valid data
              console.log("❌ No valid records. Expected columns: Account Holder Name, Account Number, IFSC, Bank Name, Amount");
              console.log("❌ Detected columns:", firstRow ? Object.keys(firstRow) : "none");
              return res.status(400).json({
                message: "No valid records found. Required columns: Account Holder Name, Account Number, IFSC, Bank Name, Amount",
                detectedColumns: firstRow ? Object.keys(firstRow) : []
              });
            }

            // ✅ Save bulk payout to database
            const bulkPayout = await BulkPayout.create({
              userId,
              fileName: req.file.originalname,
              totalAmount,
              totalRows: results.length,
              status: "Pending",
              payoutData: results, // Store parsed data for admin to process
            });

            // ✅ Save to session/cache for admin to process
            console.log("✅ Bulk Payout Created:", {
              id: bulkPayout._id,
              fileName: bulkPayout.fileName,
              totalRows: results.length,
              totalAmount,
              data: results
            });

            // Clean up temp file
            fs.unlinkSync(filePath);

            res.json({
              success: true,
              message: "File uploaded successfully",
              bulkPayoutId: bulkPayout._id,
              totalRows: results.length,
              totalAmount,
            });

            resolve();
          } catch (error) {
            fs.unlinkSync(filePath);
            reject(error);
          }
        })
        .on("error", (error) => {
          fs.unlinkSync(filePath);
          reject(error);
        });
    }).catch(error => {
      res.status(500).json({ message: error.message || "File processing failed" });
    });

  } catch (error) {
    console.error("Bulk upload error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// GENERATE PAYMENT LINK
// ============================
router.post("/generate-link", async (req, res) => {
  try {
    const { name, email, amount, description, userId, dueDate } = req.body;

    if (!name || !email || !amount || !userId) {
      return res.status(400).json({ message: "All fields required" });
    }

    // Get sender details
    const sender = await User.findById(userId);
    if (!sender) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate unique link ID
    const linkId = "PAY" + Date.now() + Math.random().toString(36).substring(2, 8).toUpperCase();

    // Save to database
    await PaymentLink.create({
      linkId,
      userId,
      customerName: name,
      customerEmail: email,
      amount: Number(amount),
      description: description || `Payment request from ${sender.fullName}`,
      dueDate: dueDate || null,
      status: "pending",
    });

    // Generate our checkout URL
    const checkoutUrl = `${process.env.FRONTEND_URL || "http://localhost:5173"}/pay/${linkId}`;

    // Send professional email
    const transporter = require("../config/mailer");

    const dueDateText = dueDate
      ? `<tr>
          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
            <span style="color: #64748b; font-size: 14px;">Due Date</span>
          </td>
          <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
            <span style="color: #1e293b; font-weight: 600; font-size: 14px;">${new Date(dueDate).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
          </td>
        </tr>`
      : '';

    const emailHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 40px 20px;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
              
              <!-- Header -->
              <tr>
                <td style="background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); padding: 40px 40px 30px;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">SatyamPay</h1>
                        <p style="margin: 8px 0 0; color: rgba(255,255,255,0.8); font-size: 14px;">Secure Payment Request</p>
                      </td>
                      <td align="right">
                        <div style="width: 50px; height: 50px; background: rgba(255,255,255,0.2); border-radius: 12px; display: inline-block; text-align: center; line-height: 50px;">
                          <span style="color: #fff; font-size: 24px;">₹</span>
                        </div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

              <!-- Main Content -->
              <tr>
                <td style="padding: 40px;">
                  
                  <!-- Greeting -->
                  <p style="margin: 0 0 20px; color: #1e293b; font-size: 16px; line-height: 1.6;">
                    Hello <strong>${name}</strong>,
                  </p>
                  
                  <p style="margin: 0 0 30px; color: #475569; font-size: 15px; line-height: 1.7;">
                    You have received a payment request from <strong style="color: #4f46e5;">${sender.fullName}</strong>. Please review the details below and complete the payment at your convenience.
                  </p>

                  <!-- Amount Card -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 12px; margin-bottom: 30px;">
                    <tr>
                      <td style="padding: 30px; text-align: center;">
                        <p style="margin: 0 0 8px; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 1px;">Amount Requested</p>
                        <p style="margin: 0; color: #1e293b; font-size: 42px; font-weight: 800;">
                          <span style="color: #4f46e5;">₹</span>${Number(amount).toLocaleString('en-IN')}
                        </p>
                      </td>
                    </tr>
                  </table>

                  <!-- Details Table -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 30px;">
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                        <span style="color: #64748b; font-size: 14px;">Requested By</span>
                      </td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                        <span style="color: #1e293b; font-weight: 600; font-size: 14px;">${sender.fullName}</span>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0;">
                        <span style="color: #64748b; font-size: 14px;">Email</span>
                      </td>
                      <td style="padding: 12px 0; border-bottom: 1px solid #e2e8f0; text-align: right;">
                        <span style="color: #1e293b; font-weight: 600; font-size: 14px;">${sender.email}</span>
                      </td>
                    </tr>
                    ${dueDateText}
                    ${description ? `
                    <tr>
                      <td colspan="2" style="padding: 16px 0;">
                        <span style="color: #64748b; font-size: 14px; display: block; margin-bottom: 8px;">Description</span>
                        <p style="margin: 0; color: #1e293b; font-size: 14px; background: #f8fafc; padding: 12px; border-radius: 8px; border-left: 3px solid #4f46e5;">${description}</p>
                      </td>
                    </tr>
                    ` : ''}
                  </table>

                  <!-- Pay Button -->
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td align="center">
                        <a href="${checkoutUrl}" style="display: inline-block; background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%); color: #ffffff; text-decoration: none; padding: 18px 50px; border-radius: 12px; font-size: 16px; font-weight: 700; box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);">
                          Pay ₹${Number(amount).toLocaleString('en-IN')} Now →
                        </a>
                      </td>
                    </tr>
                  </table>

                  <!-- Security Note -->
                  <table width="100%" cellpadding="0" cellspacing="0" style="margin-top: 30px;">
                    <tr>
                      <td style="background: #f0fdf4; border-radius: 8px; padding: 16px;">
                        <table cellpadding="0" cellspacing="0">
                          <tr>
                            <td style="padding-right: 12px;">
                              <span style="color: #22c55e; font-size: 20px;">🔒</span>
                            </td>
                            <td>
                              <p style="margin: 0; color: #166534; font-size: 13px; line-height: 1.5;">
                                <strong>100% Secure Payment</strong><br>
                                Pay safely via UPI, Cards, or Net Banking. Your data is encrypted and protected.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>

                </td>
              </tr>

              <!-- Footer -->
              <tr>
                <td style="background: #f8fafc; padding: 30px 40px; border-top: 1px solid #e2e8f0;">
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td>
                        <p style="margin: 0 0 8px; color: #64748b; font-size: 12px;">
                          This is an automated payment request from SatyamPay.
                        </p>
                        <p style="margin: 0; color: #94a3b8; font-size: 11px;">
                          If you did not expect this request, please ignore this email or contact support.
                        </p>
                      </td>
                    </tr>
                    <tr>
                      <td style="padding-top: 20px;">
                        <p style="margin: 0; color: #94a3b8; font-size: 11px; text-align: center;">
                          © ${new Date().getFullYear()} SatyamPay. All rights reserved.
                        </p>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>

            </table>
          </td>
        </tr>
      </table>
    </body>
    </html>
    `;

    // Send email
    await transporter.sendMail({
      from: `"SatyamPay" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: `💰 Payment Request from ${sender.fullName} - ₹${Number(amount).toLocaleString('en-IN')}`,
      html: emailHTML,
    });

    res.json({
      success: true,
      message: "Payment link generated and email sent successfully",
      paymentLink: checkoutUrl,
      linkId: linkId,
    });

  } catch (error) {
    console.error("Generate Link Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// GET PAYMENT LINK DATA (for checkout page)
// ============================
router.get("/checkout/:linkId", async (req, res) => {
  try {
    const { linkId } = req.params;

    const paymentLink = await PaymentLink.findOne({ linkId }).populate("userId", "fullName email");

    if (!paymentLink) {
      return res.status(404).json({ message: "Payment link not found" });
    }

    if (paymentLink.status === "paid") {
      return res.status(400).json({ message: "Payment already completed", status: "paid" });
    }

    if (paymentLink.status === "expired" || paymentLink.status === "cancelled") {
      return res.status(400).json({ message: "Payment link is no longer valid", status: paymentLink.status });
    }

    // Check if expired by due date
    if (paymentLink.dueDate && new Date(paymentLink.dueDate) < new Date()) {
      paymentLink.status = "expired";
      await paymentLink.save();
      return res.status(400).json({ message: "Payment link has expired", status: "expired" });
    }

    res.json({
      success: true,
      paymentLink: {
        linkId: paymentLink.linkId,
        amount: paymentLink.amount,
        description: paymentLink.description,
        customerName: paymentLink.customerName,
        customerEmail: paymentLink.customerEmail,
        merchant: paymentLink.userId?.fullName || "Merchant",
        merchantEmail: paymentLink.userId?.email,
        dueDate: paymentLink.dueDate,
      },
    });
  } catch (error) {
    console.error("Get Checkout Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// CREATE ORDER FOR CHECKOUT
// ============================
router.post("/checkout/create-order", async (req, res) => {
  try {
    const { linkId } = req.body;

    const paymentLink = await PaymentLink.findOne({ linkId });

    if (!paymentLink) {
      return res.status(404).json({ message: "Payment link not found" });
    }

    if (paymentLink.status !== "pending") {
      return res.status(400).json({ message: "Payment link is no longer valid" });
    }

    const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const result = await createGatewayOrder(paymentLink.amount, {
      receipt: `checkout_${linkId}`,
      productinfo: paymentLink.description || "Payment",
      firstname: paymentLink.customerName || "Customer",
      email: paymentLink.customerEmail || "customer@example.com",
      udf1: paymentLink.userId?.toString() || "",
      udf2: linkId,
      udf3: "checkout",
      surl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/success`,
      furl: `${process.env.BACKEND_URL || "http://localhost:5000"}/api/payment/payu/failure`,
      notes: { linkId, customerEmail: paymentLink.customerEmail },
    });

    if (result.gateway === "razorpay" && result.order) {
      paymentLink.razorpayOrderId = result.order.id;
      await paymentLink.save();
    }

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Create Checkout Order Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// VERIFY CHECKOUT PAYMENT
// ============================
router.post("/checkout/verify", async (req, res) => {
  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      linkId,
    } = req.body;

    // Validate input
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !linkId) {
      return res.status(400).json({ success: false, message: "Missing payment details" });
    }

    const paymentLink = await PaymentLink.findOne({ linkId });
    if (!paymentLink) {
      return res.status(404).json({ success: false, message: "Payment link not found" });
    }

    // Generate signature using active gateway secret
    const sign = razorpay_order_id + "|" + razorpay_payment_id;
    const { settings: checkoutGwSettings } = await getRazorpayInstance();
    const expectedSign = crypto
      .createHmac("sha256", checkoutGwSettings.keySecret)
      .update(sign)
      .digest("hex");

    if (expectedSign === razorpay_signature) {
      // Update payment link
      paymentLink.status = "paid";
      paymentLink.razorpayPaymentId = razorpay_payment_id;
      paymentLink.paidAt = new Date();
      await paymentLink.save();

      // Credit user balance
      await User.findByIdAndUpdate(paymentLink.userId, {
        $inc: { balance: Number(paymentLink.amount) },
      });

      // Create transaction record
      await Transaction.create({
        userId: paymentLink.userId,
        transactionId: razorpay_payment_id,
        description: `Payment from ${paymentLink.customerName}`,
        type: "Credit",
        amount: Number(paymentLink.amount),
        status: "Completed",
      });

      return res.json({
        success: true,
        message: "Payment successful",
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Invalid signature",
      });
    }
  } catch (error) {
    console.error("Verify Checkout Error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
});


// ============================
// WITHDRAWAL REQUEST
// ============================
router.post("/withdraw", async (req, res) => {
  try {
    const { userId, amount, accountName, accountNumber, ifsc } = req.body;

    // 1️⃣ Validation
    if (!userId || !amount || !accountName || !accountNumber || !ifsc) {
      return res.status(400).json({ message: "All fields required" });
    }

    const withdrawAmount = Number(amount);

    if (withdrawAmount < 50) {
      return res.status(400).json({ message: "Minimum withdrawal is ₹50" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // 2️⃣ Commission calculation (₹0.02 or 1%)
    const commission = Math.max(0.02, withdrawAmount * 0.01);
    const total = withdrawAmount + commission;

    if (total > user.balance) {
      return res.status(400).json({
        message: `Insufficient balance. Required ₹${total.toFixed(2)}, Available ₹${user.balance.toFixed(2)}`
      });
    }

    // 3️⃣ Create Withdrawal Request (Balance NOT deducted yet)
    const withdrawal = await Withdrawal.create({
      userId,
      withdrawalId: "WD" + Date.now(),
      amount: withdrawAmount,
      commission,
      total,
      accountName,
      accountNumber,
      ifsc,
      type: "payout",
      status: "Pending"
    });

    // 4️⃣ Create Pending Transaction Record
    await Transaction.create({
      userId,
      transactionId: withdrawal.withdrawalId,
      description: `Withdrawal Request to Bank (${accountNumber.slice(-4)})`,
      amount: withdrawAmount,
      type: "Debit",
      status: "Pending"
    });

    res.json({
      success: true,
      message: "Payout request submitted. Awaiting admin approval.",
      withdrawal,
    });

  } catch (error) {
    console.error("Withdraw Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// ADMIN: APPROVE WITHDRAWAL
// ============================
router.post("/admin/approve/:id", async (req, res) => {
  try {
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (withdrawal.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    const user = await User.findById(withdrawal.userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (withdrawal.total > user.balance) {
      return res.status(400).json({ message: "Insufficient balance now" });
    }

    // Deduct balance from user wallet
    user.balance -= withdrawal.total;
    await user.save();

    // Update withdrawal status
    withdrawal.status = "Approved";
    withdrawal.approvedAt = new Date();
    await withdrawal.save();

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { transactionId: withdrawal.withdrawalId },
      { status: "Completed" }
    );

    res.json({
      success: true,
      message: "Withdrawal approved & balance deducted",
      withdrawal
    });

  } catch (error) {
    console.error("Approve Withdrawal Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// ADMIN: REJECT WITHDRAWAL
// ============================
router.post("/admin/reject/:id", async (req, res) => {
  try {
    const { reason } = req.body;
    const withdrawal = await Withdrawal.findById(req.params.id);

    if (!withdrawal) {
      return res.status(404).json({ message: "Withdrawal not found" });
    }

    if (withdrawal.status !== "Pending") {
      return res.status(400).json({ message: "Already processed" });
    }

    // Update withdrawal status
    withdrawal.status = "Rejected";
    withdrawal.rejectionReason = reason || "Rejected by admin";
    withdrawal.rejectedAt = new Date();
    await withdrawal.save();

    // Update transaction status
    await Transaction.findOneAndUpdate(
      { transactionId: withdrawal.withdrawalId },
      { status: "Failed" }
    );

    res.json({
      success: true,
      message: "Withdrawal rejected",
      withdrawal
    });

  } catch (error) {
    console.error("Reject Withdrawal Error:", error);
    res.status(500).json({ message: error.message });
  }
});


// ============================
// GET ALL PAYOUTS (Admin) - Only type="payout"
// ============================
router.get("/admin/withdrawals", async (req, res) => {
  try {
    const withdrawals = await Withdrawal.find({ type: "payout" }).populate("userId", "fullName email").sort({ createdAt: -1 });

    res.json({
      success: true,
      withdrawals,
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


// ============================
// GET USER TRANSACTIONS
// ============================
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const transactions = await Transaction.find({ userId }).sort({ createdAt: -1 });

    res.json({
      success: true,
      transactions,
    });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


module.exports = router;
