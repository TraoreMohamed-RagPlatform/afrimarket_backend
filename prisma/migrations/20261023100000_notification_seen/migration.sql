-- Notification « vue » (onglet ouvert) distincte de « lue » (touchée),
-- comme Facebook : la pastille ne compte que les notifications pas vues.
ALTER TABLE "Notification" ADD COLUMN "seenAt" TIMESTAMP(3);

-- Les notifications déjà lues sont considérées comme vues.
UPDATE "Notification" SET "seenAt" = "createdAt" WHERE "read" = true;

CREATE INDEX "Notification_userId_seenAt_idx" ON "Notification"("userId", "seenAt");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");
