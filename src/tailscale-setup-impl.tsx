import "server-only";
import type { Metadata } from "next";
import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Card, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  getDefaultTailscaleCloneTag,
  getTailscaleConnectionStatus,
} from "./index";
import { TailscaleConnectForm } from "./tailscale-connect-form";

export const metadata: Metadata = { title: "Tailscale | Cinatra" };
export const dynamic = "force-dynamic";

export async function TailscaleConnectorPageImpl() {
  const status = getTailscaleConnectionStatus();
  const defaultCloneTag = getDefaultTailscaleCloneTag();

  return (
    <Main className="min-h-screen">
      <PageHeader
        title="Tailscale"
        description="Connect a Tailscale API access token to enable Cinatra features that need a public, externally-reachable URL or that join the Tailnet."
        className="max-w-3xl"
      />
      <PageContent className="max-w-3xl flex flex-col gap-6 pb-8">
        <Card className="border-line bg-surface backdrop-blur-none">
          <CardHeader>
            <CardTitle>Tailscale API access token</CardTitle>
            <CardDescription className="leading-6">
              The token is stored in Nango at the connection level (API_KEY
              auth mode), encrypted at rest, and shared across this Cinatra
              deployment.
            </CardDescription>
          </CardHeader>
          <TailscaleConnectForm initialStatus={status} defaultCloneTag={defaultCloneTag} />
        </Card>
      </PageContent>
    </Main>
  );
}
