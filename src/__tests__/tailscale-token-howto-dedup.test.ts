// Regression coverage for issue #63: the API-access-token "where to generate
// it" how-to used to render TWICE — once inline below the input
// (`tailscale-connect-form.tsx` FieldDescription) and once in the Help tab
// (`tailscale-setup-impl.tsx`). Per the connector setup-page spec
// (design/specs/app-connectors.html §II — Help carries the setup how-to) and
// the house pattern already followed by google-oauth-connector (its config
// fields carry no how-to prose at all; Help is the sole home), the how-to now
// lives in Help ONLY. The inline description shrinks to the minimum the
// operator needs at the field itself (the token's format + that it pairs
// with the tag field) and points to Help for the rest.
//
// Same source-snapshot convention as `tailscale-setup-tabs.test.ts` /
// `tailscale-connect-form-toast-dedup.test.ts`: this repo's vitest is a
// node-only environment with no @cinatra-ai/sdk-ui available standalone, so
// these components can't be mounted in a DOM harness here — the invariants
// below are asserted against the authored source text instead.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const formSource = readFileSync(path.join(testDir, "../tailscale-connect-form.tsx"), "utf8");
const helpSource = readFileSync(path.join(testDir, "../tailscale-setup-impl.tsx"), "utf8");

// Guards every anchor before it is used to slice — an unmatched `indexOf`
// returns -1, which `slice()` accepts silently (it would just produce an
// empty or wrong-window string) instead of failing loudly at the point the
// source no longer matches the expected shape.
function mustFind(haystack: string, needle: string, fromIndex = 0): number {
  const idx = haystack.indexOf(needle, fromIndex);
  if (idx === -1) {
    throw new Error(`Expected to find ${JSON.stringify(needle)} (search anchor moved/removed?)`);
  }
  return idx;
}

// Isolate the API-access-token Field block in the connect form: from its
// FieldLabel down through its own FieldDescription close — NOT all the way to
// the end of the Field (the Tag field right after it legitimately mentions
// `tagOwners` for itself; the OAuth-client Field above it is a separate,
// flag-gated field not covered by issue #63) — both are left untouched.
const apiKeyFieldStart = mustFind(formSource, '<FieldLabel htmlFor="tailscaleApiKey">');
const apiKeyDescCloseIdx = mustFind(formSource, "</FieldDescription>", apiKeyFieldStart);
const apiKeyFieldEnd = apiKeyDescCloseIdx + "</FieldDescription>".length;
const apiKeyField = formSource.slice(apiKeyFieldStart, apiKeyFieldEnd);

// Isolate the Help tab's "API access token" subsection.
const helpApiTokenHeadingIdx = mustFind(helpSource, ">\n              API access token\n            </h3>");
const helpOAuthOrTagHeadingIdx = mustFind(helpSource, "{oauthEnabled ? (", helpApiTokenHeadingIdx);
const helpApiTokenSection = helpSource.slice(helpApiTokenHeadingIdx, helpOAuthOrTagHeadingIdx);

describe("tailscale token how-to dedup (issue #63)", () => {
  it("the inline field no longer carries the 'where to generate it' how-to — that lives in Help only", () => {
    expect(apiKeyField).not.toContain("login.tailscale.com/admin/settings/keys");
    expect(apiKeyField).not.toContain("Generate access token");
    expect(apiKeyField).not.toContain("Access Controls");
    expect(apiKeyField).not.toContain("tagOwners");
  });

  it("the inline field keeps only the minimum the operator needs at the field itself", () => {
    expect(apiKeyField).toContain("tskey-api-");
    // Points to Help instead of repeating the how-to.
    expect(apiKeyField).toMatch(/Help tab/);
  });

  it("Help keeps the full how-to: where to generate the token and the button name", () => {
    expect(helpApiTokenSection).toContain("login.tailscale.com/admin/settings/keys");
    expect(helpApiTokenSection).toContain("Generate access token");
  });

  it("the generate-token URL is absent from the token field and present in Help", () => {
    const urlRe = /login\.tailscale\.com\/admin\/settings\/keys/g;
    // Scoped to the token field (not the whole form file) so this stays
    // about THIS field's dedup, not an org-wide ban on the URL string.
    expect(apiKeyField).not.toMatch(urlRe);
    const helpHits = [...helpApiTokenSection.matchAll(urlRe)].length;
    // Appears twice in Help (ExternalLink href + visible link text) — both
    // inside the single canonical how-to location, not a second location.
    expect(helpHits).toBeGreaterThanOrEqual(1);
  });
});
