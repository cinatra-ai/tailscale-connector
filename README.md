# Tailscale

Give every running dev instance a deterministic public URL through your tailnet. Once connected, Cinatra mints a tag-scoped Tailscale Funnel URL per instance so webhooks, OAuth callbacks, and external MCP clients can reach you without setting up a tunnel by hand each session.

## Capabilities

- Provision a deterministic public Funnel URL for every dev instance
- Reach a running Cinatra instance from webhooks, OAuth callbacks, and external MCP clients without manual tunnel setup per session
- Pick the tag prefix the workspace's auth-keys are minted under
- See the current Tailscale connection status, tailnet, and configured tag
