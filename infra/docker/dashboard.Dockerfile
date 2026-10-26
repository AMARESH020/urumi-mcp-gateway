FROM node:22-bookworm-slim AS build

WORKDIR /app

ARG VITE_GATEWAY_URL=http://127.0.0.1:14000
ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL

COPY package.json package-lock.json ./
COPY apps/dashboard/package.json ./apps/dashboard/package.json
COPY apps/gateway/package.json ./apps/gateway/package.json
COPY servers/demo-mcp/package.json ./servers/demo-mcp/package.json
COPY servers/inventory-mcp/package.json ./servers/inventory-mcp/package.json
COPY servers/woocommerce-mcp/package.json ./servers/woocommerce-mcp/package.json
COPY packages/shared/package.json ./packages/shared/package.json

RUN npm ci

COPY . .

RUN npm run build --workspace=@urumi/dashboard


FROM nginx:stable-alpine-slim AS runtime

COPY infra/docker/dashboard.nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/dashboard/dist/ /usr/share/nginx/html/

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/health || exit 1
