// Host dependency injection for the tailscale connector.
//
// Decouples the connector from host-internal modules (`@/lib/database`
// connector-config, `@/lib/instance-identity-store`). The host binds concrete
// impls at boot via `registerTailscaleConnector(deps)`; runtime functions
// resolve them via `getTailscaleDeps()`.
//
// The deps slot is anchored on `globalThis` via a namespaced+versioned Symbol so
// the boot-time registration and the runtime callers — which live in
// SEPARATELY-COMPILED Next.js bundles (the /connectors page, the connector setup
// page, server actions) that do NOT import the registrar — resolve the SAME
// slot. A plain module-local binding would leave those bundles' instance
// unregistered → getTailscaleDeps() would throw. (Same reason as the SDK
// action-guard + apify/gemini deps + email-connector registry.)

/**
 * Structural shape of the Nango connection-storage surface tailscale uses.
 * Inlined (NOT imported from `@cinatra-ai/nango-connector`) so the connector
 * carries no non-SDK `@cinatra-ai/*` code dependency — the host binds the
 * concrete impls (sourced from the nango-connector extension) at boot. Returns
 * are kept permissive (`unknown`); the connector reads the credential readback
 * through its own structural `"apiKey" in readBack` guard.
 */
export interface TailscaleNangoCapability {
  /** True when the workspace has Nango configured (credentials present). */
  isConfigured(): boolean;
  /** Ensure the provider-config (integration) row exists. */
  ensureIntegration(input: {
    provider: string;
    providerConfigKey: string;
    displayName?: string;
  }): Promise<unknown>;
  /** Upsert a connection record by (providerConfigKey, connectionId). */
  importConnection(input: {
    connectorKey?: "tailscale";
    providerConfigKey: string;
    connectionId: string;
    credentials: { type: string; apiKey: string };
    connectionConfig?: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }): Promise<unknown>;
  /** Read back the stored credentials. `forceRefresh` bypasses Nango's cache so
   *  write-then-read-back verification reads the JUST-written credential. */
  getCredentials(
    providerConfigKey: string,
    connectionId: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<unknown>;
  /** Delete the Nango connection (scrubs stored credentials). Best-effort/idempotent. */
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<unknown>;
  /**
   * AUTHORITATIVE delete: scrubs the Nango connection and PROPAGATES a real
   * (non-404) failure so the caller can retain its pointer + report failure
   * instead of falsely reporting "disconnected" while the credential lingers.
   * A 404 / already-gone connection resolves successfully (idempotent).
   */
  deleteConnectionStrict(providerConfigKey: string, connectionId: string): Promise<void>;
  /** Clear the cinatra-side pointer rows for this connector. */
  clearConnectionRecords(connectorKey: "tailscale"): Promise<unknown>;
  /**
   * Mint a Nango Connect-UI session token for the OAuth-client mode
   * (cinatra-ai/tailscale-connector#23, Design C). The token scopes the hosted
   * Connect UI to the `tailscaleOauth` integration so the operator enters the
   * OAuth client_id/secret in Nango's UI — the secret never transits this app.
   */
  createConnectSession(connectorKey: "tailscaleOauth"): Promise<string>;
  /**
   * Nango frontend config for `@nangohq/frontend`'s `openConnectUI`:
   * `baseURL` = the Connect-UI host (e.g. :3009), `apiURL` = the Nango API
   * (e.g. :3003). Both non-secret.
   */
  getFrontendConfig(): { baseURL?: string; apiURL?: string };
  /** Provider-config-key bag — only this connector's slugs are exposed. */
  providerConfigKeys: { tailscale: string; tailscaleOauth: string };
}

export interface TailscaleConnectorDeps {
  /** Read this connector's persisted settings (raw connectorId key). */
  readConnectorConfigFromDatabase: <T>(connectorId: string, fallback: T) => T;
  /** Write this connector's persisted settings. */
  writeConnectorConfigToDatabase: (connectorId: string, value: unknown) => void;
  /** This deployment's instance identity (the `@/lib/instance-identity-store` surface).
   *  Typed structurally to the only field tailscale reads — keeps deps leaf. */
  readInstanceIdentity: () => { instanceDisplayName?: string | null } | null;
  /**
   * True when the OAuth-client auth mode (Design C) is enabled for this
   * deployment (default OFF). Host-mediated: `register(ctx)` binds this to the
   * ambient `ctx.runtime.flag` port — runtime connector code never reads
   * `process.env` directly (host/extension boundary, cinatra-ai/cinatra#978).
   */
  isOAuthModeEnabled: () => boolean;
  /**
   * The immutable dev-instance isolation inputs the deterministic Tailscale
   * device hostname derives from (heavy-clone DB URL / light-worktree schema).
   * Injected at the `register(ctx)` composition root like every other host
   * value — runtime connector code never reads `process.env` directly.
   */
  readDevIsolationInputs: () => { dbUrl?: string; schema?: string };
  /** Nango connection-storage surface (host-bound from the nango-connector extension). */
  nango: TailscaleNangoCapability;
}

const TAILSCALE_DEPS_KEY = Symbol.for("@cinatra-ai/tailscale-connector:host-deps/v1");
type DepsHolder = { [k: symbol]: TailscaleConnectorDeps | null | undefined };
const _holder = globalThis as unknown as DepsHolder;

/**
 * Wire the host's runtime deps. Called once at boot
 * (src/lib/register-transport-connectors.ts). Re-calling replaces — tests swap stubs.
 */
export function registerTailscaleConnector(deps: TailscaleConnectorDeps): void {
  _holder[TAILSCALE_DEPS_KEY] = deps;
}

export function getTailscaleDeps(): TailscaleConnectorDeps {
  const deps = _holder[TAILSCALE_DEPS_KEY];
  if (!deps) {
    throw new Error(
      "@cinatra-ai/tailscale-connector: host runtime deps not registered. " +
        "Call registerTailscaleConnector(deps) at boot.",
    );
  }
  return deps;
}

/** @internal test-only. */
export function _resetTailscaleDepsForTests(): void {
  _holder[TAILSCALE_DEPS_KEY] = null;
}
