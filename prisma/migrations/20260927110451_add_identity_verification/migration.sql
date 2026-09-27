-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isIdentityVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "trustScore" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "verifiedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "IdentityVerification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "documentCountry" TEXT NOT NULL,
    "documentIssueDate" TIMESTAMP(3),
    "documentExpiryDate" TIMESTAMP(3),
    "documentFrontImage" TEXT NOT NULL,
    "documentBackImage" TEXT NOT NULL,
    "selfiePhoto" TEXT NOT NULL,
    "faceSimilarityScore" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "verificationMethod" TEXT,
    "rejectionReason" TEXT,
    "rejectionDetails" TEXT,
    "verifiedBy" TEXT,
    "verificationNotes" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "lastReviewedAt" TIMESTAMP(3),
    "reviewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "IdentityVerification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IdentityVerification_userId_key" ON "IdentityVerification"("userId");

-- CreateIndex
CREATE INDEX "IdentityVerification_userId_idx" ON "IdentityVerification"("userId");

-- CreateIndex
CREATE INDEX "IdentityVerification_status_idx" ON "IdentityVerification"("status");

-- CreateIndex
CREATE INDEX "IdentityVerification_documentType_idx" ON "IdentityVerification"("documentType");

-- CreateIndex
CREATE INDEX "IdentityVerification_createdAt_idx" ON "IdentityVerification"("createdAt");

-- CreateIndex
CREATE INDEX "IdentityVerification_expiresAt_idx" ON "IdentityVerification"("expiresAt");

-- CreateIndex
CREATE INDEX "User_isIdentityVerified_idx" ON "User"("isIdentityVerified");

-- AddForeignKey
ALTER TABLE "IdentityVerification" ADD CONSTRAINT "IdentityVerification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
