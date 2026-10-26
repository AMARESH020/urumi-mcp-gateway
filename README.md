# Urumi MCP Gateway

A TypeScript-based Model Context Protocol (MCP) gateway that centralizes API-key authentication, upstream MCP server management, tool discovery, tool execution, and PostgreSQL audit logging. The project includes a React dashboard, Docker Compose configuration, and a Helm-based Kubernetes deployment.

## Features

- API-key authentication with SHA-256 hashed key storage.
- Admin and member roles.
- Upstream MCP server registration and management.
- Unified Streamable HTTP MCP endpoint at `/mcp`.
- Dynamic discovery of tools from enabled upstream MCP servers.
- Namespaced tool names to reduce collisions between servers.
- Per-server MCP proxy endpoint for compatibility.
- Upstream timeouts and safe error responses.
- PostgreSQL audit logging for gateway operations and tool calls.
- React dashboard for server management.
- Demo, Inventory, and WooCommerce MCP servers.
- PostgreSQL persistent storage.
- Docker Compose and Kubernetes deployments using Helm.

## Technology Stack

- Node.js 22 and TypeScript
- Express
- Model Context Protocol SDK
- PostgreSQL 16
- React and Vite
- Zod
- Vitest and Supertest
- Docker, Kubernetes, Minikube, and Helm

## Repository Structure

- `apps/gateway/` — gateway API, authentication, server routes, MCP proxy, and audit logging
- `apps/dashboard/` — React dashboard
- `servers/demo-mcp/` — demonstration MCP tools
- `servers/inventory-mcp/` — sample inventory tools
- `servers/woocommerce-mcp/` — WooCommerce MCP tools
- `packages/shared/` — shared schemas and types
- `infra/docker/` — Dockerfiles and Nginx configuration
- `infra/helm/urumi-gateway/` — Kubernetes Helm chart
- `docs/` — project and security documentation
- `compose.yaml` — Docker Compose deployment

## Prerequisites

- Node.js 22 and npm
- Docker Desktop with Linux containers
- For Kubernetes: Minikube, kubectl, Helm, and the Minikube Ingress add-on

## Local Development

Install dependencies from the repository root:

```powershell
npm install
```

Run type checks across workspaces:

```powershell
npm run typecheck --workspaces --if-present
```

Run tests across workspaces:

```powershell
npm run test --workspaces --if-present
```

Build all workspaces:

```powershell
npm run build --workspaces --if-present
```

Start the Docker Compose deployment:

```powershell
docker compose up -d --build
```

The configured Compose endpoints are:

- Dashboard: `http://127.0.0.1:15173/`
- Gateway health: `http://127.0.0.1:14000/health`
- Unified MCP endpoint: `http://127.0.0.1:14000/mcp`

Check the service state:

```powershell
docker compose ps
```

Stop the Compose services without deleting their containers:

```powershell
docker compose stop
```

## Kubernetes Deployment

The Helm chart is located at `infra/helm/urumi-gateway`.

The current local Minikube deployment uses the Ingress host `urumi.local`. The Windows hosts file can map this hostname to `127.0.0.1` when using a local tunnel or port-forward.

Check the deployment:

```powershell
kubectl get pods
kubectl get services
kubectl get ingress
kubectl rollout status deployment/urumi-gateway-gateway --timeout=120s
```

### Accessing Ingress on Windows

If Windows cannot reach the Minikube Docker network directly, forward the Ingress controller's HTTP port:

```powershell
kubectl port-forward --address 127.0.0.1 -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

Keep that terminal open. In another terminal, test the gateway health endpoint:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://urumi.local:8080/health"
```

With this port-forward active, the local MCP endpoint is:

`http://urumi.local:8080/mcp`

## Gateway API

### Health checks

- `GET /health` — process health.
- `GET /health/ready` — readiness check, including database connectivity.

### Unified MCP endpoint

The gateway exposes one unified, API-key-protected Streamable HTTP endpoint:

`POST /mcp`

Provide the API key in the request header:

`Authorization: Bearer <API_KEY>`

The endpoint supports MCP initialization, tool discovery, and tool invocation. It aggregates tools from enabled upstream servers and routes calls to the corresponding server.

Tool names use a namespace containing a normalized server name and a server-ID prefix, followed by the upstream tool name. For example:

`inventory_mcp_server_<id-prefix>__get_stock_level`

The identifier prefix is generated from the registered upstream server's ID. Tool names can therefore differ between environments.

The current unified endpoint uses stateless Streamable HTTP. GET-based event streams and DELETE-based session termination are not supported; those methods return HTTP 405.

### Existing per-server proxy

The original proxy endpoint remains available:

`POST /api/servers/:id/mcp`

This route forwards MCP requests to a specific registered upstream server.

### Creating an API key

The gateway provides a CLI script for creating an API key for an active administrator. Run it in an environment configured to connect to the intended gateway database:

```powershell
npm run create-api-key --workspace=@urumi/gateway
```

The script reads `ADMIN_EMAIL` and optional `API_KEY_NAME` configuration. A newly generated raw key is displayed once by the script; store it securely. Only the SHA-256 hash is stored in the database.

Do not commit API keys, passwords, `.env` files, or Kubernetes Secret values to source control.

## MCP Client Example

Configure an MCP client that supports Streamable HTTP with the gateway URL and an Authorization bearer header.

For local Minikube access while the port-forward is running:

- URL: `http://urumi.local:8080/mcp`
- Header: `Authorization: Bearer <API_KEY>`

For deployments exposed through a suitable hostname and HTTPS ingress, use that deployment's `/mcp` URL instead.

A client should initialize the MCP connection, request the available tools, and invoke tools by their advertised names. The gateway discovers tools from enabled upstream servers.

## Security Considerations

- API keys are generated using cryptographically secure random bytes.
- The database stores API-key hashes rather than raw key values.
- Protected endpoints authenticate API keys.
- Administrative routes enforce role-based access.
- Tool calls recheck that the target upstream server exists and remains enabled.
- Tool calls are audited with the requesting user, API key, upstream server, tool names, outcome, and duration.
- Upstream tool descriptions are treated as untrusted metadata and explicitly labelled as such.
- Upstream tools must still be reviewed for their behavior and permissions.
- Use HTTPS and secure secret management for non-local deployments.
- Never commit secrets to source control.

## Current Limitations

- The Inventory MCP server currently returns sample data, not live warehouse inventory.
- Live WooCommerce integration requires valid store credentials. The current cluster's live-store behavior has not been verified.
- The WooCommerce MCP server currently exposes `search_products`, `get_product`, and `list_product_categories`. Product creation and order-management operations are not yet implemented.
- An LLM-powered chat agent and its tool-calling workflow are not yet implemented.
- The unified endpoint has automated tests for initialization, tool discovery, tool invocation, and authentication, along with a successful manual Kubernetes test.
- The gateway and upstream servers use Streamable HTTP. Additional transports would require separate implementation and testing.

## Automated Checks

Run all available workspace tests:

```powershell
npm run test --workspaces --if-present
```

Run type checks:

```powershell
npm run typecheck --workspaces --if-present
```

Build all workspaces:

```powershell
npm run build --workspaces --if-present
```
## Current Limitations

- The Inventory MCP server currently returns sample inventory data rather than live warehouse inventory.
- WooCommerce MCP is integrated with the local WordPress/WooCommerce deployment. Product listing and order listing have been successfully validated through the unified gateway using a member API key. Product creation and order-status changes should be tested separately before claiming their end-to-end workflows are verified.
- The gateway contains chat orchestration code and dashboard functionality. The complete LLM-provider and tool-execution workflow must be validated end to end before treating chat-based actions as fully verified.
- The local Kubernetes environment has experienced intermittent database and application health-probe timeouts. PostgreSQL currently accepts connections, and the MariaDB health check has completed successfully, but the historical restarts and recent probe warnings should be addressed before production use.
- `values-prod.yaml` is a production configuration template, not a production-ready deployment. Replace example hostnames and image tags, provision Kubernetes Secrets securely, and configure and validate TLS before exposing the application publicly.
- The unified MCP endpoint currently uses stateless Streamable HTTP. GET-based event streams and DELETE-based session termination are not supported; those methods return HTTP 405.

## Manual Validation Evidence

The following behaviors have been verified in the local Kubernetes environment:

- A valid User B API key successfully initialized an MCP connection through `http://127.0.0.1:4000/mcp`, returning HTTP 200.
- The Inventory MCP `list_inventory` tool returned HTTP 200 and inventory data.
- The WooCommerce MCP `list_orders` tool returned HTTP 200 and order data.
- A revoked API key was rejected by the gateway with HTTP 401.
- Dashboard audit logs recorded successful Inventory and WooCommerce tool calls against the correct member account.
- Disabling the demo upstream caused its reachability check to report it as unreachable; restoring the upstream allowed it to recover.
- All three persistent volume claims were observed in the Bound state during the validation session.

These results demonstrate the tested behaviors in the local environment; they do not establish production readiness or prove that every tool and chat workflow has passed end-to-end testing.