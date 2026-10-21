-- Discussion liée à une annonce, entre un acheteur et le vendeur
-- (une seule par annonce et par acheteur, comme Facebook Marketplace).

-- 1. Nouvelles colonnes.
ALTER TABLE "Conversation" ADD COLUMN "listingId" TEXT,
ADD COLUMN "buyerId" TEXT,
ADD COLUMN "sellerId" TEXT;

-- 2. Discussions existantes : créées par la personne qui écrit au vendeur
--    depuis une annonce, donc participants[1] = acheteur, participants[2] =
--    vendeur. L'annonce n'était pas enregistrée : elles restent sans annonce.
UPDATE "Conversation"
SET "buyerId" = "participants"[1],
    "sellerId" = "participants"[2];

-- Discussions invalides (pas exactement deux personnes existantes et
-- différentes) : supprimées avec leurs messages.
DELETE FROM "Conversation" AS c
WHERE cardinality(c."participants") <> 2
   OR c."buyerId" IS NULL
   OR c."sellerId" IS NULL
   OR c."buyerId" = c."sellerId"
   OR NOT EXISTS (SELECT 1 FROM "User" AS u WHERE u."id" = c."buyerId")
   OR NOT EXISTS (SELECT 1 FROM "User" AS u WHERE u."id" = c."sellerId");

-- 3. Messages hors discussion (anciens « commentaires d'annonce », jamais
--    affichés par l'app) : supprimés. Tout message appartient désormais à
--    une discussion.
DELETE FROM "Message" WHERE "conversationId" IS NULL;

ALTER TABLE "Message" DROP CONSTRAINT "Message_listingId_fkey";
DROP INDEX "Message_listingId_idx";
ALTER TABLE "Message" DROP COLUMN "listingId",
ALTER COLUMN "conversationId" SET NOT NULL;

ALTER TABLE "Conversation" DROP COLUMN "participants",
ALTER COLUMN "buyerId" SET NOT NULL,
ALTER COLUMN "sellerId" SET NOT NULL;

-- 4. Index : messages d'une discussion par date, listes « Achat » et
--    « Vente » triées par dernier message, une discussion par annonce et
--    par acheteur.
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Conversation_buyerId_lastMessageAt_idx" ON "Conversation"("buyerId", "lastMessageAt");
CREATE INDEX "Conversation_sellerId_lastMessageAt_idx" ON "Conversation"("sellerId", "lastMessageAt");
CREATE UNIQUE INDEX "Conversation_listingId_buyerId_key" ON "Conversation"("listingId", "buyerId");

-- 5. Clés étrangères.
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
