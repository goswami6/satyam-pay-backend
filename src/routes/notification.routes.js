const express = require('express');
const router = express.Router();
const Notification = require('../models/notification.model');
const User = require('../models/user.model');

// Get admin notifications (only notifications meant for admin)
router.get('/admin/system', async (req, res) => {
  try {
    const { limit = 20 } = req.query;

    // Get only notifications meant for admin (forAdmin: true)
    const notifications = await Notification.find({ forAdmin: true })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .populate('userId', 'name email uniqueId');

    const unreadCount = await Notification.countDocuments({ forAdmin: true, isRead: false });

    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching admin notifications:', error);
    res.status(500).json({ message: error.message });
  }
});

// Mark all admin notifications as read
router.put('/admin/read-all', async (req, res) => {
  try {
    await Notification.updateMany(
      { forAdmin: true, isRead: false },
      { isRead: true }
    );
    res.json({ success: true, message: 'All admin notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get notifications for a user (only notifications meant for user, not admin)
router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { limit = 20, unreadOnly = false } = req.query;

    // Only get notifications meant for this user (forAdmin: false or not set)
    const query = {
      userId,
      $or: [{ forAdmin: false }, { forAdmin: { $exists: false } }]
    };
    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .sort({ createdAt: -1 })
      .limit(parseInt(limit));

    const unreadCount = await Notification.countDocuments({
      userId,
      isRead: false,
      $or: [{ forAdmin: false }, { forAdmin: { $exists: false } }]
    });

    res.json({
      success: true,
      notifications,
      unreadCount
    });
  } catch (error) {
    console.error('Error fetching notifications:', error);
    res.status(500).json({ message: error.message });
  }
});

// Mark notification as read
router.put('/read/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Mark all notifications as read for a user
router.put('/read-all/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    await Notification.updateMany(
      { userId, isRead: false },
      { isRead: true }
    );

    res.json({ success: true, message: 'All notifications marked as read' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Delete a notification
router.delete('/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;

    await Notification.findByIdAndDelete(notificationId);

    res.json({ success: true, message: 'Notification deleted' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Clear all notifications for a user
router.delete('/clear/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    await Notification.deleteMany({ userId });

    res.json({ success: true, message: 'All notifications cleared' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Send notification to a specific user
router.post('/send', async (req, res) => {
  try {
    const { userId, title, message, type = 'info', link = null } = req.body;

    if (!userId || !title || !message) {
      return res.status(400).json({ message: 'userId, title, and message are required' });
    }

    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      link
    });

    res.status(201).json({ success: true, notification });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Admin: Send notification to all users (broadcast)
router.post('/broadcast', async (req, res) => {
  try {
    const { title, message, type = 'announcement' } = req.body;

    if (!title || !message) {
      return res.status(400).json({ message: 'title and message are required' });
    }

    // Get all active users
    const users = await User.find({ status: 'Active' }).select('_id');

    // Create notifications for all users
    const notifications = users.map(user => ({
      userId: user._id,
      title,
      message,
      type
    }));

    await Notification.insertMany(notifications);

    res.status(201).json({
      success: true,
      message: `Notification sent to ${users.length} users`
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get unread count for a user
router.get('/count/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const unreadCount = await Notification.countDocuments({ userId, isRead: false });
    res.json({ success: true, unreadCount });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
