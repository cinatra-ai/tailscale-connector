// The tailscale connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerTailscaleConnector` —
// this entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:instance-identity`)
// plus the connector-authored `nango-system` surface (the legacy
// `@cinatra-ai/host:nango-connection-storage` adapter id is retired —
// cinatra#151 Stage 3). Every adapter field resolves the host service LAZILY
// at call time, so activation order against the host's boot imports never
// matters.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostInstanceIdentityService,
  NangoSystemSurface,
} from "@cinatra-ai/sdk-extensions";
import { registerTailscaleConnector, type TailscaleConnectorDeps } from "./deps";
import {
  getTailscaleConnectionStatus,
  getTailscaleFunnelUrlPreview,
  TAILSCALE_OAUTH_FLAG_ENV,
} from "./index";

const PACKAGE_NAME = "@cinatra-ai/tailscale-connector";

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-host-connector-services) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const identity = () =>
    hostService<HostInstanceIdentityService>(ctx, "@cinatra-ai/host:instance-identity");
  // The connector-authored nango-system surface (registered by the nango
  // gateway's own register(ctx) — a systemExtension, required at boot).
  const nango = (): NangoSystemSurface => {
    const provider = ctx.capabilities.resolveProviders("nango-system")[0];
    const surface = provider?.impl as NangoSystemSurface | undefined;
    if (!surface || typeof surface.isNangoConfigured !== "function") {
      throw new Error(
        `${PACKAGE_NAME}: the "nango-system" capability surface is not registered — ` +
          `resolve at call time (post-activation), never at module eval.`,
      );
    }
    return surface;
  };

  // Host/extension boundary (cinatra-ai/cinatra#978): runtime values reach the
  // connector's modules through injected deps, never raw `process.env` reads in
  // runtime code. The dev-instance isolation inputs (the heavy-clone DB URL /
  // light-worktree schema) are captured ONCE here at the composition root —
  // they are immutable per process (the same invariant that makes the hostname
  // derivation pure) — pending a host port that carries the isolation identity.
  const devIsolationInputs = {
    dbUrl: process.env.SUPABASE_DB_URL,
    schema: process.env.SUPABASE_SCHEMA,
  };

  const deps: TailscaleConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    readInstanceIdentity: () => identity().read(),
    // The OAuth-mode flag reads through the ambient `ctx.runtime.flag` host
    // port (host-mediated env access; the host's flag grammar accepts
    // "1"/"true"). Resolved at CALL time like the other host services.
    isOAuthModeEnabled: () => ctx.runtime.flag(TAILSCALE_OAUTH_FLAG_ENV),
    readDevIsolationInputs: () => devIsolationInputs,
    // Members delegate to the nango-system surface at CALL time (the key map
    // is a getter for the same reason). Inputs are cast at this boundary where
    // the surface owns the wider shape (required displayName /
    // NangoConnectorKey union) — this connector only ever passes valid values.
    nango: {
      isConfigured: () => nango().isNangoConfigured(),
      ensureIntegration: (input) =>
        nango().ensureNangoIntegration(input as Parameters<NangoSystemSurface["ensureNangoIntegration"]>[0]),
      importConnection: (input) =>
        nango().importNangoConnection(input as Parameters<NangoSystemSurface["importNangoConnection"]>[0]),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getNangoCredentials(providerConfigKey, connectionId, opts),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteNangoConnection(providerConfigKey, connectionId),
      // Authoritative delete (#23, Design C) — propagates non-404 failures.
      // Cast at the boundary; the nango-system impl exposes it.
      deleteConnectionStrict: (providerConfigKey, connectionId) =>
        (
          nango() as unknown as {
            deleteNangoConnectionStrict(pck: string, connId: string): Promise<void>;
          }
        ).deleteNangoConnectionStrict(providerConfigKey, connectionId),
      clearConnectionRecords: (connectorKey) => nango().clearNangoConnectionRecords(connectorKey),
      // OAuth-client mode (#23, Design C): the Connect-UI session-mint +
      // frontend-config members live on the SAME nango-system surface impl
      // (published by the nango gateway). Cast at this boundary — the SDK type
      // may not declare them, but the impl does (same "cast at boundary"
      // doctrine as the input casts above).
      createConnectSession: (connectorKey) =>
        (
          nango() as unknown as {
            createNangoConnectSession(input: { connectorKey: string }): Promise<string>;
          }
        ).createNangoConnectSession({ connectorKey }),
      getFrontendConfig: () =>
        (
          nango() as unknown as {
            getNangoFrontendConfig(): { baseURL?: string; apiURL?: string };
          }
        ).getNangoFrontendConfig(),
      // Vendor identity is OPEN at the SDK (#12): the surface's key maps are
      // `Record<string, string>` (no SDK-frozen union), so this connector
      // projects ITS OWN keys out of the open map at the boundary.
      get providerConfigKeys() {
        return {
          tailscale: nango().providerConfigKeys.tailscale,
          tailscaleOauth: nango().providerConfigKeys.tailscaleOauth,
        };
      },
    },
  };

  registerTailscaleConnector(deps);

  // Lazy/guarded host-access cutover: the host's development/tunnel
  // surface resolves this connector's local status reads from the capability
  // registry instead of value-importing the package. Pure local-settings
  // reads (no network), so exposing them as a capability impl is safe at
  // activation; absence of this provider degrades the host UI to its
  // "not connected" state.
  ctx.capabilities.registerProvider("dev-tunnel-status", {
    packageName: PACKAGE_NAME,
    impl: {
      getConnectionStatus: () => getTailscaleConnectionStatus(),
      getFunnelUrlPreview: () => getTailscaleFunnelUrlPreview(),
    },
  });
}
