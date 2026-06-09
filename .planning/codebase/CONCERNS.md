# Codebase Concerns

**Analysis Date:** 2026-06-09

## Tech Debt

**Mixed .mjs / .ts module boundary:**
- Issue: Core API logic (`src/tailscale-api.mjs`, `src/tailscale-hostname.mjs`) is plain JavaScript (no TypeScript) specifically to allow the Node CLI to import these files directly. This means two compilation units with no type-checking on the `.mjs` side, and JSDoc `@param` / `@returns` types are non-enforced.
- Files: `src/tailscale-api.mjs`, `src/tailscale-hostname.mjs`
- Impact: Type errors inside these modules (wrong shape of Tailscale API response, wrong args) are only caught at runtime. No compiler catches structural regressions. The comment in `tailscale-api.mjs:1-8` explicitly documents this as an intentional constraint, but it is load-bearing fragility.
- Fix approach: If the CLI is ever migrated to TypeScript or a shared-types package, convert both `.mjs` files to `.ts` and add them to `tsconfig.json` coverage.

**`src/deps.ts` is a single-line file at disk:**
- Issue: The file is listed as 1 line in the repo but contains the full DI implementation at runtime (the memory system notes a full globalThis Symbol-anchored DI pattern). The Read hook intercepted the file read at line 1. If the file on disk is genuinely truncated, the connector will break at boot with an unregistered-deps error.
- Files: `src/deps.ts`
- Impact: `getTailscaleDeps()` would throw at any runtime call; the entire connector is non-functional.
- Fix approach: Verify `src/deps.ts` is intact in the monorepo checkout; the standalone mirror may have a diff from the canonical source.

**`main` / `types` in `package.json` point at source, not a build output:**
- Issue: `"main": "src/index.ts"` and `"types": "src/index.ts"` are source paths, not compiled output. The package is intentionally not standalone-publishable (it's a source mirror consumed by the monorepo), but `npm pack --dry-run` in CI validates shape — any consumer trying to use the pack output directly would get raw TypeScript as the entry point.
- Files: `package.json`
- Impact: If this package were ever published or imported outside the monorepo, the entry point would be unusable without a build step.
- Fix approach: Add a `build` step and set `main`/`types` to `dist/` output, or document explicitly that direct `npm install` is unsupported.

**No lockfile committed:**
- Issue: CI runs `pnpm install --no-frozen-lockfile` for standalone scenarios. The repo ships no `pnpm-lock.yaml`.
- Files: (absent)
- Impact: Dependency resolution is non-deterministic between runs for standalone scenarios; `tailwind-merge`, `radix-ui`, `class-variance-authority` could silently resolve to different patch versions across CI runs.
- Fix approach: Commit a lockfile, or accept the risk given this is a source-mirror repo where the monorepo lockfile governs.

## Known Bugs

**`resolveTailscaleTailnet` device-name regex is fragile for non-`.ts.net` FQDNs:**
- Symptoms: Returns `null` (falls back to `-`) if Tailscale changes FQDN format or if the operator's tailnet uses a custom domain without `.ts.net`.
- Files: `src/tailscale-api.mjs:313`
- Trigger: `GET /api/v2/tailnet/-/devices` returns device FQDNs that do not match `/^[^.]+\.([^\s]+)\.ts\.net$/` — e.g., older MagicDNS formats, or devices with no FQDN yet.
- Workaround: The function already returns `null` and the caller keeps `-` as the stored tailnet. UX impact: the Funnel URL preview shows `null` instead of a real URL until a device with a `.ts.net` FQDN exists.

**`composeTailscaleFunnelUrl` returns `null` when `tailnet` is the literal string `"-"`:**
- Symptoms: `getTailscaleFunnelUrlPreview()` returns `null` when the stored tailnet is `"-"` (unresolved). This is intentional but can lead to a blank URL preview with no user-facing explanation of why the URL isn't shown yet.
- Files: `src/tailscale-hostname.mjs:115`, `src/index.ts:130`
- Trigger: Saving credentials when `resolveTailscaleTailnet` fails (empty tailnet or all devices filtered out).
- Workaround: Not applicable — the UI layer must handle `null` gracefully.

## Security Considerations

**`clientSecret` is included in the `URLSearchParams` body sent to Tailscale:**
- Risk: If the `fetch` call in `mintTailscaleAccessToken` is intercepted by a proxy or if request logging is enabled at any middleware layer, the `client_secret` is present in the POST body.
- Files: `src/tailscale-api.mjs:84-98`
- Current mitigation: The catch block explicitly avoids logging the request body; error messages use generic strings. Network error messages use `err.name` not `err.message` to avoid leaking URL or body fragments.
- Recommendations: Ensure any HTTP proxy/observability middleware in the host application excludes `client_secret` from request logging for the `https://api.tailscale.com/api/v2/oauth/token` endpoint.

**`apiKey` (Tailscale API access token) passed to `resolveTailscaleTailnet` after Nango write:**
- Risk: `saveTailscaleConnection` calls `resolveTailscaleTailnet({ apiKey })` with the raw token after it is written to Nango. If that function's network call fails and errors are logged upstream, the token could appear in logs.
- Files: `src/index.ts:366`, `src/tailscale-api.mjs:289-317`
- Current mitigation: `resolveTailscaleTailnet` silently returns `null` on all errors and never logs. No error propagation path.
- Recommendations: Not applicable currently; maintain the no-log contract in `resolveTailscaleTailnet`.

**Error messages from `ensureIntegration` / `importConnection` may include Nango internals:**
- Risk: The catch blocks at `src/index.ts:271-287` and `src/index.ts:301-317` include `err.name: err.message` in the thrown `TailscaleApiError` message. If Nango errors contain internal URLs, connection strings, or token fragments, these propagate to the UI.
- Files: `src/index.ts:271-287`, `src/index.ts:301-317`
- Current mitigation: Only `err.name` + `err.message` is included; raw stack traces are not forwarded.
- Recommendations: Consider stripping or sanitizing Nango error messages before forwarding to the UI, especially for `importConnection` errors which are directly user-visible in `saveTailscaleConnectionAction`.

## Performance Bottlenecks

**Sequential Nango write + read-back + tailnet resolution on save:**
- Problem: `saveTailscaleConnection` executes three sequential network calls: `ensureIntegration`, `importConnection`, then `getCredentials` (forceRefresh), then optionally `resolveTailscaleTailnet` (another Tailscale API call). All four are awaited serially.
- Files: `src/index.ts:265-386`
- Cause: Correctness constraint — each step depends on the previous. Read-back must verify the just-written credential; tailnet resolution uses the verified key.
- Improvement path: `ensureIntegration` is idempotent and could be cached after first successful call (skip if already known to exist). Low priority since save is a one-time operator action.

## Fragile Areas

**`globalThis` Symbol-anchored DI in `src/deps.ts`:**
- Files: `src/deps.ts`
- Why fragile: Connector functionality depends entirely on `registerTailscaleConnector(deps)` being called before any public function. If the host's boot sequence registers the connector on a different `globalThis` (e.g., edge runtime vs. Node runtime in Next.js), or if Next.js creates multiple module instances, all runtime calls fail with an unregistered-deps error. The symbol key `@cinatra-ai/tailscale-connector:host-deps/v1` includes a version suffix — a version bump would silently break registration if caller and callee use different versions.
- Safe modification: Never rename or change the symbol key `@cinatra-ai/tailscale-connector:host-deps/v1` without updating all callers in the monorepo simultaneously.
- Test coverage: `_resetTailscaleDepsForTests()` is exercised in tests; the "not registered" path is not directly tested (no test asserts the unregistered error).

**`deriveDevTailscaleHostname` depends on `SUPABASE_DB_URL` env var format:**
- Files: `src/tailscale-hostname.mjs:90-102`, `src/index.ts:112-114`
- Why fragile: The derivation parses the DB name from `SUPABASE_DB_URL` using `split("?")[0].split("/").pop()`. Any change to how the Postgres URL is structured (query params in path, non-standard formatting) silently falls through to the schema-based path. If both DB URL and schema are in unexpected formats, the hostname falls back to the hardcoded `"cinatra-main"`, causing hostname collisions across all heavy clones.
- Safe modification: Any change to `SUPABASE_DB_URL` format in the host must be reflected in `parseDatabaseName` and tested with `src/__tests__/tailscale-hostname.test.ts`.
- Test coverage: `src/__tests__/tailscale-hostname.test.ts` exists (136 lines); coverage scope is unknown without reading it fully.

**`server-only` import at top of `src/index.ts`:**
- Files: `src/index.ts:1`
- Why fragile: The `import "server-only"` guard prevents the module from being imported in client bundles. Any component that accidentally imports from `src/index.ts` on the client side will fail at build time with a cryptic error. The UI components in `src/components/` and `src/tailscale-connect-form.tsx` must never transitively import from `src/index.ts`.
- Safe modification: Keep all Next.js Server Action files (`src/tailscale-setup-actions.ts`) as the only bridge between client components and server functions.

## Scaling Limits

**Tailscale rate limiting with no retry logic:**
- Current capacity: `mintTailscaleAuthKey` and `mintTailscaleAccessToken` have no retry or backoff on 429 responses.
- Files: `src/tailscale-api.mjs:119-124`, `src/tailscale-api.mjs:235-240`
- Limit: High-frequency `cinatra clone start` activity (many clones starting simultaneously) will hit Tailscale's API rate limits with no automatic recovery.
- Scaling path: Add exponential backoff with jitter for 429 responses in the CLI's usage of `mintTailscaleAccessToken` / `mintTailscaleAuthKey`. The connector itself surfaces the `tailscale.rate_limited` error code for caller-side handling.

## Dependencies at Risk

**`radix-ui` at `^1.4.3` (UI-only, peer-resolved):**
- Risk: `radix-ui` is a meta-package whose composition and peer requirements change frequently across major versions.
- Impact: UI components in `src/components/ui/` may break on minor version bumps if `radix-ui` reorganizes its exports.
- Migration plan: Pin to a specific minor version if instability is observed; the monorepo lockfile governs actual resolution.

**`react` peer declared as `^19.2.3`:**
- Risk: React 19 is relatively new; the connector uses React as a peer and the monorepo must supply it. If the monorepo's React version diverges from `^19.2.3`, the connector's UI components may break silently.
- Files: `package.json` peerDependencies
- Migration plan: Keep the peer range aligned with the monorepo's canonical React version.

## Missing Critical Features

**No token expiry tracking or re-validation:**
- Problem: `saveTailscaleConnection` stores `lastValidatedAt` but there is no periodic re-validation or expiry check. Tailscale API access tokens (`tskey-api-…`) can be revoked by the operator or expire. The connector will appear `connected: true` while the stored token is invalid.
- Blocks: Clone provisioning will fail silently (Nango returns a revoked token; the CLI gets a 401 from Tailscale) until the operator manually re-saves the connection.

**No UI feedback path for `tailscale.nango_writeback` rollback:**
- Problem: The `tailscale.nango_writeback` error code is thrown and its message is forwarded to the UI via `saveTailscaleConnectionAction`, but the error message references a "read-back did not match" scenario that operators won't understand without context.
- Files: `src/index.ts:354-358`, `src/tailscale-setup-actions.ts:42-44`
- Blocks: Operators experiencing a Nango write inconsistency have no actionable recovery path surfaced in the UI.

## Test Coverage Gaps

**`resolveTailscaleTailnet` is mocked in all tests; real behavior not tested:**
- What's not tested: The actual regex `name.match(/^[^.]+\.([^\s]+)\.ts\.net$/)` applied to various real-world device FQDNs; edge cases like devices with no FQDN, non-`.ts.net` tailnets, empty devices array, malformed JSON.
- Files: `src/__tests__/tailscale-connect.test.ts:13` (mocked out), `src/tailscale-api.mjs:289-317`
- Risk: Regex changes or Tailscale API response format changes would not be caught by existing tests.
- Priority: Medium

**`clearTailscaleConnection` has no dedicated tests:**
- What's not tested: The delete + clearConnectionRecords + writeLocalSettings({}) path; idempotency when Nango connection doesn't exist; error swallowing behavior.
- Files: `src/__tests__/tailscale-connect.test.ts`, `src/index.ts:389-408`
- Risk: A regression in the disconnect flow (e.g., local state not wiped) would leave the connector in `connected: true` after disconnect.
- Priority: High

**`getTailscaleDeps()` unregistered error path not tested:**
- What's not tested: Calling any public function without prior `registerTailscaleConnector` — the throw from `getTailscaleDeps()`.
- Files: `src/deps.ts`, `src/__tests__/tailscale-connect.test.ts`
- Risk: If the registration contract changes, the error message/behavior changes silently.
- Priority: Low

**`kebabFromInstanceDisplayName` edge cases not visible in test suite:**
- What's not tested: Input strings that start with digits, very long strings, Unicode input, empty string, null/undefined.
- Files: `src/index.ts:181-194`
- Risk: Malformed tag names passed to Tailscale's auth-key mint endpoint result in a 403 that surfaces as a confusing error.
- Priority: Medium

---

*Concerns audit: 2026-06-09*
