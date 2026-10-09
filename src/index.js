require('dotenv').config();

const http = require('http');

const { validateEnv } = require('./config/env');

// Vérifier la configuration avant de charger quoi que ce soit d'autre.
const env = validateEnv(process.env);
if (!env.ok) {
  console.error('❌ Configuration invalide, démarrage annulé :');
  env.errors.forEach((message) => console.error(`   - ${message}`));
  process.exit(1);
}
const { config } = env;

const prisma = require('./lib/prisma');
const { createApp } = require('./app');
const { initializeSocket } = require('./socket');
const { initializeFirebase } = require('./utils/firebaseService');

const app = createApp({ corsOrigins: config.corsOrigins });
const server = http.createServer(app);

const io = initializeSocket(server, { corsOrigins: config.corsOrigins });
app.set('io', io); // Accessible dans les routes via req.app.get('io')

initializeFirebase();

server.listen(config.port, config.host, () => {
  console.log(`✅ Backend AfriMarket démarré sur http://${config.host}:${config.port}`);
  console.log(`🌐 Origines web autorisées : ${config.corsOrigins.join(', ') || 'aucune'}`);
});

// Arrêt propre : on termine les requêtes en cours puis on ferme la base.
const shutdown = (signal) => {
  console.log(`${signal} reçu, arrêt du serveur...`);
  server.close(() => {
    prisma
      .$disconnect()
      .catch((error) => console.error('Erreur à la fermeture de la base', error))
      .finally(() => process.exit(0));
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
