import "server-only";
import type { Metadata } from "next";
import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";
import { Tabs, TabsContent, TabsListRow, TabsTrigger } from "@cinatra-ai/sdk-ui/tabs";
import { ExternalLink } from "./components/ui/external-link";
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

// Per the extended connector setup-page spec (design/specs/app-connectors.html
// §II), a single-connection connector with no additional config tab shows no
// tablist at all until a tab is added — the reserved, always-LAST Help tab is
// what introduces the tablist here. Composed from the shared
// `@cinatra-ai/sdk-ui` connector-setup + Tabs primitives (no copied
// `tabs.tsx`); header + tablist stay at the Wide column (`max-w-3xl`), the
// existing connect form is untouched inside the Setup tab, and Help narrows to
// the Narrow column (`max-w-xl`), flush-left beneath the tabs.
export async function TailscaleConnectorPageImpl() {
  const status = getTailscaleConnectionStatus();
  const defaultCloneTag = getDefaultTailscaleCloneTag();
  // OAuth-client mode ships FLAG-OFF: only when enabled do we surface the auth-
  // mode toggle + the (non-secret) Connect-UI base URL the browser SDK needs.
  const oauthEnabled = isTailscaleOAuthModeEnabled();
  const oauthFrontend = oauthEnabled ? getTailscaleOAuthFrontendConfig() : null;

  return (
    <ConnectorSetupPage
      title="Tailscale"
      description="Connector setup"
      divider={false}
      className="flex flex-col gap-6 pb-8"
    >
      <Tabs defaultValue="setup" className="w-full">
        <TabsListRow aria-label="Tailscale connector setup">
          <TabsTrigger value="setup">Setup</TabsTrigger>
          {/* Help is RESERVED and ALWAYS LAST. */}
          <TabsTrigger value="help">Help</TabsTrigger>
        </TabsListRow>

        {/* SETUP — the single-connection body. Stays Wide; the existing
            connect/disconnect form is unchanged, just relocated into the tab. */}
        <TabsContent
          value="setup"
          forceMount
          className="mt-6 data-[state=inactive]:hidden"
        >
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
        </TabsContent>

        {/* HELP — reserved, always LAST, read-only (no form, no Save). Narrow. */}
        <TabsContent
          value="help"
          forceMount
          className="mt-6 flex max-w-xl flex-col gap-5 data-[state=inactive]:hidden"
        >
          <p className="text-sm leading-6 text-muted-foreground">
            Connect a Tailscale API access token (or, where enabled, an OAuth
            client) to let Cinatra features that need a public,
            externally-reachable URL — or that need to join the Tailnet —
            provision one automatically. The credential is stored in Nango,
            encrypted at rest, and shared across this Cinatra deployment.
          </p>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              API access token
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Generate one at{" "}
              <ExternalLink href="https://login.tailscale.com/admin/settings/keys">
                login.tailscale.com/admin/settings/keys
              </ExternalLink>{" "}
              → <strong>Generate access token</strong>. Cinatra uses the token
              to mint a tag-scoped, ephemeral auth-key for each clone via the
              Tailscale API — the tag from the Setup tab&apos;s Tag field is
              applied at auth-key mint time, not on the access token itself.
            </p>
          </div>
          {oauthEnabled ? (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">
                OAuth client (recommended)
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">
                In{" "}
                <ExternalLink href="https://login.tailscale.com/admin/settings/trust-credentials">
                  Tailscale → Trust credentials
                </ExternalLink>{" "}
                add a <strong>Credential → OAuth</strong> with{" "}
                <strong>
                  Keys (<code>auth_keys</code>) = Write
                </strong>{" "}
                and the tag attached, then{" "}
                <strong>Generate credential</strong>. Unlike an API token, an
                OAuth client has <strong>no 90-day expiry</strong>.
              </p>
            </div>
          ) : null}
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Tag</h3>
            <p className="text-sm leading-6 text-muted-foreground">
              The tag must start with <code>tag:</code> and already exist as a{" "}
              <code>tagOwners</code> entry in your tailnet policy (e.g. owner{" "}
              <code>autogroup:admin</code>) — add it first if it doesn&apos;t
              exist yet. It is the tag Cinatra features (e.g. the clone
              auto-tunnel) assign to the Tailscale nodes they spawn.{" "}
              {oauthEnabled
                ? "When using an OAuth client, attach this same tag to the OAuth credential above."
                : "For an API access token, the tag is applied when Cinatra mints each clone's auth-key, not on the token itself."}
            </p>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-semibold text-foreground">
              Disconnecting
            </h3>
            <p className="text-sm leading-6 text-muted-foreground">
              Disconnect removes the credential from Nango. For an OAuth
              client, also revoke it in{" "}
              <ExternalLink href="https://login.tailscale.com/admin/settings/trust-credentials">
                Tailscale → Trust credentials
              </ExternalLink>{" "}
              to fully revoke access.
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </ConnectorSetupPage>
  );
}
