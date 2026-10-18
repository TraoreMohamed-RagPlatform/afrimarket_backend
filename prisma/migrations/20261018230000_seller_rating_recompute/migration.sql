-- Un avis survit à la suppression de son annonce.
ALTER TABLE "Rating" DROP CONSTRAINT "Rating_listingId_fkey";
ALTER TABLE "Rating" ALTER COLUMN "listingId" DROP NOT NULL;
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_listingId_fkey" FOREIGN KEY ("listingId") REFERENCES "Listing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Rattrapage : note moyenne et nombre d'avis recalculés pour tous les
-- utilisateurs à partir des avis existants.
UPDATE "User" AS u
SET "avgRating" = COALESCE(r.avg, 0),
    "totalRatings" = COALESCE(r.total, 0)
FROM (
  SELECT u2."id" AS id,
         ROUND(AVG(rt."score")::numeric, 2)::double precision AS avg,
         COUNT(rt."id")::integer AS total
  FROM "User" u2
  LEFT JOIN "Rating" rt ON rt."sellerId" = u2."id"
  GROUP BY u2."id"
) AS r
WHERE r.id = u."id";
