/**
 * Valeurs fixes des annonces : villes et quartiers, modes de remise,
 * motifs de signalement.
 *
 * Listes fermées (comme Facebook Marketplace) : le client envoie un
 * identifiant court (« maarif »), jamais un texte libre. On évite ainsi
 * les variantes (« Maarif », « Maârif », « maarif ») qui casseraient le
 * filtre par quartier, et aucun texte libre n'est affiché aux autres
 * utilisateurs.
 */

const DEFAULT_CITY = 'casablanca';

/** Quartiers par ville. Clé : identifiant stocké en base. */
const CITIES = Object.freeze({
  casablanca: Object.freeze({
    name: 'Casablanca',
    districts: Object.freeze({
      'ain-chock': 'Aïn Chock',
      'ain-diab': 'Aïn Diab',
      'ain-sebaa': 'Aïn Sebaâ',
      anfa: 'Anfa',
      'ancienne-medina': 'Ancienne Médina',
      beausejour: 'Beauséjour',
      belvedere: 'Belvédère',
      'ben-msik': 'Ben M’Sick',
      bourgogne: 'Bourgogne',
      bouskoura: 'Bouskoura',
      californie: 'Californie',
      'centre-ville': 'Centre-ville',
      cil: 'CIL',
      'dar-bouazza': 'Dar Bouazza',
      'derb-sultan': 'Derb Sultan',
      'ferme-bretonne': 'Ferme Bretonne',
      gauthier: 'Gauthier',
      habous: 'Habous',
      'hay-hassani': 'Hay Hassani',
      'hay-mohammadi': 'Hay Mohammadi',
      'hay-moulay-rachid': 'Hay Moulay Rachid',
      lissasfa: 'Lissasfa',
      maarif: 'Maârif',
      'mers-sultan': 'Mers Sultan',
      oasis: 'Oasis',
      oulfa: 'Oulfa',
      palmier: 'Palmier',
      polo: 'Polo',
      racine: 'Racine',
      'roches-noires': 'Roches Noires',
      sbata: 'Sbata',
      'sidi-belyout': 'Sidi Belyout',
      'sidi-bernoussi': 'Sidi Bernoussi',
      'sidi-maarouf': 'Sidi Maârouf',
      'sidi-moumen': 'Sidi Moumen',
      'sidi-othmane': 'Sidi Othmane',
      'val-fleuri': 'Val Fleuri',
    }),
  }),
});

const isKnownCity = (city) => typeof city === 'string' && Object.hasOwn(CITIES, city);

const isKnownDistrict = (city, district) =>
  isKnownCity(city) &&
  typeof district === 'string' &&
  Object.hasOwn(CITIES[city].districts, district);

/** Villes et quartiers pour les clients, triés par nom. */
const locationOptions = () =>
  Object.entries(CITIES).map(([slug, city]) => ({
    slug,
    name: city.name,
    districts: Object.entries(city.districts)
      .map(([districtSlug, name]) => ({ slug: districtSlug, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr')),
  }));

/** Remise de l'article (« Retrait en main propre », « Livraison »). */
const DELIVERY_MODES = Object.freeze(['PICKUP', 'DELIVERY', 'BOTH']);
const DEFAULT_DELIVERY_MODE = 'PICKUP';

/** Motifs de signalement d'une annonce (inspirés de Facebook Marketplace). */
const REPORT_REASONS = Object.freeze([
  'SCAM', // Arnaque ou fraude
  'PROHIBITED_ITEM', // Article interdit
  'OFFENSIVE', // Contenu choquant ou inapproprié
  'MISLEADING', // Annonce trompeuse ou mauvaise catégorie
  'SPAM', // Doublon ou spam
  'ALREADY_SOLD', // Article déjà vendu
  'OTHER',
]);

/**
 * Statuts d'une annonce.
 * - ACTIVE : en vente ;
 * - RESERVED : promise à un acheteur, toujours visible (badge « Réservé ») ;
 * - SOLD : vendue (via /mark-sold) ;
 * - INACTIVE : masquée par le vendeur.
 */
const LISTING_STATUSES = Object.freeze(['ACTIVE', 'RESERVED', 'SOLD', 'INACTIVE']);

/** Statuts que le vendeur peut choisir lui-même (PUT /api/listings/:id). */
const OWNER_SETTABLE_STATUSES = Object.freeze(['ACTIVE', 'RESERVED', 'INACTIVE']);

/** Statuts affichés dans le fil (comme Marketplace : une annonce réservée reste visible). */
const FEED_STATUSES = Object.freeze(['ACTIVE', 'RESERVED']);

/** Tris du fil. Clé : valeur du paramètre `sort`. */
const FEED_SORTS = Object.freeze({
  newest: [{ createdAt: 'desc' }, { id: 'desc' }],
  price_asc: [{ price: 'asc' }, { createdAt: 'desc' }],
  price_desc: [{ price: 'desc' }, { createdAt: 'desc' }],
});
const DEFAULT_FEED_SORT = 'newest';

/**
 * Catégories de l'application (maquettes validées), dans l'ordre du menu.
 * `icon` : nom de l'icône Phosphor côté mobile.
 */
const CATEGORIES = Object.freeze([
  { slug: 'logement', name: 'Logement', icon: 'house', description: 'Chambres, colocations, appartements' },
  { slug: 'articles', name: 'Articles', icon: 'shoppingBag', description: 'Meubles, électronique, vêtements, téléphones' },
  { slug: 'services', name: 'Services', icon: 'wrench', description: 'Coiffure, transferts, cours, réparations' },
  { slug: 'emploi', name: 'Emploi', icon: 'briefcase', description: 'Offres et demandes d’emploi' },
  { slug: 'transport', name: 'Transport', icon: 'car', description: 'Véhicules, covoiturage, déménagement' },
  { slug: 'recherche', name: 'Recherche', icon: 'magnifyingGlass', description: 'Ce que vous cherchez' },
  { slug: 'autres', name: 'Autres', icon: 'megaphone', description: 'Tout le reste' },
]);

/** État de l'article (même liste que l'app mobile). */
const CONDITIONS = Object.freeze(['NEW', 'LIKE_NEW', 'GOOD', 'FAIR', 'POOR']);
const DEFAULT_CONDITION = 'NEW';

/**
 * Statuts possibles à la création. `INACTIVE` : l'app crée l'annonce
 * masquée, envoie les photos, puis la publie (jamais d'annonce sans photo
 * dans le fil).
 */
const CREATE_STATUSES = Object.freeze(['ACTIVE', 'INACTIVE']);

/** Prix maximal accepté (DH) : protège contre les valeurs absurdes. */
const MAX_PRICE = 100000000;

/** Nombre maximal de photos par annonce (comme Facebook Marketplace). */
const MAX_LISTING_PHOTOS = 10;

module.exports = {
  CITIES,
  DEFAULT_CITY,
  isKnownCity,
  isKnownDistrict,
  locationOptions,
  DELIVERY_MODES,
  DEFAULT_DELIVERY_MODE,
  REPORT_REASONS,
  MAX_LISTING_PHOTOS,
  CONDITIONS,
  DEFAULT_CONDITION,
  CREATE_STATUSES,
  MAX_PRICE,
  LISTING_STATUSES,
  OWNER_SETTABLE_STATUSES,
  FEED_STATUSES,
  FEED_SORTS,
  DEFAULT_FEED_SORT,
  CATEGORIES,
};
