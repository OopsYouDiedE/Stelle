# ComponentPackage Contract

`ComponentPackage` is the only lifecycle unit for runtime-loadable Stelle code.

Packages declare an id, kind, version, requirements, provisions, optional queue policy, and optional state lifecycle hooks. Core loads package objects through `ComponentLoader`; Core does not import package internals.

Lifecycle order:

1. `register(ctx)` exposes services, read models, handlers, and debug providers.
2. `hydrateState(state)` restores transferable state when a previous snapshot exists.
3. `start(ctx)` begins active work.
4. `prepareUnload()` declares whether pending work drains, cancels, hands off, or drops expired work.
5. `snapshotState()` captures transferable state.
6. `stop(ctx)` stops active work.
7. `unregister(packageId)` removes package-owned services and debug providers.

Packages should use `ctx.registry.provideForPackage(packageId, key, value)` when available so unload can clean up ownership automatically.
