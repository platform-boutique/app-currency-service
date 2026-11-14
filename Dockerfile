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

ARG SERVICE_VERSION=dev
ARG SERVICE_COMMIT=unknown

LABEL org.opencontainers.image.title="currency-service" \
      org.opencontainers.image.source="https://github.com/platform-boutique/app-currency-service" \
      org.opencontainers.image.revision="${SERVICE_COMMIT}" \
      org.opencontainers.image.version="${SERVICE_VERSION}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    SERVICE_VERSION=${SERVICE_VERSION} \
    SERVICE_COMMIT=${SERVICE_COMMIT}

# npm/npx are not needed at runtime (entrypoint is plain node); removing them drops npm's bundled
# dependencies (tar, pacote, sigstore, ...) from the image CVE surface.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup -S -g 10001 appgroup && adduser -S -u 10001 -G appgroup appuser

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --chown=appuser:appgroup proto/ ./proto/
COPY --chown=appuser:appgroup data/ ./data/

# Numeric so Kubernetes runAsNonRoot can verify it (IMG-02: UID:GID 10001)
USER 10001:10001

EXPOSE 7000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const grpc=require('@grpc/grpc-js');const c=new grpc.Client('localhost:'+(process.env.PORT||7000),grpc.credentials.createInsecure());c.waitForReady(Date.now()+3000,e=>{process.exit(e?1:0)})"

ENTRYPOINT ["node", "dist/server.js"]