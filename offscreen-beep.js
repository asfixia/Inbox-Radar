/**
 * Plays a short WAV from the extension package (MV3 offscreen + AUDIO_PLAYBACK).
 * Message: { action: 'OFFSCREEN_BEEP', url, durationMs?, volume? }
 */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.action !== 'OFFSCREEN_BEEP') return;

  (async () => {
    let ok = false;
    let error = '';
    try {
      const url = typeof msg.url === 'string' ? msg.url : '';
      if (!url) throw new Error('Missing sound URL.');

      const durationMs = Math.min(1500, Math.max(200, Number(msg.durationMs) || 500));
      const volume = Math.min(1, Math.max(0.05, Number(msg.volume) || 0.85));
      const playSec = durationMs / 1000;

      const ctx = new AudioContext();
      await ctx.resume();
      if (ctx.state === 'suspended') await ctx.resume();

      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const buf = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(buf.slice(0));

      const src = ctx.createBufferSource();
      const gain = ctx.createGain();
      src.buffer = audioBuf;
      gain.gain.value = volume;
      src.connect(gain);
      gain.connect(ctx.destination);

      const slice = Math.min(audioBuf.duration, playSec);
      src.start(0, 0, slice);
      await new Promise((r) => setTimeout(r, Math.ceil(slice * 1000) + 80));
      await ctx.close();
      ok = true;
    } catch (e) {
      error = String(e?.message || e);
    }
    sendResponse({ ok, error: error || undefined });
    try {
      chrome.runtime.sendMessage({ action: 'CHIME_OFFSCREEN_DONE' });
    } catch {
      /* ignore */
    }
  })();

  return true;
});
