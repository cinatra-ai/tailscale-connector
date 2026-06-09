# Testing Patterns

**Analysis Date:** 2026-06-09

## Test Framework

**Runner:**
- Vitest (version not pinned locally; resolved from monorepo workspace)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest's built-in `expect` (from `vitest`)

**Run Commands:**
```bash
pnpm test              # Run all tests (vitest)
```
Watch mode and coverage commands are not configured locally; the monorepo root may provide them.

## Test File Organization

**Location:**
- All tests are co-located under `src/__tests__/` (not next to source files)

**Naming:**
- `<module-name>.test.ts`, matching the source module minus extension: `tailscale-api.test.ts` → `src/tailscale-api.mjs`

**Structure:**
```
src/
  __tests__/
    tailscale-api.test.ts          # REST API client: fetch mocking
    tailscale-connect.test.ts      # saveTailscaleConnection: Nango DI stub
    tailscale-hostname.test.ts     # Pure-function hostname derivation
```

## Test Structure

**Suite Organization:**
```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("functionName", () => {
  it("does X when Y", async () => {
    // arrange
    // act
    // assert
  });

  it("rejects with code when Z", async () => {
    await expect(fn(...)).rejects.toMatchObject({ code: "tailscale.x" });
  });
});
```

**Patterns:**
- `beforeEach`: reset mocks and (re-)register DI stubs
- `afterEach`: restore mocks (`vi.restoreAllMocks()`) and reset DI slot (`_resetTailscaleDepsForTests()`)
- `describe` blocks group by function name; `it` descriptions are behavior-first ("does X", "rejects with", "maps 4xx →")

## Mocking

**Framework:** `vi` from `vitest`

**Pattern 1 — Direct `globalThis.fetch` replacement (REST API tests):**
```typescript
const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// Usage:
fetchMock.mockResolvedValueOnce(makeResponse({ status: 200, json: { ... } }));
```
This is the repo's declared convention per `src/__tests__/tailscale-api.test.ts`. No `msw`, no `fetch-mock`, no module re-import tricks.

**Pattern 2 — `vi.mock` for partial module mock (connect tests):**
```typescript
vi.mock("../tailscale-api.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tailscale-api.mjs")>();
  return { ...actual, resolveTailscaleTailnet: vi.fn(async () => "real-tailnet.ts.net") };
});
```
Spread the real module and override only the functions that make live network calls.

**Pattern 3 — Dependency-injection stub (connect tests):**
```typescript
const isConfigured = vi.fn<() => boolean>();
const ensureIntegration = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
// ...

beforeEach(() => {
  CONFIG_STORE = {};
  vi.clearAllMocks();
  registerTailscaleConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    readInstanceIdentity: () => ({ instanceDisplayName: "test-instance" }),
    nango: { isConfigured, ensureIntegration, ... },
  });
  isConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetTailscaleDepsForTests();
});
```

**What to Mock:**
- `globalThis.fetch` for any test of code that calls the Tailscale REST API
- `resolveTailscaleTailnet` when testing `saveTailscaleConnection` (avoids live network call)
- The full DI `TailscaleConnectorDeps` object when testing logic that reads/writes Nango or connector config

**What NOT to Mock:**
- Pure functions in `src/tailscale-hostname.mjs` — tested directly with no mocking
- `TailscaleApiError` — always use the real class (it's spread from `importOriginal`)

## Fixtures and Factories

**Test Data:**
```typescript
// Inline response factory used in tailscale-api.test.ts:
function makeResponse(init: { status: number; json?: unknown }) {
  const { status, json } = init;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (json === undefined) throw new Error("no json");
      return json;
    },
  };
}

// In-memory config store used in tailscale-connect.test.ts:
let CONFIG_STORE: Record<string, unknown> = {};
```

**Location:**
- Fixtures are defined inline within each test file; no shared fixture directory

## Coverage

**Requirements:** Not enforced (no `coverage` threshold configured in `vitest.config.ts`)

**View Coverage:**
```bash
# Not configured; run via monorepo root coverage command if available
```

## Test Types

**Unit Tests:**
- All tests are unit-level. Three test suites covering the three testable modules.
- `tailscale-hostname.test.ts`: pure-function tests, no mocking needed
- `tailscale-api.test.ts`: fetch-mock-based HTTP client tests
- `tailscale-connect.test.ts`: DI-stub-based integration logic tests

**Integration Tests:**
- Not applicable; integration with Nango and Tailscale is fully stubbed via DI

**E2E Tests:**
- Not used

## Common Patterns

**Async Testing:**
```typescript
// Happy path with resolved mock:
getCredentials.mockResolvedValueOnce({ apiKey: TOKEN });
const result = await saveTailscaleConnection({ apiKey: TOKEN });
expect(result.connected).toBe(true);

// Error path with rejects matcher:
await expect(saveTailscaleConnection({ apiKey: TOKEN }))
  .rejects.toThrow(/did not match/);
```

**Error Code Testing:**
```typescript
// Match error code + optional status without asserting full message:
await expect(mintTailscaleAccessToken({ clientId: "", clientSecret: "x" }))
  .rejects.toMatchObject({ code: "tailscale.invalid_client" });

await expect(mintTailscaleAccessToken({ clientId: "x", clientSecret: "y" }))
  .rejects.toMatchObject({ code: "tailscale.rate_limited", status: 429 });
```

**Security Invariant Tests:**
```typescript
// Explicit test that error messages never contain secret values:
it("error messages NEVER contain the clientSecret value (redaction invariant)", async () => {
  // arrange: trigger a 403
  fetchMock.mockResolvedValueOnce(makeResponse({ status: 403 }));
  try {
    await mintTailscaleAccessToken({
      clientId: "client-id-public",
      clientSecret: "SUPER-SECRET-PASSWORD-VALUE",
      scope: "auth_keys",
    });
    throw new Error("expected throw");
  } catch (err) {
    expect(err).toBeInstanceOf(TailscaleApiError);
    expect((err as Error).message).not.toContain("SUPER-SECRET-PASSWORD-VALUE");
  }
});
```
This pattern is required for every path that handles a secret value.

**Rollback/State Verification:**
```typescript
// Verify both Nango rollback calls AND local config wipe after a failed save:
expect(deleteConnection).toHaveBeenCalledWith(PROVIDER_KEY, PROVIDER_KEY);
expect(clearConnectionRecords).toHaveBeenCalledWith("tailscale");
expect(CONFIG_STORE.tailscale).toEqual({});
```

## Vitest Config Notes

- `vitest.config.ts` resolves `server-only` to a stub at `<monorepo-root>/tests/__stubs__/server-only.ts`
- `@/` alias maps to `<monorepo-root>/src` for test-time resolution of monorepo-internal paths
- `test.include` is restricted to `src/__tests__/**/*.test.ts`
- `test.environment` is `"node"` (no jsdom)

---

*Testing analysis: 2026-06-09*
