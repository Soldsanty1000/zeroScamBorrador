# syntax=docker/dockerfile:1

# ---------- 1. Build ----------
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# Sin --no-audit: la construcción debe avisar de dependencias vulnerables.
RUN npm ci --no-fund
COPY . .
RUN npm run build && npm audit --omit=dev --audit-level=high && npm prune --omit=dev

# ---------- 2. Imagen final ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder --chown=node:node /app/package.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
# Scripts de operación (cuentas de staff) y esquema de la base.
COPY --from=builder --chown=node:node /app/scripts ./scripts

# Evidencias y avatares: se montan como volúmenes en docker-compose.yml.
# Se crean aquí para que el volumen herede el dueño `node`.
RUN mkdir -p uploads storage/avatars && chown -R node:node uploads storage

USER node
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main"]
