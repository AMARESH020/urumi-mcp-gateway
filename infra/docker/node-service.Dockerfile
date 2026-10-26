# syntax=docker/dockerfile:1

FROM node:22-trixie-slim AS build
RUN npm install --global npm@11.21.1

WORKDIR /app

ARG WORKSPACE_NAME

# Copy workspace manifests first to improve dependency-layer caching.
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY servers/demo-mcp/package.json ./servers/demo-mcp/package.json
COPY servers/inventory-mcp/package.json ./servers/inventory-mcp/package.json
COPY servers/woocommerce-mcp/package.json ./servers/woocommerce-mcp/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

# Source files are copied after dependency installation.
COPY . .

RUN npm run build --workspace="${WORKSPACE_NAME}"

# Retain production dependencies only.
RUN npm prune --omit=dev


FROM node:22-trixie-slim AS runtime
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app

ENV NODE_ENV=production

ARG WORKSPACE_NAME
ENV WORKSPACE_NAME="${WORKSPACE_NAME}"

COPY --from=build /app /app

# The service only needs read access to application files.
USER node

CMD ["sh", "-c", "case \"$WORKSPACE_NAME\" in @urumi/gateway) WORKSPACE_DIR=apps/gateway ;; @urumi/demo-mcp) WORKSPACE_DIR=servers/demo-mcp ;; @urumi/inventory-mcp) WORKSPACE_DIR=servers/inventory-mcp ;; @urumi/woocommerce-mcp) WORKSPACE_DIR=servers/woocommerce-mcp ;; *) echo \"Unsupported WORKSPACE_NAME: $WORKSPACE_NAME\" >&2; exit 1 ;; esac; cd \"/app/$WORKSPACE_DIR\" && exec node dist/index.js"]
