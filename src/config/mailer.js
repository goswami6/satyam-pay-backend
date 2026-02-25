const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  host: "smtp.hostinger.com",
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false,
  },
  connectionTimeout: 10000,  // 10s to establish connection
  greetingTimeout: 10000,    // 10s for SMTP greeting
  socketTimeout: 15000,      // 15s for socket inactivity
});

module.exports = transporter;
