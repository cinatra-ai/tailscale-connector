// Sanitization contract for the setup server actions' catch/return path.
//
// These actions RETURN failures (`{ ok: false, error, code? }`) instead of
// throwing, so Next.js production masking never applies and whatever lands in
// `error` is serialized to the browser verbatim. The catch blocks must
// therefore never put the raw `err.message` (which wraps upstream
// Nango/Tailscale detail) on the wire: the client gets only the typed `code`
// plus a sanitized generic string, while the raw detail goes to server logs
// via `console.error`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { MockInstance } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@cinatra-ai/sdk-extensions", () => ({
  requireExtensionAction: vi.fn(async () => undefined),
}));
vi.mock("../index", () => ({
  saveTailscaleConnection: vi.fn(),
  clearTailscaleConnection: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { TailscaleApiError } from "../tailscale-api.mjs";
import { clearTailscaleConnection, saveTailscaleConnection } from "../index";
import {
  clearTailscaleConnectionAction,
  saveTailscaleConnectionAction,
} from "../tailscale-setup-actions";

const RAW_INTERNAL_DETAIL =
  "Tailscale connection import failed: NangoApiError: 401 Unauthorized — POST /connection rejected the credential";

let consoleError: MockInstance;

beforeEach(() => {
  vi.clearAllMocks();
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  consoleError.mockRestore();
});

describe("saveTailscaleConnectionAction failure return", () => {
  it("strips the raw err.message from the payload, keeps the typed code, and logs the raw detail server-side", async () => {
    const rawErr = new TailscaleApiError("tailscale.unknown", RAW_INTERNAL_DETAIL);
    vi.mocked(saveTailscaleConnection).mockRejectedValueOnce(rawErr);

    const result = await saveTailscaleConnectionAction({ apiKey: "tskey-api-x" });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("tailscale.unknown");
    expect(result.error).toBe("Tailscale connection save failed.");
    expect(result.error).not.toContain(RAW_INTERNAL_DETAIL);
    expect(JSON.stringify(result)).not.toContain("NangoApiError");
    // Raw detail stays server-side: the catch logs the original error object.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toContain(rawErr);
    // Failure path must not revalidate.
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("returns the sanitized string with no code for non-Error throws", async () => {
    vi.mocked(saveTailscaleConnection).mockRejectedValueOnce("raw string failure");

    const result = await saveTailscaleConnectionAction({ apiKey: "tskey-api-x" });

    expect(result).toEqual({
      ok: false,
      error: "Tailscale connection save failed.",
      code: undefined,
    });
  });

  it("success path is untouched: returns the status and revalidates the three paths", async () => {
    const status = {
      connected: true,
      tailnet: "example.ts.net",
      cloneTag: "tag:cinatra-clone",
      lastValidatedAt: "2026-06-10T00:00:00Z",
    };
    vi.mocked(saveTailscaleConnection).mockResolvedValueOnce(status);

    const result = await saveTailscaleConnectionAction({ apiKey: "tskey-api-x" });

    expect(result).toEqual({ ok: true, status });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(3);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("clearTailscaleConnectionAction failure return", () => {
  it("strips the raw err.message from the payload and logs the raw detail server-side", async () => {
    const rawErr = new Error(
      "TailscaleApiError: deleteConnection failed: 500 Internal Server Error from nango",
    );
    vi.mocked(clearTailscaleConnection).mockRejectedValueOnce(rawErr);

    const result = await clearTailscaleConnectionAction();

    expect(result).toEqual({ ok: false, error: "Tailscale disconnect failed." });
    expect(JSON.stringify(result)).not.toContain("500 Internal Server Error");
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(consoleError.mock.calls[0]).toContain(rawErr);
    expect(vi.mocked(revalidatePath)).not.toHaveBeenCalled();
  });

  it("success path is untouched: revalidates the three paths", async () => {
    vi.mocked(clearTailscaleConnection).mockResolvedValueOnce(undefined);

    const result = await clearTailscaleConnectionAction();

    expect(result).toEqual({ ok: true });
    expect(vi.mocked(revalidatePath)).toHaveBeenCalledTimes(3);
  });
});
