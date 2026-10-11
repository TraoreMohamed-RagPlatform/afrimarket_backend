const { randomUUID } = require('crypto');

/**
 * Base de données en mémoire, limitée à ce que testent les sessions
 * (utilisateurs et jetons de rafraîchissement). Aucune vraie base requise.
 */
const matches = (row, where = {}) =>
  Object.entries(where).every(([key, condition]) => {
    if (condition !== null && typeof condition === 'object' && !(condition instanceof Date)) {
      if ('lt' in condition) return row[key] < condition.lt;
      throw new Error(`Condition non gérée par le faux Prisma : ${key}`);
    }
    return row[key] === condition;
  });

const createFakePrisma = () => {
  const users = [];
  const refreshTokens = [];

  const pick = (row, select) =>
    select ? Object.fromEntries(Object.keys(select).map((key) => [key, row[key]])) : { ...row };

  const db = {
    _users: users,
    _refreshTokens: refreshTokens,

    user: {
      findUnique: ({ where, select }) => {
        const row = users.find((u) => matches(u, where));
        return row ? pick(row, select) : null;
      },
      findFirst: ({ where }) => {
        const row = users.find((u) => (where.OR ? where.OR.some((w) => matches(u, w)) : matches(u, where)));
        return row ? { ...row } : null;
      },
      create: ({ data }) => {
        const row = { id: randomUUID(), status: 'ACTIVE', role: 'USER', ...data };
        users.push(row);
        return { ...row };
      },
      update: ({ where, data }) => {
        const row = users.find((u) => matches(u, where));
        Object.assign(row, data);
        return { ...row };
      },
    },

    refreshToken: {
      create: ({ data, select }) => {
        const row = { id: randomUUID(), revokedAt: null, replacedById: null, createdAt: new Date(), ...data };
        refreshTokens.push(row);
        return pick(row, select);
      },
      findUnique: ({ where, include, select }) => {
        const row = refreshTokens.find((t) => matches(t, where));
        if (!row) return null;
        const result = pick(row, select);
        if (include?.user) {
          const user = users.find((u) => u.id === row.userId);
          result.user = user ? pick(user, include.user.select) : null;
        }
        return result;
      },
      update: ({ where, data }) => {
        const row = refreshTokens.find((t) => matches(t, where));
        Object.assign(row, data);
        return { ...row };
      },
      updateMany: ({ where, data }) => {
        const rows = refreshTokens.filter((t) => matches(t, where));
        rows.forEach((row) => Object.assign(row, data));
        return { count: rows.length };
      },
      deleteMany: ({ where }) => {
        const before = refreshTokens.length;
        for (let i = refreshTokens.length - 1; i >= 0; i -= 1) {
          if (matches(refreshTokens[i], where)) refreshTokens.splice(i, 1);
        }
        return { count: before - refreshTokens.length };
      },
    },

    $transaction: (fn) => fn(db),
  };

  // Comme Prisma, chaque méthode des modèles renvoie une promesse.
  for (const model of [db.user, db.refreshToken]) {
    for (const [name, method] of Object.entries(model)) {
      model[name] = (...args) => Promise.resolve().then(() => method(...args));
    }
  }
  return db;
};

module.exports = { createFakePrisma };
