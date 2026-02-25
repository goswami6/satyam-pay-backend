const express = require("express");
const router = express.Router();
const Enquiry = require("../models/enquiry.model");
const authMiddleware = require("../middlewares/auth.middleware");

// Submit new enquiry (Public)
router.post("/submit", async (req, res) => {
  try {
    const { fullName, email, phone, subject, message } = req.body;

    // Create new enquiry
    const enquiry = await Enquiry.create({
      fullName,
      email,
      phone,
      subject,
      message,
      ipAddress: req.ip || req.connection.remoteAddress,
    });

    res.status(201).json({
      success: true,
      message: "Your enquiry has been submitted successfully. We will get back to you soon!",
      data: {
        id: enquiry._id,
        createdAt: enquiry.createdAt,
      },
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({ success: false, message: errors[0] });
    }
    console.error("Enquiry submission error:", error);
    res.status(500).json({ success: false, message: "Failed to submit enquiry" });
  }
});

// Get all enquiries (Admin only)
router.get("/", authMiddleware, async (req, res) => {
  try {
    // Check if user is admin
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, search, page = 1, limit = 20 } = req.query;
    const query = {};

    // Filter by status
    if (status && status !== "all") {
      query.status = status;
    }

    // Search by name, email, or subject
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { subject: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Enquiry.countDocuments(query);
    const enquiries = await Enquiry.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get stats
    const stats = await Enquiry.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statsObj = {
      total: await Enquiry.countDocuments(),
      new: 0,
      read: 0,
      replied: 0,
      closed: 0,
    };

    stats.forEach((s) => {
      statsObj[s._id] = s.count;
    });

    res.json({
      success: true,
      data: enquiries,
      stats: statsObj,
      pagination: {
        total,
        pages: Math.ceil(total / parseInt(limit)),
        currentPage: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    console.error("Get enquiries error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiries" });
  }
});

// Get single enquiry (Admin only)
router.get("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    // Mark as read if new
    if (enquiry.status === "new") {
      enquiry.status = "read";
      await enquiry.save();
    }

    res.json({ success: true, data: enquiry });
  } catch (error) {
    console.error("Get enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch enquiry" });
  }
});

// Update enquiry status (Admin only)
router.put("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { status, adminNotes } = req.body;

    const enquiry = await Enquiry.findById(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    if (status) {
      enquiry.status = status;
      if (status === "replied") {
        enquiry.repliedAt = new Date();
      }
    }

    if (adminNotes !== undefined) {
      enquiry.adminNotes = adminNotes;
    }

    await enquiry.save();

    res.json({
      success: true,
      message: "Enquiry updated successfully",
      data: enquiry,
    });
  } catch (error) {
    console.error("Update enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to update enquiry" });
  }
});

// Delete enquiry (Admin only)
router.delete("/:id", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const enquiry = await Enquiry.findByIdAndDelete(req.params.id);
    if (!enquiry) {
      return res.status(404).json({ success: false, message: "Enquiry not found" });
    }

    res.json({ success: true, message: "Enquiry deleted successfully" });
  } catch (error) {
    console.error("Delete enquiry error:", error);
    res.status(500).json({ success: false, message: "Failed to delete enquiry" });
  }
});

// Bulk delete enquiries (Admin only)
router.post("/bulk-delete", authMiddleware, async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ success: false, message: "No enquiry IDs provided" });
    }

    const result = await Enquiry.deleteMany({ _id: { $in: ids } });

    res.json({
      success: true,
      message: `${result.deletedCount} enquir${result.deletedCount === 1 ? "y" : "ies"} deleted successfully`,
    });
  } catch (error) {
    console.error("Bulk delete error:", error);
    res.status(500).json({ success: false, message: "Failed to delete enquiries" });
  }
});

module.exports = router;
