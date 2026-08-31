-- CreateEnum
CREATE TYPE "HomeZone" AS ENUM ('PRINCIPAL', 'DESTACADAS', 'MAS_NOTICIAS');

-- CreateTable
CREATE TABLE "HomeSlot" (
    "id" TEXT NOT NULL,
    "zone" "HomeZone" NOT NULL,
    "position" INTEGER NOT NULL,
    "articleId" TEXT NOT NULL,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HomeLayoutVersion" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeLayoutVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HomeSlot_articleId_idx" ON "HomeSlot"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "HomeSlot_zone_position_key" ON "HomeSlot"("zone", "position");

-- CreateIndex
CREATE INDEX "HomeLayoutVersion_publishedAt_idx" ON "HomeLayoutVersion"("publishedAt");

-- AddForeignKey
ALTER TABLE "HomeSlot" ADD CONSTRAINT "HomeSlot_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeLayoutVersion" ADD CONSTRAINT "HomeLayoutVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
