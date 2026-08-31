-- Nuevo rol REDACTOR + flags de usuario.
-- OJO Postgres: un valor nuevo de enum no puede usarse en la misma transacción
-- que lo agrega ("unsafe use of new value"). Por eso el SET DEFAULT 'REDACTOR'
-- va en la migración siguiente.

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'REDACTOR';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
