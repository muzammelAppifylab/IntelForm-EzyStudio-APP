# IntelForm: one Node process serves the API and the built app.
#   docker build -t intelform .
#   docker run -p 8787:8787 -e DATABASE_URL=… -e APP_SECRET=… -e APP_URL=https://forms.example.com intelform
# glibc (slim, not Alpine) because @node-rs/argon2 ships prebuilt glibc binaries.

# ---- build ------------------------------------------------------------------
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# ---- runtime ----------------------------------------------------------------
FROM node:24-slim AS runtime
ENV NODE_ENV=production \
    API_PORT=8787 \
    MIGRATE_ON_BOOT=1 \
    UPLOADS_DIR=/app/uploads
WORKDIR /app

# The server runs TypeScript through tsx (a devDependency), so dev dependencies stay.
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server
COPY --from=build --chown=node:node /app/shared ./shared
COPY --from=build --chown=node:node /app/tsconfig.json /app/tsconfig.server.json ./
RUN mkdir -p /app/uploads && chown node:node /app/uploads

USER node
EXPOSE 8787
# Local uploads (used only without Bunny) survive restarts on a volume.
VOLUME ["/app/uploads"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# npm forwards SIGTERM to the server, which drains jobs and closes the pool.
CMD ["npm", "start"]
