# Codebase Structure

**Analysis Date:** 2026-06-09

## Directory Layout

```
tailscale-connector/
├── src/
│   ├── __tests__/                # Unit tests (vitest)
│   │   ├── tailscale-api.test.ts
│   │   ├── tailscale-connect.test.ts
│   │   └── tailscale-hostname.test.ts
│   ├── components/
│   │   └── ui/                   # Design-system primitives (Radix + CVA)
│   │       ├── alert.tsx
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── field.tsx
│   │       ├── input-group.tsx
│   │       ├── input.tsx
│   │       ├── label.tsx
│   │       ├── separator.tsx
│   │       └── textarea.tsx
│   ├── lib/
│   │   └── utils.ts              # cn(), slugify(), and general helpers
│   ├── deps.ts                   # DI registry — TailscaleConnectorDeps interface + globalThis slot
│   ├── index.ts                  # Package public API (server-only)
│   ├── setup-page.tsx            # RSC dispatch route for the connector setup page
│   ├── tailscale-api.mjs         # Tailscale REST client — plain ESM, no TS
│   ├── tailscale-connect-form.tsx # "use client" connect/disconnect form
│   ├── tailscale-hostname.mjs    # Hostname/Funnel-URL derivation — plain ESM, no TS
│   ├── tailscale-setup-actions.ts # "use server" Next.js Server Actions
│   └── tailscale-setup-impl.tsx  # RSC page implementation (server-only)
├── .github/
│   └── workflows/
│       ├── ci.yml                # CI pipeline
│       └── release.yml           # Release pipeline
├── .planning/
│   └── codebase/                 # GSD codebase map documents
├── .npmrc                        # npm registry config
├── LICENSE                       # Apache-2.0
├── README.md
├── package.json                  # Cinatra connector manifest + peerDeps
├── tsconfig.json
└── vitest.config.ts
```

## Directory Purposes

**`src/`:**
- Purpose: All connector source code
- Contains: Public API, DI, Tailscale API client, hostname utilities, Next.js UI, UI primitives

**`src/__tests__/`:**
- Purpose: Unit tests
- Contains: Tests for `tailscale-api.mjs`, hostname derivation, and the connect form logic
- Key files: `src/__tests__/tailscale-api.test.ts`, `src/__tests__/tailscale-hostname.test.ts`, `src/__tests__/tailscale-connect.test.ts`

**`src/components/ui/`:**
- Purpose: Self-contained Radix/CVA design-system primitives used by the setup UI
- Contains: Stateless presentational components only; no connector-specific logic

**`src/lib/`:**
- Purpose: Shared utility functions
- Key files: `src/lib/utils.ts` — `cn()` (Tailwind class merge), `slugify()`, misc formatters

## Key File Locations

**Entry Points:**
- `src/index.ts`: Package public API — all exports consumed by the host and by Server Actions
- `src/setup-page.tsx`: RSC entry point for the connector setup page (consumed by host router)

**Configuration:**
- `package.json`: Package metadata including `"cinatra"` connector manifest (`apiVersion`, `kind: "connector"`, `displayName`)
- `tsconfig.json`: TypeScript config
- `vitest.config.ts`: Test runner config

**Core Logic:**
- `src/deps.ts`: DI registry — interfaces and globalThis slot
- `src/tailscale-api.mjs`: Tailscale REST client (`mintTailscaleAccessToken`, `mintTailscaleAuthKey`, `resolveTailscaleTailnet`, `TailscaleApiError`)
- `src/tailscale-hostname.mjs`: Hostname/Funnel-URL utilities (`deriveDevTailscaleHostname`, `composeTailscaleFunnelUrl`, `sanitizeTailscaleDeviceName`, `parseDatabaseName`)
- `src/tailscale-setup-actions.ts`: Server Actions (`saveTailscaleConnectionAction`, `clearTailscaleConnectionAction`)

**UI:**
- `src/tailscale-setup-impl.tsx`: Server component — reads status from core, renders `TailscaleConnectForm`
- `src/tailscale-connect-form.tsx`: Client component — API key + clone-tag form with optimistic state

**Testing:**
- `src/__tests__/`: All test files co-located under a single `__tests__` folder at the `src/` level

## Naming Conventions

**Files:**
- TypeScript server/shared modules: `kebab-case.ts` (e.g., `tailscale-setup-actions.ts`, `tailscale-setup-impl.tsx`)
- Plain ESM modules shared with CLI: `kebab-case.mjs` (e.g., `tailscale-api.mjs`, `tailscale-hostname.mjs`)
- UI components: `kebab-case.tsx` (e.g., `tailscale-connect-form.tsx`)
- Test files: `<module-under-test>.test.ts` inside `src/__tests__/`

**Directories:**
- Feature grouping: kebab-case (`components/ui/`)

**Exports:**
- Functions: `camelCase` (e.g., `saveTailscaleConnection`, `getTailscaleConnectionStatus`)
- Types/Interfaces: `PascalCase` (e.g., `TailscaleConnectionStatus`, `TailscaleConnectorDeps`)
- Constants: `SCREAMING_SNAKE_CASE` for module-level private constants (e.g., `TAILSCALE_LOCAL_CONFIG_KEY`)
- React components: `PascalCase` (e.g., `TailscaleConnectForm`, `TailscaleConnectorPageImpl`)

## Where to Add New Code

**New connector logic (server-side, reads/writes state):**
- Implementation: `src/index.ts` — add exported functions; keep `import "server-only"` at top
- Tests: `src/__tests__/<feature>.test.ts`

**New Tailscale REST API call:**
- Implementation: `src/tailscale-api.mjs` — extend as plain ESM; never add TypeScript syntax or `@/` aliases; throw `TailscaleApiError` on failure
- Tests: `src/__tests__/tailscale-api.test.ts`

**New Server Action:**
- Implementation: `src/tailscale-setup-actions.ts` — guard with `requireExtensionAction`, catch errors, return `{ ok: true/false }` shape; call `revalidatePath` for affected routes

**New UI field on setup page:**
- Form change: `src/tailscale-connect-form.tsx` (client)
- Default-value read: `src/tailscale-setup-impl.tsx` (server component) — pass down as prop
- State persistence: `src/index.ts` via `TailscaleLocalSettings`

**New UI primitive:**
- Implementation: `src/components/ui/<name>.tsx`

**Utilities:**
- Shared helpers: `src/lib/utils.ts`

## Special Directories

**`.planning/`:**
- Purpose: GSD planning artifacts and codebase map documents
- Generated: No (manually maintained by GSD agents)
- Committed: Yes (permitted per project memory)

**`.github/workflows/`:**
- Purpose: CI/CD pipelines
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-06-09*
