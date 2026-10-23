// Onglet Notifications : mes notifications, comme Facebook.
//
// - « vue » (seenAt) : l'onglet a été ouvert ; la pastille ne la compte
//   plus ;
// - « lue » (read) : la notification a été touchée ; elle n'est plus
//   surlignée.
//
// Sécurité : chaque requête est limitée aux notifications de la personne
// connectée ; celle d'un autre répond 404 (pas d'énumération).

const prisma = require('../lib/prisma');
const { sendServerError } = require('../utils/httpErrors');

const PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

/** Ordre des photos : principale d'abord (même règle que les annonces). */
const PHOTO_ORDER = [{ position: 'asc' }, { createdAt: 'asc' }];

const NOTIFICATION_SELECT = {
  id: true,
  type: true,
  title: true,
  message: true,
  read: true,
  seenAt: true,
  createdAt: true,
  listing: {
    select: {
      id: true,
      title: true,
      status: true,
      isSold: true,
      images: { select: { url: true }, orderBy: PHOTO_ORDER, take: 1 },
    },
  },
};

/** Notification envoyée à l'app (l'app traduit son texte d'après `type`). */
const toNotification = (row) => ({
  id: row.id,
  type: row.type,
  title: row.title,
  message: row.message,
  read: row.read,
  seen: row.seenAt !== null && row.seenAt !== undefined,
  createdAt: row.createdAt,
  listing: row.listing
    ? {
        id: row.listing.id,
        title: row.listing.title,
        status: row.listing.isSold ? 'SOLD' : row.listing.status,
        photo: row.listing.images?.[0]?.url ?? null,
      }
    : null,
});

/** Taille de page demandée (bornée par la route ; Express 5 : conversion ici). */
const pageSize = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, MAX_PAGE_SIZE) : PAGE_SIZE;
};

/**
 * GET /api/notifications?cursor=&limit= : mes notifications, des plus
 * récentes aux plus anciennes. `cursor` : dernière notification déjà
 * affichée.
 */
const listMyNotifications = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { cursor } = req.query;
    const limit = pageSize(req.query.limit);
    const where = { userId };

    if (cursor) {
      const anchor = await prisma.notification.findFirst({
        where: { id: cursor, userId },
        select: { id: true },
      });
      if (!anchor) return res.status(400).json({ error: 'Invalid cursor' });
    }

    const rows = await prisma.notification.findMany({
      where,
      select: NOTIFICATION_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);

    res.set('Cache-Control', 'no-store');
    return res.json({
      notifications: page.map(toNotification),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.listMyNotifications');
  }
};

/**
 * GET /api/notifications/unread-count : pastille de l'onglet. Compte les
 * notifications pas encore VUES (onglet pas ouvert depuis).
 */
const getUnreadNotificationCount = async (req, res) => {
  try {
    const count = await prisma.notification.count({
      where: { userId: req.user.userId, seenAt: null },
    });
    res.set('Cache-Control', 'no-store');
    return res.json({ count });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.getUnreadNotificationCount');
  }
};

/** PUT /api/notifications/seen : l'onglet est ouvert, la pastille s'efface. */
const markAllNotificationsSeen = async (req, res) => {
  try {
    const { count } = await prisma.notification.updateMany({
      where: { userId: req.user.userId, seenAt: null },
      data: { seenAt: new Date() },
    });
    return res.json({ updated: count });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.markAllNotificationsSeen');
  }
};

/** PUT /api/notifications/:id/read : notification touchée (donc vue aussi). */
const markNotificationRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const { id } = req.params;
    const { count } = await prisma.notification.updateMany({
      where: { id, userId },
      data: { read: true },
    });
    if (count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    await prisma.notification.updateMany({
      where: { id, userId, seenAt: null },
      data: { seenAt: new Date() },
    });
    return res.json({ read: true });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.markNotificationRead');
  }
};

/** PUT /api/notifications/read-all : tout marquer comme lu (et vu). */
const markAllNotificationsRead = async (req, res) => {
  try {
    const userId = req.user.userId;
    const now = new Date();
    const { count } = await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    await prisma.notification.updateMany({
      where: { userId, seenAt: null },
      data: { seenAt: now },
    });
    return res.json({ updated: count });
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.markAllNotificationsRead');
  }
};

/** DELETE /api/notifications/:id : retirer une de mes notifications. */
const deleteNotification = async (req, res) => {
  try {
    const { count } = await prisma.notification.deleteMany({
      where: { id: req.params.id, userId: req.user.userId },
    });
    if (count === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    return res.status(204).end();
  } catch (error) {
    return sendServerError(res, error, 'notificationInboxController.deleteNotification');
  }
};

module.exports = {
  PAGE_SIZE,
  MAX_PAGE_SIZE,
  listMyNotifications,
  getUnreadNotificationCount,
  markAllNotificationsSeen,
  markNotificationRead,
  markAllNotificationsRead,
  deleteNotification,
};
