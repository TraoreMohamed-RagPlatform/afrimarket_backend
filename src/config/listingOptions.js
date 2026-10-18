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
};
