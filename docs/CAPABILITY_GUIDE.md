# Capability Guide

Capabilities contain reusable behavior. They may depend on Core contracts and other capability service contracts, but not concrete Windows, platform adapters, or application boot modes.

Examples include RuntimeKernel, StageOutput, memory store, viewer profile, scene observation, device action, stage director, and topic script.

Rules:

- Query APIs may be synchronous or low-latency.
- Commands and side effects should flow through events, intents, or execution results.
- Large data must use `DataPlane` and publish only `ResourceRef` or `StreamRef` on the event bus.
- Debug information is exported through package-owned `DebugProvider` objects.
- Capability queues should declare a bounded policy when they process bursty input.
