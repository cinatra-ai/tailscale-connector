// Regression coverage for saveTailscaleConnection's Nango write-back flow:
// read-back must EQUAL the submitted key, and a failed read-back must fully
// roll back BOTH the Nango connection and the eagerly-saved pointer record
// (importConnection is called with connectorKey: "tailscale", which auto-saves
// the record). Nango behavior is injected via the connector's deps slot.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Partial-mock the Tailscale API module: keep the real TailscaleApiError (thrown
// + asserted) but stub the tailnet resolution (a live API call otherwise).
vi.mock("../tailscale-api.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tailscale-api.mjs")>();
  return { ...actual, resolveTailscaleTailnet: vi.fn(async () => "real-tailnet.ts.net") };
});

import {
  saveTailscaleConnection,
  registerTailscaleConnector,
  _resetTailscaleDepsForTests,
} from "../index";
import { TAILSCALE_TOKEN_MAX_AGE_DAYS } from "../tailscale-token-expiry.mjs";

const TOKEN = "tskey-api-VALID_TOKEN_xyz";
const PROVIDER_KEY = "cinatra-tailscale";

let CONFIG_STORE: Record<string, unknown> = {};
const isConfigured = vi.fn<() => boolean>();
const ensureIntegration = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
const importConnection = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
const getCredentials = vi.fn(async (..._a: unknown[]): Promise<unknown> => ({}));
const deleteConnection = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
const deleteConnectionStrict = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const clearConnectionRecords = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
const createConnectSession = vi.fn(async (..._a: unknown[]): Promise<string> => "session-token");
const getFrontendConfig = vi.fn(() => ({ baseURL: "http://localhost:3009", apiURL: "http://localhost:3003" }));

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
    isOAuthModeEnabled: () => false,
    readDevIsolationInputs: () => ({}),
    nango: {
      isConfigured,
      ensureIntegration,
      importConnection,
      getCredentials,
      deleteConnection,
      deleteConnectionStrict,
      clearConnectionRecords,
      createConnectSession,
      getFrontendConfig,
      providerConfigKeys: { tailscale: PROVIDER_KEY, tailscaleOauth: "cinatra-tailscale-oauth" },
    },
  });
  isConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetTailscaleDepsForTests();
});

describe("saveTailscaleConnection read-back verification", () => {
  it("happy path: read-back equals submitted key → persists, no rollback", async () => {
    getCredentials.mockResolvedValueOnce({ apiKey: TOKEN });

    const result = await saveTailscaleConnection({ apiKey: TOKEN });

    expect(result.connected).toBe(true);
    // Read-back MUST force a refresh (verify the just-written credential, not a
    // cached value) — the repo's Nango write/read-back rule.
    expect(getCredentials).toHaveBeenCalledWith(PROVIDER_KEY, PROVIDER_KEY, { forceRefresh: true });
    expect(deleteConnection).not.toHaveBeenCalled();
    expect(clearConnectionRecords).not.toHaveBeenCalled();
    expect((CONFIG_STORE.tailscale as { connected?: boolean }).connected).toBe(true);
  });

  it("stamps the token set-date and derives a 90-day expiry window", async () => {
    getCredentials.mockResolvedValueOnce({ apiKey: TOKEN });

    const result = await saveTailscaleConnection({ apiKey: TOKEN });

    // The return value and the persisted row both carry the new fields.
    const persisted = CONFIG_STORE.tailscale as {
      tokenSetAt?: string;
      tokenExpiresAt?: string;
    };
    expect(result.tokenSetAt).toBe(result.lastValidatedAt);
    expect(persisted.tokenSetAt).toBe(result.tokenSetAt);
    expect(result.tokenExpiresAt).toBe(persisted.tokenExpiresAt);

    // Expiry is exactly the 90-day max age out from the set-date.
    const setAtMs = new Date(result.tokenSetAt as string).getTime();
    const expiryMs = new Date(result.tokenExpiresAt as string).getTime();
    expect(expiryMs - setAtMs).toBe(TAILSCALE_TOKEN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  });

  it("non-empty but DIFFERENT read-back is a mismatch → full rollback + throw", async () => {
    // A non-empty key that differs from the submitted one must still fail
    // (equality, not mere presence).
    getCredentials.mockResolvedValueOnce({ apiKey: "tskey-api-DIFFERENT_VALUE" });

    await expect(saveTailscaleConnection({ apiKey: TOKEN })).rejects.toThrow(/did not match/);

    // Rollback scrubs BOTH the Nango connection AND the eagerly-saved record.
    expect(deleteConnection).toHaveBeenCalledWith(PROVIDER_KEY, PROVIDER_KEY);
    expect(clearConnectionRecords).toHaveBeenCalledWith("tailscale");
    // Rollback wipes local state to {} (never leaves a partial/connected row).
    expect(CONFIG_STORE.tailscale).toEqual({});
  });

  it("re-save over an EXISTING connection that fails read-back wipes stale local state", async () => {
    // Pre-seed an already-connected workspace. A failed re-save must not leave
    // connector_config:tailscale reporting connected:true while the Nango
    // credential + pointer have been rolled back (split-brain the UI would show
    // as connected-with-no-credential).
    CONFIG_STORE.tailscale = {
      connected: true,
      tailnet: "old-tailnet.ts.net",
      cloneTag: "tag:cinatra-clone",
      lastValidatedAt: "2026-05-30T00:00:00Z",
    };
    getCredentials.mockResolvedValueOnce({ apiKey: "tskey-api-DIFFERENT_VALUE" });

    await expect(saveTailscaleConnection({ apiKey: TOKEN })).rejects.toThrow(/did not match/);

    expect(deleteConnection).toHaveBeenCalledWith(PROVIDER_KEY, PROVIDER_KEY);
    expect(clearConnectionRecords).toHaveBeenCalledWith("tailscale");
    // Local state scrubbed — no stale connected:true left behind.
    expect(CONFIG_STORE.tailscale).toEqual({});
  });

  it("missing apiKey on read-back is a mismatch → full rollback + throw", async () => {
    getCredentials.mockResolvedValueOnce({});

    await expect(saveTailscaleConnection({ apiKey: TOKEN })).rejects.toThrow(/did not match/);

    expect(deleteConnection).toHaveBeenCalledWith(PROVIDER_KEY, PROVIDER_KEY);
    expect(clearConnectionRecords).toHaveBeenCalledWith("tailscale");
  });

  it("fail-closed when Nango is unconfigured: no import attempted", async () => {
    isConfigured.mockReturnValue(false);

    await expect(saveTailscaleConnection({ apiKey: TOKEN })).rejects.toThrow(
      /Configure the connection service/,
    );

    expect(importConnection).not.toHaveBeenCalled();
    expect(CONFIG_STORE.tailscale).toBeUndefined();
  });
});
