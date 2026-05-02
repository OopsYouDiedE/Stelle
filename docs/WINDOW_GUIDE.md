# Window Guide

Windows connect Stelle to concrete interaction surfaces. They own platform adapters, connection lifecycles, and conversion from platform-specific input to Core protocol events.

Windows may import Core contracts and Capabilities. Capabilities must not import Windows.

LiveWindow is the reference shape:

```txt
platform adapter -> PerceptualEvent -> RuntimeKernel -> Intent -> StageOutput
```

Window code should preserve raw platform details only as metadata. RuntimeKernel should consume text, actor, trust, priority, summaries, and refs, not platform commands such as adapter opcodes.
