const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const {
  KYC_UPLOAD_ROOT,
  KYC_FILE_KIND,
  getKycDir,
  toPublicPath,
  resolveKycFile,
} = require('../services/kycFiles');

// Utilisateurs fictifs propres à ce test (dossiers supprimés à la fin).
const OWNER = `test-owner-${process.pid}`;
const OTHER = `test-other-${process.pid}`;

const createStoredFile = (userId, kind) => {
  const dir = getKycDir(userId, kind);
  fs.mkdirSync(dir, { recursive: true });
  const fileName = `${randomUUID()}.png`;
  fs.writeFileSync(path.join(dir, fileName), 'png');
  return fileName;
};

describe('Fichiers KYC : un chemin client ne sort jamais du dossier de l’utilisateur', () => {
  let selfieName;
  let otherUserDoc;

  beforeAll(() => {
    selfieName = createStoredFile(OWNER, KYC_FILE_KIND.SELFIE);
    otherUserDoc = createStoredFile(OTHER, KYC_FILE_KIND.DOCUMENT);
  });

  afterAll(() => {
    fs.rmSync(path.join(KYC_UPLOAD_ROOT, OWNER), { recursive: true, force: true });
    fs.rmSync(path.join(KYC_UPLOAD_ROOT, OTHER), { recursive: true, force: true });
  });

  test('chemin renvoyé à l’upload : accepté', async () => {
    const publicPath = toPublicPath(OWNER, KYC_FILE_KIND.SELFIE, selfieName);

    const file = await resolveKycFile(OWNER, KYC_FILE_KIND.SELFIE, publicPath);

    expect(file).toEqual({
      absolutePath: path.join(KYC_UPLOAD_ROOT, OWNER, 'selfie', selfieName),
      publicPath,
    });
  });

  test('ancien format Windows (séparateurs « \\ ») : accepté', async () => {
    const windowsPath = `uploads\\identity\\${OWNER}\\selfie\\${selfieName}`;

    const file = await resolveKycFile(OWNER, KYC_FILE_KIND.SELFIE, windowsPath);

    expect(file).not.toBeNull();
  });

  test.each([
    ['remontée de dossier', '../../.env'],
    ['remontée vers un .png', '../../../../tmp/x.png'],
    ['chemin absolu', '/etc/passwd'],
    ['nom non généré par le serveur', 'uploads/identity/photo.png'],
    ['mauvaise extension', `${randomUUID()}.js`],
    ['valeur non textuelle', { path: 'x' }],
    ['valeur vide', ''],
  ])('%s : refusé', async (_label, value) => {
    await expect(resolveKycFile(OWNER, KYC_FILE_KIND.SELFIE, value)).resolves.toBeNull();
  });

  test('fichier d’un autre utilisateur : refusé (IDOR)', async () => {
    const stolen = toPublicPath(OTHER, KYC_FILE_KIND.DOCUMENT, otherUserDoc);

    await expect(resolveKycFile(OWNER, KYC_FILE_KIND.DOCUMENT, stolen)).resolves.toBeNull();
  });

  test('fichier inexistant : refusé', async () => {
    const missing = toPublicPath(OWNER, KYC_FILE_KIND.SELFIE, `${randomUUID()}.png`);

    await expect(resolveKycFile(OWNER, KYC_FILE_KIND.SELFIE, missing)).resolves.toBeNull();
  });

  test('selfie présenté comme document : refusé', async () => {
    await expect(resolveKycFile(OWNER, KYC_FILE_KIND.DOCUMENT, selfieName)).resolves.toBeNull();
  });

  test('identifiant utilisateur ou type invalide : erreur (fermé par défaut)', () => {
    expect(() => getKycDir('../admin', KYC_FILE_KIND.SELFIE)).toThrow();
    expect(() => getKycDir(OWNER, '../../config')).toThrow();
  });
});
