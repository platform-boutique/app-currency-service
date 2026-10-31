# ---- Build stage ----
FROM node:24.22.1-alpine3.23 AS builder

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
FROM node:24.22.1-alpine3.23 AS runtime

ENV NODE_ENV=production

# npm/npx are not needed at runtime (entrypoint is plain node); removing them drops npm's bundled
# dependencies (tar, pacote, sigstore, ...) from the image CVE surface.
RUN apk upgrade --no-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx \
    && addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

# Copy only what's needed to run
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --chown=appuser:appgroup proto/ ./proto/
COPY --chown=appuser:appgroup data/ ./data/

USER appuser

EXPOSE 7000

HEALTHCHECK --interval=10s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const grpc=require('@grpc/grpc-js');const c=new grpc.Client('localhost:'+process.env.PORT,grpc.credentials.createInsecure());c.waitForReady(Date.now()+3000,e=>{process.exit(e?1:0)})"

ENTRYPOINT ["node", "dist/server.js"]