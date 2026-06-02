"use server";

import { revalidatePath } from "next/cache";
import { requireExtensionAction } from "@cinatra-ai/sdk-extensions";
import {
  clearTailscaleConnection,
  saveTailscaleConnection,
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
    const message =
      err instanceof Error ? err.message : "Tailscale connection save failed.";
    const code =
      err && typeof err === "object" && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : undefined;
    return { ok: false, error: message, code };
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
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Tailscale disconnect failed.",
    };
  }
  revalidatePath("/connectors/cinatra-ai/tailscale-connector/setup");
  revalidatePath("/connectors");
  revalidatePath("/configuration/development");
  return { ok: true };
}
