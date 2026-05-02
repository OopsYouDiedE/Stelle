# DebugProvider Guide

Debug is a control plane shell. It lists providers, renders provider-owned panels, runs provider-owned commands, and applies security policy.

Packages provide debug data with:

```ts
{
  id: "package.debug",
  title: "Package",
  ownerPackageId: "capability.example",
  panels: [],
  commands: [],
  getSnapshot() {}
}
```

Remote debug defaults are conservative:

- local mode can run read and safe local commands.
- remote token mode can read and run safe writes.
- selected runtime control commands must be allowlisted.
- external-effect commands require operator mode and explicit external-effect enablement.
- command attempts are audited.

Debug may display DataPlane metadata. It must not read private or runtime-scoped resource content by default in remote contexts.
