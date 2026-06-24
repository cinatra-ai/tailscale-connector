"use server";

import { revalidatePath } from "next/cache";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import {
  clearTailscaleConnection,
  createTailscaleOAuthConnectSession,
  saveTailscaleConnection,
  saveTailscaleOAuthConnection,
  type TailscaleConnectionStatus,
} from "./index";

/**
 * Save the Tailscale API access token into Nango via the built-in
 * `tailscale-api-key` provider. The token is stored at the connection
 * level because API_KEY auth mode cannot be stored at integration level.
 *
 * Revalidates `/connectors/tailscale` (canonical home), `/connectors`
 * (card grid), and `/configuration/development` (status mirror).
 */
export async function saveTailscaleConnectionAction(input: {
  apiKey: string;
  cloneTag?: string;
}): Promise<
  | { ok: true; status: TailscaleConnectionStatus }
  | { ok: false; error: string; code?: string }
> {
  await requireExtensionAction("@cinatra-ai/tailscale-connector", "manage");
  try {
    const status = await saveTailscaleConnection({
      apiKey: input.apiKey,
      cloneTag: input.cloneTag,
    });
    revalidatePath("/connectors/cinatra-ai/tailscale-connector/setup");
    revalidatePath("/connectors");
    revalidatePath("/configuration/development");
    return { ok: true, status };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    // Returned (not thrown) errors are serialized to the browser verbatim —
    // prod masking never applies — so the raw `err.message` (which wraps
    // upstream Nango/Tailscale detail) must not ride along in the payload.
    // Raw detail stays server-side; the client gets only the typed `code`
    // (mapped to friendly copy in tailscale-error-copy.ts) plus a sanitized
    // generic string.
    console.error("[connector-tailscale] saveTailscaleConnectionAction failed", { code }, err);
    return { ok: false, error: "Tailscale connection save failed.", code };
  }
}

/**
 * Mint a Nango Connect-UI session token for OAuth-client mode. The browser
 * opens Nango's hosted Connect UI with this token; the OAuth secret is entered
 * THERE (never here). Flag-gated server-side. Returns only the token — no
 * Nango/secret detail rides along on failure.
 */
export async function createTailscaleOAuthConnectSessionAction(): Promise<
  | { ok: true; token: string }
  | { ok: false; error: string; code?: string }
> {
  await requireExtensionAction("@cinatra-ai/tailscale-connector", "manage");
  try {
    const token = await createTailscaleOAuthConnectSession();
    return { ok: true, token };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    // Log only the typed code + error NAME — never the raw err (the connect
    // flow handles a session token; raw fetch/Nango errors can carry detail).
    console.error("[connector-tailscale] createTailscaleOAuthConnectSessionAction failed", {
      code,
      name: err instanceof Error ? err.name : typeof err,
    });
    return { ok: false, error: "Could not start the Tailscale OAuth connection.", code };
  }
}

/**
 * Persist the OAuth connection after the operator completed the Nango Connect
 * UI. Stores only the non-secret connectionId + cloneTag. Flag-gated.
 */
export async function saveTailscaleOAuthConnectionAction(input: {
  connectionId: string;
  cloneTag?: string;
}): Promise<
  | { ok: true; status: TailscaleConnectionStatus }
  | { ok: false; error: string; code?: string }
> {
  await requireExtensionAction("@cinatra-ai/tailscale-connector", "manage");
  try {
    const status = await saveTailscaleOAuthConnection({
      connectionId: input.connectionId,
      cloneTag: input.cloneTag,
    });
    revalidatePath("/connectors/cinatra-ai/tailscale-connector/setup");
    revalidatePath("/connectors");
    revalidatePath("/configuration/development");
    return { ok: true, status };
  } catch (err) {
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    console.error("[connector-tailscale] saveTailscaleOAuthConnectionAction failed", {
      code,
      name: err instanceof Error ? err.name : typeof err,
    });
    return { ok: false, error: "Tailscale OAuth connection save failed.", code };
  }
}

/**
 * Disconnect the Tailscale auto-tunnel integration. Idempotent.
 */
export async function clearTailscaleConnectionAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  await requireExtensionAction("@cinatra-ai/tailscale-connector", "manage");
  try {
    await clearTailscaleConnection();
  } catch (err) {
    // Same sanitization as the save path: raw detail stays in server logs,
    // never in the serialized action result. (The OAuth disconnect path throws
    // only a sanitised `TailscaleApiError` — no secret in its message.)
    console.error("[connector-tailscale] clearTailscaleConnectionAction failed", err);
    return { ok: false, error: "Tailscale disconnect failed." };
  }
  revalidatePath("/connectors/cinatra-ai/tailscale-connector/setup");
  revalidatePath("/connectors");
  revalidatePath("/configuration/development");
  return { ok: true };
}
