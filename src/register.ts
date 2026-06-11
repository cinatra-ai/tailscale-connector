// The tailscale connector's `register(ctx)` server entry.
//
// Transport-registration cutover: the host no longer statically imports `registerTailscaleConnector` —
// this entry binds the connector's host deps AT ACTIVATION by adapting the
// per-concern host services published in the capability registry
// (`@cinatra-ai/host:connector-config`, `@cinatra-ai/host:instance-identity`,
// `@cinatra-ai/host:nango-connection-storage`). Every adapter field resolves
// the host service LAZILY at call time, so activation order against the host's
// boot imports never matters.
//
// SDK imports here are TYPE-ONLY (host-peer value-import gate): the host
// services arrive as DATA through `ctx.capabilities`.

import type {
  ExtensionHostContext,
  HostConnectorConfigService,
  HostInstanceIdentityService,
  HostNangoConnectionStorageService,
} from "@cinatra-ai/sdk-extensions";
import { registerTailscaleConnector, type TailscaleConnectorDeps } from "./deps";
import { getTailscaleConnectionStatus, getTailscaleFunnelUrlPreview } from "./index";

const PACKAGE_NAME = "@cinatra-ai/tailscale-connector";

function hostService<T>(ctx: ExtensionHostContext, capability: string): T {
  const provider = ctx.capabilities.resolveProviders(capability)[0];
  if (!provider) {
    throw new Error(
      `${PACKAGE_NAME}: host service "${capability}" is not registered — ` +
        `the host boot wiring (register-transport-connectors) must run before connector calls.`,
    );
  }
  return provider.impl as T;
}

export function register(ctx: ExtensionHostContext): void {
  const config = () =>
    hostService<HostConnectorConfigService>(ctx, "@cinatra-ai/host:connector-config");
  const identity = () =>
    hostService<HostInstanceIdentityService>(ctx, "@cinatra-ai/host:instance-identity");
  const nango = () =>
    hostService<HostNangoConnectionStorageService>(
      ctx,
      "@cinatra-ai/host:nango-connection-storage",
    );

  const deps: TailscaleConnectorDeps = {
    readConnectorConfigFromDatabase: (connectorId, fallback) =>
      config().read(connectorId, fallback),
    writeConnectorConfigToDatabase: (connectorId, value) =>
      config().write(connectorId, value),
    readInstanceIdentity: () => identity().read(),
    nango: {
      isConfigured: () => nango().isConfigured(),
      ensureIntegration: (input) => nango().ensureIntegration(input),
      importConnection: (input) => nango().importConnection(input),
      getCredentials: (providerConfigKey, connectionId, opts) =>
        nango().getCredentials(providerConfigKey, connectionId, opts),
      deleteConnection: (providerConfigKey, connectionId) =>
        nango().deleteConnection(providerConfigKey, connectionId),
      clearConnectionRecords: (connectorKey) => nango().clearConnectionRecords(connectorKey),
      get providerConfigKeys() {
        return nango().providerConfigKeys as TailscaleConnectorDeps["nango"]["providerConfigKeys"];
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
