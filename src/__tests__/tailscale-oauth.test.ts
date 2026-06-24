// Coverage for the Tailscale OAuth-client (Design C) connector logic:
// flag gating (ships OFF), the Connect-UI session mint, persisting ONLY the
// non-secret connection pointer, mode-aware disconnect (scrub the TWO_STEP
// connection), and that the API-key path stays intact. Nango behaviour is
// injected via the connector deps slot.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  createTailscaleOAuthConnectSession,
  getTailscaleOAuthFrontendConfig,
  isTailscaleOAuthModeEnabled,
  saveTailscaleOAuthConnection,
  clearTailscaleConnection,
  getTailscaleConnectionStatus,
  registerTailscaleConnector,
  _resetTailscaleDepsForTests,
} from "../index";

const OAUTH_PCK = "cinatra-tailscale-oauth";

let CONFIG_STORE: Record<string, unknown> = {};
const isConfigured = vi.fn<() => boolean>();
const deleteConnection = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
// Authoritative delete: resolves on success/404, REJECTS on a real failure.
const deleteConnectionStrict = vi.fn(async (..._a: unknown[]): Promise<void> => undefined);
const clearConnectionRecords = vi.fn(async (..._a: unknown[]): Promise<unknown> => undefined);
const createConnectSession = vi.fn(async (..._a: unknown[]): Promise<string> => "session-token-xyz");
const getFrontendConfig = vi.fn(() => ({ baseURL: "http://localhost:3009", apiURL: "http://localhost:3003" }));
// Disconnect must NEVER read credentials back (that would pull the secret).
const getCredentials = vi.fn(async (..._a: unknown[]): Promise<unknown> => {
  throw new Error("getCredentials must not be called during OAuth disconnect");
});

function enableFlag() {
  process.env.CINATRA_TAILSCALE_OAUTH_ENABLED = "1";
}
function disableFlag() {
  delete process.env.CINATRA_TAILSCALE_OAUTH_ENABLED;
}

beforeEach(() => {
  CONFIG_STORE = {};
  vi.clearAllMocks();
  disableFlag();
  registerTailscaleConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    readInstanceIdentity: () => ({ instanceDisplayName: "test-instance" }),
    nango: {
      isConfigured,
      ensureIntegration: vi.fn(async () => undefined),
      importConnection: vi.fn(async () => undefined),
      getCredentials,
      deleteConnection,
      deleteConnectionStrict,
      clearConnectionRecords,
      createConnectSession,
      getFrontendConfig,
      providerConfigKeys: { tailscale: "cinatra-tailscale", tailscaleOauth: OAUTH_PCK },
    },
  });
  isConfigured.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetTailscaleDepsForTests();
  disableFlag();
});

describe("flag gating (ships OFF)", () => {
  it("isTailscaleOAuthModeEnabled is false by default, true for 1/true/on", () => {
    expect(isTailscaleOAuthModeEnabled()).toBe(false);
    for (const v of ["1", "true", "on", "TRUE"]) {
      process.env.CINATRA_TAILSCALE_OAUTH_ENABLED = v;
      expect(isTailscaleOAuthModeEnabled()).toBe(true);
    }
    process.env.CINATRA_TAILSCALE_OAUTH_ENABLED = "0";
    expect(isTailscaleOAuthModeEnabled()).toBe(false);
  });

  it("the OAuth server functions REFUSE when the flag is off", async () => {
    await expect(createTailscaleOAuthConnectSession()).rejects.toMatchObject({
      code: "tailscale.oauth_disabled",
    });
    await expect(
      saveTailscaleOAuthConnection({ connectionId: "c1", cloneTag: "tag:cinatra-clone" }),
    ).rejects.toMatchObject({ code: "tailscale.oauth_disabled" });
    expect(createConnectSession).not.toHaveBeenCalled();
  });
});

describe("createTailscaleOAuthConnectSession", () => {
  it("mints a session token for the tailscaleOauth integration when enabled", async () => {
    enableFlag();
    const token = await createTailscaleOAuthConnectSession();
    expect(token).toBe("session-token-xyz");
    expect(createConnectSession).toHaveBeenCalledWith("tailscaleOauth");
  });

  it("throws nango_unconfigured when Nango isn't configured", async () => {
    enableFlag();
    isConfigured.mockReturnValue(false);
    await expect(createTailscaleOAuthConnectSession()).rejects.toMatchObject({
      code: "tailscale.nango_unconfigured",
    });
  });
});

describe("getTailscaleOAuthFrontendConfig", () => {
  it("returns the non-secret Connect-UI baseURL + apiURL + provider config key", () => {
    const cfg = getTailscaleOAuthFrontendConfig();
    expect(cfg).toEqual({
      baseURL: "http://localhost:3009",
      apiURL: "http://localhost:3003",
      providerConfigKey: OAUTH_PCK,
    });
  });

  it("passes through an EMPTY host frontend config (hosted Nango Cloud) — the SDK defaults its URLs", () => {
    getFrontendConfig.mockReturnValueOnce({} as { baseURL?: string; apiURL?: string });
    const cfg = getTailscaleOAuthFrontendConfig();
    // baseURL/apiURL absent ⇒ the form omits them ⇒ @nangohq/frontend uses its
    // Nango Cloud defaults (the connector must NOT block on a missing baseURL).
    expect(cfg).toEqual({ baseURL: undefined, apiURL: undefined, providerConfigKey: OAUTH_PCK });
  });
});

describe("saveTailscaleOAuthConnection", () => {
  it("persists ONLY non-secret pointers (authMode/oauthConnectionId/cloneTag) — no secret stored", async () => {
    enableFlag();
    const status = await saveTailscaleOAuthConnection({
      connectionId: "conn-uuid-123",
      cloneTag: "tag:my-clone",
    });
    expect(status).toMatchObject({ connected: true, authMode: "oauth", cloneTag: "tag:my-clone" });

    const persisted = CONFIG_STORE["tailscale"] as Record<string, unknown>;
    expect(persisted).toMatchObject({
      authMode: "oauth",
      oauthConnectionId: "conn-uuid-123",
      oauthProviderConfigKey: OAUTH_PCK,
      cloneTag: "tag:my-clone",
      connected: true,
    });
    // No secret/token fields ever persisted.
    const blob = JSON.stringify(persisted);
    expect(blob).not.toMatch(/secret|clientSecret|tskey-|apiKey|accessToken/i);
    // OAuth has no 90-day clock → no token-expiry fields.
    expect(persisted.tokenSetAt).toBeUndefined();
    expect(persisted.tokenExpiresAt).toBeUndefined();
  });

  it("rejects a missing connection id or a non-tag clone tag", async () => {
    enableFlag();
    await expect(
      saveTailscaleOAuthConnection({ connectionId: "  ", cloneTag: "tag:x" }),
    ).rejects.toMatchObject({ code: "tailscale.invalid_client" });
    await expect(
      saveTailscaleOAuthConnection({ connectionId: "c1", cloneTag: "not-a-tag" }),
    ).rejects.toMatchObject({ code: "tailscale.invalid_client" });
  });

  it("getTailscaleConnectionStatus reflects the OAuth mode", async () => {
    enableFlag();
    await saveTailscaleOAuthConnection({ connectionId: "c1", cloneTag: "tag:cinatra-clone" });
    const status = getTailscaleConnectionStatus();
    expect(status.connected).toBe(true);
    expect(status.authMode).toBe("oauth");
  });
});

describe("clearTailscaleConnection — mode aware", () => {
  it("OAuth mode: AUTHORITATIVE delete (strict) scrubs the connection, never reads creds, wipes local", async () => {
    enableFlag();
    await saveTailscaleOAuthConnection({ connectionId: "conn-uuid-123", cloneTag: "tag:cinatra-clone" });
    await clearTailscaleConnection();
    expect(deleteConnectionStrict).toHaveBeenCalledWith(OAUTH_PCK, "conn-uuid-123");
    // Never the secret-bearing read-back, never the API-key pointer-record path.
    expect(getCredentials).not.toHaveBeenCalled();
    expect(clearConnectionRecords).not.toHaveBeenCalled();
    expect(CONFIG_STORE["tailscale"]).toEqual({});
  });

  it("OAuth mode: a real (non-404) delete failure PROPAGATES and RETAINS the local pointer", async () => {
    enableFlag();
    await saveTailscaleOAuthConnection({ connectionId: "conn-uuid-123", cloneTag: "tag:cinatra-clone" });
    deleteConnectionStrict.mockRejectedValueOnce(new Error("nango 503"));
    await expect(clearTailscaleConnection()).rejects.toThrow();
    // Pointer RETAINED so the operator can retry — no false "disconnected".
    expect(CONFIG_STORE["tailscale"]).toMatchObject({ authMode: "oauth", oauthConnectionId: "conn-uuid-123" });
  });

  it("API-key mode (default row): keeps the legacy delete + clearConnectionRecords path", async () => {
    // No authMode persisted ⇒ legacy api-key behaviour.
    CONFIG_STORE["tailscale"] = { connected: true, cloneTag: "tag:cinatra-clone" };
    await clearTailscaleConnection();
    expect(deleteConnection).toHaveBeenCalledWith("cinatra-tailscale", "cinatra-tailscale");
    expect(clearConnectionRecords).toHaveBeenCalledWith("tailscale");
  });
});
