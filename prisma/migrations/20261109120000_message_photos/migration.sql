-- Photos dans les messages (une par message).
ALTER TABLE "Message" ADD COLUMN "photoName" TEXT;
ALTER TABLE "Message" ADD COLUMN "photoWidth" INTEGER;
ALTER TABLE "Message" ADD COLUMN "photoHeight" INTEGER;
