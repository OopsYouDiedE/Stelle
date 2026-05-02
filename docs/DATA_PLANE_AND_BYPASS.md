# Data Plane And Bypass

Bypass means bypassing the EventBus heavy-data path only. It does not bypass lifecycle, audit, access policy, or ownership.

EventBus carries control-plane facts:

- perceptual events
- intents
- execution commands and results
- status changes
- audit and debug command events

DataPlane carries heavy data:

- images
- audio chunks and streams
- video frames
- long text or JSON blobs
- browser and scene snapshots
- embedding blocks

Default EventBus payloads are capped at 64 KB. Larger payloads should be stored through `DataPlane.putBlob()` or `DataPlane.createStream()`, then referenced by `ResourceRef` or `StreamRef`.

Debug can list resource and stream metadata without reading content. Access to content is checked by `ResourceAccessPolicy`.
