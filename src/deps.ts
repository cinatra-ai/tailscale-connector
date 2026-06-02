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
  /** Delete the Nango connection (scrubs stored credentials). */
  deleteConnection(providerConfigKey: string, connectionId: string): Promise<unknown>;
  /** Clear the cinatra-side pointer rows for this connector. */
  clearConnectionRecords(connectorKey: "tailscale"): Promise<unknown>;
  /** Provider-config-key bag — only this connector's slug is exposed. */
  providerConfigKeys: { tailscale: string };
}

export interface TailscaleConnectorDeps {
  /** Read this connector's persisted settings (raw connectorId key). */
  readConnectorConfigFromDatabase: <T>(connectorId: string, fallback: T) => T;
  /** Write this connector's persisted settings. */
  writeConnectorConfigToDatabase: (connectorId: string, value: unknown) => void;
  /** This deployment's instance identity (the `@/lib/instance-identity-store` surface).
   *  Typed structurally to the only field tailscale reads — keeps deps leaf. */
  readInstanceIdentity: () => { instanceDisplayName?: string | null } | null;
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
