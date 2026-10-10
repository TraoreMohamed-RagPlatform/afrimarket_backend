/**
 * Change le mot de passe PostgreSQL de l'application, sans jamais l'afficher.
 *
 * 1. Se connecte avec DATABASE_URL (fichier .env) ;
 * 2. génère un mot de passe aléatoire (32 caractères, sûr dans une URL) ;
 * 3. l'applique au rôle de DATABASE_URL (ALTER ROLE) ;
 * 4. met à jour DATABASE_URL dans .env ;
 * 5. vérifie la connexion avec le nouveau mot de passe, et annule tout en cas d'échec.
 *
 * Usage : node scripts/rotate-db-password.js
 */
const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { PrismaClient } = require('@prisma/client');

const ENV_PATH = path.join(__dirname, '..', '.env');
// Conserve la fin de ligne d'origine (\r\n sous Windows).
const DB_URL_LINE = /^([ \t]*DATABASE_URL[ \t]*=[ \t]*)(["']?)(.*?)\2([ \t]*\r?)$/m;
// Nom de rôle PostgreSQL simple : il est inséré dans la requête entre guillemets.
const SAFE_ROLE = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const fail = (message) => {
  console.error(`ÉCHEC : ${message}`);
  process.exit(1);
};

const connect = async (url) => {
  const client = new PrismaClient({ datasources: { db: { url } } });
  await client.$queryRawUnsafe('SELECT 1');
  return client;
};

// Le mot de passe ne contient que [A-Za-z0-9_-] : aucun guillemet possible.
const alterPassword = (client, role, password) =>
  client.$executeRawUnsafe(`ALTER ROLE "${role}" WITH PASSWORD '${password}'`);

const main = async () => {
  if (!fs.existsSync(ENV_PATH)) fail('fichier .env introuvable.');

  const envText = fs.readFileSync(ENV_PATH, 'utf8');
  const match = envText.match(DB_URL_LINE);
  if (!match) fail('ligne DATABASE_URL introuvable dans .env.');

  const [, prefix, quote, oldUrl, lineEnd] = match;
  let url;
  try {
    url = new URL(oldUrl);
  } catch {
    fail('DATABASE_URL n’est pas une URL valide.');
  }

  const role = decodeURIComponent(url.username);
  const oldPassword = decodeURIComponent(url.password);
  if (!SAFE_ROLE.test(role)) fail('nom d’utilisateur inattendu dans DATABASE_URL.');

  console.log(`Connexion à ${url.hostname}:${url.port || 5432} (base ${url.pathname.slice(1)}, rôle ${role})...`);
  let admin;
  try {
    admin = await connect(oldUrl);
  } catch (error) {
    fail(`connexion impossible avec le DATABASE_URL actuel (${error.errorCode || error.code || 'erreur'}).`);
  }

  const newPassword = randomBytes(24).toString('base64url');
  const newUrl = new URL(oldUrl);
  newUrl.password = newPassword;

  await alterPassword(admin, role, newPassword);
  console.log('Mot de passe changé dans PostgreSQL.');

  try {
    const check = await connect(newUrl.toString());
    await check.$disconnect();
  } catch (error) {
    // Retour arrière : la session ouverte reste valide après le changement.
    await alterPassword(admin, role, oldPassword);
    await admin.$disconnect();
    fail(`le nouveau mot de passe ne fonctionne pas (${error.errorCode || error.code || 'erreur'}) ; ancien mot de passe rétabli, .env inchangé.`);
  }
  await admin.$disconnect();

  const updated = envText.replace(
    DB_URL_LINE,
    () => `${prefix}${quote}${newUrl.toString()}${quote}${lineEnd}`,
  );
  fs.writeFileSync(ENV_PATH, updated, 'utf8');

  console.log('DATABASE_URL mis à jour dans .env.');
  console.log('Vérification avec le nouveau mot de passe : OK');
};

main().catch((error) => fail(error.message));
