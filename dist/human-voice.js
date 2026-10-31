// Human sounding narration shared by NeuraLearn chat and Canvas.
(() => {
  let token = 0, audio = null, objectUrl = '', paused = false, loading = false, wake = null;
  const split = text => {
    const sentences = String(text || '').replace(/```[\s\S]*?```/g, ' Code omitted from spoken answer. ').replace(/[#*_`>|]/g, ' ').replace(/\s+/g, ' ').match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [];
    const out = [];
    for (const sentence of sentences) {
      let rest = sentence.trim();
      while (rest.length > 400) { let cut = rest.lastIndexOf(' ', 400); if (cut < 120) cut = 400; out.push(rest.slice(0, cut)); rest = rest.slice(cut).trim(); }
      if (rest) out.push(rest);
    }
    const groups = []; let group = [], size = 0;
    for (const line of out) { if (group.length >= 12 || size + line.length > 2200) { groups.push(group); group = []; size = 0; } group.push(line); size += line.length; }
    if (group.length) groups.push(group);
    return groups;
  };
  function stop() { token++; loading=false;paused=false;wake?.();wake=null;if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; } if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; }
  async function speak(text, language = 'English', rate = 1) {
    stop(); const mine = token, groups = split(text);loading=true;
    try { for (const lines of groups) {
      if (mine !== token) return;
      try {
        const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ lines, language, voice: 'Sulafat', style: 'professor' }) });
        if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Natural voice is unavailable.'); }
        const blob = await res.blob(); if (mine !== token) return;
        if(paused)await new Promise(resolve=>{wake=resolve});if(mine!==token)return;
        objectUrl = URL.createObjectURL(blob); audio = new Audio(objectUrl); audio.playbackRate = Math.max(.75, Math.min(1.25, rate)); audio.preservesPitch = true;
        await new Promise(resolve => { const done = () => { if (audio) { audio.onended = audio.onerror = null; audio = null; } if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; resolve(); }; audio.onended = done; audio.onerror = done; audio.play().catch(done); });
      } catch (error) {
        if (mine === token) document.dispatchEvent(new CustomEvent('nl:voice-error', { detail: { message: error.message } }));
        return;
      }
    }} finally { if (mine === token) { paused=false;loading=false; } }
  }
  window.NeuraVoice = { speak, stop, pause() { if (loading||audio) { paused = true; audio?.pause(); } }, resume() { if (paused) { paused = false;wake?.();wake=null;if(audio)audio.play().catch(() => {}); } }, active: () => loading||!!audio, paused: () => paused };
})();
