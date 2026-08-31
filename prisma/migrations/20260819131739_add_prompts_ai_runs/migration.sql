-- CreateEnum
CREATE TYPE "AiKind" AS ENUM ('REWRITE', 'HEADLINES', 'SUMMARY', 'KICKER', 'TAGS', 'SEO');

-- CreateTable
CREATE TABLE "Prompt" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "system" TEXT NOT NULL,
    "userTemplate" TEXT NOT NULL,
    "model" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Prompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiRun" (
    "id" TEXT NOT NULL,
    "articleId" TEXT,
    "kind" "AiKind" NOT NULL,
    "promptKey" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "instruction" TEXT,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "durationMs" INTEGER,
    "accepted" BOOLEAN NOT NULL DEFAULT false,
    "acceptedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Prompt_key_active_idx" ON "Prompt"("key", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Prompt_key_version_key" ON "Prompt"("key", "version");

-- CreateIndex
CREATE INDEX "AiRun_articleId_createdAt_idx" ON "AiRun"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "AiRun_createdAt_idx" ON "AiRun"("createdAt");

-- CreateIndex
CREATE INDEX "AiRun_createdById_createdAt_idx" ON "AiRun"("createdById", "createdAt");

-- AddForeignKey
ALTER TABLE "Prompt" ADD CONSTRAINT "Prompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiRun" ADD CONSTRAINT "AiRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
