import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mintTailscaleAccessToken,
  mintTailscaleAuthKey,
  TailscaleApiError,
} from "../tailscale-api.mjs";

// ---------------------------------------------------------------------------
// Tailscale REST API client tests.
//
// Convention (per repo precedent in
// `packages/connector-media-feeds/src/__tests__/feed.test.ts:5`):
// directly mock `globalThis.fetch` with vi.fn() and restore in
// afterEach. No msw, no fetch-mock, no module re-import games.
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function makeResponse(init: { status: number; json?: unknown }) {
  const { status, json } = init;
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      if (json === undefined) throw new Error("no json");
      return json;
    },
  };
}

describe("mintTailscaleAccessToken", () => {
  it("POSTs grant_type=client_credentials with the credentials and returns the token", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        status: 200,
        json: { access_token: "ts-access-abc", expires_in: 3600 },
      }),
    );
    const result = await mintTailscaleAccessToken({
      clientId: "k-clientid",
      clientSecret: "secret-shh",
      scope: "auth_keys",
    });
    expect(result.accessToken).toBe("ts-access-abc");
    expect(result.expiresIn).toBe(3600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tailscale.com/api/v2/oauth/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    const body = String(init.body);
    expect(body).toContain("grant_type=client_credentials");
    expect(body).toContain("client_id=k-clientid");
    expect(body).toContain("client_secret=secret-shh");
    expect(body).toContain("scope=auth_keys");
  });

  it("rejects with tailscale.invalid_client when clientId is empty", async () => {
    await expect(
      mintTailscaleAccessToken({ clientId: "", clientSecret: "x" }),
    ).rejects.toMatchObject({ code: "tailscale.invalid_client" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects with tailscale.invalid_client when clientSecret is empty", async () => {
    await expect(
      mintTailscaleAccessToken({ clientId: "x", clientSecret: "" }),
    ).rejects.toMatchObject({ code: "tailscale.invalid_client" });
  });

  it("maps 401 → tailscale.scope_denied (invalid credentials)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 401 }));
    await expect(
      mintTailscaleAccessToken({ clientId: "x", clientSecret: "y" }),
    ).rejects.toMatchObject({ code: "tailscale.scope_denied", status: 401 });
  });

  it("maps 403 → tailscale.scope_denied (scope not granted)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 403 }));
    await expect(
      mintTailscaleAccessToken({
        clientId: "x",
        clientSecret: "y",
        scope: "auth_keys",
      }),
    ).rejects.toMatchObject({ code: "tailscale.scope_denied", status: 403 });
  });

  it("maps 429 → tailscale.rate_limited", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 429 }));
    await expect(
      mintTailscaleAccessToken({ clientId: "x", clientSecret: "y" }),
    ).rejects.toMatchObject({ code: "tailscale.rate_limited", status: 429 });
  });

  it("error messages NEVER contain the clientSecret value (redaction invariant)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 403 }));
    try {
      await mintTailscaleAccessToken({
        clientId: "client-id-public",
        clientSecret: "SUPER-SECRET-PASSWORD-VALUE",
        scope: "auth_keys",
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TailscaleApiError);
      expect((err as Error).message).not.toContain("SUPER-SECRET-PASSWORD-VALUE");
    }
  });

  it("maps fetch network error → tailscale.network", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await expect(
      mintTailscaleAccessToken({ clientId: "x", clientSecret: "y" }),
    ).rejects.toMatchObject({ code: "tailscale.network" });
  });
});

describe("mintTailscaleAuthKey", () => {
  it("POSTs to /tailnet/-/keys with default tags=[tag:cinatra-clone] and ephemeral=true", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 200, json: { key: "tskey-auth-abcdef" } }),
    );
    const result = await mintTailscaleAuthKey({
      accessToken: "ts-access-abc",
    });
    expect(result.authKey).toBe("tskey-auth-abcdef");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tailscale.com/api/v2/tailnet/-/keys");
    expect(init.headers.Authorization).toBe("Bearer ts-access-abc");
    const body = JSON.parse(init.body);
    expect(body.capabilities.devices.create.ephemeral).toBe(true);
    expect(body.capabilities.devices.create.preauthorized).toBe(true);
    expect(body.capabilities.devices.create.reusable).toBe(false);
    expect(body.capabilities.devices.create.tags).toEqual(["tag:cinatra-clone"]);
  });

  it("honors an explicit tailnet name in the URL", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 200, json: { key: "tskey-auth-zzz" } }),
    );
    await mintTailscaleAuthKey({
      accessToken: "ts-access-abc",
      tailnet: "example.com",
    });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.tailscale.com/api/v2/tailnet/example.com/keys");
  });

  it("honors custom tags", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({ status: 200, json: { key: "tskey-auth-zzz" } }),
    );
    await mintTailscaleAuthKey({
      accessToken: "x",
      tags: ["tag:cinatra-staging", "tag:cinatra-clone"],
    });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.capabilities.devices.create.tags).toEqual([
      "tag:cinatra-staging",
      "tag:cinatra-clone",
    ]);
  });

  it("maps 403 → tailscale.tag_denied (tag permission missing)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 403 }));
    await expect(
      mintTailscaleAuthKey({ accessToken: "x" }),
    ).rejects.toMatchObject({ code: "tailscale.tag_denied", status: 403 });
  });

  it("maps 401 → tailscale.invalid_client (access token rejected)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 401 }));
    await expect(
      mintTailscaleAuthKey({ accessToken: "x" }),
    ).rejects.toMatchObject({ code: "tailscale.invalid_client", status: 401 });
  });

  it("error messages NEVER contain the access token (redaction invariant)", async () => {
    fetchMock.mockResolvedValueOnce(makeResponse({ status: 403 }));
    try {
      await mintTailscaleAuthKey({ accessToken: "SECRET-ACCESS-TOKEN-VALUE" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).not.toContain("SECRET-ACCESS-TOKEN-VALUE");
    }
  });
});
