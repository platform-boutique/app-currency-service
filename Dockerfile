# ---- Build stage ----
FROM node:22.22.2-alpine3.23 AS builder

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
RUN npm ci --ignore-scripts

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Prune dev dependencies
RUN npm prune --omit=dev

# ---- Runtime stage ----
FROM node:22.22.2-alpine3.23 AS runtime

ENV NODE_ENV=production

# npm/npx are not needed at runtime (entrypoint is plain node); removing them drops npm's bundled
# dependencies (tar, pacote, sigstore, ...) from the image CVE surface.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup -S -g 101 appgroup && adduser -S -u 100 -G appgroup appuser

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --chown=appuser:appgroup proto/ ./proto/
COPY --chown=appuser:appgroup data/ ./data/

# Numeric so Kubernetes runAsNonRoot can verify it (matches the chart's runAsUser: 100 / runAsGroup: 101)
USER 100:101

EXPOSE 7000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const grpc=require('@grpc/grpc-js');const c=new grpc.Client('localhost:'+(process.env.PORT||7000),grpc.credentials.createInsecure());c.waitForReady(Date.now()+3000,e=>{process.exit(e?1:0)})"

ENTRYPOINT ["node", "dist/server.js"]