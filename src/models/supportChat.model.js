const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: {
    type: String,
    enum: ["user", "admin"],
    required: true,
  },
  message: {
    type: String,
    required: false,
  },
  fileName: {
    type: String,
  },
  filePath: {
    type: String,
  },
  fileType: {
    type: String,
  },
  readAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const supportChatSchema = new mongoose.Schema(
  {
    chatId: {
      type: String,
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    subject: {
      type: String,
      default: "General Support",
    },
    status: {
      type: String,
      enum: ["open", "pending", "resolved", "closed"],
      default: "open",
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high"],
      default: "medium",
    },
    messages: [messageSchema],
    lastMessage: {
      type: String,
    },
    lastMessageAt: {
      type: Date,
      default: Date.now,
    },
    unreadByUser: {
      type: Number,
      default: 0,
    },
    unreadByAdmin: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Index for quick lookups
supportChatSchema.index({ userId: 1, status: 1 });
supportChatSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model("SupportChat", supportChatSchema);
