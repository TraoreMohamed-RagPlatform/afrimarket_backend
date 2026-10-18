const prisma = require('../lib/prisma');
const { sendServerError } = require('../utils/httpErrors');

const PAGE_SIZE = 20;

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  read: true,
  listingId: true,
  createdAt: true,
};

/** GET /api/notifications : mes notifications, des plus récentes aux plus anciennes. */
const listMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const where = { userId };

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        select: NOTIFICATION_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
      }),
      prisma.notification.count({ where }),
    ]);

    res.set('Cache-Control', 'no-store');
    res.json({
      notifications,
      pagination: { page, limit: PAGE_SIZE, total, pages: Math.ceil(total / PAGE_SIZE) },
    });
  } catch (error) {
    sendServerError(res, error, 'notificationInboxController.listMyNotifications');
  }
};

/** GET /api/notifications/unread-count : pastille de l'onglet Notifications. */
const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.userId, read: false },
    });
    res.set('Cache-Control', 'no-store');
    res.json({ count });
  } catch (error) {
    sendServerError(res, error, 'notificationInboxController.getUnreadNotificationCount');
  }
};

/**
 * PUT /api/notifications/:id/read. Seules les notifications de l'utilisateur
 * connecté sont concernées : celle d'un autre répond 404 (pas d'énumération).
 */
const markNotificationRead = async (req, res) => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { id: req.params.id, userId: req.user.userId },
      data: { read: true },
    });
    if (count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.json({ read: true });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.markNotificationRead');
  }
};

/** PUT /api/notifications/read-all : tout marquer comme lu. */
const markAllNotificationsRead = async (req, res) => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.userId, read: false },
      data: { read: true },
    });
    res.json({ updated: count });
  } catch (error) {
    sendServerError(res, error, 'notificationInboxController.markAllNotificationsRead');
  }
};

module.exports = {
  PAGE_SIZE,
  listMyNotifications,
  getUnreadNotificationCount,
  markNotificationRead,
  markAllNotificationsRead,
};
