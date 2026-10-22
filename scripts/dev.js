// Lance le serveur en développement, redémarré quand le code change.
//
// Seul `src/` est surveillé. Avec `node --watch` seul, Node surveille aussi
// chaque fichier de node_modules chargé ; sous Windows, le premier
// chargement d'un module en cours de route (ex. vérification App Check à
// la première connexion) est vu comme une modification : le serveur
// redémarre et coupe la requête en cours (« erreur inattendue » dans l'app).
//
// `--watch-path` n'existe que sous Windows et macOS : ailleurs, on garde
// `--watch`.

const { spawn } = require('node:child_process');

const ENTRY = 'src/index.js';
const WATCHED = ['./src'];

/** Options de surveillance de Node pour [platform]. */
const watchArgs = (platform = process.platform) =>
  platform === 'win32' || platform === 'darwin'
    ? WATCHED.map((path) => `--watch-path=${path}`)
    : ['--watch'];

const start = () => {
  const child = spawn(process.execPath, [...watchArgs(), ENTRY], { stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
};

if (require.main === module) start();

module.exports = { watchArgs, ENTRY };
