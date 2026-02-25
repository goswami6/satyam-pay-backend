const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const connectDB = require("./config/db");
const withdrawRoutes = require("./routes/withdraw.routes");
const transactionRoutes = require("./routes/transaction.routes");
const adminBulkRoutes = require("./routes/BulkPayout.routes");



const app = express();

// Connect Database
connectDB();

// CORS Configuration for Production
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://localhost:5174",
  process.env.FRONTEND_URL
].filter(Boolean);

// Middlewares
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, etc)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(null, true); // Allow all origins in development, restrict in production if needed
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"]
}));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

// ✅ Serve Static Files (uploads folder) - CORS enabled
app.use("/uploads", (req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
  next();
}, express.static(path.join(__dirname, "../uploads")));

// Routes
app.use("/api/users", require("./routes/user.routes"));
app.use("/api/payment", require("./routes/payment.routes"));
app.use("/api/withdraw", withdrawRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/bulk", adminBulkRoutes);
app.use("/api/bank", require("./routes/bank.routes"));
app.use("/api/qr", require("./routes/qr.routes"));
app.use("/api/api-tokens", require("./routes/apiToken.routes"));
app.use("/api/reports", require("./routes/report.routes"));
app.use("/api/support", require("./routes/support.routes"));
app.use("/api/dashboard", require("./routes/dashboard.routes"));
app.use("/api/gateway", require("./routes/gateway.routes"));
app.use("/api/payout-requests", require("./routes/payoutRequest.routes"));
app.use("/api/settings", require("./routes/settings.routes"));
app.use("/api/enquiry", require("./routes/enquiry.routes"));

// ✅ Public API Routes (v1) - For merchant integrations
app.use("/api/v1", require("./routes/api.v1.routes"));



module.exports = app;
