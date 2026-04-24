import type { Live2DStageState } from "../types.js";

export function renderLiveHtml(initialState: Live2DStageState, defaultBackground: string): string {
  const stateJson = JSON.stringify(initialState).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Stelle Live</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Microsoft YaHei", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: #101923; }
    #stage { position: relative; width: 100vw; height: 100vh; background: var(--bg); background-size: cover; background-position: center; }
    #stage::before { content: ""; position: absolute; inset: 0; background: linear-gradient(180deg, rgba(0,0,0,.05), rgba(0,0,0,.32)); }
    #model { position: absolute; left: 50%; top: 48%; width: min(54vw, 660px); height: min(82vh, 900px); transform: translate(-50%, -50%); display: grid; place-items: center; }
    #model-card { width: 100%; height: 100%; position: relative; display: grid; place-items: center; filter: drop-shadow(0 30px 45px rgba(0,0,0,.32)); animation: breathe 4s ease-in-out infinite; }
    #model-standin { width: min(78%, 430px); aspect-ratio: 0.58; border-radius: 50% 50% 42% 42% / 34% 34% 46% 46%; background: linear-gradient(165deg, #f8fbff 0 18%, #8bd5d1 18% 34%, #355c7d 34% 100%); box-shadow: inset 0 0 0 10px rgba(255,255,255,.28), 0 20px 60px rgba(0,0,0,.28); }
    #model-name { position: absolute; top: 9%; padding: 8px 18px; border: 1px solid rgba(255,255,255,.34); border-radius: 999px; background: rgba(11,24,38,.42); backdrop-filter: blur(10px); color: white; font-size: 22px; }
    #caption { position: absolute; left: 50%; bottom: 46px; width: min(88vw, 1500px); min-height: 132px; transform: translateX(-50%); display: grid; place-items: center; padding: 24px 44px; color: white; font-size: 48px; line-height: 1.28; text-align: center; text-shadow: 0 3px 12px rgba(0,0,0,.72); background: rgba(7, 15, 23, .68); border: 1px solid rgba(255,255,255,.18); border-radius: 8px; backdrop-filter: blur(14px); overflow: hidden; }
    #voice { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
    #caption-text { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; }
    @keyframes breathe { 0%, 100% { transform: translateY(0) scale(1); } 50% { transform: translateY(-1.4%) scale(1.012); } }
    @media (max-width: 900px) {
      #model { width: 74vw; height: 72vh; top: 44%; }
      #caption { bottom: 24px; width: 92vw; min-height: 104px; padding: 18px 24px; font-size: 28px; }
      #model-name { font-size: 16px; }
    }
  </style>
</head>
<body>
  <main id="stage">
    <section id="model" aria-label="Live2D model">
      <div id="model-card">
        <div id="model-name"></div>
        <div id="model-standin"></div>
      </div>
    </section>
    <section id="caption" aria-live="polite"><div id="caption-text"></div></section>
    <audio id="voice" crossorigin="anonymous" autoplay></audio>
  </main>
  <script>
    const state = ${stateJson};
    const stage = document.getElementById("stage");
    const caption = document.getElementById("caption-text");
    const modelName = document.getElementById("model-name");
    const voice = document.getElementById("voice");
    const silentWavDataUrl = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const audioQueue = [];
    let audioPlaying = false;
    let primingAudio = false;
    let retryTimer;
    function updateAudioState(patch) {
      window.__stelleAudioState = Object.assign({
        queued: audioQueue.length,
        playing: audioPlaying,
        playedCount: (window.__stelleAudioState && window.__stelleAudioState.playedCount) || 0,
        activated: true,
        lastUrl: window.__stelleAudioState && window.__stelleAudioState.lastUrl,
        lastText: window.__stelleAudioState && window.__stelleAudioState.lastText,
        lastEvent: window.__stelleAudioState && window.__stelleAudioState.lastEvent,
        lastError: window.__stelleAudioState && window.__stelleAudioState.lastError,
        errorName: window.__stelleAudioState && window.__stelleAudioState.errorName,
        mediaErrorCode: window.__stelleAudioState && window.__stelleAudioState.mediaErrorCode,
        mediaErrorMessage: window.__stelleAudioState && window.__stelleAudioState.mediaErrorMessage
      }, patch || {});
      try { fetch("/audio-status", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(window.__stelleAudioState), keepalive: true }); } catch {}
    }
    function applyState(next) {
      Object.assign(state, next);
      stage.style.setProperty("--bg", state.background || "${defaultBackground}");
      if (state.background && /^(https?:|data:|file:|\\/)/.test(state.background)) {
        stage.style.backgroundImage = "url('" + state.background.replace(/'/g, "%27") + "')";
      } else {
        stage.style.backgroundImage = state.background || "${defaultBackground}";
      }
      caption.textContent = state.caption || "";
      modelName.textContent = state.model?.displayName || state.model?.id || "Hiyori Pro";
    }
    function applyCommand(command) {
      if (command.type === "state:set") applyState(command.state || {});
      if (command.type === "caption:set") applyState({ caption: command.text || "" });
      if (command.type === "caption:clear") applyState({ caption: "" });
      if (command.type === "background:set") applyState({ background: command.source || "" });
      if (command.type === "model:load") applyState({ model: command.model || state.model });
      if (command.type === "motion:trigger") {
        const card = document.getElementById("model-card");
        card.animate([{ transform: "translateY(0) scale(1)" }, { transform: "translateY(-3%) scale(1.035)" }, { transform: "translateY(0) scale(1)" }], { duration: 520, easing: "ease-out" });
      }
      if (command.type === "audio:play" || command.type === "audio:stream") {
        audioQueue.push(command);
        updateAudioState({ queued: audioQueue.length, lastEvent: "queued", lastUrl: command.url, lastText: command.text, lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
        void playNextAudio();
      }
    }
    async function playNextAudio() {
      if (audioPlaying || !audioQueue.length) return;
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
      audioPlaying = true;
      const next = audioQueue[0];
      if (next.text) applyState({ caption: next.text });
      primingAudio = false;
      voice.loop = false;
      voice.muted = false;
      voice.src = next.url;
      updateAudioState({ queued: audioQueue.length, playing: true, lastEvent: "play_requested", lastUrl: next.url, lastText: next.text, lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
      try { await voice.play(); audioQueue.shift(); updateAudioState({ queued: audioQueue.length, playing: true, lastEvent: "play_resolved", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined }); } catch (error) { audioPlaying = false; const message = error instanceof Error ? error.message : String(error); const errorName = error instanceof Error ? error.name : undefined; const mediaError = describeMediaError(); updateAudioState(Object.assign({ playing: false, activated: true, lastEvent: "play_rejected", lastError: message, errorName }, mediaError)); scheduleAudioRetry(); }
    }
    async function primeAudioElement() {
      primingAudio = true;
      voice.muted = true;
      voice.loop = true;
      voice.src = silentWavDataUrl;
      updateAudioState({ playing: false, activated: true, lastEvent: "priming_requested", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined });
      try { await voice.play(); updateAudioState({ playing: false, activated: true, lastEvent: "primed", lastError: undefined, errorName: undefined, mediaErrorCode: undefined, mediaErrorMessage: undefined }); } catch (error) { primingAudio = false; updateAudioState(Object.assign({ playing: false, activated: true, lastEvent: "priming_blocked", lastError: "audio priming blocked: " + (error instanceof Error ? error.message : String(error)), errorName: error instanceof Error ? error.name : undefined }, describeMediaError())); }
    }
    function describeMediaError() {
      return {
        mediaErrorCode: voice.error && voice.error.code || undefined,
        mediaErrorMessage: voice.error && voice.error.message || undefined
      };
    }
    function scheduleAudioRetry() {
      if (retryTimer !== undefined || !audioQueue.length) return;
      retryTimer = setTimeout(() => { retryTimer = undefined; void playNextAudio(); }, 2500);
    }
    voice.addEventListener("play", () => { if (primingAudio) return; updateAudioState({ playing: true, lastEvent: "play", lastError: undefined }); applyCommand({ type: "speech:start", durationMs: Math.max(1400, Math.min(20000, Math.round((voice.duration || 3) * 1000))) }); });
    voice.addEventListener("ended", () => { if (primingAudio) return; audioPlaying = false; updateAudioState({ playing: false, lastEvent: "ended", playedCount: ((window.__stelleAudioState && window.__stelleAudioState.playedCount) || 0) + 1 }); applyCommand({ type: "speech:stop" }); void playNextAudio(); });
    voice.addEventListener("error", () => { const mediaError = describeMediaError(); if (primingAudio) { primingAudio = false; updateAudioState(Object.assign({ lastEvent: "priming_error", lastError: "audio priming failed" }, mediaError)); return; } audioPlaying = false; audioQueue.shift(); updateAudioState(Object.assign({ playing: false, queued: audioQueue.length, lastEvent: "error", lastError: "audio element error" }, mediaError)); void playNextAudio(); });
    voice.autoplay = true;
    updateAudioState({ lastEvent: "priming_requested", activated: true });
    void primeAudioElement();
    applyState(state);
    const events = new EventSource("/events");
    events.onopen = () => { window.__stelleRendererEventsReady = true; };
    events.addEventListener("command", event => applyCommand(JSON.parse(event.data)));
  </script>
</body>
</html>`;
}
