# Multi-stage: la imagen final solo lleva lo necesario para correr,
# no las herramientas de compilación.

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate
COPY --from=build /app/dist ./dist

# La carpeta de uploads debe existir y pertenecer a node ANTES de declarar
# USER: cuando compose monte un volumen vacío acá, hereda este ownership.
# Si fuera de root, el proceso (que corre como node) no podría escribir.
RUN mkdir -p /app/uploads && chown -R node:node /app/uploads

# Principio de menor privilegio: si alguien logra ejecutar código dentro del
# contenedor, que sea como un usuario sin permisos, no como root.
USER node

EXPOSE 4000

# exec form (sin sh -c): node es PID 1 y recibe SIGTERM directo, así el
# graceful shutdown de Nest (enableShutdownHooks) funciona de verdad.
# Las migraciones ya no van acá: las corre el servicio one-shot "migrate"
# del compose — migrar y servir son ciclos de vida distintos.
CMD ["node", "dist/main.js"]
