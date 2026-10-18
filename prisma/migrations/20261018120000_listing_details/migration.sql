-- AlterTable
ALTER TABLE "Image" ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 0;

-- Photos existantes : ordre d'ajout.
UPDATE "Image" AS i
SET "position" = r.rn - 1
FROM (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "listingId" ORDER BY "createdAt", "id") AS rn
    FROM "Image"
) AS r
WHERE i."id" = r."id";

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "city" TEXT NOT NULL DEFAULT 'casablanca',
ADD COLUMN     "deliveryMode" TEXT NOT NULL DEFAULT 'PICKUP',
ADD COLUMN     "district" TEXT,
ADD COLUMN     "isNegotiable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "previousPrice" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "responseSampleCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "responseTimeMinutes" INTEGER;

-- CreateTable
CREATE TABLE "UserSettings" (
    "userId" TEXT NOT NULL,
    "showPhone" BOOLEAN NOT NULL DEFAULT false,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT false,
    "messageAlerts" BOOLEAN NOT NULL DEFAULT true,
    "listingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "ratingAlerts" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ListingReport" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListingReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ListingReport_reporterId_idx" ON "ListingReport"("reporterId");

-- CreateIndex
CREATE INDEX "ListingReport_status_idx" ON "ListingReport"("status");

-- CreateIndex
CREATE INDEX "ListingReport_createdAt_idx" ON "ListingReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ListingReport_listingId_reporterId_key" ON "ListingReport"("listingId", "reporterId");

-- CreateIndex
CREATE INDEX "Image_listingId_position_idx" ON "Image"("listingId", "position");

-- CreateIndex
CREATE INDEX "Listing_city_district_idx" ON "Listing"("city", "district");

-- AddForeignKey
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingReport" ADD CONSTRAINT "ListingReport_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListingReport" ADD CONSTRAINT "ListingReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
