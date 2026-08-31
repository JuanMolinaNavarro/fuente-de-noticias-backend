-- Se elimina la IA embebida del producto (pasa a usarse de forma externa):
-- caen las tablas Prompt/AiRun, el enum AiKind, los campos de trazabilidad
-- aiAssisted/rewriteAttempts y el motivo de revisión AI_ACCEPT.

-- Las revisiones creadas al aceptar sugerencias de IA se borran (decisión
-- editorial: limpieza total, sin registro histórico). Postgres no permite
-- quitar un valor de un enum en uso, así que va antes de recrear el tipo.
DELETE FROM "ArticleRevision" WHERE "reason" = 'AI_ACCEPT';

-- AlterEnum
BEGIN;
CREATE TYPE "RevisionReason_new" AS ENUM ('AUTOSAVE', 'MANUAL', 'SUBMIT', 'PUBLISH', 'UNPUBLISH', 'CORRECTION', 'RESTORE');
ALTER TABLE "ArticleRevision" ALTER COLUMN "reason" TYPE "RevisionReason_new" USING ("reason"::text::"RevisionReason_new");
ALTER TYPE "RevisionReason" RENAME TO "RevisionReason_old";
ALTER TYPE "RevisionReason_new" RENAME TO "RevisionReason";
DROP TYPE "public"."RevisionReason_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "AiRun" DROP CONSTRAINT "AiRun_articleId_fkey";

-- DropForeignKey
ALTER TABLE "AiRun" DROP CONSTRAINT "AiRun_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Prompt" DROP CONSTRAINT "Prompt_createdById_fkey";

-- AlterTable
ALTER TABLE "Article" DROP COLUMN "aiAssisted",
DROP COLUMN "rewriteAttempts";

-- DropTable
DROP TABLE "AiRun";

-- DropTable
DROP TABLE "Prompt";

-- DropEnum
DROP TYPE "AiKind";
