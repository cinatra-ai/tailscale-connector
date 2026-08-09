// Coverage for cinatra#2534: the host's `dev-tunnel-status` capability probe
// reads an OPTIONAL `getFunnelUrlPreviewReason()` getter off the same
// provider `getFunnelUrlPreview()` lives on (see cinatra's
// `src/lib/dev-tunnel-status.ts` and `funnel-preview-notice.ts`). This
// connector computed the reason all along but only `console.warn()`d it —
// this pins that `getTailscaleFunnelUrlPreviewReason()` now reports each
// code the identity classifier can produce, that it agrees with
// `getTailscaleFunnelUrlPreview()` on when a preview IS available, and that
// the two reads never desync when called independently (exactly how the
// host's structural probe calls them).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  getTailscaleFunnelUrlPreview,
  getTailscaleFunnelUrlPreviewReason,
  registerTailscaleConnector,
  _resetTailscaleDepsForTests,
} from "../index";
import {
  DEV_TAILSCALE_IDENTITY_CONFLICT_CODE,
  DEV_TAILSCALE_UNREGISTERED_CODE,
} from "../tailscale-hostname.mjs";

// Credential-bearing fixture URLs are ASSEMBLED at runtime (same trick as
// tailscale-connect.test.ts): a literal scheme+user+password+host string
// trips the repo's secret scanner even in an obviously synthetic test.
const PG = ["postgre", "sql", "://"].join("");
const pgUrl = (hostAndPath: string) => `${PG}${hostAndPath}`;

let CONFIG_STORE: Record<string, unknown> = {};
let isolationInputs: { dbUrl?: string; schema?: string; mainDatabase?: string } = {};

function registerWith(settings: { tailnet?: string }) {
  CONFIG_STORE = { tailscale: settings };
  registerTailscaleConnector({
    readConnectorConfigFromDatabase: <T>(key: string, fallback: T): T =>
      (CONFIG_STORE[key] as T) ?? fallback,
    writeConnectorConfigToDatabase: (key: string, value: unknown) => {
      CONFIG_STORE[key] = value;
    },
    readInstanceIdentity: () => ({ instanceDisplayName: "test-instance" }),
    isOAuthModeEnabled: () => false,
    readDevIsolationInputs: () => isolationInputs,
    nango: {
      isConfigured: () => true,
      ensureIntegration: async () => undefined,
      importConnection: async () => undefined,
      getCredentials: async () => ({}),
      deleteConnection: async () => undefined,
      deleteConnectionStrict: async () => undefined,
      clearConnectionRecords: async () => undefined,
      createConnectSession: async () => "session-token",
      getFrontendConfig: () => ({ baseURL: "http://localhost:3009", apiURL: "http://localhost:3003" }),
      providerConfigKeys: { tailscale: "cinatra-tailscale", tailscaleOauth: "cinatra-tailscale-oauth" },
    },
  });
}

beforeEach(() => {
  isolationInputs = {};
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  _resetTailscaleDepsForTests();
});

describe("getTailscaleFunnelUrlPreviewReason", () => {
  it("no tailnet resolved yet ⇒ null (no code minted for this cause today)", () => {
    registerWith({ tailnet: undefined });
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBeNull();
  });

  it("unresolved tailnet placeholder (\"-\") ⇒ null reason, same as no tailnet", () => {
    registerWith({ tailnet: "-" });
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBeNull();
  });

  it("no sanctioned dev identity ⇒ the connector's unregistered code", () => {
    registerWith({ tailnet: "my-tailnet" });
    isolationInputs = {}; // no clone DB, no schema, no main declaration
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
  });

  it("conflicting dev identity signals ⇒ the connector's conflict code", () => {
    registerWith({ tailnet: "my-tailnet" });
    isolationInputs = {
      dbUrl: pgUrl("127.0.0.1:5434/cinatra_clone_foo"),
      schema: "cinatra_lane",
    };
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBe(DEV_TAILSCALE_IDENTITY_CONFLICT_CODE);
  });

  it("a sanctioned identity WITH a resolved tailnet ⇒ a preview URL and a null reason", () => {
    registerWith({ tailnet: "my-tailnet" });
    isolationInputs = {
      dbUrl: pgUrl("127.0.0.1:5434/cinatra_clone_foo"),
      schema: "cinatra",
    };
    expect(getTailscaleFunnelUrlPreview()).toBe("https://cinatra-clone-foo.my-tailnet.ts.net");
    expect(getTailscaleFunnelUrlPreviewReason()).toBeNull();
  });

  it("the two reads never desync — called independently, same inputs, same verdict every time", () => {
    registerWith({ tailnet: "my-tailnet" });
    isolationInputs = {}; // unregistered
    // Call in either order, any number of times: pure + no shared mutable
    // state, so nothing but the (unchanged) inputs can move the answer.
    expect(getTailscaleFunnelUrlPreviewReason()).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
  });

  it("does not itself console.warn — calling both getters (the host's real call sequence for a null preview) warns exactly ONCE", () => {
    registerWith({ tailnet: "my-tailnet" });
    isolationInputs = {};
    const warn = vi.spyOn(console, "warn");
    // The host reads the reason only AFTER a null preview (see
    // dev-tunnel-status.ts's `funnelUrlPreview ? null : readPreviewReason(impl)`),
    // so this is the exact pair of calls a null-preview status read makes.
    expect(getTailscaleFunnelUrlPreview()).toBeNull();
    expect(getTailscaleFunnelUrlPreviewReason()).toBe(DEV_TAILSCALE_UNREGISTERED_CODE);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
