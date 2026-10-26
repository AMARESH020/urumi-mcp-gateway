# Verification and Acceptance Evidence

This document separates observed local test evidence from requirements that still need an explicit test. It is not a claim that the deployment is production-ready.

## Confirmed in the October 26, 2026 local validation session

| Check | Result | Evidence / notes |
|---|---|---|
| Member API-key record | Pass | PostgreSQL lookup returned one record with no revocation or expiry and an active member user. |
| Gateway database connectivity | Pass at test time | A fresh `SELECT NOW(), current_database()` succeeded inside the gateway pod. |
| MCP tool discovery | Pass | Authenticated `tools/list` returned 13 tools: 2 Demo, 3 Inventory, and 8 WooCommerce. |
| Demo upstream tool call | Pass | `demo_mcp_server_6c3ca2e4__get_demo_status` returned status `ok` from `urumi-demo-mcp`. |
| Member audit attribution | Pass | Audit API returned the event under `userb.external@example.com`. |
| Request ID correlation | Pass | Request ID `assignment-audit-test-001` matched the audit event. |
| Tool metadata in audit | Pass | The record included action `mcp.tool_call`, exact exposed tool name, success outcome, and duration `105` ms. |
| Source push | Pass | GitHub received the `main` branch; local `main` tracked `origin/main` after push. |
| Secret file tracking check | Pass for checked filenames | `.env` was ignored and the tracked-file scan for selected secret filename patterns returned no matches. This is not a complete secret-history scan. |

## Previously recorded manual validation notes

The repository's previous README contained manual validation notes for successful Inventory `list_inventory` and WooCommerce `list_orders` responses, revoked-key rejection with HTTP 401, and persistent-volume claims in the Bound state. These checks should be rerun against the final cluster state if they are part of the reviewer acceptance criteria.

The most recent WooCommerce retry during the current session failed because PowerShell could not connect to `127.0.0.1:4000`. That indicates the local port-forward/client connection was unavailable at that time; it does not establish that the WooCommerce upstream itself failed. Verify that the port-forward is running before repeating the request.

## Acceptance checklist still needing explicit evidence

Use a separate test record/store where a test can modify data.

- [ ] Call Inventory search and capture its result through the unified gateway.
- [ ] Call WooCommerce `list_orders` through the unified gateway with the correct tool name returned by `tools/list`.
- [ ] Verify audit events for Inventory and WooCommerce calls show the member identity, tool name, outcome, duration, and request ID where provided.
- [ ] Create a clearly labelled test product, verify its result in WooCommerce, and record the test product ID. Do not use an existing production store without authorization.
- [ ] Update an expendable test order's status, verify the stored status, and restore or document the resulting test state as appropriate.
- [ ] Revoke a test member key and confirm subsequent requests using that key return HTTP 401. Do not revoke the key needed by the reviewer/demo.
- [ ] Disable one upstream from the admin interface and verify its tools disappear from `tools/list` while other upstream tools remain available; then re-enable it.
- [ ] Delete/stop one test upstream pod and verify the gateway and unrelated upstream tools continue to work. Restore the pod afterward and record the observed outcome.
- [ ] Verify member attempts to use admin-only server-management routes are rejected, while the admin can perform the operation.
- [ ] Verify persistence across an ordinary database pod restart using a safe test record, and confirm PVCs are Bound. Do not delete PVCs as part of this check.
- [ ] Test the complete chat-agent workflow using a configured LLM provider and verify tool-call display and audit attribution.
- [ ] Confirm the README and deployment instructions match the final repository and active chart configuration.

## Useful commands (PowerShell)

Check the local cluster and release:

```powershell
kubectl get pods -o wide
kubectl get pvc
kubectl get ingress
helm status urumi-gateway -n default
```

Check health (adjust the URL if using Docker Compose or another port-forward):

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4000/health"
Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:4000/health/ready"
```

View member-visible audit records with a test key stored in a PowerShell variable:

```powershell
$headers = @{ Authorization = "Bearer $memberKey" }
$audit = Invoke-RestMethod -Uri "http://127.0.0.1:4000/api/audit-logs?limit=20" -Headers $headers
$audit.events | Select-Object created_at, user_email, action, exposed_tool_name, outcome, request_id, duration_ms
```

Never print or commit the raw API key. Use an `Accept` header of `application/json, text/event-stream` for MCP Streamable HTTP POST requests.
