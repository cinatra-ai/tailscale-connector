import "server-only";
import type { Metadata } from "next";
import { Main, PageHeader, PageContent } from "@cinatra-ai/sdk-ui/marketplace";
import { Card, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import {
  getDefaultTailscaleCloneTag,
  getTailscaleConnectionStatus,
  getTailscaleOAuthFrontendConfig,
  isTailscaleOAuthModeEnabled,
} from "./index";
import { TailscaleConnectForm } from "./tailscale-connect-form";

export const metadata: Metadata = { title: "Tailscale | Cinatra" };
export const dynamic = "force-dynamic";

export async function TailscaleConnectorPageImpl() {
  const status = getTailscaleConnectionStatus();
  const defaultCloneTag = getDefaultTailscaleCloneTag();
  // OAuth-client mode ships FLAG-OFF: only when enabled do we surface the auth-
  // mode toggle + the (non-secret) Connect-UI base URL the browser SDK needs.
  const oauthEnabled = isTailscaleOAuthModeEnabled();
  const oauthFrontend = oauthEnabled ? getTailscaleOAuthFrontendConfig() : null;

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
            <CardTitle>
              {oauthEnabled ? "Tailscale connection" : "Tailscale API access token"}
            </CardTitle>
            <CardDescription className="leading-6">
              {oauthEnabled
                ? "Connect with an OAuth client (recommended — no 90-day expiry) or an API access token. Credentials are stored in Nango, encrypted at rest, and shared across this Cinatra deployment."
                : "The token is stored in Nango at the connection level (API_KEY auth mode), encrypted at rest, and shared across this Cinatra deployment."}
            </CardDescription>
          </CardHeader>
          <TailscaleConnectForm
            initialStatus={status}
            defaultCloneTag={defaultCloneTag}
            oauthEnabled={oauthEnabled}
            oauthBaseUrl={oauthFrontend?.baseURL}
            oauthApiUrl={oauthFrontend?.apiURL}
          />
        </Card>
      </PageContent>
    </Main>
  );
}
