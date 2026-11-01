// Human sounding narration shared by NeuraLearn chat and Canvas.
(() => {
  let token = 0, audio = null, objectUrl = '', paused = false, loading = false, wake = null, deviceResolve = null;
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
  function stop() { token++; loading=false;paused=false;wake?.();wake=null;deviceResolve?.();deviceResolve=null;if ('speechSynthesis' in window) window.speechSynthesis.cancel();if (audio) { audio.onended = audio.onerror = null; audio.pause(); audio = null; } if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; }
  const languageTag = language => ({'English':'en','English (India)':'en-IN','Hindi':'hi','Kannada':'kn','Tamil':'ta','Telugu':'te','Malayalam':'ml','Marathi':'mr','Bengali':'bn','Spanish':'es','French':'fr'}[language] || 'en');
  function speakWithDevice(text, language, rate, mine) {
    if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return Promise.resolve();
    const synth=window.speechSynthesis, tag=languageTag(language), sentences=String(text).match(/[^.!?]+[.!?]+|[^.!?]+$/g)||[text];
    return new Promise(resolve=>{
      let index=0, settled=false;
      const finish=()=>{if(settled)return;settled=true;if(deviceResolve===finish)deviceResolve=null;resolve()};
      deviceResolve=finish;
      const next=()=>{
        if(settled||mine!==token)return finish();
        if(index>=sentences.length)return finish();
        const u=new SpeechSynthesisUtterance(sentences[index++].trim());
        const voices=synth.getVoices(),voice=voices.find(v=>String(v.lang||'').toLowerCase().startsWith(tag.toLowerCase()))||voices.find(v=>/^en/i.test(v.lang||''));
        u.lang=voice?.lang||tag;if(voice)u.voice=voice;u.rate=Math.max(.6,Math.min(1.5,rate||1));u.onend=next;u.onerror=next;synth.speak(u);
      };
      next();
    });
  }
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
        await new Promise((resolve,reject) => { const done = () => { if (audio) { audio.onended = audio.onerror = null; audio = null; } if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; resolve(); }; const failed = () => { if (audio) { audio.onended = audio.onerror = null; audio = null; } if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = ''; reject(new Error('Natural audio could not play.')); }; audio.onended = done; audio.onerror = failed; audio.play().catch(failed); });
      } catch (error) {
        if (mine === token) {
          document.dispatchEvent(new CustomEvent('nl:voice-error', { detail: { message: error.message, fallback: true } }));
          await speakWithDevice(lines.join(' '), language, rate, mine);
        }
      }
    }} finally { if (mine === token) { paused=false;loading=false; } }
  }
  window.NeuraVoice = { speak, stop, pause() { if (loading||audio) { paused = true; audio?.pause(); if(!audio&&'speechSynthesis'in window)window.speechSynthesis.pause(); } }, resume() { if (paused) { paused = false;wake?.();wake=null;if(audio)audio.play().catch(() => {});else if('speechSynthesis'in window)window.speechSynthesis.resume(); } }, active: () => loading||!!audio||!!deviceResolve, paused: () => paused };
})();
