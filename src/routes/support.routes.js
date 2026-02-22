const express = require("express");
const router = express.Router();
const SupportChat = require("../models/supportChat.model");
const User = require("../models/user.model");
const upload = require("../middlewares/upload.middleware");

// ============================
// GET OR CREATE USER'S CHAT
// ============================
router.get("/chat/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    // Find existing open chat or create new one
    let chat = await SupportChat.findOne({
      userId,
      status: { $in: ["open", "pending"] },
    });

    if (!chat) {
      const chatId = "CHAT" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

      chat = await SupportChat.create({
        chatId,
        userId,
        subject: "Support Chat",
        status: "open",
        messages: [
          {
            sender: "admin",
            message: "Hello! Welcome to SatyamPay Support. How can we help you today?",
            createdAt: new Date(),
          },
        ],
        lastMessage: "Hello! Welcome to SatyamPay Support. How can we help you today?",
        lastMessageAt: new Date(),
      });
    }

    // Mark admin messages as read
    if (chat.unreadByUser > 0) {
      chat.messages.forEach((msg) => {
        if (msg.sender === "admin" && !msg.readAt) {
          msg.readAt = new Date();
        }
      });
      chat.unreadByUser = 0;
      await chat.save();
    }

    res.json({
      success: true,
      chat: {
        chatId: chat.chatId,
        status: chat.status,
        messages: chat.messages,
        unreadByUser: chat.unreadByUser,
      },
    });
  } catch (error) {
    console.error("Get Chat Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// SEND MESSAGE (USER)
// ============================
router.post("/chat/:userId/send", async (req, res) => {
  try {
    const { userId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    let chat = await SupportChat.findOne({
      userId,
      status: { $in: ["open", "pending"] },
    });

    if (!chat) {
      const chatId = "CHAT" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();

      chat = await SupportChat.create({
        chatId,
        userId,
        subject: "Support Chat",
        status: "open",
        messages: [],
      });
    }

    // Add user message
    chat.messages.push({
      sender: "user",
      message: message.trim(),
      createdAt: new Date(),
    });

    chat.lastMessage = message.trim();
    chat.lastMessageAt = new Date();
    chat.unreadByAdmin += 1;
    chat.status = "pending"; // Mark as pending for admin attention

    await chat.save();

    res.json({
      success: true,
      message: "Message sent successfully",
      chat: {
        chatId: chat.chatId,
        status: chat.status,
        messages: chat.messages,
      },
    });
  } catch (error) {
    console.error("Send Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// SEND FILE MESSAGE (USER)
// ============================
router.post("/chat/:userId/send-file", upload.single("file"), async (req, res) => {
  try {
    const { userId } = req.params;
    const { message } = req.body;
    const file = req.file;

    if (!message && !file) {
      return res.status(400).json({ message: "Message or file is required" });
    }

    let chat = await SupportChat.findOne({
      userId,
      status: { $in: ["open", "pending"] },
    });

    if (!chat) {
      const chatId = "CHAT" + Date.now() + Math.random().toString(36).substring(2, 6).toUpperCase();
      chat = await SupportChat.create({
        chatId,
        userId,
        subject: "Support Chat",
        status: "open",
        messages: [],
      });
    }

    // Add user message with file
    const msgObj = {
      sender: "user",
      message: message || "",
      createdAt: new Date(),
    };
    if (file) {
      msgObj.fileName = file.originalname;
      msgObj.filePath = file.filename;
      msgObj.fileType = file.mimetype;
    }
    chat.messages.push(msgObj);

    chat.lastMessage = message || (file ? file.originalname : "");
    chat.lastMessageAt = new Date();
    chat.unreadByAdmin += 1;
    chat.status = "pending";

    await chat.save();

    res.json({
      success: true,
      message: "File/message sent successfully",
      chat: {
        chatId: chat.chatId,
        status: chat.status,
        messages: chat.messages,
      },
    });
  } catch (error) {
    console.error("Send File Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET ALL CHATS (ADMIN)
// ============================
router.get("/admin/chats", async (req, res) => {
  try {
    const { status } = req.query;

    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const chats = await SupportChat.find(query)
      .populate("userId", "fullName email phone")
      .sort({ lastMessageAt: -1 })
      .limit(100);

    // Get stats
    const stats = await SupportChat.aggregate([
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const totalUnread = await SupportChat.aggregate([
      { $match: { unreadByAdmin: { $gt: 0 } } },
      { $group: { _id: null, total: { $sum: "$unreadByAdmin" } } },
    ]);

    res.json({
      success: true,
      chats,
      stats: {
        open: stats.find((s) => s._id === "open")?.count || 0,
        pending: stats.find((s) => s._id === "pending")?.count || 0,
        resolved: stats.find((s) => s._id === "resolved")?.count || 0,
        closed: stats.find((s) => s._id === "closed")?.count || 0,
        totalUnread: totalUnread[0]?.total || 0,
      },
    });
  } catch (error) {
    console.error("Get Admin Chats Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET SINGLE CHAT (ADMIN)
// ============================
router.get("/admin/chat/:chatId", async (req, res) => {
  try {
    const { chatId } = req.params;

    const chat = await SupportChat.findOne({ chatId }).populate(
      "userId",
      "fullName email phone balance"
    );

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // Mark user messages as read
    if (chat.unreadByAdmin > 0) {
      chat.messages.forEach((msg) => {
        if (msg.sender === "user" && !msg.readAt) {
          msg.readAt = new Date();
        }
      });
      chat.unreadByAdmin = 0;
      await chat.save();
    }

    res.json({
      success: true,
      chat,
    });
  } catch (error) {
    console.error("Get Admin Chat Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// SEND MESSAGE (ADMIN)
// ============================
router.post("/admin/chat/:chatId/send", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ message: "Message is required" });
    }

    const chat = await SupportChat.findOne({ chatId });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // Add admin message
    chat.messages.push({
      sender: "admin",
      message: message.trim(),
      createdAt: new Date(),
    });

    chat.lastMessage = message.trim();
    chat.lastMessageAt = new Date();
    chat.unreadByUser += 1;
    chat.status = "open"; // Reopen if was pending

    await chat.save();

    res.json({
      success: true,
      message: "Message sent successfully",
      chat,
    });
  } catch (error) {
    console.error("Admin Send Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// SEND FILE MESSAGE (ADMIN)
// ============================
router.post("/admin/chat/:chatId/send-file", upload.single("file"), async (req, res) => {
  try {
    const { chatId } = req.params;
    const { message } = req.body;
    const file = req.file;

    if (!message && !file) {
      return res.status(400).json({ message: "Message or file is required" });
    }

    const chat = await SupportChat.findOne({ chatId });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    // Add admin message with file
    const msgObj = {
      sender: "admin",
      message: message || "",
      createdAt: new Date(),
    };
    if (file) {
      msgObj.fileName = file.originalname;
      msgObj.filePath = file.filename;
      msgObj.fileType = file.mimetype;
    }
    chat.messages.push(msgObj);

    chat.lastMessage = message || (file ? file.originalname : "");
    chat.lastMessageAt = new Date();
    chat.unreadByUser += 1;
    chat.status = "open";

    await chat.save();

    res.json({
      success: true,
      message: "File/message sent successfully",
      chat,
    });
  } catch (error) {
    console.error("Admin Send File Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// UPDATE CHAT STATUS (ADMIN)
// ============================
router.patch("/admin/chat/:chatId/status", async (req, res) => {
  try {
    const { chatId } = req.params;
    const { status } = req.body;

    if (!["open", "pending", "resolved", "closed"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const chat = await SupportChat.findOneAndUpdate(
      { chatId },
      { status },
      { new: true }
    );

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    res.json({
      success: true,
      message: "Status updated successfully",
      chat,
    });
  } catch (error) {
    console.error("Update Chat Status Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// DELETE MESSAGE (USER)
// ============================
router.delete("/chat/:userId/message/:messageId", async (req, res) => {
  try {
    const { userId, messageId } = req.params;

    const chat = await SupportChat.findOne({
      userId,
      status: { $in: ["open", "pending"] },
    });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const msgIndex = chat.messages.findIndex(
      (m) => m._id.toString() === messageId && m.sender === "user"
    );

    if (msgIndex === -1) {
      return res.status(404).json({ message: "Message not found or not allowed to delete" });
    }

    chat.messages.splice(msgIndex, 1);

    // Update lastMessage if the deleted message was the last one
    if (chat.messages.length > 0) {
      const last = chat.messages[chat.messages.length - 1];
      chat.lastMessage = last.message || last.fileName || "";
      chat.lastMessageAt = last.createdAt;
    } else {
      chat.lastMessage = "";
      chat.lastMessageAt = new Date();
    }

    await chat.save();

    res.json({
      success: true,
      message: "Message deleted successfully",
      chat: {
        chatId: chat.chatId,
        status: chat.status,
        messages: chat.messages,
      },
    });
  } catch (error) {
    console.error("Delete Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// DELETE MESSAGE (ADMIN)
// ============================
router.delete("/admin/chat/:chatId/message/:messageId", async (req, res) => {
  try {
    const { chatId, messageId } = req.params;

    const chat = await SupportChat.findOne({ chatId });

    if (!chat) {
      return res.status(404).json({ message: "Chat not found" });
    }

    const msgIndex = chat.messages.findIndex(
      (m) => m._id.toString() === messageId
    );

    if (msgIndex === -1) {
      return res.status(404).json({ message: "Message not found" });
    }

    chat.messages.splice(msgIndex, 1);

    if (chat.messages.length > 0) {
      const last = chat.messages[chat.messages.length - 1];
      chat.lastMessage = last.message || last.fileName || "";
      chat.lastMessageAt = last.createdAt;
    } else {
      chat.lastMessage = "";
      chat.lastMessageAt = new Date();
    }

    await chat.save();

    res.json({
      success: true,
      message: "Message deleted successfully",
      chat,
    });
  } catch (error) {
    console.error("Admin Delete Message Error:", error);
    res.status(500).json({ message: error.message });
  }
});

// ============================
// GET UNREAD COUNT (USER)
// ============================
router.get("/unread/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const chat = await SupportChat.findOne({
      userId,
      status: { $in: ["open", "pending"] },
    });

    res.json({
      success: true,
      unreadCount: chat?.unreadByUser || 0,
    });
  } catch (error) {
    console.error("Get Unread Error:", error);
    res.status(500).json({ message: error.message });
  }
});



module.exports = router;
