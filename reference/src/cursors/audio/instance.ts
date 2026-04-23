import { stelle } from "../../core/runtime.js";
import { EventDrivenAudioCursor } from "./AudioCursor.js";
import { configuredAudioEngine } from "./runtime.js";

let audioCursorSingleton: EventDrivenAudioCursor | null = null;

export function getAudioCursor(): EventDrivenAudioCursor {
  if (!audioCursorSingleton) {
    audioCursorSingleton = new EventDrivenAudioCursor({
      id: "audio-main",
      engine: configuredAudioEngine,
    });
    stelle.registerWindow(audioCursorSingleton);
  }
  return audioCursorSingleton;
}
