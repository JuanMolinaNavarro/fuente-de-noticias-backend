-- Cierra la transición Article.category (string) -> Article.categoryId (FK).
-- Primero completa la FK donde falte a partir del nombre; después borra el
-- string. Si quedara alguna categoría sin fila en Category, se pierde a
-- propósito (era texto libre): mejor un artículo sin sección que un string
-- que ninguna pantalla puede resolver.
UPDATE "Article" a
SET "categoryId" = c."id"
FROM "Category" c
WHERE a."categoryId" IS NULL AND a."category" = c."name";

ALTER TABLE "Article" DROP COLUMN "category";
