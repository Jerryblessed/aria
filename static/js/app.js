'use strict';
let _narrAudio = null;
const WORKLET_CODE=`class MicProcessor extends AudioWorkletProcessor{process(inputs){const ch=inputs[0][0];if(ch){const p=new Int16Array(ch.length);for(let i=0;i<ch.length;i++)p[i]=Math.max(-32768,Math.min(32767,ch[i]*32768));this.port.postMessage(p.buffer,[p.buffer])}return true}}registerProcessor('mic-processor',MicProcessor);`;
const S={
  hist:[],tl:[],busy:false,presenting:false,cancelPresent:false,
  attaches:[],lastRefs:[],storyCtx:{},activeTab:'chat',
  auth:null,currentProject:null,authCallback:null,googleClientId:'',
  viewMode:'a',theme:localStorage.getItem('aria_theme')||'dark',
  live:{ws:null,audioCtx:null,micCtx:null,micStream:null,camStream:null,
        manualScreen:null,mssActive:false,playing:false,nextPlayTime:0,
        sources:[],connected:false,camInterval:null,scrInterval:null},
  recording:{active:false,recorder:null,chunks:[],startTime:0,timer:null},
  vpMin:false,
  capturedFrameId:null,capturedFrameSource:'camera',
  templates:[],
};
let cardCount=0,ytMeta=null,_userMenuOpen=false,_compiledVideoJobId=null;

const G=id=>document.getElementById(id);
const $stream=G('stream'),$tlPanel=G('tlPanel'),$inp=G('inp'),
      $sendBtn=G('sendBtn'),$arow=G('attachRow'),
      $sImg=G('sImg'),$sVid=G('sVid'),$sTxt=G('sTxt'),$sTxtC=G('sTxtContent'),
      $stage=G('stage'),$narr=G('narr'),$ntxt=G('ntxt'),
      $stageLoad=G('stageLoad'),$loadTxt=G('loadTxt'),
      $prgBar=G('prgBar'),$prgFill=G('prgFill'),
      $expPanel=G('expPanel'),$ctxBar=G('ctxBar'),$ctxTxt=G('ctxTxt'),
      $splash=G('splash'),$insGrid=G('insGrid'),$prepScreen=G('prepScreen');

/* ── Theme ────────────────────────────────────────────────────────────── */
function applyTheme(t){S.theme=t;document.documentElement.setAttribute('data-theme',t);G('themeBtn').textContent=t==='dark'?'🌙':'☀️';localStorage.setItem('aria_theme',t)}
function toggleTheme(){applyTheme(S.theme==='dark'?'light':'dark')}
applyTheme(S.theme);

/* ── Mobile sidebar ───────────────────────────────────────────────────── */
function toggleSidebar(){G('left').classList.toggle('mobile-open');G('leftOverlay').classList.toggle('on')}
function closeSidebar(){G('left').classList.remove('mobile-open');G('leftOverlay').classList.remove('on')}

/* ── Voice panel minimize ─────────────────────────────────────────────── */
function toggleVpMin(){
  S.vpMin=!S.vpMin;G('voicePanel').classList.toggle('minimized',S.vpMin);
  G('vpMinBtn').textContent=S.vpMin?'□':'─';G('vpMinBtn').title=S.vpMin?'Expand':'Minimise';
}

/* ── Draggable PiP ────────────────────────────────────────────────────── */
(function(){
  const el=G('pipContainer');let dr=false,sx,sy,ol,ot;
  el.addEventListener('mousedown',e=>{
    if(e.target.tagName==='VIDEO'||e.target.tagName==='CANVAS')return;
    dr=true;const r=el.getBoundingClientRect();sx=e.clientX;sy=e.clientY;ol=r.left;ot=r.top;
    el.classList.add('dragging');el.style.cssText=`position:fixed;right:auto;bottom:auto;left:${ol}px;top:${ot}px`;e.preventDefault();
  });
  document.addEventListener('mousemove',e=>{if(!dr)return;el.style.left=(ol+e.clientX-sx)+'px';el.style.top=(ot+e.clientY-sy)+'px'});
  document.addEventListener('mouseup',()=>{dr=false;el.classList.remove('dragging')});
  el.addEventListener('touchstart',e=>{const t=e.touches[0];const r=el.getBoundingClientRect();dr=true;sx=t.clientX;sy=t.clientY;ol=r.left;ot=r.top;el.style.cssText=`position:fixed;right:auto;bottom:auto;left:${ol}px;top:${ot}px`},{passive:true});
  document.addEventListener('touchmove',e=>{if(!dr)return;const t=e.touches[0];el.style.left=(ol+t.clientX-sx)+'px';el.style.top=(ot+t.clientY-sy)+'px'},{passive:true});
  document.addEventListener('touchend',()=>{dr=false});
})();

/* ── View mode ────────────────────────────────────────────────────────── */
function setViewMode(mode,silent=false){
  S.viewMode=mode;
  ['a','b','c'].forEach(m=>G('vmode-'+m)?.classList.toggle('active',m===mode));
  const right=G('right'),vh=G('videoHalf'),pip=G('pipContainer');
  pip.classList.remove('on');vh.classList.remove('on');right.classList.remove('split-mode');
  G('splitVideo').style.display='none';G('splitCanvas').style.display='none';
  G('pipVideo').style.display='none';G('pipCanvas').style.display='none';
  if(mode==='b'){pip.classList.add('on');refreshPipCanvas();if(!silent)setVpStatus('⭕ PiP — you can see yourself')}
  else if(mode==='c'){vh.classList.add('on');right.classList.add('split-mode');refreshSplitCanvas();if(!silent)setVpStatus('◧ Split screen')}
  else{if(!silent)setVpStatus('👁 Stealth mode — AI sees you')}
}

/* Paint the latest echoed camera frame onto PiP/split canvases */
let _lastCamFrame=null;
function onVideoEcho(b64){
  _lastCamFrame=b64;
  if(S.live.camStream)return;
  if(S.viewMode==='b')drawB64ToCanvas(b64,G('pipCanvas'),true);
  if(S.viewMode==='c')drawB64ToCanvas(b64,G('splitCanvas'),false);
}
function onMssFrame(b64){
  if(S.viewMode==='b')drawB64ToCanvas(b64,G('pipCanvas'),true);
  if(S.viewMode==='c')drawB64ToCanvas(b64,G('splitCanvas'),false);
  S.live.mssActive=true;
}
function drawB64ToCanvas(b64,canvas,pip){
  if(!canvas)return;
  const img=new Image();
  img.onload=()=>{
    const sz=pip?110:Math.max(canvas.parentElement?.offsetWidth||320,320);
    canvas.width=img.width;canvas.height=img.height;
    canvas.getContext('2d').drawImage(img,0,0);
    canvas.style.display='block';
    if(pip)G('pipVideo').style.display='none';
    else G('splitVideo').style.display='none';
  };
  img.src='data:image/jpeg;base64,'+b64;
}
function refreshPipCanvas(){
  const pv=G('pipVideo'),pc=G('pipCanvas');
  if(S.live.camStream){
    // Use live video element for camera
    pv.srcObject=S.live.camStream;pv.style.display='block';pc.style.display='none';
    G('pipLabel').textContent='Camera';G('pipContainer').classList.add('on');
  }else if(_lastCamFrame||S.live.mssActive){
    pv.style.display='none';
  }
}
function refreshSplitCanvas(){
  const sv=G('splitVideo'),sc=G('splitCanvas');
  if(S.live.camStream){
    sv.srcObject=S.live.camStream;sv.style.display='block';sc.style.display='none';
    G('splitLabel').textContent='Camera';
  }else if(S.live.manualScreen){
    sv.srcObject=S.live.manualScreen;sv.style.display='block';sc.style.display='none';
    G('splitLabel').textContent='Screen Share';
  }
}

/* ── Recording ────────────────────────────────────────────────────────── */
async function startRecording(){
  if(S.recording.active)return;
  try{
    let stream;
    if(S.live.manualScreen)stream=S.live.manualScreen;
    else if(S.live.camStream)stream=S.live.camStream;
    else{
          // Live-render the ARIA stage so recording shows actual content
          const cv=document.createElement('canvas');cv.width=1280;cv.height=720;
          const ctx=cv.getContext('2d');
          const drawFrame=()=>{
            if(!S.recording.active)return;
            ctx.fillStyle='#060811';ctx.fillRect(0,0,1280,720);
            const stageImg=G('sImg'),stageVid=G('sVid'),stageTxt=G('sTxtContent');
            try{
              if(stageImg&&stageImg.src&&stageImg.style.display!=='none'&&stageImg.complete&&stageImg.naturalWidth>0){
                ctx.drawImage(stageImg,0,0,1280,720);
              }else if(stageVid&&stageVid.src&&stageVid.style.display!=='none'&&stageVid.readyState>=2){
                ctx.drawImage(stageVid,0,0,1280,720);
              }else if(stageTxt&&stageTxt.textContent){
                ctx.fillStyle='#0d1a3a';ctx.fillRect(0,0,1280,720);
                ctx.fillStyle='#dde2f0';ctx.font='bold 52px serif';ctx.textAlign='center';
                ctx.fillText((stageTxt.textContent||'').slice(0,60),640,340);
              }else{
                ctx.fillStyle='#060811';ctx.fillRect(0,0,1280,720);
                ctx.fillStyle='#2563eb';ctx.font='bold 80px serif';ctx.textAlign='center';
                ctx.fillText('ARIA',640,300);
                ctx.fillStyle='#22d3ee';ctx.font='28px sans-serif';
                ctx.fillText('Creative Storyteller',640,360);
                ctx.fillStyle=`rgba(239,68,68,${0.5+0.5*Math.sin(Date.now()/400)})`;
                ctx.beginPath();ctx.arc(80,80,16,0,Math.PI*2);ctx.fill();
                ctx.fillStyle='#fff';ctx.font='bold 20px sans-serif';ctx.textAlign='left';
                ctx.fillText('● REC',104,87);
              }
              const narrEl=G('ntxt');
              if(narrEl&&narrEl.textContent&&G('narr').classList.contains('on')){
                ctx.fillStyle='rgba(0,0,0,0.65)';ctx.fillRect(0,620,1280,100);
                ctx.fillStyle='#7a88b0';ctx.font='22px sans-serif';ctx.textAlign='center';
                ctx.fillText((narrEl.textContent||'').slice(0,110),640,675);
              }
            }catch(_){}
            requestAnimationFrame(drawFrame);
          };
          requestAnimationFrame(drawFrame);
          stream=cv.captureStream(30);
        }
    let finalStream=stream;
    if(S.live.micStream){
      try{const at=S.live.micStream.getAudioTracks()[0];if(at)finalStream=new MediaStream([...stream.getVideoTracks(),at])}catch(_){}
    }
    const mimeType=MediaRecorder.isTypeSupported('video/webm;codecs=vp9')?'video/webm;codecs=vp9':'video/webm';
    const recorder=new MediaRecorder(finalStream,{mimeType});
    S.recording.chunks=[];
    recorder.ondataavailable=e=>{if(e.data.size>0)S.recording.chunks.push(e.data)};
    recorder.onstop=saveRecording;
    recorder.start(500);
    S.recording.recorder=recorder;S.recording.active=true;S.recording.startTime=Date.now();
    G('recIndicator').classList.add('on');G('vpRecBtn').classList.add('recording');
    G('vpRecBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="6" y="6" width="12" height="12" rx="1"/></svg> Stop';
    setVpStatus('🔴 Recording…');
    S.recording.timer=setInterval(()=>{
      const s=Math.floor((Date.now()-S.recording.startTime)/1000);
      G('recTime').textContent=String(Math.floor(s/60)).padStart(2,'0')+':'+String(s%60).padStart(2,'0');
    },1000);
    toast('Recording started','ok');
  }catch(e){toast('Recording error: '+e.message,'err')}
}
function stopRecording(){
  if(!S.recording.active||!S.recording.recorder)return;
  S.recording.recorder.stop();S.recording.active=false;clearInterval(S.recording.timer);
  G('recIndicator').classList.remove('on');G('vpRecBtn').classList.remove('recording');
  G('vpRecBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg> Record';
  setVpStatus('💾 Saving recording…');
}
function toggleRecording(){S.recording.active?stopRecording():startRecording()}
async function saveRecording(){
  const blob=new Blob(S.recording.chunks,{type:'video/webm'});
  const duration=Math.round((Date.now()-S.recording.startTime)/1000);
  const name=`ARIA_${new Date().toISOString().slice(0,19).replace(/[T:]/g,'_')}.webm`;
  const reader=new FileReader();
  reader.onload=async e=>{
    try{
      const r=await fetch('/api/recordings/save',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({data:e.target.result,name,duration,token:S.auth?.token||''})
      });
      const d=await r.json();
      if(d.ok){toast(`Saved: ${name}`,'ok');setVpStatus('✓ Recording saved');loadRecordingsList()}
      else toast('Save failed: '+d.error,'err');
    }catch(err){toast('Save error: '+err.message,'err')}
  };
  reader.readAsDataURL(blob);
}
async function loadRecordingsList(){
  try{
    const r=await fetch('/api/recordings',{headers:apiHeaders()});
    const d=await r.json();
    const list=G('vpRecsList');list.innerHTML='';
    const recs=(d.recordings||[]).slice(0,5);
    if(!recs.length){G('vpRecs').classList.remove('on');return}
    G('vpRecs').classList.add('on');
    recs.forEach(rec=>{
      const dur=rec.duration?` · ${Math.floor(rec.duration/60)}:${String(rec.duration%60).padStart(2,'0')}`:'';
      const div=document.createElement('div');div.className='vp-rec-item';
      div.innerHTML=`<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.63rem">${esc(rec.name.slice(0,24))}${dur}</span>
        ${rec.url?`<button class="vp-rec-play" onclick="window.open('${esc(rec.url)}','_blank')">▶</button><a class="vp-rec-dl" href="${esc(rec.url)}" download target="_blank">⬇</a>`:''}`;
      list.appendChild(div);
    });
  }catch(e){console.warn('[recordings]',e)}
}
async function openRecordingsPanel(){
  G('recordingsModal').classList.add('on');
  const list = G('recordingsModalList');
  list.innerHTML = '<div class="proj-empty">Loading…</div>';
  try{
    const r = await fetch('/api/recordings', {headers: apiHeaders()});
    const d = await r.json();
    const recs = d.recordings || [];
    list.innerHTML = '';
    if(!recs.length){list.innerHTML='<div class="proj-empty">No recordings yet.<br>Use Live Voice → Record to capture sessions.</div>';return}
    recs.forEach(rec=>{
      const dur = rec.duration ? `${Math.floor(rec.duration/60)}:${String(rec.duration%60).padStart(2,'0')}` : '--:--';
      const date = rec.created_at ? new Date(rec.created_at*1000).toLocaleString() : '';
      const div = document.createElement('div');
      div.className = 'proj-item';
      div.innerHTML = `
        <div class="proj-item-icon">🎞</div>
        <div class="proj-item-info">
          <div class="proj-item-name">${esc(rec.name||'Recording')}</div>
          <div class="proj-item-meta">${dur} · ${date}</div>
        </div>
        <div class="proj-item-acts">
          ${rec.url?`<button class="pact" onclick="window.open('${esc(rec.url)}','_blank')">▶ Play</button>`:''}
          ${rec.url?`<a class="pact" href="${esc(rec.url)}" download target="_blank">⬇</a>`:''}
          <button class="pact del" onclick="deleteRecording('${rec.id}',this)">✕</button>
        </div>`;
      list.appendChild(div);
    });
  }catch(e){list.innerHTML=`<div class="proj-empty">Error: ${esc(e.message)}</div>`}
}

async function deleteRecording(rid, btn){
  if(!confirm('Delete this recording?')) return;
  btn.closest('.proj-item').style.opacity='.4';
  try{
    await fetch(`/api/recordings/${rid}`, {method:'DELETE', headers:apiHeaders()});
    btn.closest('.proj-item').remove();
    toast('Recording deleted');
  }catch(e){toast('Delete failed','err');btn.closest('.proj-item').style.opacity='1'}
}
/* ── Captured frame (screen-to-story) ─────────────────────────────────── */
function onCapturedFrame(frameId,source){
  S.capturedFrameId=frameId;S.capturedFrameSource=source;
  const banner=G('capturedBanner');
  G('capturedTxt').textContent=`${source==='screen'?'Screen':'Camera'} frame saved`;
  banner.classList.add('on');
  setTimeout(()=>banner.classList.remove('on'),8000);
  toast(`${source==='screen'?'📺 Screen':'📷 Camera'} captured — say "use in story" or click banner`,'ok');
}
function useCapturedFrame(){
  G('capturedBanner').classList.remove('on');
  if(!S.capturedFrameId){toast('No captured frame','err');return}
  const msg=`Generate a cinematic story scene from the captured ${S.capturedFrameSource==='screen'?'screenshot':'camera portrait'} — create a generate_image or generate_video as appropriate`;
  G('inp').value=msg;syncBar();
  // Attach frame to next send
  S._pendingFrameId=S.capturedFrameId;
  toast('Ready — press Enter or click Send to generate','info');
}
function onSendFrameToStory(frameId,message,source){
  // Live voice triggered screen-to-story
  S._pendingFrameId=frameId;S.capturedFrameSource=source;
  if(message)G('inp').value=message;
  syncBar();
  setTimeout(()=>send(),400);
}

/* ── Live Voice ───────────────────────────────────────────────────────── */
function toggleLive(){if(S.live.connected)stopLive();else startLive()}

async function startLive(){
  if(S.live.connected)return;
  const liveBtn=G('liveBtn');liveBtn.classList.add('connecting');
  try{
    const proto=location.protocol==='https:'?'wss':'ws';
    const ws=new WebSocket(`${proto}://${location.host}/ws/live`);
    S.live.ws=ws;
    const audioCtx=new AudioContext({sampleRate:24000,latencyHint:'interactive'});
    S.live.audioCtx=audioCtx;S.live.nextPlayTime=0;S.live.sources=[];
    const micCtx=new AudioContext({sampleRate:16000,latencyHint:'interactive'});
    S.live.micCtx=micCtx;
    const wBlob=new Blob([WORKLET_CODE],{type:'application/javascript'});
    await micCtx.audioWorklet.addModule(URL.createObjectURL(wBlob));
    const micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,sampleRate:16000}});
    S.live.micStream=micStream;
    const micSrc=micCtx.createMediaStreamSource(micStream);
    const worklet=new AudioWorkletNode(micCtx,'mic-processor');
    micSrc.connect(worklet);
    worklet.port.onmessage=e=>{if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({audio:b64FromBuf(e.data)}))};

    // Camera frame sender
    const camCanvas=document.createElement('canvas');camCanvas.width=640;camCanvas.height=480;
    const camCtx=camCanvas.getContext('2d');
    S.live.camInterval=setInterval(()=>{
      if(ws.readyState!==WebSocket.OPEN||!S.live.camStream)return;
      // Find the video element that has the camera stream
      const vids=[G('pipVideo'),G('splitVideo'),G('_camHiddenVid')];
      let vidEl=null;
      for(const v of vids){if(v&&v.srcObject===S.live.camStream&&v.readyState>=2&&v.videoWidth>0){vidEl=v;break}}
      if(!vidEl)return;
      try{
        camCtx.drawImage(vidEl,0,0,640,480);
        const b64=camCanvas.toDataURL('image/jpeg',.6).split(',')[1];
        ws.send(JSON.stringify({video:b64}));
        // Also echo back to show user themselves
        onVideoEcho(b64);
      }catch(e){console.warn('[cam send]',e)}
    },800);

    ws.onopen=()=>{
      S.live.connected=true;liveBtn.classList.remove('connecting');liveBtn.classList.add('live-on');
      G('voicePanel').classList.add('on');setVpStatus('🎙 Listening — speak to ARIA');
      setVpOrb('listening');animateWave(true);toast('ARIA Voice connected','ok');loadRecordingsList();
    };
    ws.onmessage=e=>{
      try{
        const msg=JSON.parse(e.data);
        if(msg.audio)scheduleVoiceAudio(msg.audio);
        if(msg.interrupt)stopVoiceAudio();
        if(msg.tool)handleVoiceTool(msg.tool);
        if(msg.status)setVpStatus(msg.status);
        if(msg.mss_frame)onMssFrame(msg.mss_frame);
        // Server echoes camera frames back for PiP/split
        if(msg.video_echo)onVideoEcho(msg.video_echo);
        if(msg.screen_list)showVpList('📺 Screens',msg.screen_list,item=>{
          if(item.index==='manual')voiceStartManualScreen();
          else ws.send(JSON.stringify({start_mss:parseInt(item.index)}));
        });
        if(msg.tab_list)showVpList('🌐 Tabs',msg.tab_list,item=>ws.send(JSON.stringify({switch_tab:item.index})));
        // Screen/camera → story events from server
        if(msg.captured_frame)onCapturedFrame(msg.captured_frame.frame_id,msg.captured_frame.source);
        if(msg.send_frame_to_story)onSendFrameToStory(msg.send_frame_to_story.frame_id,msg.send_frame_to_story.message,msg.send_frame_to_story.source);
      }catch(_){}
    };
    ws.onclose=()=>{
      S.live.connected=false;liveBtn.classList.remove('live-on','connecting');
      G('voicePanel').classList.remove('on');
      clearInterval(S.live.camInterval);S.live.camInterval=null;
      clearInterval(S.live.scrInterval);S.live.scrInterval=null;
      animateWave(false);setVpOrb('off');stopLiveCam();stopMssStream();stopManualScreen();
      if(S.recording.active)stopRecording();
    };
    ws.onerror=()=>{toast('Voice connection failed','err');liveBtn.classList.remove('connecting')};
  }catch(err){toast(`Voice error: ${err.message}`,'err');G('liveBtn').classList.remove('connecting')}
}

function stopLive(){
  clearInterval(S.live.camInterval);S.live.camInterval=null;
  clearInterval(S.live.scrInterval);S.live.scrInterval=null;
  if(S.live.ws){try{S.live.ws.close()}catch(_){}; S.live.ws=null}
  if(S.live.micStream){S.live.micStream.getTracks().forEach(t=>t.stop());S.live.micStream=null}
  if(S.live.micCtx){try{S.live.micCtx.close()}catch(_){}; S.live.micCtx=null}
  if(S.live.audioCtx){try{S.live.audioCtx.close()}catch(_){}; S.live.audioCtx=null}
  stopLiveCam();stopMssStream();stopManualScreen();S.live.connected=false;
  G('liveBtn').classList.remove('live-on','connecting');G('voicePanel').classList.remove('on');
  animateWave(false);setVpOrb('off');
  setViewMode('a',true);
  if(S.recording.active)stopRecording();
  toast('Voice disconnected');
}

/* ── Camera ───────────────────────────────────────────────────────────── */
async function voiceStartCam(){
  if(S.live.camStream)return;
  try{
    S.live.camStream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:480,facingMode:'user'}});
    // Hidden video element for frame grabbing
    let hv=G('_camHiddenVid');
    if(!hv){hv=document.createElement('video');hv.id='_camHiddenVid';hv.autoplay=true;hv.playsInline=true;hv.muted=true;hv.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0';document.body.appendChild(hv)}
    hv.srcObject=S.live.camStream;hv.play().catch(()=>{});
    G('vpCamBtn').classList.add('active');
    G('vpCamBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> 🟢 On';
    // Show in PiP / split if active
    if(S.viewMode==='b'){
      G('pipVideo').srcObject=S.live.camStream;G('pipVideo').play().
    catch(()=>{});
      G('pipVideo').style.display='block';G('pipCanvas').style.display='none';
      G('pipLabel').textContent='Camera';
    }
    if(S.viewMode==='c'){
      G('splitVideo').srcObject=S.live.camStream;G('splitVideo').play().catch(()=>{});
      G('splitVideo').style.display='block';G('splitCanvas').style.display='none';
      G('splitLabel').textContent='Camera';
    }
    setVpStatus('📷 Camera on');toast('Camera on','ok');
  }catch(e){toast('Camera error: '+e.message,'err')}
}
function stopLiveCam(){
  if(S.live.camStream){S.live.camStream.getTracks().forEach(t=>t.stop());S.live.camStream=null}
  const hv=G('_camHiddenVid');if(hv){hv.srcObject=null}
  G('vpCamBtn').classList.remove('active');
  G('vpCamBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg> Camera';
  G('pipVideo').srcObject=null;G('pipVideo').style.display='none';
  G('splitVideo').srcObject=null;G('splitVideo').style.display='none';
}
function voiceToggleCam(){S.live.camStream?stopLiveCam():voiceStartCam()}

/* ── Screen share (manual) ────────────────────────────────────────────── */
async function voiceStartManualScreen(){
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:10},audio:false});
    S.live.manualScreen=stream;
    await S.live.audioCtx?.resume(); // ← ADD THIS
    if(S.viewMode==='c'){
      G('splitVideo').srcObject=stream;G('splitVideo').play().catch(()=>{});
      G('splitVideo').style.display='block';G('splitCanvas').style.display='none';
      G('splitLabel').textContent='Screen Share';
    }
    G('vpScrBtn').classList.add('active');
    G('vpScrBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> 🟢 On';
    const scrCanvas=document.createElement('canvas');scrCanvas.width=960;scrCanvas.height=540;
    const scrCtx=scrCanvas.getContext('2d');
    const scrVid=document.createElement('video');scrVid.autoplay=true;scrVid.playsInline=true;scrVid.muted=true;
    scrVid.srcObject=stream;scrVid.play().catch(()=>{});
    S.live.scrInterval=setInterval(()=>{
      if(!S.live.ws||S.live.ws.readyState!==WebSocket.OPEN||!S.live.manualScreen)return;
      if(scrVid.readyState<2||scrVid.videoWidth===0)return;
      try{
        scrCtx.drawImage(scrVid,0,0,960,540);
        const b64=scrCanvas.toDataURL('image/jpeg',.55).split(',')[1];
        S.live.ws.send(JSON.stringify({video:b64}));
        if(S.viewMode==='b')drawB64ToCanvas(b64,G('pipCanvas'),true);
      }catch(e){}
    },1000);
    stream.getVideoTracks()[0].onended=()=>stopManualScreen();
    setVpStatus('📺 Screen sharing');toast('Screen sharing started','ok');
  }catch(e){
    if(e.name!=='NotAllowedError')toast('Screen share error: '+e.message,'err');
  }
}
function stopManualScreen(){
  clearInterval(S.live.scrInterval);S.live.scrInterval=null;
  if(S.live.manualScreen){S.live.manualScreen.getTracks().forEach(t=>t.stop());S.live.manualScreen=null}
  G('vpScrBtn').classList.remove('active');
  G('vpScrBtn').innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg> Screen';
  G('splitVideo').srcObject=null;G('splitVideo').style.display='none';
}
function stopMssStream(){
  if(S.live.ws&&S.live.ws.readyState===WebSocket.OPEN)S.live.ws.send(JSON.stringify({stop_mss:true}));
  S.live.mssActive=false;
}
function voiceStartScreen(){
  if(S.live.ws&&S.live.ws.readyState===WebSocket.OPEN)S.live.ws.send(JSON.stringify({get_screens:true}));
  else voiceStartManualScreen();
}
function voiceListTabs(){
  if(S.live.ws&&S.live.ws.readyState===WebSocket.OPEN)S.live.ws.send(JSON.stringify({list_tabs:true}));
  else toast('Voice not connected','err');
}

/* ── Voice audio playback ─────────────────────────────────────────────── */
function b64FromBuf(buf){
  const bytes=new Uint8Array(buf);let s='';
  for(let i=0;i<bytes.length;i++)s+=String.fromCharCode(bytes[i]);
  return btoa(s);
}
function scheduleVoiceAudio(b64){
  if(!S.live.audioCtx)return;
  try{
    const raw=atob(b64);const dv=new DataView(new ArrayBuffer(raw.length));
    for(let i=0;i<raw.length;i++)dv.setUint8(i,raw.charCodeAt(i));
    const buf=new Int16Array(raw.length/2);
    for(let i=0;i<buf.length;i++)buf[i]=dv.getInt16(i*2,true);
    const float=new Float32Array(buf.length);
    for(let i=0;i<buf.length;i++)float[i]=buf[i]/32768;
    const ab=S.live.audioCtx.createBuffer(1,float.length,24000);
    ab.getChannelData(0).set(float);
    const src=S.live.audioCtx.createBufferSource();
    src.buffer=ab;src.connect(S.live.audioCtx.destination);
    const now=S.live.audioCtx.currentTime;
    const start=Math.max(now,S.live.nextPlayTime);
    src.start(start);S.live.nextPlayTime=start+ab.duration;
    S.live.sources.push(src);S.live.playing=true;setVpOrb('speaking');
    src.onended=()=>{
      S.live.sources=S.live.sources.filter(x=>x!==src);
      if(!S.live.sources.length){S.live.playing=false;setVpOrb('listening')}
    };
  }catch(e){console.warn('[audio]',e)}
}
function stopVoiceAudio(){
  S.live.sources.forEach(s=>{try{s.stop()}catch(_){}});
  S.live.sources=[];S.live.playing=false;S.live.nextPlayTime=0;setVpOrb('listening');
}

/* ── VP helpers ───────────────────────────────────────────────────────── */
function setVpOrb(state){
  const o=G('vpOrb');if(!o)return;
  o.className='vp-orb';if(state==='speaking'||state==='listening')o.classList.add(state);
}
function setVpStatus(txt){const el=G('vpStatus');if(el)el.textContent=txt}
function animateWave(on){
  G('vpWave')?.querySelectorAll('.vp-wb').forEach(b=>{
    b.classList.toggle('on',on);
    if(on)b.style.height=(Math.random()*12+3)+'px';else b.style.height='3px';
  });
  if(on){
    if(S._waveTimer)clearInterval(S._waveTimer);
    S._waveTimer=setInterval(()=>{
      if(!S.live.connected){clearInterval(S._waveTimer);return}
      G('vpWave')?.querySelectorAll('.vp-wb.on').forEach(b=>b.style.height=(Math.random()*12+3)+'px');
    },300);
  }
}
function showVpList(title,items,onPick){
  G('vpListTitle').textContent=title;
  const container=G('vpListItems');container.innerHTML='';
  items.forEach(item=>{
    const div=document.createElement('div');div.className='vpl-item';
    const label=item.label||item.title||item.url||String(item.index);
    const badge=item.active?'<span class="vpl-badge grn">Active</span>':'<span class="vpl-badge">'+item.index+'</span>';
    div.innerHTML=`${badge}<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(label)}</span>`;
    div.onclick=()=>{onPick(item);G('vpListPanel').classList.remove('on')};
    container.appendChild(div);
  });
  G('vpListPanel').classList.add('on');
}

/* ── Voice tool handler ───────────────────────────────────────────────── */
function handleVoiceTool(tool){
  const{id,name,args}=tool;
  const reply=result=>S.live.ws?.readyState===WebSocket.OPEN&&S.live.ws.send(JSON.stringify({tool_resp:{id,name,result}}));
  switch(name){
    case 'toggle_camera':args.enabled?voiceStartCam():stopLiveCam();reply(args.enabled?'Camera on':'Camera off');break;
    case 'list_screens':S.live.ws.send(JSON.stringify({get_screens:true}));reply('Screen list requested');break;
    case 'capture_screen':
      if(args.screen==='manual')voiceStartManualScreen().then(()=>reply('Screen sharing started'));
      else{S.live.ws.send(JSON.stringify({start_mss:parseInt(args.screen)||1}));reply('Capturing monitor '+args.screen)}break;
    case 'stop_screen':stopMssStream();stopManualScreen();reply('Screen sharing stopped');break;
    case 'set_theme':applyTheme(args.theme);reply('Theme: '+args.theme);break;
    case 'set_view_mode':setViewMode(args.mode);reply('View: '+args.mode);break;
    case 'start_recording':startRecording().then(()=>reply('Recording started'));break;
    case 'stop_recording':stopRecording();reply('Recording stopped');break;
    case 'list_tabs':S.live.ws.send(JSON.stringify({list_tabs:true}));reply('Tab list requested');break;
    case 'switch_tab':S.live.ws.send(JSON.stringify({switch_tab:args.index}));reply('Switching tab '+args.index);break;
    case 'open_tab': 
    window.open(args.url, '_blank');  // opens in user's real browser
    S.live.ws.send(JSON.stringify({open_tab:args.url}));  // also opens in Playwright
    reply('Opening '+args.url); 
    break;
    case 'close_tab':S.live.ws.send(JSON.stringify({close_tab:args.index}));reply('Closing tab '+args.index);break;
    case 'screenshot_tab':S.live.ws.send(JSON.stringify({screenshot_tab:args.index??-1}));reply('Screenshot taken');break;
    case 'aria_present':present();reply('Presentation started');break;
    case 'aria_stop_present':cancelPresent();reply('Stopped');break;
    case 'aria_clear':clearAll();reply('Cleared');break;
    case 'aria_save_project':saveCurrentProject().then(()=>reply('Saved'));break;
    case 'aria_switch_tab':switchTab(args.tab);reply('Tab: '+args.tab);break;
    case 'aria_open_projects':openProjects();reply('Projects opened');break;
    case 'aria_send_chat':
      if(args.message){G('inp').value=args.message;syncBar();setTimeout(()=>send(),300)}
      reply('Sending');break;
    case 'aria_use_template':{
      const t=S.templates.find(x=>x.id===args.template_id);
      if(t){loadTemplate(t);reply('Template loaded: '+t.title)}else reply('Not found');break;}
    default:reply('ok');
  }
}

/* ── Input bar ────────────────────────────────────────────────────────── */
function syncBar(){
  const v=$inp.value.trim();
  $sendBtn.style.display=(v||S.attaches.length||S._pendingFrameId)?'flex':'none';
}
function requireAuth(cb){if(S.auth){cb();return}S.authCallback=cb;G('authModal').classList.add('on')}
function apiHeaders(){
  const h={'Content-Type':'application/json'};
  if(S.auth?.token)h['X-Token']=S.auth.token;
  return h;
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

/* ── File attach ──────────────────────────────────────────────────────── */
function onFile(input){
  Array.from(input.files).forEach(file=>{
    const reader=new FileReader();
    reader.onload=e=>{S.attaches.push({name:file.name,type:file.type,b64:e.target.result});renderAttaches();syncBar()};
    reader.readAsDataURL(file);
  });
  input.value='';
}
function renderAttaches(){
  $arow.innerHTML='';
  if(!S.attaches.length){$arow.style.display='none';return}
  $arow.style.display='flex';
  S.attaches.forEach((a,i)=>{
    const div=document.createElement('div');div.className='att-item';
    div.innerHTML=`${a.type.startsWith('image/')?`<img src="${a.b64}" alt="">`:'📎'}<span>${esc(a.name.slice(0,18))}</span><span class="arm" onclick="removeAttach(${i})">✕</span>`;
    $arow.appendChild(div);
  });
}
function removeAttach(i){S.attaches.splice(i,1);renderAttaches();syncBar()}

/* ── Send ─────────────────────────────────────────────────────────────── */
async function send(){
  const msg=$inp.value.trim();
  const frameId=S._pendingFrameId||null;
  S._pendingFrameId=null;
  if(!msg&&!S.attaches.length&&!frameId)return;
  if(S.busy)return;
  S.busy=true;$sendBtn.style.display='none';
  if(!$splash.classList.contains('gone')){$splash.classList.add('fade-out');setTimeout(()=>$splash.classList.add('gone'),800)}
  if($insGrid.classList.contains('on')){$insGrid.classList.add('fading');setTimeout(()=>$insGrid.classList.remove('on','fading'),500)}
  const userDiv=document.createElement('div');userDiv.className='mb user';
  userDiv.textContent=msg||(frameId?'[Captured frame]':'[Files]');
  $stream.appendChild(userDiv);$stream.scrollTop=$stream.scrollHeight;
  const thinkDiv=document.createElement('div');thinkDiv.className='mb aria';
  thinkDiv.innerHTML='<div class="albl">ARIA</div><span class="dots-anim">Thinking…</span>';
  $stream.appendChild(thinkDiv);$stream.scrollTop=$stream.scrollHeight;
  if(msg)S.hist.push({role:'user',content:msg});
  const refs=S.attaches.filter(a=>a.type.startsWith('image/')).map(a=>a.b64);
  try{
    const body={message:msg,history:S.hist.slice(-14),image_b64:refs[0]||'',
      frame_id:frameId||'',story_context:S.storyCtx,reference_images:refs};
    const resp=await fetch('/api/chat',{method:'POST',headers:apiHeaders(),body:JSON.stringify(body)});
    let finalPayload=null;
    const reader=resp.body.getReader();const dec=new TextDecoder();let buf='';
    while(true){
      const{done,value}=await reader.read();if(done)break;
      buf+=dec.decode(value,{stream:true});
      const lines=buf.split('\n');buf=lines.pop()||'';
      for(const line of lines){
        if(!line.startsWith('data:'))continue;
        const d=line.slice(5).trim();if(d==='[DONE]')break;
        try{const p=JSON.parse(d);if(p.payload)finalPayload=p.payload}catch(_){}
      }
    }
    if(finalPayload)processPayload(finalPayload,thinkDiv);
    else thinkDiv.innerHTML='<div class="albl">ARIA</div>Sorry, something went wrong. Please try again.';
  }catch(e){thinkDiv.innerHTML=`<div class="albl">ARIA</div>Error: ${esc(e.message)}`}
  $inp.value='';S.attaches=[];renderAttaches();syncBar();
  S.hist.push({role:'assistant',content:'[response]'});
  S.busy=false;$stream.scrollTop=$stream.scrollHeight;
}

/* ── Process payload ──────────────────────────────────────────────────── */
function processPayload(p,thinkDiv){
  const mode=p.mode||'chat';
  const msg=p.aria_message||'';
  const questions=(p.clarifying_questions||[]).filter(Boolean);
  const item=p.timeline_item||null;
  if(p.story_context&&Object.keys(p.story_context).length)
    S.storyCtx=Object.assign(S.storyCtx,p.story_context);
  if(S.storyCtx.visual_style||S.storyCtx.characters?.length){
    $ctxBar.classList.add('on');
    const chars=(S.storyCtx.characters||[]).slice(0,2).join(', ');
    const style=(S.storyCtx.visual_style||'').slice(0,30);
    $ctxTxt.textContent=[chars,style].filter(Boolean).join(' · ')||'Story continuity active';
  }
  let html=`<div class="albl${mode==='clarify'?' cq':''}">ARIA</div>`;
  if(msg)html+=`<p>${esc(msg)}</p>`;
  if(questions.length){
    html+='<div style="margin-top:6px;display:flex;flex-direction:column;gap:3px">';
    questions.forEach(q=>html+=`<div style="font-size:.73rem;color:var(--mu4)"><span class="qdot">›</span> ${esc(q)}</div>`);
    html+='</div>';
  }
  if(p._grounded)html+=`<div style="font-size:.56rem;color:var(--mu2);margin-top:4px">✦ Web-grounded</div>`;
  thinkDiv.className='mb aria'+(mode==='clarify'?' clarify':'');
  thinkDiv.innerHTML=html;
  if(!item)return;
  buildCard(item,mode);
  S.tl.push({...item,_card:'c'+(_cardIdCounter-1),mode});
  updateTlCount();updatePresentBtn();
  if(mode==='generate_image')setTimeout(()=>generateImage(item,S.tl.length-1),200);
  else if(mode==='generate_video')setTimeout(()=>generateVideo(item,S.tl.length-1),200);
}

/* ── Card builder ─────────────────────────────────────────────────────── */
let _cardIdCounter=0;
function buildCard(item,mode){
  const card=document.createElement('div');card.className='tc';
  const cid='c'+(_cardIdCounter++);card.id=cid;
  const idx=S.tl.length;
  const isGen=mode==='generate_image'||mode==='generate_video';
  const isTxt=mode==='generate_text_scene';
  card.innerHTML=`
    <span class="tnum">#${idx+1}</span>
    ${isGen?`<div class="sk sk-img" id="${cid}_sk"></div><div class="prog-bar"><div class="prog-fill" id="${cid}_pg" style="width:5%"></div></div>`:''}
    <span class="tbadge ${isGen?'gen':isTxt?'txt':''}" id="${cid}_badge">
      ${isGen?(mode==='generate_image'?'🖼 Image':'🎬 Video'):isTxt?'📝 Text':'💬 Chat'}
    </span>
    <div class="ttl">${esc(item.title||'Scene')}</div>
    <div class="tnarr" id="${cid}_narr">${esc(item.narration||'')}</div>
    <div class="tc-acts">
      <button class="tact" onclick="showCard(${idx})">▶ View</button>
      <button class="tact" onclick="editNarration(${idx})">✏ Edit</button>
      ${isGen?`<button class="tact" onclick="regenItem(${idx})">↺ Regen</button>`:''}
      <button class="tact" onclick="deleteItem(${idx})" style="color:var(--red2)">✕</button>
    </div>`;
  $tlPanel.appendChild(card);
  return card;
}

/* ── Generate image ───────────────────────────────────────────────────── */
async function generateImage(item,idx){
  if(idx>=S.tl.length)return;
  const entry=S.tl[idx];const cid=entry._card;
  const pg=G(cid+'_pg');const sk=G(cid+'_sk');const badge=G(cid+'_badge');
  try{
    const refs=[...(S.lastRefs||[]),...S.attaches.filter(a=>a.type.startsWith('image/')).map(a=>a.b64)];
    const r=await fetch('/api/generate/image',{method:'POST',headers:apiHeaders(),body:JSON.stringify({
      prompt:item.generation_prompt||item.narration,aspect_ratio:item.aspect_ratio||'16:9',
      style_seed:item.style_seed||S.storyCtx.visual_style||'',
      reference_images:refs.slice(0,4),frame_id:S.capturedFrameId||''
    })});
    const d=await r.json();
    if(!d.job_id)throw new Error(d.error||'No job id');
    if(pg)pg.style.width='20%';
    await pollJob(d.job_id,pct=>{if(pg)pg.style.width=pct+'%'},async jid=>{
      if(pg)pg.parentElement?.remove();if(sk)sk.remove();
      if(badge){badge.className='tbadge done';badge.textContent='✓ Image'}
      const card=G(cid);if(card){
        const img=document.createElement('img');img.className='tthumb';
        img.src=`/api/media/${jid}`;img.onerror=()=>img.remove();
        card.insertBefore(img,card.querySelector('.ttl'));
      }
      S.tl[idx].media_path=`/api/media/${jid}`;
      S.lastRefs=refs.slice(0,2);autoSaveProject();
    });
  }catch(e){
    if(badge){badge.className='tbadge err';badge.textContent='✗ Error'}
    addMsg('aria',`Image generation failed: ${esc(e.message)}`);
  }
}

/* ── Generate video ───────────────────────────────────────────────────── */
async function generateVideo(item,idx){
  if(idx>=S.tl.length)return;
  const entry=S.tl[idx];const cid=entry._card;
  const pg=G(cid+'_pg');const sk=G(cid+'_sk');const badge=G(cid+'_badge');
  try{
    if(pg)pg.style.width='10%';
    const r=await fetch('/api/generate/video',{method:'POST',headers:apiHeaders(),body:JSON.stringify({
      prompt:item.generation_prompt||item.narration,aspect_ratio:item.aspect_ratio||'16:9',
      duration:item.duration_seconds||8,style_seed:item.style_seed||S.storyCtx.visual_style||'',
      reference_image:S.lastRefs?.[0]||'',frame_id:S.capturedFrameId||''
    })});
    const d=await r.json();
    if(!d.job_id)throw new Error(d.error||'No job id');
    await pollJob(d.job_id,pct=>{if(pg)pg.style.width=pct+'%'},async jid=>{
      if(pg)pg.parentElement?.remove();if(sk)sk.remove();
      if(badge){badge.className='tbadge done';badge.textContent='✓ Video'}
      const card=G(cid);if(card){
        const vid=document.createElement('video');vid.className='tthumb';
        vid.src=`/api/media/${jid}`;vid.muted=true;vid.playsInline=true;vid.loop=true;
        vid.onmouseenter=()=>vid.play();vid.onmouseleave=()=>vid.pause();
        card.insertBefore(vid,card.querySelector('.ttl'));
      }
      S.tl[idx].media_path=`/api/media/${jid}`;autoSaveProject();
    });
  }catch(e){
    if(badge){badge.className='tbadge err';badge.textContent='✗ Error'}
    addMsg('aria',`Video generation failed: ${esc(e.message)}`);
  }
}

/* ── Poll job ─────────────────────────────────────────────────────────── */
async function pollJob(jid,onProg,onDone,maxWait=600){
  const start=Date.now();
  while(Date.now()-start<maxWait*1000){
    await sleep(4000);
    try{
      const r=await fetch('/api/job/'+jid);const d=await r.json();
      if(d.progress)onProg(Math.min(d.progress,98));
      if(d.status==='done'){await onDone(jid);return}
      if(d.status==='error')throw new Error(d.error||'Job failed');
    }catch(e){throw e}
  }
  throw new Error('Job timed out');
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

/* ── Timeline actions ─────────────────────────────────────────────────── */
function showCard(idx){
  const item=S.tl[idx];if(!item)return;
  $stage.classList.add('on');hideSplash();
  if(item.media_path){
    const isVid=item.media_path.includes('.mp4')||item.mode==='generate_video';
    if(isVid){$sVid.src=item.media_path;$sVid.style.display='block';$sImg.style.display='none';$sTxt.style.display='none';$sVid.play()}
    else{$sImg.src=item.media_path;$sImg.style.display='block';$sVid.style.display='none';$sTxt.style.display='none'}
    if(item.narration){$ntxt.textContent=item.narration;$narr.classList.add('on')}
  }else{
    $sTxt.style.display='flex';$sImg.style.display='none';$sVid.style.display='none';
    $sTxtC.textContent=item.title||'';
    if(item.narration){$ntxt.textContent=item.narration;$narr.classList.add('on')}
  }
  $expPanel.classList.add('on');
}
function editNarration(idx){
  const item=S.tl[idx];const cid=item._card;const narrEl=G(cid+'_narr');if(!narrEl)return;
  const orig=item.narration||'';
  const ta=document.createElement('textarea');ta.className='narr-edit';ta.value=orig;
  const btns=document.createElement('div');btns.className='edit-btns';
  btns.innerHTML=`<button class="ebtn save">Save</button><button class="ebtn cancel">Cancel</button><button class="ebtn" style="margin-left:auto;font-size:.56rem;color:var(--teal2)" onclick="aiEditNarration(${idx})">✦ AI Rewrite</button>`;
  narrEl.replaceWith(ta);
  btns.querySelector('.save').onclick=()=>{
    item.narration=ta.value;const d=document.createElement('div');d.className='tnarr';d.id=cid+'_narr';d.textContent=ta.value;ta.replaceWith(d);btns.remove();autoSaveProject();
  };
  btns.querySelector('.cancel').onclick=()=>{
    const d=document.createElement('div');d.className='tnarr';d.id=cid+'_narr';d.textContent=orig;ta.replaceWith(d);btns.remove();
  };
  ta.after(btns);ta.focus();
}
async function aiEditNarration(idx){
  const item=S.tl[idx];if(!item)return;
  const cid=item._card;const el=G(cid+'_narr')||document.querySelector(`#${cid} textarea`);
  const txt=el?.value||el?.textContent||item.narration||'';
  try{
    const r=await fetch('/api/narration/edit',{method:'POST',headers:apiHeaders(),
      body:JSON.stringify({mode:'auto',text:txt,scene_title:item.title||''})});
    const d=await r.json();
    if(d.narration){item.narration=d.narration;if(el)el.value!==undefined?el.value=d.narration:el.textContent=d.narration;toast('Rewritten','ok');autoSaveProject()}
  }catch(e){toast('AI rewrite failed','err')}
}
async function regenItem(idx){
  const item=S.tl[idx];if(!item)return;
  const cid=item._card;const card=G(cid);if(card){
    const sk=document.createElement('div');sk.className='sk sk-img';sk.id=cid+'_sk';
    const pgWrap=document.createElement('div');pgWrap.className='prog-bar';
    pgWrap.innerHTML=`<div class="prog-fill" id="${cid}_pg" style="width:5%"></div>`;
    const badge=G(cid+'_badge');if(badge){badge.className='tbadge gen';badge.textContent=item.mode==='generate_video'?'🎬 Video':'🖼 Image'}
    card.querySelector('.tthumb')?.remove();
    const ttl=card.querySelector('.ttl');card.insertBefore(sk,ttl);card.insertBefore(pgWrap,ttl);
  }
  item.mode==='generate_video'?generateVideo(item,idx):generateImage(item,idx);
}
function deleteItem(idx){
  if(idx<0||idx>=S.tl.length)return;
  G(S.tl[idx]._card)?.remove();S.tl.splice(idx,1);
  S.tl.forEach((t,i)=>{const c=G(t._card);if(c){const n=c.querySelector('.tnum');if(n)n.textContent='#'+(i+1)}});
  updateTlCount();updatePresentBtn();autoSaveProject();
}

/* ── Chat helpers ─────────────────────────────────────────────────────── */
function addMsg(role,html){
  const div=document.createElement('div');div.className='mb '+(role==='user'?'user':'aria');
  if(role==='aria')div.innerHTML=`<div class="albl">ARIA</div>${html}`;else div.textContent=html;
  $stream.appendChild(div);$stream.scrollTop=$stream.scrollHeight;return div;
}

/* ── Tabs ─────────────────────────────────────────────────────────────── */
function switchTab(tab){
  S.activeTab=tab;
  G('tabChat').classList.toggle('on',tab==='chat');
  G('tabTL').classList.toggle('on',tab==='timeline');
  $stream.classList.toggle('hide',tab!=='chat');
  $tlPanel.classList.toggle('on',tab==='timeline');
}
function updateTlCount(){G('tlCount').textContent=S.tl.length?`(${S.tl.length})`:''}
function updatePresentBtn(){G('pBtn').style.display=S.tl.some(t=>t.media_path||t.title)?'flex':'none'}

/* ── Present ──────────────────────────────────────────────────────────── */
async function present(){
  if(!S.tl.length){toast('Add scenes first','err');return}
  S.presenting=true;S.cancelPresent=false;G('pBtn').disabled=true;
  hideSplash();$insGrid.classList.remove('on');
  const prepScenes=G('prepScenes');prepScenes.innerHTML='';
  const thumbEls=S.tl.map((item,i)=>{
    const div=document.createElement('div');div.className='prep-scene-thumb';
    div.innerHTML=`<span class="prep-scene-num">${i+1}</span>`;
    if(item.media_path){
      const isVid=item.media_path.includes('.mp4');
      const el=isVid?document.createElement('video'):document.createElement('img');
      el.src=item.media_path;if(isVid){el.muted=true;el.playsInline=true}
      div.appendChild(el);div.classList.add('ready');
    }
    prepScenes.appendChild(div);return div;
  });
  const prepPills=G('prepPills');prepPills.innerHTML='';
  ['Building','Narrating','Presenting'].forEach((l,i)=>{
    const p=document.createElement('div');p.className='prep-pill';p.id='pp_'+i;p.textContent=l;prepPills.appendChild(p);
  });
  $prepScreen.classList.add('on');G('prepFill').style.width='0%';G('prepStatus').textContent='Checking scenes…';
  G('pp_0').classList.add('active');
  const toNarrate=S.tl.filter(t=>t.narration&&!t._audio);
  for(let i=0;i<toNarrate.length;i++){
    if(S.cancelPresent)break;
    G('prepStatus').textContent=`Narrating ${i+1}/${toNarrate.length}…`;
    G('prepFill').style.width=Math.round((i/Math.max(toNarrate.length,1))*40)+'%';
    try{
      const r=await fetch('/api/narrate',{method:'POST',headers:apiHeaders(),body:JSON.stringify({script:toNarrate[i].narration})});
      const d=await r.json();if(d.audio)toNarrate[i]._audio=d.audio;
    }catch(_){}
  }
  G('pp_0').classList.remove('active');G('pp_0').classList.add('done');
  G('pp_1').classList.add('active');G('prepFill').style.width='50%';
  if(S.cancelPresent){endPresent();return}
  await sleep(400);
  G('pp_1').classList.remove('active');G('pp_1').classList.add('done');
  G('pp_2').classList.add('active');G('prepFill').style.width='70%';
  await sleep(300);
  $prepScreen.classList.remove('on');$stage.classList.add('on');$expPanel.classList.add('on');$prgBar.classList.add('on');
  for(let i=0;i<S.tl.length;i++){
    if(S.cancelPresent)break;
    const item=S.tl[i];
    thumbEls.forEach((t,j)=>t.classList.toggle('active',j===i));
    $prgFill.style.width=Math.round((i/S.tl.length)*100)+'%';
    G(item._card)?.classList.add('presenting');
    await showSceneOnStage(item);
    if (_narrAudio) { _narrAudio.pause(); _narrAudio.src = ''; _narrAudio = null }
    if (item._audio) {
      await new Promise(res => {
        const a = new Audio(item._audio); _narrAudio = a;
        const dur = (item.duration_seconds || 8) * 1000 + 1500;
        const t = setTimeout(() => { a.pause(); _narrAudio = null; res() }, dur);
        a.onended = () => { clearTimeout(t); _narrAudio = null; res() };
        a.onerror = () => { clearTimeout(t); _narrAudio = null; res() };
        a.play().catch(() => { clearTimeout(t); _narrAudio = null; res() });
      });
    } else { await sleep((item.duration_seconds || 8) * 1000) }
    G(item._card)?.classList.remove('presenting');
  }
  $prgFill.style.width='100%';endPresent();
}
async function showSceneOnStage(item) {
  [$sImg, $sVid, $sTxt].forEach(el => el.style.display = 'none'); $narr.classList.remove('on');
  if (item.media_path) {
    const isVid = item.media_path.includes('.mp4') || item.mode === 'generate_video';
    if (isVid) {
      await new Promise(res => {
        $sVid.oncanplay = res; $sVid.onerror = res; setTimeout(res, 4000);
        $sVid.src = item.media_path; $sVid.style.display = 'block';
        $sVid.currentTime = 0; $sVid.play().catch(() => { });
      });
    } else {
      await new Promise(res => {
        $sImg.onload = res; $sImg.onerror = res; setTimeout(res, 4000);
        $sImg.src = item.media_path; $sImg.style.display = 'block';
      });
    }
    if (item.narration) { $ntxt.textContent = item.narration; $narr.classList.add('on') }
  } else {
    $sTxt.style.display = 'flex'; $sTxtC.textContent = item.text_overlay || item.title || '';
    if (item.narration) { $ntxt.textContent = item.narration; $narr.classList.add('on') }
  }
}
function cancelPresent(){S.cancelPresent=true}
function endPresent(){
  S.presenting=false;G('pBtn').disabled=false;$prepScreen.classList.remove('on');$prgBar.classList.remove('on');
  ['pp_0','pp_1','pp_2'].forEach(id=>G(id)?.classList.remove('active','done'));
}

/* ── Stage helpers ────────────────────────────────────────────────────── */
function hideSplash(){
  if(!$splash.classList.contains('gone')){$splash.classList.add('fade-out');setTimeout(()=>$splash.classList.add('gone'),800)}
}

/* ── Clear ────────────────────────────────────────────────────────────── */
function clearAll(){
  if((S.tl.length||S.hist.length)&&!confirm('Clear all scenes and chat history?'))return;
  S.tl=[];S.hist=[];S.storyCtx={};S.lastRefs=[];S.attaches=[];
  $tlPanel.innerHTML='';$stream.innerHTML='';renderAttaches();$ctxBar.classList.remove('on');
  $stage.classList.remove('on');$expPanel.classList.remove('on');
  addMsg('aria','Story cleared. What shall we create next?');
  updateTlCount();updatePresentBtn();
  $insGrid.classList.remove('fading');$insGrid.classList.add('on');hideSplash();
}
function clearCtx(){S.storyCtx={};$ctxBar.classList.remove('on');toast('Story context reset')}

/* ── Templates ────────────────────────────────────────────────────────── */
async function loadTemplates(){
  try{
    const interests=(S.auth?.interests||[]).join(',');
    const r=await fetch('/api/templates'+(interests?'?interests='+interests:''));
    const d=await r.json();
    S.templates=d.templates||[];
    renderTemplateGrid(S.templates);renderInterestFilterBar();
  }catch(_){
    const grid=G('igGrid');if(grid)grid.innerHTML='<div class="ig-load">Start typing to create your story</div>';
  }
}
function renderTemplateGrid(templates){
  const grid=G('igGrid');if(!grid)return;
  grid.innerHTML='';
  if(!templates.length){grid.innerHTML='<div class="ig-load">No templates found.<br>Start typing a story idea.</div>';return}
  templates.forEach(t=>{
    const card=document.createElement('div');card.className='icard';
    const tJson=JSON.stringify(t).replace(/"/g,'&quot;');
    card.innerHTML=`
      ${t.badge?`<span class="icard-badge${t.badge==='Live'?' live':''}">${esc(t.badge)}</span>`:''}
      <div class="icard-img-wrap">
        <img class="icard-img" src="${esc(t.img||'')}" alt="${esc(t.title)}" loading="lazy" onerror="this.style.display='none'">
        <div class="anim-overlay anim-${esc(t.animation||'sacred-glow')}"></div>
      </div>
      <div class="icard-body">
        <div class="icard-tag">${esc(t.tag||'')}</div>
        <div class="icard-title">${esc(t.title)}</div>
        <div class="icard-desc">${esc(t.desc||'')}</div>
        <button class="icard-btn" onclick="event.stopPropagation();loadTemplate(${tJson})">Use Template →</button>
      </div>`;
    card.onclick=e=>{if(e.target.tagName!=='BUTTON')loadTemplate(t)};
    grid.appendChild(card);
  });
}
function renderInterestFilterBar(){
  const bar=G('interestFilterBar');if(!bar)return;
  const allTags=[...new Set(S.templates.flatMap(t=>t.interests||[]))].slice(0,10);
  if(!allTags.length)return;
  bar.innerHTML='';
  const allChip=document.createElement('span');allChip.className='ifchip active';allChip.textContent='All';
  allChip.onclick=()=>{bar.querySelectorAll('.ifchip').forEach(c=>c.classList.remove('active'));allChip.classList.add('active');renderTemplateGrid(S.templates)};
  bar.appendChild(allChip);
  allTags.forEach(tag=>{
    const chip=document.createElement('span');chip.className='ifchip';chip.textContent=tag;
    chip.onclick=()=>{bar.querySelectorAll('.ifchip').forEach(c=>c.classList.remove('active'));chip.classList.add('active');renderTemplateGrid(S.templates.filter(t=>(t.interests||[]).includes(tag)))};
    bar.appendChild(chip);
  });
  bar.classList.add('on');
}
function loadTemplate(t){
  if(t.prompt){G('inp').value=t.prompt;syncBar()}
  if(t.style_seed)S.storyCtx.visual_style=t.style_seed;
  if(t.img){
    fetch(t.img).then(r=>r.blob()).then(blob=>{
      const reader=new FileReader();
      reader.onload=e=>{S.attaches=[{name:t.title+'.jpg',type:'image/jpeg',b64:e.target.result}];renderAttaches();syncBar()};
      reader.readAsDataURL(blob);
    }).catch(()=>{});
  }
  $insGrid.classList.add('fading');setTimeout(()=>$insGrid.classList.remove('on','fading'),400);
  hideSplash();G('inp').focus();toast(`Template: ${t.title}`,'ok');
}

/* ── Projects ─────────────────────────────────────────────────────────── */
function openProjects(){requireAuth(async()=>{G('projectsModal').classList.add('on');await refreshProjectsList()})}
function closeProjects(){G('projectsModal').classList.remove('on')}
async function refreshProjectsList(){
  const list=G('projList');
  try{
    const r=await fetch('/api/projects',{headers:apiHeaders()});
    const d=await r.json();list.innerHTML='';
    if(!d.projects?.length){list.innerHTML='<div class="proj-empty">No saved projects yet.</div>';return}
    d.projects.forEach(p=>{
      const div=document.createElement('div');
      div.className='proj-item'+(S.currentProject===p.id?' active':'');
      const scenes=(p.timeline||[]).length;
      const dateStr=p.updated_at?new Date(p.updated_at*1000).toLocaleDateString():'';
      div.innerHTML=`
        <div class="proj-item-icon">📽</div>
        <div class="proj-item-info">
          <div class="proj-item-name" id="pn_${p.id}">${esc(p.name)}</div>
          <div class="proj-item-meta">${scenes} scene${scenes!==1?'s':''} · ${dateStr}</div>
        </div>
        <div class="proj-item-acts">
          <button class="pact" onclick="loadProject('${p.id}')">Load</button>
          <button class="pact" onclick="renameProject('${p.id}')">Rename</button>
          <button class="pact" onclick="dupProject('${p.id}')">Copy</button>
          <button class="pact del" onclick="delProject('${p.id}')">✕</button>
        </div>`;
      list.appendChild(div);
    });
  }catch(_){list.innerHTML='<div class="proj-empty">Error loading projects.</div>'}
}
async function loadProject(pid){
  try{
    const r=await fetch('/api/projects',{headers:apiHeaders()});
    const d=await r.json();const p=d.projects?.find(x=>x.id===pid);
    if(!p){toast('Project not found','err');return}
    S.tl=[];S.hist=p.history||[];S.storyCtx=p.story_context||{};
    $tlPanel.innerHTML='';$stream.innerHTML='';
    (p.timeline||[]).forEach(item=>{
      buildCard(item,item.mode||'generate_image');
      S.tl.push({...item,_card:'c'+(_cardIdCounter-1)});
      if(item.media_path){
        const cid=S.tl[S.tl.length-1]._card;const c=G(cid);if(c){
          const isVid=item.media_path.includes('.mp4');
          const el=isVid?document.createElement('video'):document.createElement('img');
          el.className='tthumb';el.src=item.media_path;
          if(isVid){el.muted=true;el.playsInline=true;el.loop=true;el.onmouseenter=()=>el.play();el.onmouseleave=()=>el.pause()}
          c.insertBefore(el,c.querySelector('.ttl'));
          const badge=G(cid+'_badge');if(badge){badge.className='tbadge done';badge.textContent=isVid?'✓ Video':'✓ Image'}
          G(cid+'_sk')?.remove();G(cid+'_pg')?.parentElement?.remove();
        }
      }
    });
    (p.history||[]).slice(-6).forEach(h=>addMsg(h.role==='user'?'user':'aria',esc(h.content||'')));
    S.currentProject=pid;updateTlCount();updatePresentBtn();closeProjects();
    toast(`Loaded: ${p.name}`,'ok');hideSplash();$insGrid.classList.remove('on');
  }catch(e){toast('Load failed: '+e.message,'err')}
}
function newProject(){S.currentProject=null;clearAll();closeProjects();toast('New project')}
async function saveCurrentProject(){
  requireAuth(async()=>{
    const name=S.currentProject?(G('pn_'+S.currentProject)?.textContent||'My Story'):'My Story '+new Date().toLocaleDateString();
    const items=S.tl.map(t=>({title:t.title||'',narration:t.narration||'',generation_prompt:t.generation_prompt||'',
      media_path:t.media_path||'',aspect_ratio:t.aspect_ratio||'16:9',style_seed:t.style_seed||'',
      duration_seconds:t.duration_seconds||8,mode:t.mode||'chat',text_overlay:t.text_overlay||'',sort_order:t.sort_order||0}));
    try{
      const r=await fetch('/api/projects/save',{method:'POST',headers:apiHeaders(),
        body:JSON.stringify({id:S.currentProject||undefined,name,timeline:items,history:S.hist.slice(-10),story_context:S.storyCtx})});
      const d=await r.json();
      if(d.id){S.currentProject=d.id;toast('Saved ✓','ok');await refreshProjectsList()}
      else toast('Save failed','err');
    }catch(e){toast('Save error: '+e.message,'err')}
  });
}
let _autoSaveTimer=null;
function autoSaveProject(){
  if(!S.currentProject||!S.auth)return;
  clearTimeout(_autoSaveTimer);_autoSaveTimer=setTimeout(()=>saveCurrentProject(),4000);
}
async function renameProject(pid){
  const nameEl=G('pn_'+pid);if(!nameEl)return;const old=nameEl.textContent;
  const inp=document.createElement('input');inp.className='proj-name-input';inp.value=old;
  nameEl.replaceWith(inp);inp.focus();
  const save=async()=>{
    const newName=inp.value.trim()||old;
    try{
      const r=await fetch('/api/projects',{headers:apiHeaders()});
      const d=await r.json();const p=d.projects?.find(x=>x.id===pid);
      if(p){await fetch('/api/projects/save',{method:'POST',headers:apiHeaders(),body:JSON.stringify({...p,name:newName})});
        toast('Renamed','ok');await refreshProjectsList()}
    }catch(_){}
  };
  inp.onblur=save;inp.onkeydown=e=>{if(e.key==='Enter')inp.blur()};
}
async function dupProject(pid){
  try{await fetch(`/api/projects/${pid}/duplicate`,{method:'POST',headers:apiHeaders()});toast('Duplicated','ok');await refreshProjectsList()}
  catch(_){toast('Duplicate failed','err')}
}
async function delProject(pid){
  if(!confirm('Delete this project?'))return;
  try{await fetch(`/api/projects/${pid}`,{method:'DELETE',headers:apiHeaders()});
    if(S.currentProject===pid)S.currentProject=null;toast('Deleted');await refreshProjectsList()}
  catch(_){toast('Delete failed','err')}
}

/* ── Export ───────────────────────────────────────────────────────────── */
async function doExportVideo(){
  if(!S.tl.length){toast('No scenes','err');return}
  G('videoExportModal').classList.add('on');
  G('vexpPct').textContent='0%';G('vexpFill').style.width='0%';
  G('vexpMsg').textContent='Sending to renderer…';G('vexpDl').style.display='none';
  G('vexpErr').classList.remove('on');G('vexpRing').style.display='block';
  try{
    const r=await fetch('/api/export/video',{method:'POST',headers:apiHeaders(),
      body:JSON.stringify({items:S.tl.map(t=>({title:t.title,narration:t.narration,media_path:t.media_path||'',duration:t.duration_seconds||8}))})});
    const d=await r.json();
    if(!d.job_id)throw new Error(d.error||'No job id');
    _compiledVideoJobId=d.job_id;
    await pollJob(d.job_id,pct=>{G('vexpPct').textContent=pct+'%';G('vexpFill').style.width=pct+'%';G('vexpMsg').textContent='Compiling… '+pct+'%'},
      async()=>{G('vexpPct').textContent='100%';G('vexpFill').style.width='100%';G('vexpMsg').textContent='Ready!';G('vexpRing').style.display='none';G('vexpDl').style.display='inline-block';toast('Video ready!','ok')});
  }catch(e){G('vexpErr').textContent=e.message;G('vexpErr').classList.add('on');G('vexpRing').style.display='none'}
}
function downloadCompiledVideo(){if(_compiledVideoJobId)window.open(`/api/media/${_compiledVideoJobId}`,'_blank')}
async function exportYT(){
  if(!S.tl.length){toast('No scenes','err');return}
  try{
    const r=await fetch('/api/export/youtube',{method:'POST',headers:apiHeaders(),
      body:JSON.stringify({project_title:'My ARIA Story',items:S.tl})});
    ytMeta=await r.json();
    G('ytFields').innerHTML=`
      <div class="modal-field"><div class="modal-label">Title</div><div class="modal-val">${esc(ytMeta.title||'')}</div></div>
      <div class="modal-field"><div class="modal-label">Description</div><div class="modal-val" style="max-height:100px;overflow-y:auto">${esc(ytMeta.description||'')}</div></div>
      <div class="modal-field"><div class="modal-label">Tags</div><div class="modal-val">${esc((ytMeta.tags||[]).join(', '))}</div></div>
      <div class="modal-field"><div class="modal-label">Instructions</div><div class="modal-val">${esc(ytMeta.instructions||'')}</div></div>`;
    G('ytModal').classList.add('on');
  }catch(e){toast('Export failed: '+e.message,'err')}
}
function copyYtMeta(){
  if(!ytMeta)return;
  navigator.clipboard.writeText(`Title: ${ytMeta.title}\n\nDescription:\n${ytMeta.description}\n\nTags: ${(ytMeta.tags||[]).join(', ')}`).then(()=>toast('Copied','ok'));
}

/* ── Auth ─────────────────────────────────────────────────────────────── */
function authTab(tab){
  G('atSignIn').classList.toggle('on',tab==='signin');G('atRegister').classList.toggle('on',tab==='register');
  G('authSignIn').style.display=tab==='signin'?'block':'none';G('authRegister').style.display=tab==='register'?'block':'none';
  G('authForgot').style.display='none';G('googleAuthSection').style.display=tab==='signin'?'block':'none';
}
function showForgot(){G('authSignIn').style.display='none';G('authForgot').style.display='block';G('googleAuthSection').style.display='none'}
async function doSignIn(){
  const email=G('siEmail').value.trim(),pw=G('siPw').value;const errEl=G('siErr');errEl.classList.remove('on');
  if(!email||!pw){errEl.textContent='Please enter email and password.';errEl.classList.add('on');return}
  G('siBtn').disabled=true;G('siBtn').textContent='Signing in…';
  try{
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password:pw})});
    const d=await r.json();
    if(d.token)onAuthSuccess(d);else{errEl.textContent=d.error||'Sign in failed';errEl.classList.add('on')}
  }catch(_){errEl.textContent='Connection error';errEl.classList.add('on')}
  G('siBtn').disabled=false;G('siBtn').textContent='Sign In';
}
async function doRegister(){
  const name=G('regName').value.trim(),email=G('regEmail').value.trim(),pw=G('regPw').value;
  const errEl=G('regErr');errEl.classList.remove('on');
  if(!name||!email||!pw){errEl.textContent='Please fill all fields.';errEl.classList.add('on');return}
  G('regBtn').disabled=true;G('regBtn').textContent='Creating…';
  try{
    const r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,email,password:pw})});
    const d=await r.json();
    if(d.token)onAuthSuccess(d);else{errEl.textContent=d.error||'Registration failed';errEl.classList.add('on')}
  }catch(_){errEl.textContent='Connection error';errEl.classList.add('on')}
  G('regBtn').disabled=false;G('regBtn').textContent='Create Account';
}
async function doForgot(){
  const email=G('fgtEmail').value.trim();if(!email)return;
  await fetch('/api/auth/forgot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  G('fgtOk').classList.add('on');
}
async function signInWithGoogle(){
  const btn=G('googleBtn');btn.disabled=true;btn.textContent='Connecting…';
  try{
    if(!S.googleClientId){const cfg=await(await fetch('/api/config')).json();S.googleClientId=cfg.google_client_id||''}
    if(!S.googleClientId){toast('Google sign-in not configured','err');btn.disabled=false;btn.innerHTML='<img src="https://www.google.com/favicon.ico" width="16"> Continue with Google';return}
    google.accounts.id.initialize({client_id:S.googleClientId,callback:async resp=>{
      try{
        const r=await fetch('/api/auth/google',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id_token:resp.credential})});
        const d=await r.json();
        if(d.token)onAuthSuccess(d);else toast(d.error||'Google sign-in failed','err');
      }catch(_){toast('Google error','err')}
      btn.disabled=false;btn.innerHTML='<img src="https://www.google.com/favicon.ico" width="16"> Continue with Google';
    }});
    google.accounts.id.prompt(n=>{if(n.isNotDisplayed()||n.isSkippedMoment())google.accounts.id.renderButton(btn,{theme:'outline',size:'large'})});
  }catch(e){toast('Google error: '+e.message,'err');btn.disabled=false;btn.innerHTML='<img src="https://www.google.com/favicon.ico" width="16"> Continue with Google'}
}
function onAuthSuccess(d){
  S.auth={...d.user,token:d.token};localStorage.setItem('aria_token',d.token);
  G('authModal').classList.remove('on');updateUserUI();
  if(d.user.is_new||!d.user.interests?.length)showInterestModal(false);
  else{loadTemplates();if(S.authCallback){S.authCallback();S.authCallback=null}}
  toast(`Welcome${d.user.name?' '+d.user.name.split(' ')[0]:''}!`,'ok');
}
function updateUserUI(){
  G('navSignInBtn').classList.add('hidden');G('userBadge').classList.add('on');
  G('uAvatar').textContent=(S.auth.name||'U')[0].toUpperCase();
  G('userName').textContent=S.auth.name?.split(' ')[0]||'';G('umEmail').textContent=S.auth.email||'';
}
function doLogout(){S.auth=null;localStorage.removeItem('aria_token');G('navSignInBtn').classList.remove('hidden');G('userBadge').classList.remove('on');closeUserMenu();toast('Signed out')}
function toggleUserMenu(){_userMenuOpen=!_userMenuOpen;G('userMenu').classList.toggle('on',_userMenuOpen)}
function closeUserMenu(){_userMenuOpen=false;G('userMenu').classList.remove('on')}
document.addEventListener('click',e=>{if(_userMenuOpen&&!G('userMenu').contains(e.target)&&!G('userBadge').contains(e.target))closeUserMenu()});

/* ── Interests ────────────────────────────────────────────────────────── */
const INTEREST_CATEGORIES={
  'Industry':[
    {id:'marketing',icon:'📣',label:'Marketing & Brand'},
    {id:'education',icon:'🎓',label:'Education'},
    {id:'journalism',icon:'📰',label:'Journalism'},
    {id:'social',icon:'📱',label:'Social Media'},
  ],
  'Genre':[
    {id:'biblical',icon:'✝️',label:'Biblical & Faith'},
    {id:'documentary',icon:'🎬',label:'Documentary'},
    {id:'children',icon:'🧸',label:'Children & Family'},
    {id:'nature',icon:'🌿',label:'Nature'},
    {id:'adventure',icon:'⚔️',label:'Adventure'},
    {id:'parable',icon:'🕊️',label:'Parables & Wisdom'},
    {id:'redemption',icon:'🌅',label:'Redemption'},
    {id:'action',icon:'🔥',label:'Action & Thriller'},
    {id:'fiction',icon:'🔍',label:'Fiction & Mystery'},
    {id:'family',icon:'👨‍👩‍👧',label:'Family Stories'},
  ]
};
let _selectedInterests=[];
function showInterestModal(edit=false){
  _selectedInterests=edit?(S.auth?.interests||[]).slice():[];
  G('interestModal').classList.add('on');renderInterestChips();updateIntCounter();
}
function renderInterestChips(){
  G('intIndustryGrid').innerHTML='';G('intGenreGrid').innerHTML='';
  Object.entries(INTEREST_CATEGORIES).forEach(([section,items])=>{
    const grid=section==='Industry'?G('intIndustryGrid'):G('intGenreGrid');
    items.forEach(item=>{
      const chip=document.createElement('div');chip.className='int-chip'+(_selectedInterests.includes(item.id)?' sel':'');
      chip.innerHTML=`<span class="int-chip-icon">${item.icon}</span><span class="int-chip-label">${item.label}</span>`;
      chip.onclick=()=>{
        if(_selectedInterests.includes(item.id)){_selectedInterests=_selectedInterests.filter(x=>x!==item.id);chip.classList.remove('sel')}
        else if(_selectedInterests.length<3){_selectedInterests.push(item.id);chip.classList.add('sel')}
        updateIntCounter();
      };
      grid.appendChild(chip);
    });
  });
}
function updateIntCounter(){G('intCount').textContent=_selectedInterests.length;G('intDoneBtn').disabled=_selectedInterests.length!==3}
async function saveInterests(){
  if(_selectedInterests.length!==3)return;
  if(S.auth){try{await fetch('/api/auth/interests',{method:'POST',headers:apiHeaders(),body:JSON.stringify({token:S.auth.token,interests:_selectedInterests})});S.auth.interests=_selectedInterests}catch(_){}}
  G('interestModal').classList.remove('on');loadTemplates();
  if(S.authCallback){S.authCallback();S.authCallback=null}
  toast('Interests saved','ok');
}

/* ── Toast ────────────────────────────────────────────────────────────── */
function toast(msg,type=''){
  const el=document.createElement('div');el.className='tn'+(type?' '+type:'');el.textContent=msg;
  G('toast').appendChild(el);
  setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(4px)';setTimeout(()=>el.remove(),300)},3000);
}

/* ── Session restore ──────────────────────────────────────────────────── */
async function restoreSession(){
  const token=localStorage.getItem('aria_token');if(!token)return;
  try{
    const r=await fetch('/api/auth/validate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})});
    const d=await r.json();
    if(d.user){S.auth={...d.user,token};updateUserUI();loadTemplates()}
  }catch(_){}
}

/* ── Init ─────────────────────────────────────────────────────────────── */
async function init(){
  try{const c=await(await fetch('/api/config')).json();S.googleClientId=c.google_client_id||''}catch(_){}
  await restoreSession();
  setTimeout(()=>{
    if(!$splash.classList.contains('gone')){
      $splash.classList.add('fade-out');
      setTimeout(()=>{$splash.classList.add('gone');$insGrid.classList.add('on')},800);
    }
  },2000);
  if(!S.auth)loadTemplates();
}
init();
