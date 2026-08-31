-- Article pasa de "registro de ingesta" a "documento editorial".
--
-- El material del feed (guid, urls, título/contenido originales) se muda a
-- ArticleSource (1-1 opcional). Editada a mano a partir del diff de Prisma
-- porque el diff DROPea las columnas ANTES de mover los datos: acá el orden es
--   1) crear tablas nuevas
--   2) copiar el material del feed a ArticleSource (INSERT ... SELECT)
--   3) recién entonces borrar las columnas viejas de Article
-- El backfill va dentro de la migración (y no en un script aparte) para que
-- `prisma migrate deploy` deje cualquier base —incluida la de tests— consistente
-- sin pasos manuales.

-- CreateEnum
CREATE TYPE "ArticleOrigin" AS ENUM ('FEED', 'ORIGINAL');

-- CreateEnum
CREATE TYPE "RevisionReason" AS ENUM ('AUTOSAVE', 'MANUAL', 'SUBMIT', 'PUBLISH', 'UNPUBLISH', 'CORRECTION', 'RESTORE', 'AI_ACCEPT');

-- ── 1) Tablas nuevas ─────────────────────────────────────────────────────

CREATE TABLE "ArticleSource" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "feedUrl" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "originalTitle" TEXT NOT NULL,
    "originalContent" TEXT NOT NULL,
    "originalImageUrl" TEXT,

    CONSTRAINT "ArticleSource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArticleTag" (
    "articleId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "ArticleTag_pkey" PRIMARY KEY ("articleId","tagId")
);

CREATE TABLE "ArticleAuthor" (
    "articleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArticleAuthor_pkey" PRIMARY KEY ("articleId","userId")
);

CREATE TABLE "ArticleRevision" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "reason" "RevisionReason" NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "userId" TEXT,
    "diff" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- ── 2) Columnas nuevas de Article + backfill ─────────────────────────────

ALTER TABLE "Article"
ADD COLUMN     "aiAssisted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "breakingUntil" TIMESTAMP(3),
ADD COLUMN     "contentJson" JSONB,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "firstPublishedAt" TIMESTAMP(3),
ADD COLUMN     "isBreaking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "kicker" TEXT,
ADD COLUMN     "lastEditedById" TEXT,
ADD COLUMN     "origin" "ArticleOrigin" NOT NULL DEFAULT 'FEED',
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "rewriteAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "scheduledAt" TIMESTAMP(3),
ADD COLUMN     "seoDescription" TEXT,
ADD COLUMN     "seoTitle" TEXT,
ADD COLUMN     "socialTitle" TEXT,
ADD COLUMN     "sourceSimilarity" DOUBLE PRECISION,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- Todo lo que existe hoy vino de un feed: mover su material a ArticleSource.
-- El id se genera con md5 (no hay cuid en SQL); sólo importa que sea único.
INSERT INTO "ArticleSource" ("id", "articleId", "guid", "feedUrl", "sourceName", "sourceUrl", "originalTitle", "originalContent", "originalImageUrl")
SELECT md5('src:' || "id"), "id", "guid", "feedUrl", "sourceName", "sourceUrl", "originalTitle", "originalContent", "originalImageUrl"
FROM "Article";

-- Las que ya están publicadas: su primera publicación es la que conocemos.
-- createdAt = fetchedAt (la fecha real de alta), no "ahora".
UPDATE "Article" SET "firstPublishedAt" = "publishedAt" WHERE "status" = 'PUBLISHED';
UPDATE "Article" SET "createdAt" = "fetchedAt", "updatedAt" = COALESCE("reviewedAt", "fetchedAt");

-- ── 3) Borrar las columnas viejas de Article ─────────────────────────────

DROP INDEX "Article_guid_key";

ALTER TABLE "Article" DROP COLUMN "feedUrl",
DROP COLUMN "guid",
DROP COLUMN "originalContent",
DROP COLUMN "originalImageUrl",
DROP COLUMN "originalTitle",
DROP COLUMN "sourceName",
DROP COLUMN "sourceUrl";

-- ── Índices y FKs ────────────────────────────────────────────────────────

CREATE UNIQUE INDEX "ArticleSource_articleId_key" ON "ArticleSource"("articleId");
CREATE UNIQUE INDEX "ArticleSource_guid_key" ON "ArticleSource"("guid");
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");
CREATE INDEX "ArticleRevision_articleId_createdAt_idx" ON "ArticleRevision"("articleId", "createdAt");
CREATE UNIQUE INDEX "ArticleRevision_articleId_version_key" ON "ArticleRevision"("articleId", "version");
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "Article_status_updatedAt_idx" ON "Article"("status", "updatedAt");
CREATE INDEX "Article_createdById_status_idx" ON "Article"("createdById", "status");
CREATE INDEX "Article_status_scheduledAt_idx" ON "Article"("status", "scheduledAt");

ALTER TABLE "Article" ADD CONSTRAINT "Article_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Article" ADD CONSTRAINT "Article_lastEditedById_fkey" FOREIGN KEY ("lastEditedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArticleSource" ADD CONSTRAINT "ArticleSource_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleTag" ADD CONSTRAINT "ArticleTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleAuthor" ADD CONSTRAINT "ArticleAuthor_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleAuthor" ADD CONSTRAINT "ArticleAuthor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleRevision" ADD CONSTRAINT "ArticleRevision_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
