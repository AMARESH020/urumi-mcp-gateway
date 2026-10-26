
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

type HealthResponse = {
  status: string;
  service: string;
  timestamp?: string;
};

type UpstreamServer = {
  id: string;
  name: string;
  transport: string;
  endpoint_url: string;
  is_enabled: boolean;
  timeout_ms: number;
  created_at?: string;
};

type AuditEvent = {
  id: string | number;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string;
  resource_id: string | null;
  outcome: string;
  request_id: string | null;
  server_name: string | null;
  exposed_tool_name: string | null;
  upstream_tool_name: string | null;
  duration_ms: number | string | null;
  action_tool_name: string | null;
  action_status: string | null;
  resource_name: string | null;
  is_enabled: boolean | null;
  created_at: string;
};
type MemberUser = {
  id: string;
  email: string;
  role: "admin" | "member";
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  active_key_count?: number;
};

type MemberApiKey = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
};

type CreatedApiKeyResponse = {
  message: string;
  user: {
    id: string;
    email: string;
  };
  apiKey: {
    id: string;
    name: string;
    keyPrefix: string;
    createdAt: string;
    expiresAt: string | null;
    rawKey: string;
  };
};

type OneTimeKey = {
  userId: string;
  email: string;
  name: string;
  prefix: string;
  rawKey: string;
};

type ApiError = {
  error?: string;
  details?: unknown;
};
type ChatToolCall = {
  name: string;
  success: boolean;
};

type PendingChatAction = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  expiresAt: string;
};
type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  toolCalls?: ChatToolCall[];
  pendingAction?: PendingChatAction;
};

type ChatResponse = {
  reply: string;
  toolCalls?: ChatToolCall[];
  pendingAction?: PendingChatAction;
};
type ChatActionResponse = {
  actionId: string;
  status: "succeeded" | "cancelled";
  reply: string;
  toolName?: string;
  result?: string;
};

const DEFAULT_GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "http://127.0.0.1:4000";

export default function App() {
  const [gatewayUrl, setGatewayUrl] = useState(() => {
  try {
    return localStorage.getItem("urumi-gateway-url") || DEFAULT_GATEWAY_URL;
  } catch {
    return DEFAULT_GATEWAY_URL;
  }
});

useEffect(() => {
  try {
    localStorage.setItem("urumi-gateway-url", gatewayUrl);
  } catch {
    // Keep the dashboard usable if browser storage is unavailable.
  }
}, [gatewayUrl]);
  const [apiKey, setApiKey] = useState("");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [servers, setServers] = useState<UpstreamServer[]>([]);
  type ReachabilityStatus =
  | "not_checked"
  | "checking"
  | "reachable"
  | "unreachable"
  | "disabled";

type ServerReachability = {
  status: ReachabilityStatus;
  checkedAt?: string;
  message?: string;
};

const [serverReachability, setServerReachability] = useState<
  Record<string, ServerReachability>
>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");

  const [serverName, setServerName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("10000");
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [members, setMembers] = useState<MemberUser[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [memberError, setMemberError] = useState("");
  const [memberNotice, setMemberNotice] = useState("");

  const [memberEmail, setMemberEmail] = useState("");
  const [memberPassword, setMemberPassword] = useState("");

  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [memberKeys, setMemberKeys] = useState<MemberApiKey[]>([]);
  const [memberKeysLoading, setMemberKeysLoading] = useState(false);
  const [memberKeyName, setMemberKeyName] = useState(
  "external-mcp-client",
);

const [oneTimeKey, setOneTimeKey] = useState<OneTimeKey | null>(null);

  function baseUrl(): string {
    const value = gatewayUrl.trim().replace(/\/+$/, "");

    if (!value) {
      throw new Error("Enter the gateway base URL.");
    }

    return value;
  }

  async function apiRequest<T>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    if (!apiKey.trim()) {
      throw new Error("Enter your administrator API key first.");
    }

    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${apiKey.trim()}`);
    headers.set("Accept", "application/json");

    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers,
    });

    const payload = (await response.json().catch(() => ({}))) as
      | ApiError
      | Record<string, unknown>;

    if (!response.ok) {
      const message =
        "error" in payload && typeof payload.error === "string"
          ? payload.error
          : `Gateway request failed with HTTP ${response.status}.`;

      throw new Error(message);
    }

    return payload as T;
  }
  async function handleChatAction(
  actionId: string,
  decision: "confirm" | "cancel",
) {
  if (chatLoading) return;

  if (
    decision === "confirm" &&
    !window.confirm(
      "Confirm this WooCommerce action? It may change data in your store.",
    )
  ) {
    return;
  }

  setChatLoading(true);
  setChatError("");

  try {
    const result = await apiRequest<ChatActionResponse>(
      `/api/chat/actions/${encodeURIComponent(actionId)}/${decision}`,
      {
        method: "POST",
        body: JSON.stringify({}),
      },
    );

    setChatMessages((current) => {
      const updated = current.map((message) => {
        if (message.pendingAction?.id !== actionId) {
          return message;
        }

        const copy = { ...message };
        delete copy.pendingAction;
        return copy;
      });

      const content = result.result
        ? `${result.reply}\n\nTool result:\n${result.result}`
        : result.reply;

      return [
        ...updated,
        { role: "assistant" as const, content },
      ];
    });
  } catch (err: unknown) {
    setChatError(
      err instanceof Error
        ? err.message
        : "Unable to process the action decision.",
    );
  } finally {
    setChatLoading(false);
  }
}
  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  const message = chatInput.trim();

  if (!message || chatLoading) {
    return;
  }

  const history = chatMessages.slice(-12).map(({ role, content }) => ({
    role,
    content,
  }));

  setChatMessages((current) => [
    ...current,
    { role: "user", content: message },
  ]);
  setChatInput("");
  setChatLoading(true);
  setChatError("");

  try {
    const response = await apiRequest<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        message,
        history,
      }),
    });

    setChatMessages((current) => [
      ...current,
      {
        role: "assistant",
        content: response.reply,
        toolCalls: response.toolCalls,
        pendingAction: response.pendingAction,
      },
    ]);
  } catch (err: unknown) {
    setChatError(
      err instanceof Error ? err.message : "Unable to send your message.",
    );
  } finally {
    setChatLoading(false);
  }
}

  async function checkHealth() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch(`${baseUrl()}/health`);

      if (!response.ok) {
        throw new Error(`Health check failed: HTTP ${response.status}`);
      }

      setHealth((await response.json()) as HealthResponse);
      setNotice("Gateway health check completed.");
    } catch (err: unknown) {
      setHealth(null);
      setError(
        err instanceof Error ? err.message : "Unable to contact the gateway.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function fetchServers(): Promise<UpstreamServer[]> {
    const result = await apiRequest<{ servers: UpstreamServer[] }>(
      "/api/servers",
    );

    setServers(result.servers);
    return result.servers;
  }

  async function loadServers() {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await fetchServers();
      setNotice(`Loaded ${result.length} upstream server(s).`);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to load upstream servers.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadAuditLogs() {
    setAuditLoading(true);
    setAuditError("");

    try {
      const result = await apiRequest<{ events: AuditEvent[] }>(
        "/api/audit-logs?limit=50",
      );
      setAuditEvents(result.events);
    } catch (err: unknown) {
      setAuditError(
        err instanceof Error ? err.message : "Unable to load audit logs.",
      );
    } finally {
      setAuditLoading(false);
    }
  }
  async function loadMembers() {
  setMembersLoading(true);
  setMemberError("");
  setMemberNotice("");

  try {
    const result = await apiRequest<{ users: MemberUser[] }>(
      "/api/users",
    );

    setMembers(result.users);
    setMemberNotice(`Loaded ${result.users.length} user account(s).`);
  } catch (err: unknown) {
    setMemberError(
      err instanceof Error
        ? err.message
        : "Unable to load users.",
    );
  } finally {
    setMembersLoading(false);
  }
}

async function loadMemberKeys(userId: string) {
  setSelectedMemberId(userId);
  setMemberKeysLoading(true);
  setMemberError("");
  setMemberNotice("");

  try {
    const result = await apiRequest<{ keys: MemberApiKey[] }>(
      `/api/users/${encodeURIComponent(userId)}/keys`,
    );

    setMemberKeys(result.keys);
  } catch (err: unknown) {
    setMemberKeys([]);
    setMemberError(
      err instanceof Error
        ? err.message
        : "Unable to load API keys.",
    );
  } finally {
    setMemberKeysLoading(false);
  }
}

async function createMember(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();

  if (membersLoading) return;

  setMembersLoading(true);
  setMemberError("");
  setMemberNotice("");
  setOneTimeKey(null);

  try {
    const result = await apiRequest<{ user: MemberUser }>(
      "/api/users",
      {
        method: "POST",
        body: JSON.stringify({
          email: memberEmail.trim(),
          password: memberPassword,
        }),
      },
    );

    const member = result.user;

    setMembers((current) => [
      member,
      ...current.filter((item) => item.id !== member.id),
    ]);

    setSelectedMemberId(member.id);
    setMemberKeys([]);
    setMemberEmail("");
    setMemberPassword("");

    setMemberNotice(`Created member account: ${member.email}.`);
  } catch (err: unknown) {
    setMemberError(
      err instanceof Error
        ? err.message
        : "Unable to create member account.",
    );
  } finally {
    setMembersLoading(false);
  }
}

async function createMemberKey(
  event: FormEvent<HTMLFormElement>,
) {
  event.preventDefault();

  if (!selectedMemberId || membersLoading) return;

  const selectedMember = members.find(
    (member) => member.id === selectedMemberId,
  );

  if (!selectedMember || selectedMember.role !== "member") {
    setMemberError("Select a member account before creating a key.");
    return;
  }

  setMembersLoading(true);
  setMemberError("");
  setMemberNotice("");
  setOneTimeKey(null);

  try {
    const result = await apiRequest<CreatedApiKeyResponse>(
      `/api/users/${encodeURIComponent(selectedMemberId)}/keys`,
      {
        method: "POST",
        body: JSON.stringify({
          name: memberKeyName.trim(),
        }),
      },
    );

    // Keep the raw secret in component memory only.
    // It is not written to localStorage.
    setOneTimeKey({
      userId: result.user.id,
      email: result.user.email,
      name: result.apiKey.name,
      prefix: result.apiKey.keyPrefix,
      rawKey: result.apiKey.rawKey,
    });

    setMemberKeyName("external-mcp-client");
    setMemberNotice(result.message);

    // Refresh key metadata after the successful creation.
    const keyResult = await apiRequest<{ keys: MemberApiKey[] }>(
      `/api/users/${encodeURIComponent(selectedMemberId)}/keys`,
    );

    setMemberKeys(keyResult.keys);

    // Refresh account key counts.
    const userResult = await apiRequest<{ users: MemberUser[] }>(
      "/api/users",
    );

    setMembers(userResult.users);
  } catch (err: unknown) {
    setMemberError(
      err instanceof Error
        ? err.message
        : "Unable to create API key.",
    );
  } finally {
    setMembersLoading(false);
  }
}

async function revokeMemberKey(
  member: MemberUser,
  key: MemberApiKey,
) {
  if (membersLoading) return;

  if (
    key.revoked_at ||
    (key.expires_at &&
      new Date(key.expires_at).getTime() <= Date.now())
  ) {
    setMemberError("This key is already revoked or expired.");
    return;
  }

  const confirmed = window.confirm(
    `Revoke API key "${key.name}" for ${member.email}? ` +
      "Any client using this key will lose access.",
  );

  if (!confirmed) return;

  setMembersLoading(true);
  setMemberError("");
  setMemberNotice("");

  try {
    const result = await apiRequest<{ message: string }>(
      `/api/users/${encodeURIComponent(member.id)}/keys/${encodeURIComponent(key.id)}`,
      {
        method: "DELETE",
      },
    );

    setOneTimeKey(null);
    setMemberNotice(result.message);

    const keyResult = await apiRequest<{ keys: MemberApiKey[] }>(
      `/api/users/${encodeURIComponent(member.id)}/keys`,
    );

    setMemberKeys(keyResult.keys);

    const userResult = await apiRequest<{ users: MemberUser[] }>(
      "/api/users",
    );

    setMembers(userResult.users);
  } catch (err: unknown) {
    setMemberError(
      err instanceof Error
        ? err.message
        : "Unable to revoke API key.",
    );
  } finally {
    setMembersLoading(false);
  }
}
async function checkServerReachability(server: UpstreamServer) {
  if (!apiKey.trim()) {
    setError("Enter your administrator API key first.");
    return;
  }

  if (!server.is_enabled) {
    setServerReachability((current) => ({
      ...current,
      [server.id]: {
        status: "disabled",
        checkedAt: new Date().toISOString(),
        message: "This server is disabled in the gateway registry.",
      },
    }));
    return;
  }

  setServerReachability((current) => ({
    ...current,
    [server.id]: {
      status: "checking",
      message: "Checking upstream availability...",
    },
  }));

  try {
    const response = await fetch(
      `${baseUrl()}/api/servers/${encodeURIComponent(server.id)}/mcp`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey.trim()}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: {
              name: "urumi-dashboard-health-check",
              version: "1.0.0",
            },
          },
        }),
        signal: AbortSignal.timeout(8000),
      },
    );

    const checkedAt = new Date().toISOString();

    if (response.status === 409) {
      await response.text().catch(() => "");

      setServerReachability((current) => ({
        ...current,
        [server.id]: {
          status: "disabled",
          checkedAt,
          message: "The gateway has disabled this upstream.",
        },
      }));
      return;
    }

    if (response.ok) {
      await response.text().catch(() => "");

      setServerReachability((current) => ({
        ...current,
        [server.id]: {
          status: "reachable",
          checkedAt,
          message: `Upstream responded with HTTP ${response.status}.`,
        },
      }));
      return;
    }

    await response.text().catch(() => "");

    setServerReachability((current) => ({
      ...current,
      [server.id]: {
        status: "unreachable",
        checkedAt,
        message: `Gateway returned HTTP ${response.status}.`,
      },
    }));
  } catch (err: unknown) {
    setServerReachability((current) => ({
      ...current,
      [server.id]: {
        status: "unreachable",
        checkedAt: new Date().toISOString(),
        message:
          err instanceof Error && err.name === "TimeoutError"
            ? "The upstream health check timed out."
            : "The upstream could not be reached through the gateway.",
      },
    }));
  }
}
  async function registerServer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");

    const parsedTimeout = Number(timeoutMs);

    if (
      !Number.isInteger(parsedTimeout) ||
      parsedTimeout < 100 ||
      parsedTimeout > 120000
    ) {
      setError("Timeout must be an integer between 100 and 120000 milliseconds.");
      setLoading(false);
      return;
    }

    try {
      const result = await apiRequest<{ server: UpstreamServer }>(
        "/api/servers",
        {
          method: "POST",
          body: JSON.stringify({
            name: serverName.trim(),
            endpointUrl: endpointUrl.trim(),
            timeoutMs: parsedTimeout,
          }),
        },
      );

      await fetchServers();
      setServerName("");
      setEndpointUrl("");
      setTimeoutMs("10000");
      setNotice(`Registered ${result.server.name}.`);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to register the server.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function toggleServer(server: UpstreamServer) {
    setLoading(true);
    setError("");
    setNotice("");

    try {
      const result = await apiRequest<{ server: UpstreamServer }>(
        `/api/servers/${server.id}/status`,
        {
          method: "PATCH",
          body: JSON.stringify({
            isEnabled: !server.is_enabled,
          }),
        },
      );

      setServers((current) =>
        current.map((item) =>
          item.id === server.id ? { ...item, ...result.server } : item,
        ),
      );

      setNotice(
        `${server.name} ${result.server.is_enabled ? "enabled" : "disabled"}.`,
      );
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to update server status.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function deleteServer(server: UpstreamServer) {
    const confirmed = window.confirm(
      `Delete "${server.name}" from the gateway registry? This will not delete the upstream service itself.`,
    );

    if (!confirmed) return;

    setLoading(true);
    setError("");
    setNotice("");

    try {
      await apiRequest<{ message: string }>(`/api/servers/${server.id}`, {
        method: "DELETE",
      });

      setServers((current) =>
        current.filter((item) => item.id !== server.id),
      );
      setNotice(`${server.name} removed from the gateway registry.`);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Unable to delete the server.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Urumi home">
          <span className="brand-mark">U</span>
          <span>
            urumi<span className="brand-light">.gateway</span>
          </span>
        </a>
        <span className="topbar-label">CONTROL PLANE</span>
      </header>

      <section className="hero">
        <p className="eyebrow">MODEL CONTEXT PROTOCOL</p>
        <h1>Your MCP infrastructure, in one place.</h1>
        <p className="hero-copy">
          Monitor gateway health and manage registered MCP upstream servers
          from one control panel.
        </p>
      </section>

      <section className="stats-grid" aria-label="Gateway overview">
        <article className="stat-card">
          <span className="stat-label">GATEWAY</span>
          <strong>Urumi</strong>
          <span className="stat-note">API control plane</span>
        </article>

        <article className="stat-card">
          <span className="stat-label">UPSTREAM SERVERS</span>
          <strong>{servers.length}</strong>
          <span className="stat-note">
            {servers.filter((server) => server.is_enabled).length} enabled
          </span>
        </article>

        <article className="stat-card">
          <span className="stat-label">CONNECTION</span>
          <strong className={health?.status === "ok" ? "healthy" : ""}>
            {health?.status === "ok" ? "Connected" : "Not checked"}
          </strong>
          <span className="stat-note">
            {health?.service ?? "Check gateway health"}
          </span>
        </article>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CONNECTION</p>
            <h2>Gateway access</h2>
          </div>

          <span
            className={`status-pill ${
              health?.status === "ok" ? "status-good" : ""
            }`}
          >
            <span className="status-dot" />
            {health?.status === "ok" ? "Operational" : "Awaiting check"}
          </span>
        </div>

        <div className="connection-form">
          <label htmlFor="gateway-url">Gateway base URL</label>
          <div className="input-row">
            <input
              id="gateway-url"
              type="url"
              value={gatewayUrl}
              onChange={(event) => setGatewayUrl(event.target.value)}
              placeholder="http://127.0.0.1:4000"
              required
            />
            <button
              type="button"
              onClick={() => void checkHealth()}
              disabled={loading}
            >
              Check health
            </button>
          </div>

          <label htmlFor="api-key">Administrator API key</label>
          <input
            id="api-key"
            className="wide-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste API key here - never share it"
          />
          <p className="form-hint">
            Held in memory only. It is not saved to browser storage and clears
            when this page is reloaded.
          </p>

          <div className="button-row">
            <button
              type="button"
              onClick={() => void loadServers()}
              disabled={loading || !apiKey.trim()}
            >
              {loading ? "Working..." : "Load upstream servers"}
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setApiKey("");
                setServers([]);
                setError("");
                setNotice("API key cleared from memory.");
              }}
              disabled={loading && !apiKey}
            >
              Clear key
            </button>
          </div>
        </div>

        {error && (
          <p className="feedback feedback-error" role="alert">
            {error}
          </p>
        )}

        {notice && (
          <p className="feedback feedback-success" role="status">
            {notice}
          </p>
        )}

        {health && (
          <div className="health-result" role="status">
            <div className="health-check">OK</div>
            <div>
              <strong>{health.service}</strong>
              <p>
                Status: {health.status}
                {health.timestamp
                  ? ` - ${new Date(health.timestamp).toLocaleTimeString()}`
                  : ""}
              </p>
            </div>
          </div>
        )}
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">UPSTREAM REGISTRY</p>
            <h2>Register an MCP server</h2>
          </div>
        </div>

        <form className="server-form" onSubmit={registerServer}>
          <div className="form-grid">
            <div>
              <label htmlFor="server-name">Server name</label>
              <input
                id="server-name"
                value={serverName}
                onChange={(event) => setServerName(event.target.value)}
                minLength={1}
                maxLength={100}
                placeholder="e.g. Demo MCP Server"
                required
              />
            </div>

            <div>
              <label htmlFor="server-timeout">Timeout (milliseconds)</label>
              <input
                id="server-timeout"
                type="number"
                value={timeoutMs}
                onChange={(event) => setTimeoutMs(event.target.value)}
                min={100}
                max={120000}
                step={100}
                required
              />
            </div>
          </div>

          <label htmlFor="server-endpoint">MCP endpoint URL</label>
          <input
            id="server-endpoint"
            type="url"
            value={endpointUrl}
            onChange={(event) => setEndpointUrl(event.target.value)}
            placeholder="http://localhost:9000/mcp"
            required
          />

          <p className="form-hint">
            HTTPS is required for remote endpoints. Plain HTTP is accepted by
            the gateway only for localhost development.
          </p>

          <button type="submit" disabled={loading || !apiKey.trim()}>
            {loading ? "Working..." : "Register upstream"}
          </button>
        </form>
      </section>
      <section className="panel members-panel">
  <div className="panel-heading">
    <div>
      <p className="eyebrow">ACCESS CONTROL</p>
      <h2>Members and API keys</h2>
      <p className="hero-copy">
        Create member accounts, issue client keys, and revoke access.
      </p>
    </div>

    <button
      type="button"
      className="secondary-button"
      onClick={() => void loadMembers()}
      disabled={membersLoading || !apiKey.trim()}
    >
      {membersLoading ? "Working..." : "Load users"}
    </button>
  </div>

  <form className="members-form" onSubmit={createMember}>
    <h3>Create a member account</h3>

    <div className="form-grid">
      <div>
        <label htmlFor="member-email">Email address</label>
        <input
          id="member-email"
          type="email"
          value={memberEmail}
          onChange={(event) => setMemberEmail(event.target.value)}
          maxLength={254}
          autoComplete="off"
          placeholder="member@example.com"
          required
        />
      </div>

      <div>
        <label htmlFor="member-password">Temporary password</label>
        <input
          id="member-password"
          type="password"
          value={memberPassword}
          onChange={(event) => setMemberPassword(event.target.value)}
          minLength={12}
          maxLength={128}
          autoComplete="new-password"
          placeholder="At least 12 characters"
          required
        />
      </div>
    </div>

    <p className="form-hint">
      New accounts receive the member role. Passwords are hashed by the gateway.
    </p>

    <button
      type="submit"
      disabled={membersLoading || !apiKey.trim()}
    >
      Create member
    </button>
  </form>

  {memberError && (
    <p className="feedback feedback-error" role="alert">
      {memberError}
    </p>
  )}

  {memberNotice && (
    <p className="feedback feedback-success" role="status">
      {memberNotice}
    </p>
  )}

  {oneTimeKey && (
    <section className="one-time-key" aria-live="polite">
      <p className="eyebrow">NEW API KEY</p>
      <h3>Copy and store this key securely</h3>

      <p className="form-hint">
        Account: {oneTimeKey.email}
      </p>
      <p className="form-hint">
        Name: {oneTimeKey.name} · Prefix: {oneTimeKey.prefix}
      </p>

      <code className="one-time-key-value">
        {oneTimeKey.rawKey}
      </code>

      <p className="form-hint">
        This secret is shown only in this creation response. After hiding
        it or reloading the page, you cannot retrieve it again.
      </p>

      <button
        type="button"
        className="secondary-button"
        onClick={() => setOneTimeKey(null)}
      >
        Hide secret
      </button>
    </section>
  )}

  {members.length === 0 ? (
    <div className="empty-state">
      <strong>No user list loaded</strong>
      <p>
        Enter your administrator API key above and select Load users.
      </p>
    </div>
  ) : (
    <div className="members-list">
      {members.map((member) => {
        const isSelected = selectedMemberId === member.id;

        return (
          <article className="member-card" key={member.id}>
            <div className="member-card-heading">
              <div className="member-identity">
                <h3>{member.email}</h3>
                <span className="member-id">{member.id}</span>
              </div>

              <div className="member-badges">
                <span className="status-pill">
                  {member.role}
                </span>
                <span
                  className={`status-pill ${
                    member.is_active ? "status-good" : ""
                  }`}
                >
                  {member.is_active ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            <div className="member-meta">
              <span>
                <strong>Active API keys</strong>
                <span>{member.active_key_count ?? 0}</span>
              </span>

              <span>
                <strong>Created</strong>
                <span>
                  {new Date(member.created_at).toLocaleString()}
                </span>
              </span>
            </div>

            {member.role === "member" && (
              <div className="member-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    setOneTimeKey(null);
                    void loadMemberKeys(member.id);
                  }}
                  disabled={membersLoading || !apiKey.trim()}
                >
                  {isSelected ? "Refresh keys" : "Manage API keys"}
                </button>
              </div>
            )}

            {isSelected && member.role === "member" && (
              <div className="member-key-section">
                <h4>API keys for {member.email}</h4>

                <form
                  className="member-key-form"
                  onSubmit={createMemberKey}
                >
                  <div>
                    <label htmlFor={`key-name-${member.id}`}>
                      New API-key name
                    </label>

                    <input
                      id={`key-name-${member.id}`}
                      value={memberKeyName}
                      onChange={(event) =>
                        setMemberKeyName(event.target.value)
                      }
                      minLength={1}
                      maxLength={100}
                      required
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={
                      membersLoading ||
                      memberKeysLoading ||
                      !apiKey.trim() ||
                      !member.is_active
                    }
                  >
                    Generate API key
                  </button>
                </form>

                {memberKeysLoading ? (
                  <p className="stat-note">Loading API keys...</p>
                ) : memberKeys.length === 0 ? (
                  <p className="stat-note">
                    No API keys exist for this account.
                  </p>
                ) : (
                  <div className="member-key-table-wrap">
                    <table className="member-key-table">
                      <thead>
                        <tr>
                          <th>Name</th>
                          <th>Prefix</th>
                          <th>Status</th>
                          <th>Last used</th>
                          <th>Action</th>
                        </tr>
                      </thead>

                      <tbody>
                        {memberKeys.map((key) => {
                          const expired = Boolean(
                            key.expires_at &&
                              new Date(key.expires_at).getTime() <=
                                Date.now(),
                          );

                          const revoked = Boolean(key.revoked_at);
                          const active = !revoked && !expired;

                          return (
                            <tr key={key.id}>
                              <td>
                                <strong>{key.name}</strong>
                                <span className="member-id">
                                  {key.created_at
                                    ? new Date(
                                        key.created_at,
                                      ).toLocaleString()
                                    : "Unknown creation date"}
                                </span>
                              </td>

                              <td>
                                <code>{key.key_prefix}</code>
                              </td>

                              <td>
                                <span
                                  className={`status-pill ${
                                    active ? "status-good" : ""
                                  }`}
                                >
                                  {revoked
                                    ? "Revoked"
                                    : expired
                                      ? "Expired"
                                      : "Active"}
                                </span>

                                {revoked && key.revoked_at && (
                                  <span className="member-id">
                                    {new Date(
                                      key.revoked_at,
                                    ).toLocaleString()}
                                  </span>
                                )}
                              </td>

                              <td>
                                {key.last_used_at
                                  ? new Date(
                                      key.last_used_at,
                                    ).toLocaleString()
                                  : "Never"}
                              </td>

                              <td>
                                {active && (
                                  <button
                                    type="button"
                                    className="danger-button"
                                    disabled={membersLoading}
                                    onClick={() =>
                                      void revokeMemberKey(member, key)
                                    }
                                  >
                                    Revoke
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  )}
</section>
            <section className="panel chat-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">AI ASSISTANT</p>
            <h2>Chat with your MCP tools</h2>
            <p className="hero-copy">
              Ask questions about registered MCP servers and available tools.
            </p>
          </div>
          <span className="status-pill">AI powered</span>
        </div>

        <div
          className="chat-messages"
          role="log"
          aria-live="polite"
          aria-label="Chat conversation"
        >
          {chatMessages.length === 0 && (
            <p className="stat-note">
              Start a conversation. For example: “What inventory tools are
              available?” or “Check the stock level for item SKU-101.”
            </p>
          )}

          {chatMessages.map((message, index) => (
            <article
              key={`${message.role}-${index}`}
              className={`chat-message chat-message-${message.role}`}
            >
              <strong>
                {message.role === "user" ? "You" : "Urumi AI"}
              </strong>

              <p style={{ whiteSpace: "pre-wrap" }}>{message.content}</p>

              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className="chat-tool-calls">
                  <strong>Tool execution results</strong>
                  {message.toolCalls.map((tool, toolIndex) => (
                    <p key={`${tool.name}-${toolIndex}`}>
                      {tool.name}: {tool.success ? "Succeeded" : "Failed"}
                    </p>
                  ))}
                </div>
              )}

              {message.pendingAction && (
  <div className="chat-pending-action">
    <strong>Pending action — not yet executed</strong>

    <p>Tool: {message.pendingAction.toolName}</p>

    <pre>
      {JSON.stringify(message.pendingAction.arguments, null, 2)}
    </pre>

    <p>
      Expires:{" "}
      {new Date(message.pendingAction.expiresAt).toLocaleString()}
    </p>

    <div className="chat-action-buttons">
      <button
        type="button"
        disabled={chatLoading}
        onClick={() =>
          void handleChatAction(message.pendingAction!.id, "confirm")
        }
      >
        Confirm and execute
      </button>

      <button
        type="button"
        disabled={chatLoading}
        onClick={() =>
          void handleChatAction(message.pendingAction!.id, "cancel")
        }
      >
        Cancel action
      </button>
    </div>

    <p>
      The action will execute only after confirmation. Do not confirm unless
      the proposed operation and arguments are correct.
    </p>
  </div>
)}
            </article>
          ))}

          {chatLoading && (
            <p className="stat-note" role="status">
              Urumi AI is processing your request...
            </p>
          )}
        </div>

        {chatError && (
          <p role="alert" className="chat-error">
            {chatError}
          </p>
        )}

        <form className="chat-form" onSubmit={(event) => void sendChatMessage(event)}>
          <label htmlFor="chat-message">Your message</label>

          <div className="input-row">
            <input
              id="chat-message"
              type="text"
              value={chatInput}
              onChange={(event) => setChatInput(event.target.value)}
              placeholder="Ask something about your MCP tools..."
              maxLength={4000}
              disabled={chatLoading}
              required
            />

            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
            >
              {chatLoading ? "Thinking..." : "Send"}
            </button>
          </div>

          <p className="stat-note">
            Your gateway API key is sent to your configured gateway. The
            OpenAI API key must remain server-side.
          </p>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">REGISTERED UPSTREAMS</p>
            <h2>Server management</h2>
          </div>

          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadServers()}
            disabled={loading || !apiKey.trim()}
          >
            Refresh
          </button>
        </div>

        {servers.length === 0 ? (
          <div className="empty-state">
            <strong>No servers loaded</strong>
            <p>
              Enter your administrator API key and select "Load upstream servers" to view the gateway registry.
            </p>
          </div>
        ) : (
          <div className="server-list">
            {servers.map((server) => (
              <article className="server-card" key={server.id}>
                <div className="server-card-top">
                  <div className="server-heading">
                    <span
                      className={`server-icon ${
                        server.is_enabled ? "server-icon-enabled" : ""
                      }`}
                    >
                      {server.is_enabled ? "OK" : "â€“"}
                    </span>

                    <div className="server-title">
                      <h3>{server.name}</h3>
                      <span className="server-id">{server.id}</span>
                    </div>
                  </div>

                  <span
                    className={`status-pill ${
                      server.is_enabled ? "status-good" : ""
                    }`}
                  >
                    <span className="status-dot" />
                    {server.is_enabled ? "Enabled" : "Disabled"}
                  </span>
                  

                  {(() => {
                    const reachability = serverReachability[server.id] ?? {
                      status: "not_checked" as const,
                    };

                    const statusLabel: Record<ReachabilityStatus, string> = {
                      not_checked: "Not checked",
                      checking: "Checking...",
                      reachable: "Reachable",
                      unreachable: "Unreachable",
                      disabled: "Disabled",
                    };

                    const statusClass =
                      reachability.status === "reachable"
                        ? "status-good"
                        : reachability.status === "unreachable"
                          ? "status-unreachable"
                          : reachability.status === "checking"
                            ? "status-checking"
                            : "";

                    return (
                      <div className="reachability-info">
                        <span className={`status-pill ${statusClass}`}>
                          <span className="status-dot" />
                          {statusLabel[reachability.status]}
                        </span>

                        {reachability.checkedAt && (
                          <span className="server-id">
                            Checked{" "}
                            {new Date(
                              reachability.checkedAt,
                            ).toLocaleTimeString()}
                          </span>
                        )}

                        {reachability.message && (
                          <span className="reachability-message">
                            {reachability.message}
                          </span>
                        )}
                      </div>
                    );
                  })()}
                </div>

                <div className="server-meta">
                  <span>
                    <strong>Endpoint</strong>
                    <code>{server.endpoint_url}</code>
                  </span>
                  <span>
                    <strong>Transport</strong>
                    <code>{server.transport}</code>
                  </span>
                  <span>
                    <strong>Timeout</strong>
                    <code>{server.timeout_ms} ms</code>
                  </span>
                </div>

                <div className="server-actions">
                  <button
  type="button"
  className="secondary-button"
  onClick={() => void checkServerReachability(server)}
  disabled={
    loading ||
    !apiKey.trim() ||
    serverReachability[server.id]?.status === "checking"
  }
>
  {serverReachability[server.id]?.status === "checking"
    ? "Checking..."
    : "Check reachability"}
</button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void toggleServer(server)}
                    disabled={loading}
                  >
                    {server.is_enabled ? "Disable" : "Enable"}
                  </button>

                  <button
                    type="button"
                    className="danger-button"
                    onClick={() => void deleteServer(server)}
                    disabled={loading}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="panel audit-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">SECURITY & ACTIVITY</p>
            <h2>Audit logs</h2>
            <p>Recent gateway actions and MCP tool activity.</p>
          </div>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void loadAuditLogs()}
            disabled={auditLoading || !apiKey.trim()}
          >
            {auditLoading ? "Loading..." : "Refresh logs"}
          </button>
        </div>

        {auditError ? (
          <p className="audit-error" role="alert">{auditError}</p>
        ) : !apiKey.trim() ? (
          <div className="empty-state">
            <strong>API key required</strong>
            <p>Enter your administrator API key to view audit events.</p>
          </div>
        ) : auditEvents.length === 0 ? (
          <div className="empty-state">
            <strong>{auditLoading ? "Loading audit logs..." : "No audit events loaded"}</strong>
            <p>
              {auditLoading
                ? "Retrieving recent events from the gateway."
                : "Select Refresh logs to retrieve recent events."}
            </p>
          </div>
        ) : (
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Resource</th>
                  <th>Outcome</th>
                  <th>Server / tool</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {auditEvents.map((event) => (
                  <tr key={event.id}>
                    <td>
                      {event.created_at
                        ? new Date(event.created_at).toLocaleString()
                        : "—"}
                    </td>
                    <td>
                      <span>{event.user_email || "Deleted or unknown user"}</span>
                      {event.user_id && (
                      <div className="audit-resource-id">{event.user_id}</div>
                      )}
                    </td>
                    <td>{event.action || "—"}</td>
                    <td>
                      {event.resource_name || event.resource_type || "—"}
                      {event.resource_id && (
                        <div className="audit-resource-id">{event.resource_id}</div>
                      )}
                    </td>
                    <td>
                      {event.action_status
                        ? `${event.outcome} · ${event.action_status}`
                        : event.outcome || "—"}
                    </td>
                    <td>
                      {event.exposed_tool_name ||
                        event.action_tool_name ||
                        event.upstream_tool_name ||
                        event.server_name ||
                        "—"}
                    </td>
                    <td>
                      {event.duration_ms != null
                        ? `${event.duration_ms} ms`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <footer className="footer">
        <span>URUMI MCP GATEWAY</span>
        <span>Local development workspace</span>
      </footer>
    </main>
  );
}
