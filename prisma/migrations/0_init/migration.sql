-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ArticleStatus" AS ENUM ('INGESTED', 'DRAFT', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "originalImageUrl" TEXT,
    "title" TEXT,
    "summary" TEXT,
    "content" TEXT,
    "category" TEXT,
    "slug" TEXT,
    "imageUrl" TEXT,
    "status" "ArticleStatus" NOT NULL DEFAULT 'INGESTED',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Article_guid_key" ON "Article"("guid");

-- CreateIndex
CREATE UNIQUE INDEX "Article_slug_key" ON "Article"("slug");

-- CreateIndex
CREATE INDEX "Article_status_publishedAt_idx" ON "Article"("status", "publishedAt");
