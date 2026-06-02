// Tailscale connector setup page dispatch route.
// Wraps the shared page implementation for the connector setup UI.

import { TailscaleConnectorPageImpl } from "./tailscale-setup-impl";

type ConnectorSetupPageProps = {
  packageId: string;
  slug: string;
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function TailscaleConnectorSetupPage(
  _props: ConnectorSetupPageProps,
) {
  return TailscaleConnectorPageImpl();
}
