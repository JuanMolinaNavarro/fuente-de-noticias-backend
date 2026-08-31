-- CreateEnum
CREATE TYPE "MarketIndicator" AS ENUM ('DOLAR_OFICIAL', 'DOLAR_BLUE', 'DOLAR_MEP', 'DOLAR_CCL', 'DOLAR_MAYORISTA', 'DOLAR_CRIPTO', 'DOLAR_TARJETA', 'MERVAL', 'RIESGO_PAIS');

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "indicator" "MarketIndicator" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "buy" DOUBLE PRECISION,
    "sell" DOUBLE PRECISION,
    "source" TEXT NOT NULL,
    "sourceAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketSnapshot_indicator_capturedAt_idx" ON "MarketSnapshot"("indicator", "capturedAt");
