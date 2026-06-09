# Coding Conventions

**Analysis Date:** 2026-06-09

## Naming Patterns

**Files:**
- TypeScript source files: `kebab-case.ts` / `kebab-case.tsx` (e.g., `tailscale-setup-actions.ts`, `tailscale-connect-form.tsx`)
- Pure-ESM JavaScript files use `.mjs` extension: `tailscale-api.mjs`, `tailscale-hostname.mjs`
- UI components: `kebab-case.tsx` under `src/components/ui/` (e.g., `alert.tsx`, `input-group.tsx`)
- Tests: `src/__tests__/<module-name>.test.ts`, mirroring the source module name

**Functions:**
- camelCase for all exported and internal functions: `saveTailscaleConnection`, `getTailscaleDeps`, `mintTailscaleAuthKey`
- Test-only helpers prefixed with `_` underscore: `_resetTailscaleDepsForTests`
- Private/internal helpers are unexported (e.g., `kebabFromInstanceDisplayName`, `readLocalSettings`, `writeLocalSettings`)

**Variables:**
- camelCase for locals; UPPER_SNAKE_CASE for module-level constants: `TAILSCALE_LOCAL_CONFIG_KEY`, `DEFAULT_CLONE_TAG`, `TAILSCALE_BASE_URL`

**Types:**
- PascalCase for interfaces and type aliases: `TailscaleConnectionStatus`, `TailscaleConnectorDeps`, `TailscaleNangoCapability`
- Inline `as const` for string literal constants

## Code Style

**Formatting:**
- Not detected (no `.prettierrc` or `biome.json` present); formatting is enforced by the monorepo's root config (this repo extends `../../../tsconfig.json`)
- 2-space indentation observed consistently across all files

**Linting:**
- Not detected at the repo level; linting governed by monorepo root

## Import Organization

**Order (observed pattern):**
1. Node built-ins with `node:` prefix (`import * as path from "node:path"` in `vitest.config.ts`)
2. Framework/host directives (`"use server"`, `import "server-only"`)
3. External packages (`next/cache`, `@cinatra-ai/sdk-extensions`, `vitest`)
4. Internal relative imports (`./index`, `../tailscale-api.mjs`)

**Path Aliases:**
- `@/` alias is configured in `vitest.config.ts` to point at the monorepo's `src/` root (for test isolation); not used in production source within this connector

**Module boundary rule:**
- `.mjs` files (`tailscale-api.mjs`, `tailscale-hostname.mjs`) are pure ESM with no TypeScript and no `@/` or `@cinatra-ai/*` imports, so the plain-Node CLI can import them directly across the `.mjs` boundary. TS connector code imports these `.mjs` modules; do not convert them to `.ts`.

## Error Handling

**Patterns:**
- Custom error class `TailscaleApiError` (in `src/tailscale-api.mjs`) extends `Error` with `.code: string` and optional `.status: number`. All domain errors thrown as this class.
- Error codes are namespaced with `tailscale.` prefix: `tailscale.invalid_client`, `tailscale.nango_unconfigured`, `tailscale.nango_writeback`, `tailscale.unknown`, `tailscale.scope_denied`, `tailscale.tag_denied`, `tailscale.rate_limited`, `tailscale.network`
- Server actions in `src/tailscale-setup-actions.ts` catch `TailscaleApiError` and return `{ ok: false, error: string, code?: string }` — errors never surface as thrown exceptions at the Next.js action boundary
- Best-effort cleanup paths (`deleteConnection`, `clearConnectionRecords`) use empty `catch {}` blocks to avoid masking the original error
- `resolveTailscaleTailnet` never throws past its boundary; returns `null` on any failure

**Security rule — error message redaction:**
- Secrets (`clientSecret`, `accessToken`, `apiKey`) MUST NEVER appear in error message strings. Enforce this invariant with explicit test cases (see `tailscale-api.test.ts`).

## Logging

**Framework:** `console.error` only

**Patterns:**
- Structured log calls use positional arguments: `console.error("[connector-tailscale] <message>", { key: value }, rawErr)`
- Log prefix `[connector-tailscale]` on all error logs for grep-ability
- No `console.log` / `console.warn` in production code; only `console.error` on unexpected failures before re-throwing

## Comments

**When to Comment:**
- Top-of-file block comments explain the module's role, constraints, and storage/auth model in depth (all major source files have 30–80 line block comments)
- Each exported function has a JSDoc (`.mjs`) or TSDoc (`.ts`) comment explaining parameters, return value, and important side-effects or security constraints
- Inline comments explain non-obvious business logic, storage patterns, and bug regression notes (e.g., heavy-clone hostname collision fix documented inline)

**JSDoc/TSDoc:**
- `.mjs` files use `@param`, `@returns`, and `@type` JSDoc annotations
- `.ts` files use TSDoc-style `/** ... */` comments without type annotations (TypeScript types are in the signature)

## Function Design

**Size:** Functions are focused; complex flows (e.g., `saveTailscaleConnection`) are documented step-by-step with numbered inline comments

**Parameters:** Objects used for named parameters when more than 1–2 arguments: `saveTailscaleConnection({ apiKey, cloneTag? })`, `mintTailscaleAuthKey({ accessToken, tailnet, tags?, ... })`

**Return Values:** Async functions return typed result objects; server actions always return discriminated unions `{ ok: true, ... } | { ok: false, error: string }`

## Module Design

**Exports:**
- `src/index.ts` is the single public entry point; re-exports DI surface from `src/deps.ts`
- `src/tailscale-setup-actions.ts` exports Next.js server actions separately (marked `"use server"`)
- `.mjs` modules export functions directly; no barrel re-export of `.mjs` from `src/index.ts` (CLI imports `.mjs` directly)

**DI Pattern:**
- Host dependencies injected at boot via `registerTailscaleConnector(deps)` stored on `globalThis` under a versioned Symbol (`Symbol.for("@cinatra-ai/tailscale-connector:host-deps/v1")`). Runtime code resolves via `getTailscaleDeps()`. This handles the multi-bundle Next.js scenario where separately-compiled page bundles don't share module-local state.

**`server-only` guard:**
- `import "server-only"` at the top of `src/index.ts` prevents client bundle inclusion

---

*Convention analysis: 2026-06-09*
