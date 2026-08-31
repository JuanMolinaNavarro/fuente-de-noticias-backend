-- Renombrar estados editoriales y agregar los intermedios.
--
-- Escrito a mano: el diff automático de Prisma no sabe "renombrar" un valor
-- de enum (genera CREATE TYPE nuevo + ALTER COLUMN ... USING + DROP TYPE) y
-- fallaría o perdería las filas que todavía tienen APPROVED/REJECTED.
-- Postgres sí sabe: ALTER TYPE ... RENAME VALUE preserva las filas tal cual.
--
--   APPROVED -> PUBLISHED   (era "aprobada", pero significaba "publicada")
--   REJECTED -> SPIKED      (papelera blanda, restaurable; antes era terminal)
--   + IN_REVIEW  (después de DRAFT)
--   + SCHEDULED  (después de IN_REVIEW)
--
-- El schema.prisma declara el enum en este mismo orden físico para que
-- `prisma migrate diff` no detecte drift.
ALTER TYPE "ArticleStatus" RENAME VALUE 'APPROVED' TO 'PUBLISHED';
ALTER TYPE "ArticleStatus" RENAME VALUE 'REJECTED' TO 'SPIKED';
ALTER TYPE "ArticleStatus" ADD VALUE 'IN_REVIEW' AFTER 'DRAFT';
ALTER TYPE "ArticleStatus" ADD VALUE 'SCHEDULED' AFTER 'IN_REVIEW';
