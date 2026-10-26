# Urumi MCP Gateway - Threat Model



## 1. Purpose and Scope



This document identifies security threats to the Urumi MCP Gateway, its dashboard, PostgreSQL database, and upstream Model Context Protocol (MCP) servers.



The assessment covers the local Docker Compose and Minikube deployments. It distinguishes implemented controls from recommended production hardening.



## 2. System Components



- \*\*Gateway API:\*\* Express and TypeScript application that authenticates requests, enforces authorization, manages upstream servers, and forwards MCP requests.

- \*\*Dashboard:\*\* React and Vite user interface for viewing and managing upstream servers.

- \*\*PostgreSQL:\*\* Stores users, API-key hashes, upstream server configuration, and audit records.

- \*\*Demo MCP server:\*\* Provides demonstration tools.

- \*\*WooCommerce MCP server:\*\* Provides product search, product lookup, and category tools.

- \*\*Inventory MCP server:\*\* Provides inventory search, stock lookup, and inventory listing using sample data.

- \*\*Deployment infrastructure:\*\* Docker Compose, Kubernetes, Helm, and Ingress.



## 3. Assets Requiring Protection



| Asset | Security objective |

|---|---|

| API keys | Prevent unauthorized access and credential disclosure |

| User accounts and roles | Prevent account compromise and privilege escalation |

| Database credentials | Prevent unauthorized database access |

| Upstream server URLs | Prevent unauthorized or unsafe outbound requests |

| MCP tool requests and responses | Protect availability, integrity, and sensitive data |

| Audit records | Preserve accountability and support investigation |

| Kubernetes Secrets and configuration | Prevent exposure of deployment credentials |

| Inventory and store data | Prevent unauthorized access or modification |



## 4. Trust Boundaries



1\. \*\*Client to gateway:\*\* HTTP requests cross into the API; protected routes require Bearer-token authentication.

2\. \*\*Dashboard to gateway:\*\* The browser sends API requests using the configured gateway URL and an API key entered by the user.

3\. \*\*Gateway to upstream MCP servers:\*\* The gateway forwards requests to registered upstream endpoints.

4\. \*\*Application to database:\*\* Services connect to PostgreSQL using database credentials.

5\. \*\*Deployment administration:\*\* Operators with access to Docker, Kubernetes, Helm, or the host can influence application configuration and secrets.



## 5. Threats, Existing Controls, and Residual Risk



### T1. Stolen or leaked API key



\*\*Threat:\*\* An attacker obtains a valid API key and uses it to access protected gateway endpoints.



\*\*Existing controls:\*\*

- API keys are generated with cryptographically secure random bytes.

- The database stores a hash and key prefix rather than the raw key.

- Authentication checks key revocation, expiry, and active-user status.

- A key can be revoked.



\*\*Residual risk:\*\* A stolen, active key can be used until it is revoked or expires. Protect keys from logs, screenshots, source control, and shared terminals.



### T2. Unauthorized administrative actions



\*\*Threat:\*\* A regular user attempts to register, disable, or delete upstream servers.



\*\*Existing controls:\*\*

- The gateway authenticates protected requests.

- Administrative server-management routes require the admin role.



\*\*Residual risk:\*\* Authorization depends on correct role enforcement across every privileged route. Regression tests should cover both permitted and denied actions.



### T3. Malicious upstream endpoint or server-side request forgery



\*\*Threat:\*\* An attacker attempts to use server registration to direct the gateway toward internal services or sensitive network destinations.



\*\*Existing controls:\*\*

- Server registration validates endpoint URLs.

- Plain HTTP endpoints are restricted by application validation rules.

- Administrative authorization is required for server management.



\*\*Residual risk:\*\* HTTPS endpoints can still point to unintended destinations. Production deployment should apply hostname allowlists, DNS and IP-range validation, redirect restrictions, and outbound network policies.



### T4. Upstream outage or slow response



\*\*Threat:\*\* A slow or unavailable MCP server delays requests and consumes gateway resources.



\*\*Existing controls:\*\*

- Upstream request timeouts are implemented.

- The gateway returns a safe error when an upstream request fails.

- Health and readiness endpoints support deployment checks.



\*\*Residual risk:\*\* Timeouts alone do not prevent sustained resource exhaustion. Production deployments should consider rate limiting, concurrency limits, connection-pool controls, and monitoring.



### T5. Sensitive information exposed in logs



\*\*Threat:\*\* Credentials, sensitive request data, or internal implementation details are disclosed through logs or error responses.



\*\*Existing controls:\*\*

- API keys are hashed in storage.

- Upstream failures are handled with safe error responses.

- PostgreSQL audit records capture relevant application activity.



\*\*Residual risk:\*\* Review all log fields and ensure credentials, authorization headers, and sensitive payloads are never recorded. Restrict access to audit records.



### T6. Database compromise or data loss



\*\*Threat:\*\* An attacker obtains database credentials, or a database failure destroys application data and audit history.



\*\*Existing controls:\*\*

- PostgreSQL credentials are configured outside application source code.

- Docker Compose uses persistent storage.

- Kubernetes uses a persistent volume claim.



\*\*Residual risk:\*\* Persistent storage does not replace backups or access controls. Production needs tested backups and recovery, restricted database access, and encryption where required.



### T7. Browser-side API-key exposure



\*\*Threat:\*\* An API key entered into the dashboard is exposed by a compromised browser, malicious script, or unsafe deployment.



\*\*Existing controls:\*\*

- The dashboard keeps the key in browser memory rather than persistent browser storage.

- The local deployment uses a configured dashboard-to-gateway URL.



\*\*Residual risk:\*\* Browser memory does not protect against cross-site scripting or a compromised device. Production should use HTTPS, a restrictive Content Security Policy, dependency maintenance, and careful input handling.



### T8. Kubernetes or deployment-secret exposure



\*\*Threat:\*\* An unauthorized user reads deployment secrets or changes workload configuration.



\*\*Existing controls:\*\*

- Credentials are supplied through Kubernetes Secrets rather than hard-coded into workload manifests.

- Application components run as containers.

- Helm templates define the deployment resources.



\*\*Residual risk:\*\* Kubernetes Secrets require appropriate cluster RBAC and encryption-at-rest configuration. Restrict cluster access, image sources, secret permissions, and deployment privileges.



### T9. Unauthorized or misleading audit records



\*\*Threat:\*\* Audit records are accessed or altered by an unauthorized party, or an outcome is recorded without correctly reflecting a tool-level failure.



\*\*Existing controls:\*\*

- The application writes audit records to PostgreSQL.

- Auditing includes MCP request activity.



\*\*Residual risk:\*\* Database administrators may still be able to alter records. Production should consider restricted database permissions, centralized append-only logging, integrity monitoring, and explicit handling of MCP tool-level errors.



## 6. Security Validation Plan



Before release, validate the following:



- Requests without a valid API key are rejected.

- Revoked and expired keys cannot authenticate.

- Member users cannot perform admin-only operations.

- Invalid upstream URLs are rejected.

- Upstream failures return controlled errors and do not crash the gateway.

- Audit records are created for relevant actions.

- Secrets are absent from Git history, application logs, and image layers.

- Kubernetes readiness and health checks behave correctly during restarts.

- Persistent database data survives a normal pod restart.

- Dashboard requests use the intended gateway URL.



Record test results and evidence separately; do not mark checks as passed without executing them.



## 7. Production Hardening Priorities



1\. Enforce HTTPS for browser, gateway, and external upstream communication.

2\. Restrict outbound network traffic and validate upstream destinations.

3\. Apply least-privilege access controls to PostgreSQL and Kubernetes.

4\. Configure database backups and test restoration.

5\. Add rate limiting, request-size limits, and concurrency controls.

6\. Centralize security monitoring and protect audit-log integrity.

7\. Scan dependencies and container images for known vulnerabilities.

8\. Define incident response and API-key rotation procedures.



## 8. Assessment Limitations



This document is based on the implemented project architecture and observed configuration. It is not a formal penetration-test report or proof that every threat has been eliminated.



Security claims must be verified against the final source code, deployment configuration, and test results.
