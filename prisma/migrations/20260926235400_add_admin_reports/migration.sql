-- CreateTable
CREATE TABLE "AdminReport" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "filters" JSONB NOT NULL,
    "data" JSONB NOT NULL,
    "generatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminReport_type_idx" ON "AdminReport"("type");

-- CreateIndex
CREATE INDEX "AdminReport_generatedBy_idx" ON "AdminReport"("generatedBy");

-- CreateIndex
CREATE INDEX "AdminReport_createdAt_idx" ON "AdminReport"("createdAt");

-- AddForeignKey
ALTER TABLE "AdminReport" ADD CONSTRAINT "AdminReport_generatedBy_fkey" FOREIGN KEY ("generatedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
