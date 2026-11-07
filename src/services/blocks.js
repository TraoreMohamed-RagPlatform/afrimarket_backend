/**
 * Blocages entre personnes (comme Messenger / Facebook Marketplace).
 *
 * Un blocage vaut dans les deux sens : ni l'un ni l'autre ne peut écrire,
 * et leurs annonces ne se voient plus. La personne bloquée n'est jamais
 * prévenue : elle reçoit la même réponse que pour un compte indisponible.
 */

/** Plafond : au-delà, la liste est tronquée (une personne réelle n'y arrive pas). */
const MAX_BLOCKS_READ = 1000;

/** Filtre Prisma : blocage entre [a] et [b], dans un sens ou dans l'autre. */
const betweenFilter = (a, b) => ({
  OR: [
    { blockerId: a, blockedId: b },
    { blockerId: b, blockedId: a },
  ],
});

/** Vrai si [a] et [b] sont bloqués l'un pour l'autre. */
const isBlockedBetween = async (prisma, a, b) => {
  if (!a || !b || a === b) return false;
  const block = await prisma.userBlock.findFirst({
    where: betweenFilter(a, b),
    select: { id: true },
  });
  return Boolean(block);
};

/** Vrai si [blockerId] a bloqué [blockedId] (ce sens seulement). */
const hasBlocked = async (prisma, blockerId, blockedId) => {
  if (!blockerId || !blockedId) return false;
  const block = await prisma.userBlock.findUnique({
    where: { blockerId_blockedId: { blockerId, blockedId } },
    select: { id: true },
  });
  return Boolean(block);
};

/**
 * Personnes dont [userId] ne doit pas voir les annonces : celles qu'il a
 * bloquées et celles qui l'ont bloqué. Vide pour un visiteur.
 */
const hiddenUserIds = async (prisma, userId) => {
  if (!userId) return [];
  const blocks = await prisma.userBlock.findMany({
    where: { OR: [{ blockerId: userId }, { blockedId: userId }] },
    select: { blockerId: true, blockedId: true },
    take: MAX_BLOCKS_READ,
  });
  const ids = new Set();
  for (const block of blocks) {
    ids.add(block.blockerId === userId ? block.blockedId : block.blockerId);
  }
  return [...ids];
};

/**
 * Blocages entre [userId] et chacune des personnes [otherIds] (une requête) :
 * `byMe` (je les ai bloquées), `against` (elles m'ont bloqué).
 */
const blockStatesFor = async (prisma, userId, otherIds) => {
  const ids = [...new Set(otherIds.filter(Boolean))];
  const states = { byMe: new Set(), against: new Set() };
  if (!userId || ids.length === 0) return states;
  const rows = await prisma.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, blockedId: { in: ids } },
        { blockedId: userId, blockerId: { in: ids } },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  for (const row of rows) {
    if (row.blockerId === userId) states.byMe.add(row.blockedId);
    else states.against.add(row.blockerId);
  }
  return states;
};

/** État de blocage avec [otherId], d'après [blockStatesFor]. */
const blockStateOf = (states, otherId) => ({
  blockedByMe: states.byMe.has(otherId),
  blocked: states.byMe.has(otherId) || states.against.has(otherId),
});

/** Filtre Prisma d'annonces : sans celles des personnes [hidden]. */
const visibleSellerFilter = (hidden) => (hidden.length > 0 ? { userId: { notIn: hidden } } : {});

module.exports = {
  MAX_BLOCKS_READ,
  betweenFilter,
  isBlockedBetween,
  hasBlocked,
  hiddenUserIds,
  visibleSellerFilter,
  blockStatesFor,
  blockStateOf,
};
