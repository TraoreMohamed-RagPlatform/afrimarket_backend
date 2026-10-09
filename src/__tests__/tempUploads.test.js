const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const { TEMP_DIR, tempUploadPath, removeTempUploads } = require('../middleware/uploadMiddleware');

describe('Fichiers temporaires d’upload', () => {
  test('chemin reconstruit dans le dossier temporaire à partir du nom serveur', () => {
    const filename = `${randomUUID()}.jpg`;

    expect(tempUploadPath({ filename, path: '/etc/passwd' })).toBe(path.join(TEMP_DIR, filename));
  });

  test.each(['../../.env', 'photo.jpg', `${randomUUID()}.js`, '', undefined])('nom refusé (%p)', (filename) => {
    expect(() => tempUploadPath({ filename })).toThrow();
  });

  test('suppression : le fichier disparaît, aucune erreur sinon', async () => {
    const filename = `${randomUUID()}.png`;
    fs.writeFileSync(path.join(TEMP_DIR, filename), 'x');

    await removeTempUploads({ filename }, { filename: '../../.env' }, undefined);

    expect(fs.existsSync(path.join(TEMP_DIR, filename))).toBe(false);
    expect(fs.existsSync(path.join(__dirname, '../../package.json'))).toBe(true);
  });
});
