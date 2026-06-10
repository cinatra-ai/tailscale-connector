"use client";

import { useState, useTransition } from "react";
import { Hash, KeyRound, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "./components/ui/alert";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { CardContent, CardFooter } from "./components/ui/card";
import { Field, FieldDescription, FieldLabel } from "./components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput } from "./components/ui/input-group";
import { useNotify } from "@cinatra-ai/sdk-ui";
import {
  clearTailscaleConnectionAction,
  saveTailscaleConnectionAction,
} from "./tailscale-setup-actions";
import {
  tailscaleConnectFailureNotice,
  tailscaleDisconnectFailureNotice,
} from "./tailscale-error-copy";

type TailscaleStatusProp = {
  connected: boolean;
  tailnet?: string;
  cloneTag?: string;
  lastValidatedAt?: string;
};

type Props = {
  initialStatus: TailscaleStatusProp;
  defaultCloneTag: string;
};

export function TailscaleConnectForm({ initialStatus, defaultCloneTag }: Props) {
  const { addNotification } = useNotify();
  const [status, setStatus] = useState<TailscaleStatusProp>(initialStatus);
  const [apiKey, setApiKey] = useState("");
  const [cloneTag, setCloneTag] = useState(defaultCloneTag);
  const [isPending, startTransition] = useTransition();
  // Friendly copy only — failed action results carry raw server-side error
  // strings (returned, not thrown, so prod masking never applies); the raw
  // `result.error` must never reach the alert or a toast.
  const [friendlyError, setFriendlyError] = useState<string | null>(null);

  const canSubmit =
    apiKey.trim().length > 0 && cloneTag.trim().startsWith("tag:");

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
        body: "API token removed from Nango.",
        kind: "success",
      });
    });
  }

  return (
    <>
      <CardContent className="flex flex-col gap-4">
        {status.connected ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-success/15 text-success">
                <ShieldCheck className="mr-1 h-3 w-3" />
                Connected
              </Badge>
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
            </dl>
          </div>
        ) : (
          <>
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
