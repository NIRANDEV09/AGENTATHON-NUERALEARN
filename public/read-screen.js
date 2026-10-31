(()=>{
  const video=document.getElementById('screenVideo'),canvas=document.getElementById('screenMarkCanvas'),preview=document.getElementById('screenPreviewWrap');
  const status=document.getElementById('screenShareStatus'),start=document.getElementById('startScreenShare'),stop=document.getElementById('stopScreenShare');
  const empty=document.getElementById('screenEmpty'),clear=document.getElementById('clearScreenMarks'),explain=document.getElementById('explainScreenBtn');
  const answer=document.getElementById('screenAnswer'),question=document.getElementById('screenQuestion');
  const desktopButton=document.getElementById('launchDesktopOverlay');
  if(!video||!canvas)return;
  async function startDesktopOverlay(){if(!desktopButton)return;desktopButton.disabled=true;status.textContent='Opening the resizable desktop screen viewer…';try{const r=await fetch('/api/screen-overlay/start',{method:'POST'});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||'Could not open the desktop viewer.');status.textContent=data.restarted?'Updated desktop viewer opened. Use its Select button to mark anywhere on your screen.':data.alreadyRunning?'Desktop viewer is already open. Use its Select button to mark anywhere on your screen.':'Desktop viewer opened. Use its Select button to mark anywhere on your screen.';}catch(e){status.textContent=e.message+' You can still share a screen in this page.';}finally{desktopButton.disabled=false}}
  window.startNeuraDesktopOverlay=startDesktopOverlay;
  desktopButton?.addEventListener('click',startDesktopOverlay);
  const ctx=canvas.getContext('2d');
  let stream=null,drawing=false,dragged=false,hasMarks=false,ratio=1,busy=false,startPoint=null,lastPoint=null;
  function resizeCanvas(){
    const r=preview.getBoundingClientRect();if(!r.width||!r.height)return;
    ratio=Math.min(window.devicePixelRatio||1,2);canvas.width=Math.round(r.width*ratio);canvas.height=Math.round(r.height*ratio);
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle='#40e0d0';ctx.lineWidth=4;hasMarks=false;
  }
  function clearMarks(){ctx.clearRect(0,0,canvas.width/ratio,canvas.height/ratio);hasMarks=false}
  function stopCapture(){
    const old=stream;stream=null;if(old)old.getTracks().forEach(t=>t.stop());video.srcObject=null;canvas.hidden=true;empty.hidden=false;stop.hidden=true;start.disabled=false;explain.disabled=true;
    status.textContent='Screen sharing stopped.';clearMarks();
  }
  window.stopReadScreenCapture=stopCapture;
  async function startCapture(){
    if(!navigator.mediaDevices?.getDisplayMedia){status.textContent='Screen sharing needs a recent desktop browser.';return}
    start.disabled=true;status.textContent='Choose the screen, window, or browser tab you want to discuss.';
    try{
      stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:false});video.srcObject=stream;await video.play();
      if(video.readyState<2)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
      preview.style.aspectRatio=`${video.videoWidth||16}/${video.videoHeight||9}`;
      requestAnimationFrame(()=>{resizeCanvas();canvas.hidden=false;empty.hidden=true;stop.hidden=false;explain.disabled=false;status.textContent='Click the mirrored screen on the left to explain a point, or drag to mark a region.'});
      stream.getVideoTracks()[0]?.addEventListener('ended',stopCapture,{once:true});
    }catch(e){stream=null;start.disabled=false;status.textContent=e.name==='NotAllowedError'?'Screen sharing was cancelled. Click Share screen when ready.':'Could not share the screen: '+e.message}
  }
  function point(e){const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top}}
  function drawPointer(p){
    ctx.save();ctx.strokeStyle='#ff3f55';ctx.fillStyle='rgba(255,63,85,.18)';ctx.lineWidth=3;
    ctx.beginPath();ctx.arc(p.x,p.y,18,0,Math.PI*2);ctx.fill();ctx.stroke();
    ctx.beginPath();ctx.arc(p.x,p.y,4,0,Math.PI*2);ctx.fillStyle='#ff3f55';ctx.fill();ctx.restore();
  }
  canvas.addEventListener('pointerdown',e=>{
    if(!stream||busy)return;e.preventDefault();drawing=true;dragged=false;startPoint=lastPoint=point(e);clearMarks();
    try{canvas.setPointerCapture(e.pointerId)}catch{}
  });
  canvas.addEventListener('pointermove',e=>{
    if(!drawing)return;const p=point(e);
    if(!dragged&&Math.hypot(p.x-startPoint.x,p.y-startPoint.y)>7){dragged=true;ctx.beginPath();ctx.moveTo(startPoint.x,startPoint.y)}
    if(dragged){ctx.lineTo(p.x,p.y);ctx.stroke();lastPoint=p;hasMarks=true}
  });
  async function finishMark(e){
    if(!drawing)return;drawing=false;const p=point(e);
    if(dragged){if(lastPoint&&Math.hypot(p.x-lastPoint.x,p.y-lastPoint.y)>1){ctx.lineTo(p.x,p.y);ctx.stroke()}}
    else drawPointer(p);
    ctx.beginPath();hasMarks=true;status.textContent=dragged?'Region marked. Looking at it…':'Point marked. Looking at it…';await explainFrame();
  }
  canvas.addEventListener('pointerup',finishMark);canvas.addEventListener('pointercancel',()=>{drawing=false;ctx.beginPath()});
  clear.addEventListener('click',()=>{clearMarks();status.textContent='Mark cleared. Click a point or drag around a region on the left.'});
  start.addEventListener('click',startCapture);stop.addEventListener('click',stopCapture);window.addEventListener('resize',()=>{if(stream)resizeCanvas()});
  function showAnswer(data){
    answer.replaceChildren();const title=document.createElement('div');title.className='answer-result-title';title.textContent='NeuraLearn explains';
    const text=document.createElement('p');text.className='answer-result-text';text.textContent=data.explanation||'I could not identify that area. Try marking it more clearly.';answer.append(title,text);
    if(data.context){const context=document.createElement('p');context.className='answer-context';context.textContent=data.context;answer.append(context)}
  }
  async function explainFrame(){
    if(!stream||busy||video.readyState<2)return;busy=true;explain.disabled=true;explain.textContent='Looking at the screen…';
    try{
      const frame=document.createElement('canvas');frame.width=canvas.width;frame.height=canvas.height;const out=frame.getContext('2d');
      out.drawImage(video,0,0,frame.width,frame.height);out.drawImage(canvas,0,0);const image=frame.toDataURL('image/jpeg',.86);
      const r=await fetch('/api/read-screen',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({image,question:question.value.trim(),hasMarks})});
      const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`Screen explanation failed (${r.status})`);
      showAnswer(data);status.textContent='Explanation ready. Click another point or mark another region.';
    }catch(e){answer.replaceChildren();const p=document.createElement('p');p.className='answer-error';p.textContent=e.message;answer.append(p);status.textContent='Could not explain this screen.'}
    finally{busy=false;explain.disabled=!stream;explain.textContent='Explain marked area'}
  }
  explain.addEventListener('click',explainFrame);
})();
