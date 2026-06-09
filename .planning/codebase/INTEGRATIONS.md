# External Integrations

**Analysis Date:** 2026-06-09

## APIs & External Services

**Tailscale REST API:**
- Service: Tailscale - VPN mesh networking; the connector stores credentials and mints per-clone ephemeral auth-keys
  - SDK/Client: None — raw `fetch` calls in `src/tailscale-api.mjs`
  - Base URL: `https://api.tailscale.com/api/v2`
  - Endpoints used:
    - `POST /api/v2/oauth/token` — OAuth client_credentials flow to mint a short-lived access token
    - `POST /api/v2/tailnet/{tailnet}/keys` — mint ephemeral, preauthorized auth-keys for clone sidecars
    - `GET /api/v2/tailnet/-/devices` — resolve the literal `-` tailnet alias to the real tailnet name (UX display only)
  - Auth: OAuth2 client credentials (`clientId` + `clientSecret`) for token minting; `Bearer` access token for auth-key and devices endpoints
  - Error codes: `TailscaleApiError` with typed `.code` values: `tailscale.invalid_client`, `tailscale.scope_denied`, `tailscale.tag_denied`, `tailscale.rate_limited`, `tailscale.network`, `tailscale.unknown` — all defined in `src/tailscale-api.mjs`

## Data Storage

**Databases:**
- None directly owned by this connector. Connector config (`connected`, `tailnet`, `cloneTag`, `lastValidatedAt`) is persisted via the host's `writeConnectorConfigToDatabase` / `readConnectorConfigFromDatabase` helpers, injected through `TailscaleConnectorDeps` in `src/deps.ts`. The connector key used is `"tailscale"` (`TAILSCALE_LOCAL_CONFIG_KEY` in `src/index.ts`).

**File Storage:**
- Not applicable

**Caching:**
- None. Tailscale OAuth access tokens (1-hour TTL) are explicitly NOT cached — the implementation notes they should always be re-minted at clone-start time.

## Authentication & Identity

**Auth Provider: Nango (injected)**
- Implementation: The connector does NOT import Nango directly. The host binds a `TailscaleNangoCapability` implementation at boot via `registerTailscaleConnector(deps)` (`src/deps.ts`). The concrete Nango extension is sourced from `@cinatra-ai/nango-connector` on the host side.
- Nango provider: `tailscale-api-key` (`auth_mode: API_KEY` in Nango's providers.yaml)
- Provider config key: exposed via `nango.providerConfigKeys.tailscale` (set by host)
- Connection ID: equals the provider config key (`const connectionId = providerConfigKey`)
- Credentials stored: `{ type: "API_KEY", apiKey: "<tskey-api-…>" }` with `connectionConfig: { organizationName: tailnet }`
- Read-back verification: performed with `forceRefresh: true` after every `importConnection` to confirm the write succeeded (`src/index.ts` `saveTailscaleConnection`)
- Rollback: on read-back mismatch, `deleteConnection` + `clearConnectionRecords` + local settings wipe

**Instance Identity:**
- `readInstanceIdentity()` injected via deps (`src/deps.ts`) — reads `{ instanceDisplayName }` from the host's instance-identity store; used only to derive the default clone tag suggestion in `getDefaultTailscaleCloneTag()` (`src/index.ts`)

## Monitoring & Observability

**Error Tracking:**
- Not detected; the connector emits `console.error` logs with structured context on Nango integration/connection failures (in `src/index.ts` `saveTailscaleConnection`)

**Logs:**
- `console.error` with prefix `[connector-tailscale]` on `ensureNangoIntegration` and `importNangoConnection` failures

## CI/CD & Deployment

**Hosting:**
- Deployed inside the Cinatra host Next.js application as a monorepo workspace package
- CI: `.github/workflows/ci.yml` and `.github/workflows/release.yml` present in this package

**CI Pipeline:**
- Vitest (`npm test` / `vitest`) — test suite in `src/__tests__/`

## Environment Configuration

**Required env vars (runtime, read inside this package):**
- `SUPABASE_DB_URL` — Postgres URL; DB name segment parsed to derive the Tailscale device hostname for heavy clones (`src/tailscale-hostname.mjs` `parseDatabaseName`, called from `src/index.ts` `getTailscaleDevHostname`)
- `SUPABASE_SCHEMA` — Schema name; used for light-worktree hostname derivation (`src/tailscale-hostname.mjs` `deriveDevTailscaleHostname`)

**Secrets location:**
- Tailscale API key (`tskey-api-…`) is stored exclusively in Nango (never in env or local DB). The local `connector_config:tailscale` row stores only non-secret metadata.

## Webhooks & Callbacks

**Incoming:**
- Not applicable — this connector initiates all Tailscale API calls outbound; Tailscale does not push events back

**Outgoing:**
- Not applicable

---

*Integration audit: 2026-06-09*
