// La soumission KYC ne doit jamais lire un fichier choisi par le client.
const mockPrisma = {
  identityVerification: { findUnique: jest.fn(), create: jest.fn() },
  user: { findUnique: jest.fn() },
};
jest.mock('@prisma/client', () => ({ PrismaClient: jest.fn(() => mockPrisma) }));
jest.mock('../services/faceMatchingService', () => ({
  performFullFaceVerification: jest.fn(),
}));
// Aucun accès réseau ni base pendant les tests (e-mails, SMS, statut).
jest.mock('../services/identityVerificationService', () => ({
  updateVerificationStatus: jest.fn().mockResolvedValue({ success: true }),
}));
jest.mock('../services/notificationService', () => ({
  notifyVerificationCompleted: jest.fn().mockResolvedValue({ sent: true }),
  sendAdminEmail: jest.fn().mockResolvedValue({ sent: true }),
}));
jest.mock('../services/kycFiles', () => ({
  ...jest.requireActual('../services/kycFiles'),
  resolveKycFile: jest.fn(),
}));

const faceMatchingService = require('../services/faceMatchingService');
const kycFiles = require('../services/kycFiles');
const controller = require('../controllers/identityVerificationController');

const mockRes = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

const submit = (body) => {
  const res = mockRes();
  return controller
    .submitIdentityVerification({ user: { userId: 'user-1' }, body }, res)
    .then(() => res);
};

const VALID_BODY = {
  documentType: 'PASSPORT',
  documentNumber: 'AB123456',
  documentCountry: 'MA',
  frontImage: 'uploads/identity/user-1/documents/front.png',
  backImage: 'uploads/identity/user-1/documents/back.png',
  selfiePhoto: 'uploads/identity/user-1/selfie/me.png',
};

describe('Soumission KYC', () => {
  beforeEach(() => jest.clearAllMocks());

  test('chemin refusé (ex. « ../../.env ») : 400, aucun fichier lu ni enregistrement créé', async () => {
    kycFiles.resolveKycFile.mockResolvedValue(null);

    const res = await submit({ ...VALID_BODY, selfiePhoto: '../../.env' });

    expect(res.status).toHaveBeenCalledWith(400);
    expect(faceMatchingService.performFullFaceVerification).not.toHaveBeenCalled();
    expect(mockPrisma.identityVerification.create).not.toHaveBeenCalled();
  });

  test('chemins vérifiés pour l’utilisateur authentifié, jamais ceux du client', async () => {
    kycFiles.resolveKycFile.mockImplementation((userId, kind, value) =>
      Promise.resolve({ absolutePath: `/safe/${userId}/${kind}/${value.length}`, publicPath: `pub:${kind}:${value.length}` }),
    );
    mockPrisma.identityVerification.findUnique.mockResolvedValue(null);
    mockPrisma.identityVerification.create.mockResolvedValue({ id: 'v-1' });
    faceMatchingService.performFullFaceVerification.mockResolvedValue({ overallScore: 0 });

    await submit(VALID_BODY);

    for (const call of kycFiles.resolveKycFile.mock.calls) {
      expect(call[0]).toBe('user-1');
    }
    const [, selfieArg, frontArg] = faceMatchingService.performFullFaceVerification.mock.calls[0];
    expect(selfieArg).toMatch(/^\/safe\/user-1\/selfie\//);
    expect(frontArg).toMatch(/^\/safe\/user-1\/documents\//);
    expect(mockPrisma.identityVerification.create.mock.calls[0][0].data.selfiePhoto).toMatch(/^pub:selfie:/);
  });

  test('recto et verso identiques : 400', async () => {
    kycFiles.resolveKycFile.mockResolvedValue({ absolutePath: '/safe/same.png', publicPath: 'p' });

    const res = await submit(VALID_BODY);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockPrisma.identityVerification.create).not.toHaveBeenCalled();
  });
});
