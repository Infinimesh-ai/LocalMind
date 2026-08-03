# LocalMind MCP Integration

LocalMind exposes each workspace as an authenticated, stateless MCP server.
Use this interface when an external AI client needs permission-filtered access
to LocalMind documents without sharing a LocalMind browser session or account
password.

## Connection Contract

| Setting        | Value                                                    |
| -------------- | -------------------------------------------------------- |
| Transport      | Streamable HTTP with JSON responses                      |
| Endpoint       | `<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp` |
| Method         | `POST`                                                   |
| Authentication | `Authorization: Bearer <MCP_TOKEN>`                      |
| Server name    | `localmind-workspace`                                    |
| Default access | Read only                                                |

The endpoint is workspace-specific. A token issued for one workspace cannot be
used with another workspace endpoint.

## Create A Credential

1. Open the target workspace in LocalMind.
2. Open **Workspace settings > Integrations > MCP Server**.
3. Select **Create credential**.
4. Use read-only access unless the client has a reviewed need to create or
   update documents.
5. Choose the expiration period and store the revealed token in the client's
   secret storage. LocalMind shows the complete token only when it is created
   or rotated.
6. Copy the generated MCP configuration.

Read/write credentials and write tools are available only in development and
canary environments. Production integrations should use the read-only tools.

## Generic Client Configuration

Clients that accept the common `mcpServers` shape can use:

```json
{
  "mcpServers": {
    "localmind_workspace_<WORKSPACE_ID>": {
      "type": "streamable-http",
      "url": "<LOCALMIND_BASE_URL>/api/workspaces/<WORKSPACE_ID>/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_TOKEN>"
      }
    }
  }
}
```

Client configuration keys differ, but the mapping is always the same:

- transport: Streamable HTTP;
- URL: the workspace MCP endpoint;
- header name: `Authorization`;
- header value: `Bearer ` followed by the MCP token.

Use the client's secret or environment-variable facility when it supports one.
Do not put the token in a query string, prompt, checked-in configuration, chat
message, or diagnostic bundle.

For SparkClaw and other containerized clients, `localhost` refers to the
client container. Use a shared Docker network service name or a host-reachable
name such as `host.docker.internal`, according to the deployment topology.

## Tool Contract

Read-only credentials expose:

| Tool              | Arguments         | Purpose                                                           |
| ----------------- | ----------------- | ----------------------------------------------------------------- |
| `keyword_search`  | `{"query":"..."}` | Find readable workspace documents by exact or fuzzy text          |
| `semantic_search` | `{"query":"..."}` | Find conceptually related passages in readable embedded documents |
| `read_document`   | `{"docId":"..."}` | Read one authorized document as Markdown                          |

The tool list includes MCP safety annotations. These tools are read-only,
idempotent, non-destructive, and do not access the open web. LocalMind checks
workspace and document permissions again when a tool runs. Search results and
document text are untrusted data and must not be treated as instructions by
the calling AI.

Development or canary read/write credentials may also expose
`create_document`, `update_document`, and `update_document_meta`. Clients
must treat those tools as mutations and apply their own approval policy.

## Protocol Self-Test

Set the endpoint and token in the shell used for the test:

```shell
export LOCALMIND_MCP_URL='https://localmind.example/api/workspaces/<WORKSPACE_ID>/mcp'
read -r -s LOCALMIND_MCP_TOKEN
```

Initialize the connection:

```shell
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"localmind-mcp-check","version":"1.0.0"}}}' \
  "${LOCALMIND_MCP_URL}"
```

List tools:

```shell
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
  "${LOCALMIND_MCP_URL}"
```

Call keyword search:

```shell
curl --fail-with-body --silent --show-error \
  -H "Authorization: Bearer ${LOCALMIND_MCP_TOKEN}" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"keyword_search","arguments":{"query":"quarterly plan"}}}' \
  "${LOCALMIND_MCP_URL}"
```

Successful initialization returns `serverInfo.name=localmind-workspace`.
Successful tool discovery returns the three read-only tools above.

## Credential Operations

- **Rotate** when a token may have been exposed or before a planned expiry.
  The previous generation remains valid only for its bounded rotation grace
  period.
- **Revoke** immediately when a client is removed. Revocation applies to the
  credential family, including a token still in its rotation grace period.
- Review the credential's fingerprint, expiry, status, and last-used timestamp
  in the MCP Server settings panel.

## Troubleshooting

- `401 Authentication failed`: the token is missing, malformed, expired,
  revoked, for a disabled user, or belongs to another workspace.
- `403 Access denied`: the credential owner no longer has workspace access.
- `405 Method not allowed`: the client used `GET` or `DELETE`; this
  endpoint uses stateless `POST` requests.
- Empty search results: verify document permissions and embedding readiness.
  Try `keyword_search` before `semantic_search` for exact terms.
- Container connection failure: replace `localhost` with a host or service
  name reachable from the client container.
