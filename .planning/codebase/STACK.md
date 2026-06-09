# Technology Stack

**Analysis Date:** 2026-06-09

## Languages

**Primary:**
- TypeScript - Server-side connector logic, React UI components (`src/index.ts`, `src/setup-page.tsx`, `src/tailscale-connect-form.tsx`, `src/tailscale-setup-impl.tsx`, `src/tailscale-setup-actions.ts`, `src/deps.ts`)

**Secondary:**
- JavaScript (ESM `.mjs`) - Pure-Node modules shared with the CLI: `src/tailscale-api.mjs`, `src/tailscale-hostname.mjs`. The `.mjs` boundary allows the plain-Node CLI to `import` them without TypeScript compilation.

## Runtime

**Environment:**
- Node.js (ESM, `"type": "module"` in `package.json`)

**Package Manager:**
- pnpm (`.npmrc` present with `auto-install-peers=false`)
- Lockfile: managed at monorepo root (this is a workspace package)

## Frameworks

**Core:**
- React 19 (peer dependency `^19.2.3`) - UI setup page and form components
- Next.js - Implied by `"server-only"` import in `src/index.ts` and the reference to separately-compiled page/server-action bundles; consumed as a Next.js connector extension

**Testing:**
- Vitest - Test runner, config at `vitest.config.ts`

**Build/Dev:**
- TypeScript compiler (`tsconfig.json` extends monorepo root `../../../tsconfig.json`)
- No dedicated bundler within this package — consumed by the host app's build pipeline

## Key Dependencies

**Critical:**
- `@cinatra-ai/sdk-extensions` (peer, optional) - Cinatra extension SDK surface; connector registers against it
- `@cinatra-ai/sdk-ui` (peer, optional) - Cinatra shared UI primitives
- `radix-ui` `^1.4.3` - Headless UI primitives (used in `src/components/ui/`)
- `class-variance-authority` `^0.7.1` - Variant-based class composition for UI components
- `clsx` `^2.1.1` - Conditional class name utility
- `tailwind-merge` `^3.5.0` - Tailwind CSS class deduplication

**Infrastructure:**
- Nango (no direct npm dep; injected via `TailscaleNangoCapability` interface in `src/deps.ts`) - credential storage for the Tailscale API key. Concrete implementation is host-bound at boot via `registerTailscaleConnector(deps)`.

## Configuration

**Environment:**
- `SUPABASE_DB_URL` - Postgres connection string read at runtime to derive the deterministic Tailscale device hostname for heavy clones
- `SUPABASE_SCHEMA` - Schema name read at runtime to derive the hostname for light worktrees / main
- No `.env` file inside this package; env vars are inherited from the host Next.js app

**Build:**
- `tsconfig.json` - TypeScript configuration; excludes test files from compilation
- `vitest.config.ts` - Test runner config; aliases `server-only` to a stub, maps `@/` to the monorepo `src/` root

## Platform Requirements

**Development:**
- Node.js (ESM-capable version, matches monorepo root)
- pnpm workspace (package is consumed as `@cinatra-ai/tailscale-connector` within the monorepo)

**Production:**
- Deployed as a Next.js server component / server-action bundle inside the Cinatra host application
- `"server-only"` guard in `src/index.ts` prevents client-side bundle inclusion

---

*Stack analysis: 2026-06-09*
