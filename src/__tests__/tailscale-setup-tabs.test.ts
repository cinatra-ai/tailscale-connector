// Regression pins for issue #48 (connector-setup-tabs rollout): the setup
// page wraps its content in the shared `@cinatra-ai/sdk-ui` Tabs primitive,
// Setup first, Help always LAST.
//
// The setup page is an async server component composed from
// `@cinatra-ai/sdk-ui/*` primitives that this package does not resolve in
// isolation (host-provided at build time — this repo is a source-mirror with
// no jsdom/testing-library and a node-only vitest environment, matching the
// sibling connectors' setup-page test convention). These pins assert against
// the authored source of `../tailscale-setup-impl.tsx` — tab presence, tab
// order, and which content maps to which tab.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const srcPath = fileURLToPath(new URL("../tailscale-setup-impl.tsx", import.meta.url));
const src = readFileSync(srcPath, "utf8");

// Collapse insignificant JSX whitespace so multi-line elements match as text.
const flat = src.replace(/\s+/g, " ");

describe("tailscale-setup-impl — tabbed setup page (issue #48)", () => {
  it("imports the shared sdk-ui Tabs primitive, not a hand-rolled/copied tabs module", () => {
    expect(src).toContain(
      'import { Tabs, TabsContent, TabsListRow, TabsTrigger } from "@cinatra-ai/sdk-ui/tabs";',
    );
    expect(src).toContain(
      'import { ConnectorSetupPage } from "@cinatra-ai/sdk-ui/connector-setup-page";',
    );
    // No copied tabs.tsx anywhere in this connector (boundary + no-vendoring).
    expect(existsSync(fileURLToPath(new URL("../tabs.tsx", import.meta.url)))).toBe(false);
    expect(
      existsSync(fileURLToPath(new URL("../components/ui/tabs.tsx", import.meta.url))),
    ).toBe(false);
  });

  it("declares exactly two tabs, Setup then Help, in that order", () => {
    const triggerValues = [...src.matchAll(/<TabsTrigger value="([a-z]+)">/g)].map(
      (m) => m[1],
    );
    expect(triggerValues).toEqual(["setup", "help"]);
  });

  it("Help is always LAST — the reserved tab position", () => {
    const setupIdx = src.indexOf('<TabsTrigger value="setup">');
    const helpIdx = src.indexOf('<TabsTrigger value="help">');
    expect(setupIdx).toBeGreaterThan(-1);
    expect(helpIdx).toBeGreaterThan(setupIdx);
    // Help's TabsContent block is also the last TabsContent in the file.
    const setupContentIdx = src.indexOf('<TabsContent\n          value="setup"');
    const helpContentIdx = src.indexOf('<TabsContent\n          value="help"');
    expect(setupContentIdx).toBeGreaterThan(-1);
    expect(helpContentIdx).toBeGreaterThan(setupContentIdx);
  });

  it("the tablist uses the shared TabsListRow (etched-rule row), not a hand-rolled tablist", () => {
    expect(flat).toContain('<TabsListRow aria-label="Tailscale connector setup">');
    expect(src).not.toContain('role="tablist"');
  });

  it("the header suppresses its own divider so it never stacks with the tab row's rule", () => {
    expect(flat).toContain("<ConnectorSetupPage");
    expect(flat).toContain("divider={false}");
  });

  it("Setup tab content: the existing TailscaleConnectForm (unchanged connect/disconnect flow) lives inside the setup TabsContent", () => {
    // Anchor on the <TabsContent> elements themselves (not the TabsTrigger
    // value= attributes, which appear earlier in the tab row).
    const setupBlockStart = src.indexOf('<TabsContent\n          value="setup"');
    const helpBlockStart = src.indexOf('<TabsContent\n          value="help"');
    const setupBlock = src.slice(setupBlockStart, helpBlockStart);
    expect(setupBlockStart).toBeGreaterThan(-1);
    expect(helpBlockStart).toBeGreaterThan(setupBlockStart);
    expect(setupBlock).toContain("<TailscaleConnectForm");
    expect(setupBlock).toContain("<Card");
  });

  it("Help tab content is read-only — no form, no Save/Connect action, narrows to the Narrow column", () => {
    const helpBlockStart = src.indexOf('<TabsContent\n          value="help"');
    expect(helpBlockStart).toBeGreaterThan(-1);
    const helpBlock = src.slice(helpBlockStart);
    expect(helpBlock).not.toContain("<TailscaleConnectForm");
    expect(helpBlock).not.toContain("<form");
    expect(helpBlock).not.toContain("Save");
    expect(helpBlock).not.toContain("<Button");
    expect(helpBlock).toContain("max-w-xl");
  });

  it("Help content covers the API token, tag, and disconnect prerequisites a user needs to connect", () => {
    const helpBlockStart = src.indexOf('<TabsContent\n          value="help"');
    const helpBlock = src.slice(helpBlockStart);
    expect(helpBlock).toContain("API access token");
    expect(helpBlock).toContain("Tag");
    expect(helpBlock).toContain("tagOwners");
    expect(helpBlock).toContain("Disconnecting");
  });

  it("no leftover single-card-only chrome (Main/PageHeader/PageContent hand-rolled directly)", () => {
    expect(src).not.toContain('from "@cinatra-ai/sdk-ui/marketplace"');
  });
});
