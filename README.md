# Fuente de Noticias — Backend

API REST del diario, construida con **NestJS + PostgreSQL + Prisma**. El frontend Next.js
(`../fuente-de-noticias-frontend`) consume esta API desde el servidor (patrón BFF): el
browser nunca habla directo con el backend.

## Arranque rápido

```bash
# 1. Postgres (compose en la raíz del repo)
docker compose -f ../docker-compose.yml up -d db

# 2. Configuración
cp .env.example .env   # completar JWT_SECRET y SEED_ADMIN_PASSWORD

# 3. Migraciones + usuario admin (+ artículos demo con --demo)
npx prisma migrate deploy
npx prisma db seed -- --demo
node --env-file=.env -r ts-node/register prisma/backfill-fase3.ts  # categorías + feeds

# 4. Dev server en http://localhost:4000/api/v1
npm run start:dev
```

Tests: `npm test` (unit) · `npm run test:e2e` (contra la DB real `frente_noticias_test`,
que se crea y migra sola).

## Arquitectura

Monolito modular por contexto, con capas `Controller → Service → PrismaService`:

```
src/
├── config/          validación Zod del entorno (la app no arranca con env inválido)
├── prisma/          PrismaService (módulo global)
├── common/          paginación, decoradores (@Roles, @CurrentUser), filtro P2002/P2025
├── domain/          LÓGICA PURA: máquina de estados editorial + slugify (sin Nest/Prisma)
└── modules/
    ├── articles/        API pública (solo APPROVED, DTO sin campos internos)
    ├── admin-articles/  flujo editorial: stats, listados, save/approve/reject/unpublish
    ├── auth/            JWT + Passport + bcrypt (User con roles ADMIN/EDITOR)
    ├── users/           acceso a usuarios (solo seed por ahora)
    ├── categories/      catálogo de categorías (público + CRUD admin)
    ├── feeds/           feeds RSS a ingerir (CRUD admin)
    ├── weather/         proxy cacheado de Open-Meteo (puerto/adaptador)
    └── ingest/          worker RSS→borrador (cron 30 min + POST manual)
```

**La máquina de estados** (`src/domain/article-state.ts`) es el corazón del dominio:

```
INGESTED ──> DRAFT ──approve──> APPROVED
     │          │                   │
     └──reject──┴──> REJECTED       └──unpublish──> DRAFT (libera el slug)
```

Son funciones puras que devuelven los campos a actualizar o lanzan errores de dominio;
el service las orquesta y traduce a HTTP (422/409). Se testean sin base de datos.

**Puertos y adaptadores** solo donde hay volatilidad real: `WeatherProviderPort`
(Open-Meteo), `FeedParserAdapter` (rss-parser).

## API (`/api/v1`)

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| GET | `/health` | — | estado de la app y la DB (exento de rate limit) |
| GET | `/articles?category&page&limit` | — | notas publicadas, paginadas |
| GET | `/articles/slugs` | — | proyección liviana para el sitemap (slug + fechas) |
| GET | `/articles/preview/:token` | — | vista previa con token efímero |
| GET | `/articles/:slug` | — | detalle (404 si no está PUBLISHED) |
| GET | `/articles/:slug/related?limit` | — | relacionadas por categoría |
| GET | `/categories` | — | catálogo (el nav del frontend sale de acá) |
| GET | `/home` | — | portada curada + relleno cronológico |
| GET | `/market/summary` | — | dólares, Merval y riesgo país |
| GET | `/weather` | — | clima de Tucumán, cache 30 min |
| POST | `/auth/login` | — | `{email, password}` → token (máx. 5 intentos/min por IP) |
| GET | `/auth/me` · POST `/auth/change-password` | Bearer | sesión propia |
| GET/POST/PATCH | `/admin/articles...` | Bearer | redacción: stats, listado, edición, revisiones, submit/spike |
| POST | `/admin/articles/:id/{return,publish,unpublish,unschedule,restore}` | ADMIN·EDITOR | flujo editorial |
| GET/PUT/POST | `/admin/home...` | ADMIN·EDITOR | curación de portada |
| GET/POST/PATCH | `/admin/{categories,feeds,users}` · `/admin/audit` · `/admin/ingest/run` · `/admin/market/refresh` | ADMIN | administración |

Errores: 400 validación de DTO · 401 sin token · 403 rol insuficiente · 404 no existe ·
409 conflicto (slug duplicado / transición inválida / ingesta en curso) · 422 publicar
sin título o cuerpo · 429 rate limit.

## Producción

- **Rate limiting** global (100 req/min por IP, `ThrottlerGuard` como `APP_GUARD`)
  con límite estricto en login; **helmet** en `app.setup.ts`; CORS solo en dev
  (con BFF el browser nunca llama al backend). `trust proxy` activado para que
  la IP real llegue a través de Caddy.
- El deploy corre con `docker-compose.prod.yml` (raíz del monorepo): las
  migraciones y el seed van en el servicio one-shot `migrate`, no en el CMD
  del contenedor. Ver el README de la raíz.

## Decisiones pendientes

- `Article.category` (string) convive con `categoryId` (FK) durante la transición;
  el sitio público todavía filtra por el string.
- Refresh tokens (hoy JWT de 12 h; mitigado porque `JwtStrategy` relee el usuario
  de la DB en cada request, así una desactivación aplica al instante).
- **Deuda de seguridad documentada**: los guards de auth son opt-in por controller
  (`@UseGuards(...)` en cada uno). El refactor a `APP_GUARD` global + decorator
  `@Public()` haría que un controller nuevo nazca protegido por defecto
  (~14 controllers a tocar + e2e). Mitigación actual: los e2e cubren 401 en
  rutas admin.
