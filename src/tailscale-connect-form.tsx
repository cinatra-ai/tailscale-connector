"use client";

import { useState, useTransition } from "react";
import { Clock, Hash, KeyRound, ShieldCheck, Fingerprint } from "lucide-react";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { CardContent, CardFooter } from "./components/ui/card";
import { Field, FieldDescription, FieldLabel } from "./components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./components/ui/input-group";
import { useNotify } from "@cinatra-ai/sdk-ui";
import {
  clearTailscaleConnectionAction,
  createTailscaleOAuthConnectSessionAction,
  saveTailscaleConnectionAction,
  saveTailscaleOAuthConnectionAction,
} from "./tailscale-setup-actions";
import {
  tailscaleConnectFailureNotice,
  tailscaleDisconnectFailureNotice,
} from "./tailscale-error-copy";
import { describeTailscaleTokenExpiry } from "./tailscale-token-expiry.mjs";

type TailscaleStatusProp = {
  connected: boolean;
  authMode?: "api_key" | "oauth";
  tailnet?: string;
  cloneTag?: string;
  lastValidatedAt?: string;
  tokenSetAt?: string;
  tokenExpiresAt?: string;
};

/**
 * Inline copy for the token-expiry reminder. Mirrors the connector's existing
 * inline-guidance pattern (amber `warning` as expiry approaches, red
 * `destructive` once lapsed) so a stale token surfaces in the UI BEFORE the
 * background clone auto-tunnel silently stops working.
 */
function tokenExpiryNotice(expiresAt: string | undefined): {
  variant: "warning" | "destructive";
  body: string;
} | null {
  const { status, daysRemaining } = describeTailscaleTokenExpiry(expiresAt);
  if (status === "expired") {
    return {
      variant: "destructive",
      body: "This Tailscale API token has expired. Clone auto-tunnels can no longer mint auth-keys — generate a fresh token and reconnect below.",
    };
  }
  if (status === "warning" && typeof daysRemaining === "number") {
    const dayLabel = daysRemaining === 1 ? "1 day" : `${daysRemaining} days`;
    return {
      variant: "warning",
      body: `This Tailscale API token expires in ${dayLabel}. Generate a fresh token and reconnect before then to keep clone auto-tunnels working.`,
    };
  }
  return null;
}

type Props = {
  initialStatus: TailscaleStatusProp;
  defaultCloneTag: string;
  /** OAuth-client mode is flag-gated; when false the form is API-key-only (unchanged). */
  oauthEnabled?: boolean;
  /** Nango Connect-UI host URL (`baseURL`) for `@nangohq/frontend` (non-secret). */
  oauthBaseUrl?: string;
  /** Nango API URL (`apiURL`) for `@nangohq/frontend` (non-secret). */
  oauthApiUrl?: string;
};

export function TailscaleConnectForm({
  initialStatus,
  defaultCloneTag,
  oauthEnabled = false,
  oauthBaseUrl,
  oauthApiUrl,
}: Props) {
  const { addNotification } = useNotify();
  const [status, setStatus] = useState<TailscaleStatusProp>(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [cloneTag, setCloneTag] = useState(defaultCloneTag);
  // Auth-mode toggle (only meaningful when oauthEnabled). Default to the
  // recommended OAuth mode for a fresh connect; ignored entirely when the flag
  // is off (the API-key path renders exactly as before).
  const [mode, setMode] = useState<"oauth" | "api_key">(oauthEnabled ? "oauth" : "api_key");
  const [isPending, startTransition] = useTransition();
  const [oauthConnecting, setOauthConnecting] = useState(false);
  // Friendly copy only — failed action results carry raw server-side error
  // strings (returned, not thrown, so prod masking never applies); the raw
  // `result.error` must never reach the alert or a toast.
  const [friendlyError, setFriendlyError] = useState<string | null>(null);

  const canSubmit =
    apiKey.trim().length > 0 && cloneTag.trim().startsWith("tag:");
  const canOAuthConnect = cloneTag.trim().startsWith("tag:") && !oauthConnecting;

  // OAuth-client connect: open Nango's hosted Connect UI (an iframe; the
  // operator enters the client_id/secret THERE — it never transits this app),
  // then persist only the non-secret connection id. `openConnectUI` mounts the
  // iframe and the session token is fetched and applied immediately after.
  function handleOAuthConnect() {
    setFriendlyError(null);
    setOauthConnecting(true);
    const tag = cloneTag.trim();
    void (async () => {
      let connectUI: { setSessionToken: (t: string) => void; close: () => void } | null = null;
      try {
        const NangoMod = await import("@nangohq/frontend");
        const Nango = NangoMod.default;
        const nango = new Nango();
        // Pass Connect-UI URLs only when configured (self-hosted Nango). When
        // absent (hosted Nango Cloud), `@nangohq/frontend` defaults to its Cloud
        // URLs — so we must NOT block on a missing baseURL.
        connectUI = nango.openConnectUI({
          ...(oauthBaseUrl ? { baseURL: oauthBaseUrl } : {}),
          ...(oauthApiUrl ? { apiURL: oauthApiUrl } : {}),
          onEvent: (event: { type: string; payload?: { connectionId?: string } }) => {
            if (event.type === "connect" && event.payload?.connectionId) {
              const connectionId = event.payload.connectionId;
              startTransition(async () => {
                const saved = await saveTailscaleOAuthConnectionAction({ connectionId, cloneTag: tag });
                if (!saved.ok) {
                  setFriendlyError(saved.error);
                  addNotification({ title: "Tailscale OAuth save failed", body: saved.error, kind: "error" });
                  return;
                }
                setStatus(saved.status);
                addNotification({
                  title: "Tailscale connected (OAuth)",
                  body: "OAuth client connected. Clone auto-tunnels will mint keys via Nango — no 90-day token expiry.",
                  kind: "success",
                });
              });
              connectUI?.close();
            } else if (event.type === "error") {
              setFriendlyError("Tailscale OAuth connection did not complete.");
            }
          },
        });
        const session = await createTailscaleOAuthConnectSessionAction();
        if (!session.ok) {
          setFriendlyError(session.error);
          addNotification({ title: "Tailscale OAuth unavailable", body: session.error, kind: "error" });
          connectUI?.close();
          return;
        }
        connectUI.setSessionToken(session.token);
      } catch {
        // Never surface raw SDK/network detail.
        setFriendlyError("Could not open the Tailscale OAuth connection dialog.");
        connectUI?.close();
      } finally {
        setOauthConnecting(false);
      }
    })();
  }

  const expiryNotice = status.connected
    ? tokenExpiryNotice(status.tokenExpiresAt)
    : null;

  function handleConnect() {
    setFriendlyError(null);
    startTransition(async () => {
      const result = await saveTailscaleConnectionAction({
        apiKey: apiKey.trim(),
        cloneTag: cloneTag.trim(),
      });
      if (!result.ok) {
        const notice = tailscaleConnectFailureNotice(result);
        setFriendlyError(notice.body);
        addNotification({
          title: notice.title,
          body: notice.body,
          kind: "error",
        });
        return;
      }
      setStatus(result.status);
      setApiKey("");
      const tn = result.status.tailnet;
      const tnLabel = !tn || tn === "-" ? "the token's home tailnet" : `tailnet ${tn}`;
      addNotification({
        title: "Tailscale connected",
        body: `Stored API token for ${tnLabel}.`,
        kind: "success",
      });
    });
  }

  function handleDisconnect() {
    setFriendlyError(null);
    const wasOauth = status.authMode === "oauth";
    startTransition(async () => {
      const result = await clearTailscaleConnectionAction();
      if (!result.ok) {
        const notice = tailscaleDisconnectFailureNotice(result);
        setFriendlyError(notice.body);
        addNotification({
          title: notice.title,
          body: notice.body,
          kind: "error",
        });
        return;
      }
      setStatus({ connected: false });
      addNotification({
        title: "Tailscale disconnected",
        body: wasOauth
          ? "OAuth connection removed from Nango. Remember to also revoke the OAuth client in Tailscale → OAuth clients."
          : "API token removed from Nango.",
        kind: "success",
      });
    });
  }

  return (
    <>
      <CardContent className="flex flex-col gap-4">
        {status.connected ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-success/15 text-success">
                <ShieldCheck className="mr-1 h-3 w-3" />
                Connected
              </Badge>
              {/* Auth-mode badge only when OAuth mode is enabled — flag-OFF keeps
                  the connected view byte-for-byte unchanged for API-key users. */}
              {oauthEnabled ? (
                <Badge variant="outline">
                  {status.authMode === "oauth" ? (
                    <>
                      <Fingerprint className="mr-1 h-3 w-3" />
                      OAuth client
                    </>
                  ) : (
                    <>
                      <KeyRound className="mr-1 h-3 w-3" />
                      API token
                    </>
                  )}
                </Badge>
              ) : null}
              {expiryNotice ? (
                <Badge
                  variant={
                    expiryNotice.variant === "destructive"
                      ? "destructive"
                      : "warning"
                  }
                >
                  <Clock className="mr-1 h-3 w-3" />
                  {expiryNotice.variant === "destructive"
                    ? "Token expired"
                    : "Token expiring"}
                </Badge>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              {status.tailnet ? (
                <>
                  <dt className="text-muted-foreground">Tailnet</dt>
                  <dd>
                    <code className="rounded bg-surface-strong px-1 py-0.5 text-xs">
                      {status.tailnet === "-"
                        ? "token's home tailnet"
                        : status.tailnet}
                    </code>
                  </dd>
                </>
              ) : null}
              {status.cloneTag ? (
                <>
                  <dt className="text-muted-foreground">Tag</dt>
                  <dd>
                    <code className="rounded bg-surface-strong px-1 py-0.5 text-xs">
                      {status.cloneTag}
                    </code>
                  </dd>
                </>
              ) : null}
              {status.lastValidatedAt ? (
                <>
                  <dt className="text-muted-foreground">Last validated</dt>
                  <dd className="text-xs text-muted-foreground">
                    <time dateTime={status.lastValidatedAt}>
                      {new Date(status.lastValidatedAt).toLocaleString()}
                    </time>
                  </dd>
                </>
              ) : null}
              {status.tokenExpiresAt ? (
                <>
                  <dt className="text-muted-foreground">Token expires</dt>
                  <dd className="text-xs text-muted-foreground">
                    <time dateTime={status.tokenExpiresAt}>
                      {new Date(status.tokenExpiresAt).toLocaleDateString()}
                    </time>
                  </dd>
                </>
              ) : null}
            </dl>
            {expiryNotice ? (
              <Alert variant={expiryNotice.variant === "destructive" ? "destructive" : "warning"}>
                <Clock aria-hidden="true" />
                <AlertDescription>{expiryNotice.body}</AlertDescription>
              </Alert>
            ) : null}
            {status.authMode === "oauth" ? (
              <Alert>
                <Fingerprint aria-hidden="true" />
                <AlertDescription>
                  Disconnecting removes the connection from Nango but does{" "}
                  <strong>not</strong> revoke the OAuth client — also delete it
                  in{" "}
                  <a
                    href="https://login.tailscale.com/admin/settings/oauth"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    Tailscale → OAuth clients
                  </a>{" "}
                  to fully revoke access.
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
        ) : (
          <>
            {oauthEnabled ? (
              <div
                role="tablist"
                aria-label="Tailscale auth mode"
                className="inline-flex w-fit gap-1 rounded-lg bg-surface-strong p-1"
              >
                <Button
                  type="button"
                  role="tab"
                  aria-selected={mode === "oauth"}
                  variant={mode === "oauth" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMode("oauth");
                    setFriendlyError(null);
                  }}
                >
                  <Fingerprint className="mr-1 h-3 w-3" aria-hidden="true" />
                  OAuth client
                </Button>
                <Button
                  type="button"
                  role="tab"
                  aria-selected={mode === "api_key"}
                  variant={mode === "api_key" ? "default" : "ghost"}
                  size="sm"
                  onClick={() => {
                    setMode("api_key");
                    setFriendlyError(null);
                  }}
                >
                  <KeyRound className="mr-1 h-3 w-3" aria-hidden="true" />
                  API access token
                </Button>
              </div>
            ) : null}
            {mode === "oauth" && oauthEnabled ? (
              <Field>
                <FieldLabel>OAuth client (recommended)</FieldLabel>
                <FieldDescription className="leading-6">
                  Create an OAuth client at{" "}
                  <a
                    href="https://login.tailscale.com/admin/settings/oauth"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    login.tailscale.com/admin/settings/oauth
                  </a>{" "}
                  with scope <code>auth_keys</code> and the tag below attached.
                  Click <strong>Connect OAuth client</strong> — you&apos;ll enter
                  the <strong>client ID + secret</strong> in Tailscale&apos;s
                  connection service dialog (they are stored encrypted in Nango
                  and never touch Cinatra). Unlike an API token, an OAuth client
                  has <strong>no 90-day expiry</strong>.
                </FieldDescription>
              </Field>
            ) : (
            <Field>
              <FieldLabel htmlFor="tailscaleApiKey">API access token</FieldLabel>
              <InputGroup className="max-w-xl">
                <InputGroupAddon>
                  <KeyRound aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="tailscaleApiKey"
                  type="password"
                  placeholder="tskey-api-…"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </InputGroup>
              <FieldDescription className="leading-6">
                Generate at{" "}
                <a
                  href="https://login.tailscale.com/admin/settings/keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline underline-offset-4 hover:text-foreground"
                >
                  login.tailscale.com/admin/settings/keys
                </a>
                . Click <strong>Generate access token</strong> and, on the
                token creation page, set <strong>Tags</strong> to whichever
                tag you enter below. If the tag doesn&apos;t exist yet, open
                Access Controls and add a <code>tagOwners</code> entry first
                (e.g. owner <code>autogroup:admin</code>).
              </FieldDescription>
            </Field>
            )}
            <Field>
              <FieldLabel htmlFor="tailscaleCloneTag">Tag</FieldLabel>
              <InputGroup className="max-w-xl">
                <InputGroupAddon>
                  <Hash aria-hidden="true" />
                </InputGroupAddon>
                <InputGroupInput
                  id="tailscaleCloneTag"
                  type="text"
                  placeholder="tag:cinatra-clone"
                  value={cloneTag}
                  onChange={(e) => setCloneTag(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </InputGroup>
              <FieldDescription>
                Must start with <code>tag:</code>. This is the tag Cinatra
                features (e.g. clone auto-tunnel) will assign to the
                Tailscale nodes they spawn. Must match a <code>tagOwners</code>{" "}
                entry in your tailnet policy file AND match the Tags scope
                on the API token above.
              </FieldDescription>
            </Field>
          </>
        )}
        {friendlyError ? (
          <Alert variant="destructive">
            <AlertDescription>{friendlyError}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        {status.connected ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleDisconnect}
            disabled={isPending}
          >
            {isPending ? "Disconnecting…" : "Disconnect"}
          </Button>
        ) : mode === "oauth" && oauthEnabled ? (
          <Button
            type="button"
            onClick={handleOAuthConnect}
            disabled={isPending || !canOAuthConnect}
          >
            {oauthConnecting || isPending ? "Connecting…" : "Connect OAuth client"}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={handleConnect}
            disabled={isPending || !canSubmit}
          >
            {isPending ? "Connecting…" : "Connect"}
          </Button>
        )}
      </CardFooter>
    </>
  );
}
