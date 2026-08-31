-- CreateTable
CREATE TABLE "IngestTombstone" (
    "id" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "title" TEXT,
    "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestTombstone_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IngestTombstone_guid_key" ON "IngestTombstone"("guid");

-- CreateIndex
CREATE INDEX "IngestTombstone_deletedAt_idx" ON "IngestTombstone"("deletedAt");

-- CreateIndex
CREATE INDEX "Article_status_fetchedAt_idx" ON "Article"("status", "fetchedAt");
