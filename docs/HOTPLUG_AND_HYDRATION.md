# Hotplug And Hydration

Hotplug is package lifecycle management through `ComponentLoader` and `ComponentRegistry`.

Safe unload order:

1. Reject new work through package policy.
2. Ask `prepareUnload()` how pending work should finish.
3. Capture transferable state with `snapshotState()`.
4. Stop the package.
5. Remove package-owned services and debug providers.
6. Reload a new package object.
7. Hydrate with the stored snapshot.
8. Start the package.

State categories:

- Ephemeral state is discarded.
- Durable state is written through a store.
- Transferable state is moved through snapshot and hydration.

Long-running model calls may finish and be ignored if stale, or be cancelled with an abort signal. Perfect transfer of every async call is not required.
