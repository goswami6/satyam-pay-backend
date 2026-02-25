const express = require("express");
const router = express.Router();
const Settings = require("../models/settings.model");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../uploads/settings");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|ico|svg|webp/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    }
    cb(new Error("Only image files are allowed"));
  },
});

// Get settings (public route for user side)
router.get("/", async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json(settings);
  } catch (error) {
    console.error("Get settings error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get public settings (limited fields for frontend)
router.get("/public", async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      websiteName: settings.websiteName,
      websiteUrl: settings.websiteUrl,
      websiteEmail: settings.websiteEmail,
      websitePhone: settings.websitePhone,
      websiteDescription: settings.websiteDescription,
      metaKeywords: settings.metaKeywords,
      logo: settings.logo,
      favicon: settings.favicon,
      address: settings.address,
      city: settings.city,
      state: settings.state,
      country: settings.country,
      zipCode: settings.zipCode,
      socialLinks: settings.socialLinks,
    });
  } catch (error) {
    console.error("Get public settings error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Update settings (admin only)
router.put("/", upload.fields([
  { name: "logo", maxCount: 1 },
  { name: "favicon", maxCount: 1 }
]), async (req, res) => {
  try {
    const settings = await Settings.getSettings();

    // Update text fields
    const textFields = [
      "websiteName", "websiteUrl", "websiteEmail", "websitePhone",
      "websiteDescription", "metaKeywords", "address", "city",
      "state", "country", "zipCode"
    ];

    textFields.forEach((field) => {
      if (req.body[field] !== undefined) {
        settings[field] = req.body[field];
      }
    });

    // Update number fields
    if (req.body.commissionRate !== undefined) {
      settings.commissionRate = parseFloat(req.body.commissionRate);
    }
    if (req.body.minWithdrawal !== undefined) {
      settings.minWithdrawal = parseFloat(req.body.minWithdrawal);
    }
    if (req.body.maxWithdrawal !== undefined) {
      settings.maxWithdrawal = parseFloat(req.body.maxWithdrawal);
    }

    // Update social links
    if (req.body.socialLinks) {
      const socialLinks = typeof req.body.socialLinks === "string" 
        ? JSON.parse(req.body.socialLinks) 
        : req.body.socialLinks;
      settings.socialLinks = { ...settings.socialLinks, ...socialLinks };
    }

    // Update uploaded files
    if (req.files) {
      if (req.files.logo && req.files.logo[0]) {
        // Delete old logo if exists
        if (settings.logo) {
          const oldLogoPath = path.join(__dirname, "../../uploads/settings", settings.logo);
          if (fs.existsSync(oldLogoPath)) {
            fs.unlinkSync(oldLogoPath);
          }
        }
        settings.logo = req.files.logo[0].filename;
      }
      if (req.files.favicon && req.files.favicon[0]) {
        // Delete old favicon if exists
        if (settings.favicon) {
          const oldFaviconPath = path.join(__dirname, "../../uploads/settings", settings.favicon);
          if (fs.existsSync(oldFaviconPath)) {
            fs.unlinkSync(oldFaviconPath);
          }
        }
        settings.favicon = req.files.favicon[0].filename;
      }
    }

    await settings.save();
    res.json({ message: "Settings updated successfully", settings });
  } catch (error) {
    console.error("Update settings error:", error);
    res.status(500).json({ message: error.message });
  }
});

// Get payment settings only (for withdrawal calculations)
router.get("/payment", async (req, res) => {
  try {
    const settings = await Settings.getSettings();
    res.json({
      commissionRate: settings.commissionRate,
      minWithdrawal: settings.minWithdrawal,
      maxWithdrawal: settings.maxWithdrawal,
    });
  } catch (error) {
    console.error("Get payment settings error:", error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
