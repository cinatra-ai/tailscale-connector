<!-- refreshed: 2026-06-09 -->
# Architecture

**Analysis Date:** 2026-06-09

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    Next.js Host App (external)                       │
│  registers deps at boot via registerTailscaleConnector(deps)        │
└──────────────┬──────────────────────────────────────────────────────┘
               │ globalThis Symbol slot
               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Connector Core  (server-only)                     │
│  `src/index.ts`  — public API surface                               │
│  `src/deps.ts`   — DI registry (globalThis Symbol)                  │
├──────────────┬──────────────────────────────────────────────────────┤
│  Tailscale   │  Hostname Utilities                                   │
│  REST API    │  `src/tailscale-api.mjs`                             │
│  client      │  `src/tailscale-hostname.mjs`                        │
└──────┬───────┴─────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Setup UI  (Next.js RSC + Server Actions)                           │
│  `src/setup-page.tsx`     — RSC dispatch route                      │
│  `src/tailscale-setup-impl.tsx` — server component (reads state)   │
│  `src/tailscale-setup-actions.ts` — "use server" actions           │
│  `src/tailscale-connect-form.tsx` — "use client" form              │
└─────────────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────────────┐
│  UI Component Library                                               │
│  `src/components/ui/`  — shadcn/Radix-based primitives             │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Connector Core | Public API — save/clear connection, read status, derive hostname/URL | `src/index.ts` |
| DI Registry | globalThis-anchored dep slot; host wires impls at boot, all bundles share one slot | `src/deps.ts` |
| Tailscale API Client | OAuth token mint, auth-key mint, tailnet resolution — pure ESM, no TS | `src/tailscale-api.mjs` |
| Hostname Utilities | Deterministic hostname/Funnel-URL derivation from env vars — pure ESM, no TS | `src/tailscale-hostname.mjs` |
| Setup Page Route | RSC dispatch wrapper consumed by the host's connector-setup routing | `src/setup-page.tsx` |
| Setup Page Impl | Server component: reads connection status + default tag, renders card | `src/tailscale-setup-impl.tsx` |
| Server Actions | `"use server"` boundary: auth guard, calls core, revalidates paths | `src/tailscale-setup-actions.ts` |
| Connect Form | `"use client"` form: API key + clone-tag inputs, optimistic state via `useTransition` | `src/tailscale-connect-form.tsx` |
| UI Primitives | Radix + CVA-based design-system components (alert, badge, button, card, field, input…) | `src/components/ui/` |

## Pattern Overview

**Overall:** Cinatra SDK Connector — Dependency-Injection + pure-ESM boundary

**Key Characteristics:**
- The connector carries zero host-internal imports; all host capabilities (database read/write, Nango surface, instance identity) are injected via `registerTailscaleConnector(deps)` at boot and retrieved at runtime from a versioned `globalThis` Symbol.
- A deliberate `.mjs` boundary separates the Tailscale REST client (`src/tailscale-api.mjs`) and hostname derivation (`src/tailscale-hostname.mjs`) from the TypeScript server code. Both files are plain ESM so the CLI (a plain Node binary that cannot process TypeScript) can `import` the exact same modules the TS server uses — no duplication, no build step.
- Secrets (API keys) are stored exclusively in Nango at the connection level; the connector's local DB row (`connector_config:tailscale`) stores only non-secret state (`connected`, `tailnet`, `cloneTag`, `lastValidatedAt`).
- The hostname derivation is intentionally stateless/pure: it re-derives from immutable env vars (`SUPABASE_DB_URL`, `SUPABASE_SCHEMA`) every call rather than persisting, avoiding stale-cache bugs where all heavy clones collided on `cinatra-main`.

## Layers

**DI / Boot Layer:**
- Purpose: Decouple connector from host internals across Next.js bundle boundaries
- Location: `src/deps.ts`
- Contains: `TailscaleConnectorDeps` interface, `TailscaleNangoCapability` interface, register/get/reset functions
- Depends on: nothing (`globalThis` only)
- Used by: `src/index.ts` at every runtime call site

**Connector Core Layer:**
- Purpose: All business logic — save/clear credentials, read status, derive hostname/URL, tag slug generation
- Location: `src/index.ts`
- Contains: `saveTailscaleConnection`, `clearTailscaleConnection`, `getTailscaleConnectionStatus`, `getTailscaleDevHostname`, `getTailscaleFunnelUrlPreview`, `getDefaultTailscaleCloneTag`
- Depends on: `src/deps.ts`, `src/tailscale-api.mjs`, `src/tailscale-hostname.mjs`
- Used by: `src/tailscale-setup-actions.ts`, host's CLI/dev-tab code

**Pure-ESM Utility Layer:**
- Purpose: Tailscale REST calls and hostname math, importable by both TS server and plain-Node CLI
- Location: `src/tailscale-api.mjs`, `src/tailscale-hostname.mjs`
- Contains: `mintTailscaleAccessToken`, `mintTailscaleAuthKey`, `resolveTailscaleTailnet`, `deriveDevTailscaleHostname`, `composeTailscaleFunnelUrl`, `sanitizeTailscaleDeviceName`, `TailscaleApiError`
- Depends on: native `fetch` only
- Used by: `src/index.ts` (TS server), CLI binary (external)

**Setup UI Layer:**
- Purpose: Next.js App Router UI for operator-facing connector setup
- Location: `src/setup-page.tsx`, `src/tailscale-setup-impl.tsx`, `src/tailscale-setup-actions.ts`, `src/tailscale-connect-form.tsx`
- Contains: RSC page, server actions, client form
- Depends on: `src/index.ts`, `@cinatra-ai/sdk-extensions` (auth guard), `@cinatra-ai/sdk-ui` (layout + notify), `src/components/ui/`
- Used by: Host Next.js app routing

**UI Primitives Layer:**
- Purpose: Shared design-system primitives for the setup UI
- Location: `src/components/ui/`
- Contains: alert, badge, button, card, field, input-group, input, label, separator, textarea
- Depends on: `radix-ui`, `class-variance-authority`, `clsx`, `tailwind-merge`
- Used by: `src/tailscale-connect-form.tsx`, `src/tailscale-setup-impl.tsx`

## Data Flow

### Save Tailscale API Token

1. Operator fills form in `TailscaleConnectForm` (`src/tailscale-connect-form.tsx`)
2. `handleConnect()` calls `saveTailscaleConnectionAction` via `useTransition` (`src/tailscale-setup-actions.ts:20`)
3. Action calls `requireExtensionAction("@cinatra-ai/tailscale-connector", "manage")` — auth guard
4. Action calls `saveTailscaleConnection({ apiKey, cloneTag })` (`src/index.ts:225`)
5. Core retrieves Nango surface via `getTailscaleDeps().nango` (`src/index.ts:251`)
6. `nango.ensureIntegration(...)` — creates provider-config row if absent
7. `nango.importConnection(...)` — upserts Nango connection with `credentials: { type: "API_KEY", apiKey }`
8. `nango.getCredentials(..., { forceRefresh: true })` — read-back verification; rolls back both Nango and local state on mismatch
9. `resolveTailscaleTailnet({ apiKey })` (`src/tailscale-api.mjs:289`) — GET `/api/v2/tailnet/-/devices` to resolve human-readable tailnet name
10. `writeLocalSettings(...)` persists `connected`, `tailnet`, `cloneTag`, `lastValidatedAt` to `connector_config:tailscale`
11. Action calls `revalidatePath` for `/connectors/…`, `/connectors`, `/configuration/development`
12. Form sets local React state from returned `TailscaleConnectionStatus`

### Read Connection Status (UI / Dev Tab)

1. `TailscaleConnectorPageImpl` (`src/tailscale-setup-impl.tsx`) calls `getTailscaleConnectionStatus()` server-side
2. `getTailscaleConnectionStatus` reads `connector_config:tailscale` from DB via injected dep — no network round-trip
3. Returns `{ connected, tailnet, cloneTag, lastValidatedAt }`

### Hostname / Funnel URL Derivation (Pure — No Network)

1. Caller (app server or CLI) calls `deriveDevTailscaleHostname({ dbUrl, schema })` (`src/tailscale-hostname.mjs:90`)
2. Parse DB name from `SUPABASE_DB_URL`; match `cinatra_clone_<slug>` → `cinatra-clone-<slug>`
3. Else match `SUPABASE_SCHEMA` pattern `cinatra_<slug>` → `cinatra-<slug>`
4. Else → `"cinatra-main"`
5. `sanitizeTailscaleDeviceName` enforces Tailscale's naming rules (lowercase, hyphens, starts with letter, ≤63 chars with hash suffix on truncation)
6. `composeTailscaleFunnelUrl(hostname, tailnet)` → `https://<hostname>.<tailnet>.ts.net` or `null` if tailnet unresolved

**State Management:**
- Credentials: stored in Nango (encrypted at rest), never in the connector's local state
- Non-secret status: stored in host DB via `readConnectorConfigFromDatabase` / `writeConnectorConfigToDatabase` (injected)
- React UI state: local `useState` in `TailscaleConnectForm`, updated optimistically after server action resolves

## Key Abstractions

**TailscaleConnectorDeps:**
- Purpose: Complete set of host capabilities the connector needs — DB config r/w, Nango surface, instance identity
- Examples: `src/deps.ts:57`
- Pattern: Structural interface, bound at boot via `registerTailscaleConnector(deps)`, read at call time via `getTailscaleDeps()`

**TailscaleNangoCapability:**
- Purpose: Minimal Nango surface the connector calls — decouples from `@cinatra-ai/nango-connector` package
- Examples: `src/deps.ts:24`
- Pattern: Inlined structural interface; host passes a concrete implementation that wraps the real Nango client

**TailscaleApiError:**
- Purpose: Tagged error class for mapping HTTP failures to UI-safe codes without leaking secrets
- Examples: `src/tailscale-api.mjs:37`
- Pattern: `new TailscaleApiError(code, message, status?)` — codes: `tailscale.invalid_client`, `tailscale.scope_denied`, `tailscale.tag_denied`, `tailscale.rate_limited`, `tailscale.network`, `tailscale.unknown`, `tailscale.nango_unconfigured`, `tailscale.nango_writeback`

## Entry Points

**Package public API:**
- Location: `src/index.ts`
- Triggers: Imported by host at boot (for `registerTailscaleConnector`) and by server actions / dev-tab code at runtime
- Responsibilities: All connector logic + re-exports of DI functions from `src/deps.ts`

**Setup Page (RSC):**
- Location: `src/setup-page.tsx`
- Triggers: Host Next.js router renders this for `/connectors/cinatra-ai/tailscale-connector/setup`
- Responsibilities: Delegates immediately to `TailscaleConnectorPageImpl`

**Server Actions:**
- Location: `src/tailscale-setup-actions.ts`
- Triggers: Called from `TailscaleConnectForm` via `useTransition`
- Responsibilities: Auth guard, call connector core, revalidate Next.js paths

## Architectural Constraints

- **Threading:** Single-threaded Next.js server; no worker threads. `saveTailscaleConnection` is `async` and awaits Nango calls sequentially.
- **Global state:** One `globalThis` Symbol slot (`@cinatra-ai/tailscale-connector:host-deps/v1`) shared across all Next.js bundles. This is intentional: separate bundles (RSC, server actions, page) must resolve the same DI registration. See `src/deps.ts:69`.
- **Circular imports:** None detected.
- **`.mjs` boundary:** `src/tailscale-api.mjs` and `src/tailscale-hostname.mjs` must remain plain ESM (no TypeScript syntax, no `@/` aliases) so the CLI can import them without a build step.
- **`server-only` guard:** `src/index.ts` and `src/tailscale-setup-impl.tsx` both begin with `import "server-only"` — prevents accidental client-bundle inclusion of server logic.
- **Secret hygiene:** The `apiKey` is never logged. Error messages in `src/tailscale-api.mjs` deliberately omit response bodies on auth failures.

## Anti-Patterns

### Importing connector core directly in client components

**What happens:** `TailscaleConnectForm` is `"use client"` and must not import `src/index.ts` (which is `server-only`).
**Why it's wrong:** `server-only` would throw a build error; the client has no access to DI-injected DB deps.
**Do this instead:** Client components call only Server Actions (`src/tailscale-setup-actions.ts`); all server-side reads happen in the RSC (`src/tailscale-setup-impl.tsx`) and are passed down as props.

### Persisting the derived hostname

**What happens:** Previously, the hostname was stored in DB state.
**Why it's wrong:** All heavy clones share schema `cinatra`, so schema-only derivation produced `cinatra-main` for every clone — a collision. Persistence also introduced stale-cache risk on re-derivation.
**Do this instead:** Always call `deriveDevTailscaleHostname({ dbUrl, schema })` at read time using the immutable env vars (`SUPABASE_DB_URL`, `SUPABASE_SCHEMA`). See `src/tailscale-hostname.mjs:90` and `src/index.ts:110`.

## Error Handling

**Strategy:** Tagged error class (`TailscaleApiError`) with `.code` and optional `.status`; callers distinguish error types via `.code` without string parsing.

**Patterns:**
- `src/tailscale-api.mjs`: All HTTP errors mapped to `TailscaleApiError` codes; no secret values in messages
- `src/index.ts:saveTailscaleConnection`: Wraps Nango calls in try/catch, rethrows `TailscaleApiError`; includes read-back rollback (`deleteConnection` + `clearConnectionRecords` + `writeLocalSettings({})`)
- `src/tailscale-setup-actions.ts`: Catches any error, returns `{ ok: false, error: message, code? }` to the client — never throws past the action boundary

## Cross-Cutting Concerns

**Logging:** `console.error` with structured context objects at Nango failure sites in `src/index.ts`; no raw response bodies logged.
**Validation:** Input validation at the connector core level (`saveTailscaleConnection` checks `apiKey` non-empty, `cloneTag` starts with `tag:`); tag name sanitization in `kebabFromInstanceDisplayName`.
**Authentication:** All server actions guarded by `requireExtensionAction("@cinatra-ai/tailscale-connector", "manage")` from `@cinatra-ai/sdk-extensions`.

---

*Architecture analysis: 2026-06-09*
