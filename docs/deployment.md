# Deployment Guide

This guide covers the repository's local Windows workflow and the intended production configuration path. Commands are examples for the repository's current chart layout; inspect the active release and its values before applying an upgrade to an existing cluster.

## 1. Requirements

- Windows 11 with PowerShell
- Node.js 22+ and npm
- Docker Desktop using Linux containers
- For Kubernetes: Minikube, `kubectl`, Helm, and the Minikube NGINX Ingress add-on
- Git access to this repository

From the repository root:

```powershell
npm install
npm run typecheck
npm run test
npm run build
```

## 2. Docker Compose deployment

Start the local stack:

```powershell
docker compose up -d --build
docker compose ps
```

Check health and readiness:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:14000/health"
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:14000/health/ready"
```

The configured endpoints are:

- Dashboard: `http://127.0.0.1:15173/`
- MCP endpoint: `http://127.0.0.1:14000/mcp`

Stop the services without deleting volumes:

```powershell
docker compose stop
```

Do not use `docker compose down -v` unless you intentionally want to delete Compose-managed volumes and their data.

## 3. Minikube: inspect before changing anything

The chart is `infra/helm/urumi-gateway`; the expected release name used by the local environment is `urumi-gateway` in namespace `default`.

```powershell
minikube status
kubectl get pods -o wide
kubectl get services
kubectl get ingress
kubectl get pvc
helm list -n default
helm status urumi-gateway -n default
helm get values urumi-gateway -n default
```

Check that the required Secret objects exist without printing their values:

```powershell
kubectl get secrets
```

The default values file references these Secret names:

- `urumi-gateway-secrets`
- `urumi-store-secrets`
- `urumi-woocommerce-credentials`

The chart expects these secrets to be provisioned appropriately for the selected configuration. Never paste secret values into source-controlled YAML, this document, terminal screenshots, or GitHub. Before applying changes, verify the exact secret keys expected by the chart templates.

## 4. Access the local Kubernetes ingress

Enable the Minikube ingress add-on if it is not already enabled:

```powershell
minikube addons enable ingress
kubectl get pods -n ingress-nginx
```

Start a port-forward in a separate PowerShell window and leave it running:

```powershell
kubectl port-forward --address 127.0.0.1 -n ingress-nginx svc/ingress-nginx-controller 8080:80
```

If host resolution is required, run Notepad as Administrator and edit:

`C:\Windows\System32\drivers\etc\hosts`

Add:

```text
127.0.0.1 urumi.local
127.0.0.1 store.urumi.local
```

In the original terminal, verify:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://urumi.local:8080/health"
Invoke-WebRequest -UseBasicParsing -Uri "http://urumi.local:8080/health/ready"
```

The local URLs while the port-forward is active are:

- Dashboard: `http://urumi.local:8080/`
- Store: `http://store.urumi.local:8080/`
- Gateway MCP endpoint: `http://urumi.local:8080/mcp`

For direct temporary gateway testing, a port-forward can be used instead:

```powershell
kubectl port-forward deployment/urumi-gateway-gateway 4000:4000
```

Then use `http://127.0.0.1:4000/health` and `http://127.0.0.1:4000/mcp`. Keep the port-forward terminal open. If a request reports that it cannot connect to `127.0.0.1:4000`, confirm the port-forward is still running before diagnosing the gateway or upstream.

## 5. Helm chart validation

Run a lint and render check before modifying the active release:

```powershell
helm lint .\infra\helm\urumi-gateway
helm template urumi-gateway .\infra\helm\urumi-gateway -n default -f .\infra\helm\urumi-gateway\values.yaml
```

The default values include local image names/tags and references to the existing Secret names. A fresh Minikube cluster may not have the images loaded or the secrets created. Do not run an upgrade until those prerequisites have been met and verified.

For a deliberate update of the local release, use the same values files and image tags that match the code/images being tested. The general Helm pattern is:

```powershell
helm upgrade --install urumi-gateway .\infra\helm\urumi-gateway `
  --namespace default `
  -f .\infra\helm\urumi-gateway\values.yaml
```

**Important:** This can change running workloads. Before running it on the existing assignment cluster, compare `helm get values`, check image names/tags, inspect required Secrets, and ensure the intended images are present in Minikube. If you have made no application or chart changes, there is no need to run an upgrade merely to perform acceptance tests.

After an upgrade:

```powershell
kubectl rollout status deployment/urumi-gateway-gateway -n default --timeout=120s
kubectl get pods -o wide
kubectl get pvc
helm status urumi-gateway -n default
```

## 6. Production-like values template

The repository includes `infra/helm/urumi-gateway/values-prod.yaml`. It increases storage and resource requests/limits and contains placeholder hostnames and image tags. It is a template, not proof that a public VPS/k3s installation has been completed.

Before using it:

1. Replace every placeholder image tag with an immutable/versioned tag that exists in a registry accessible by the cluster.
2. Replace `gateway.example.com` and `store.example.com` with the real hostnames.
3. Provision the referenced Kubernetes Secrets securely and verify their required keys.
4. Configure ingress TLS explicitly. The current Ingress template does not declare a TLS secret, so the current values file alone does not provide HTTPS termination.
5. Confirm persistent storage classes, backups and restore procedures, ingress/network policies, Kubernetes RBAC, resource availability, and monitoring.
6. Render and review the complete manifests before applying them:

```powershell
helm lint .\infra\helm\urumi-gateway
helm template urumi-gateway .\infra\helm\urumi-gateway `
  --namespace default `
  -f .\infra\helm\urumi-gateway\values.yaml `
  -f .\infra\helm\urumi-gateway\values-prod.yaml
```

Do not deploy the template publicly without replacing placeholders and validating TLS, secrets, images, storage, and network access.

## 7. Operational checks

List workloads and recent events:

```powershell
kubectl get pods -o wide
kubectl get events --sort-by=.lastTimestamp | Select-Object -Last 30
kubectl logs deployment/urumi-gateway-gateway --since=15m --tail=100
kubectl logs deployment/urumi-gateway-postgres --since=15m --tail=100
```

To inspect an upstream, use its actual current deployment name from `kubectl get deployments`; names may vary if the chart or release name changes.

Health endpoints:

- `/health`: gateway process health
- `/health/ready`: gateway readiness; also tests database access

Do not consider a process-only health response sufficient if the database or upstream pods have been restarting. Check readiness and workload events too.

## 8. MCP request details

For local direct access through the gateway port-forward:

```powershell
$headers = @{
    Authorization = "Bearer <API_KEY>"
    Accept = "application/json, text/event-stream"
}
```

For MCP Streamable HTTP JSON-RPC POSTs, include an `Accept` header listing both `application/json` and `text/event-stream`. Discover tools with `tools/list` and use the exact exposed names it returns; names include a server-ID prefix and can vary by deployment.

Never insert a real API key into a committed script or documentation. Use a PowerShell variable in local testing and do not print it.

## 9. Rollback

Inspect release history first:

```powershell
helm history urumi-gateway -n default
```

If an upgrade has failed and the previous revision is known-good, review the history and roll back to the explicit revision number shown there:

```powershell
helm rollback urumi-gateway <REVISION> -n default
```

Wait for the rollout and re-run health/readiness checks. Do not guess the revision number.

## 10. Troubleshooting

| Symptom | First check |
|---|---|
| `Unable to connect to the remote server` at `127.0.0.1:4000` | Confirm `kubectl port-forward deployment/urumi-gateway-gateway 4000:4000` is still running. |
| HTTP 406 from `/mcp` | Include `Accept: application/json, text/event-stream`. |
| HTTP 401 | Confirm the intended key is active, unexpired, and not revoked; never print the key in logs. |
| HTTP 503 during authentication | Inspect gateway logs and test database readiness before changing API-key data. |
| Tools from an upstream disappear | Check that the upstream is enabled and healthy; inspect its pod/service and gateway logs. |
| Pods restart or fail readiness | Inspect `kubectl describe pod`, pod logs, PVC status, and events. |
| Dashboard is reachable but MCP URL is not | Check Ingress paths, service ports, host resolution, and active port-forward. |

## Security reminder

Never commit `.env`, API keys, passwords, database credentials, or Kubernetes Secret values. Use TLS for public endpoints, restrict database and cluster access, and test backup restoration before treating a deployment as production-ready.
