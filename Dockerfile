# syntax=docker/dockerfile:1

# ---------- 1. Dependencias de producción ----------
# Se instalan aparte en vez de `npm prune` sobre las de desarrollo: prune se
# quedaba colgado en PCs lentas, y así esta capa se reutiliza mientras no
# cambie package-lock.json.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Caché de npm entre builds: si cambia package-lock.json solo se descarga lo
# nuevo, no todas las dependencias otra vez.
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev --prefer-offline --no-audit --no-fund

# ---------- 2. Build ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --prefer-offline --no-audit --no-fund
COPY . .
RUN npm run build

# ---------- 3. Imagen final ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist

# Evidencias y avatares: se montan como volúmenes en docker-compose.yml.
# Se crean aquí para que el volumen herede el dueño `node`.
RUN mkdir -p uploads storage/avatars && chown -R node:node uploads storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
