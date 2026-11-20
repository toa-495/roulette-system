import {recordingAudio,createWheelRenderer,spinPosition} from './wheel.js?v=20261120-video3';

export function recordingMime(Recorder = globalThis.MediaRecorder) {
  if (!Recorder) return '';
  const choices = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp8,opus','video/webm'];
  return choices.find(type=>Recorder.isTypeSupported?.(type)) || '';
}
export function recordingSupported() {
  return typeof globalThis.MediaRecorder === 'function' && typeof document.createElement('canvas').captureStream === 'function';
}
function plain(rich) {
  return new DOMParser().parseFromString((rich || '').replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-4]|blockquote)>/gi,'\n'),'text/html').body.textContent.trim();
}
function lines(ctx,text,width) {
  const result=[];
  for (const paragraph of String(text || '').split('\n')) {
    let line='';
    for (const char of Array.from(paragraph)) {
      if (line && ctx.measureText(line+char).width > width) {result.push(line);line='';}
      line+=char;
    }
    result.push(line);
  }
  return result;
}
export function recordingTimeline(first,reduceMotion = false) {
  const reveals=new Map();
  let currentSpin;
  let initial=true;
  return (frame,at)=>{
    const progress={},cues=[];
    for(const person of frame.people) {
      if(!person.proposal) {progress[person.userId]=0;continue;}
      const key=JSON.stringify([person.userId,person.openedAt || 0]);
      if(!reveals.has(key)) {
        const p=Math.max(0,Math.min(1,frame.revealProgress?.[person.userId] ?? (initial?1:0)));
        reveals.set(key,at-p*2400);
        if(p<1 && !cues.some(cue=>cue.kind==='reveal')) cues.push({kind:'reveal',elapsed:p*2.4});
      }
      progress[person.userId]=Math.min(1,Math.max(0,(at-reveals.get(key))/2400));
    }
    initial=false;
    let pose={progress:1,turns:0};
    if(frame.spin) {
      if(currentSpin?.id!==frame.spin.id) {
        const elapsed=Number.isFinite(frame.serverNow)?frame.serverNow-frame.spin.startAt:(frame.spinning?0:frame.spin.duration);
        currentSpin={id:frame.spin.id,at,elapsed,lastTick:-1,lastSound:-Infinity,finished:elapsed>=frame.spin.duration};
      }
      pose=spinPosition(frame.spin,currentSpin.elapsed+at-currentSpin.at,reduceMotion);
      const tick=Math.floor(pose.turns*frame.spin.candidates.length);
      if(pose.progress>0 && pose.progress<1 && tick!==currentSpin.lastTick && currentSpin.lastTick>=0 && at-currentSpin.lastSound>=42) {
        cues.push({kind:'tick'});currentSpin.lastSound=at;
      }
      currentSpin.lastTick=tick;
      if(pose.progress===1 && !currentSpin.finished) {cues.push({kind:'finish'});currentSpin.finished=true;}
    }
    const winner=frame.spin && pose.progress===1?frame.people.find(person=>person.userId===frame.spin.winnerId && person.proposal) || frame.winner:null;
    const candidates=frame.spin?frame.spin.candidates:frame.people.map(person=>({userId:person.userId,name:person.name,title:person.proposal?.title || '未開示'}));
    return {...frame,winner,spinning:!!frame.spin && pose.progress<1,revealProgress:progress,turns:pose.turns,cues,
      wheelCandidates:candidates.map(person=>({...person,title:progress[person.userId]===undefined || progress[person.userId]>=1?person.title:frame.people.find(item=>item.userId===person.userId)?.proposal?'開示中…':'未開示'}))};
  };
}
function painter(canvas) {
  const ctx=canvas.getContext('2d');
  const layer=document.createElement('canvas');layer.width=648;
  const text=layer.getContext('2d');
  const mosaic=document.createElement('canvas');
  const titleLayer=document.createElement('canvas');
  const disk=document.createElement('canvas');
  let paintWheel,wheelKey='';
  const fitted=new Map();
  let focused='',focusAt=0,cachedKey='',cachedLines=[];
  function fit(g,value,width) {
    const key=g.font+':'+width+':'+value;
    if(fitted.has(key)) return fitted.get(key);
    let result=String(value || '');
    if(g.measureText(result).width>width) {
      const chars=Array.from(result);
      while(chars.length && g.measureText(chars.join('')+'…').width>width) chars.pop();
      result=chars.join('')+'…';
    }
    if(fitted.size>600) fitted.clear();
    fitted.set(key,result);return result;
  }
  function showLayer(source,x,y,width,height,progress) {
    ctx.save();ctx.globalAlpha=.23+.77*progress;
    if(progress<1) {
      const scale=.025+.975*progress*progress;
      mosaic.width=Math.max(1,Math.round(source.width*scale));mosaic.height=Math.max(1,Math.round(source.height*scale));
      mosaic.getContext('2d').drawImage(source,0,0,mosaic.width,mosaic.height);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(mosaic,x,y,width,height);
    } else ctx.drawImage(source,x,y,width,height);
    ctx.restore();
  }
  function write(value,x,y,width,font,color,max=2) {
    ctx.font=font;ctx.fillStyle=color;
    const wrapped=lines(ctx,value,width);
    wrapped.slice(0,max).forEach((line,i)=>ctx.fillText(line+(i===max-1 && wrapped.length>max?'…':''),x,y+i*38));
  }
  return (frame,at)=>{
    ctx.fillStyle='#f6f5ef';ctx.fillRect(0,0,720,1280);
    ctx.textBaseline='top';
    write(frame.eventTitle,36,24,648,'800 28px system-ui,sans-serif','#212538',1);
    write(frame.slotTitle,36,68,648,'600 23px system-ui,sans-serif','#676b70',1);
    const columns=frame.people.length<=1?1:frame.people.length<=8?2:3;
    const rows=Math.max(1,Math.ceil(frame.people.length/columns));
    const cellHeight=Math.min(78,Math.floor(264/rows));
    const cellWidth=(672-(columns-1)*8)/columns;
    for(const [index,person] of frame.people.entries()) {
      const x=24+(index%columns)*(cellWidth+8),y=116+Math.floor(index/columns)*cellHeight;
      const compact=cellHeight<46;
      const boxHeight=cellHeight-(compact?2:5);
      ctx.fillStyle=frame.winner?.userId===person.userId?'#f6df9f':'#fffdf7';
      ctx.fillRect(x,y,cellWidth,boxHeight);
      ctx.strokeStyle='#d8dbd2';ctx.lineWidth=1;ctx.strokeRect(x,y,cellWidth,boxHeight);
      const nameSize=compact?Math.max(9,Math.min(12,Math.floor(cellHeight*.37))):Math.min(21,Math.floor(cellHeight*.32));
      const titleSize=compact?Math.max(9,Math.min(11,Math.floor(cellHeight*.34))):Math.min(18,Math.floor(cellHeight*.28));
      const pad=compact?1:Math.min(9,cellHeight*.1);
      ctx.fillStyle='#24334a';ctx.font='700 '+nameSize+'px system-ui,sans-serif';
      ctx.fillText(fit(ctx,person.name,cellWidth-16),x+8,y+pad);
      const titleY=y+pad+nameSize+(compact?1:4);
      titleLayer.width=Math.floor(cellWidth-16);titleLayer.height=titleSize+(compact?2:4);
      const g=titleLayer.getContext('2d');g.textBaseline='top';g.font='600 '+titleSize+'px system-ui,sans-serif';g.fillStyle='#24334a';
      g.fillText(fit(g,person.proposal?.title || '未開示',cellWidth-16),0,0);
      showLayer(titleLayer,x+8,titleY,titleLayer.width,titleLayer.height,person.proposal?frame.revealProgress[person.userId] ?? 1:1);
    }
    const detailY=116+rows*cellHeight+12;
    const detailHeight=622-detailY;
    const person=frame.winner || frame.people.find(item=>item.userId===frame.focusId) || frame.people.find(item=>item.proposal) || frame.people[0];
    const proposal=person?.proposal;
    const key=person?.userId || '';
    const focusKey=key+':'+!!frame.winner;
    if (focusKey!==focused) {focused=focusKey;focusAt=at;cachedKey='';}
    ctx.fillStyle=frame.winner?'#fbefce':'#fffdf7';ctx.fillRect(24,detailY,672,detailHeight);
    write(frame.winner?'決定：'+person.name+' さん':person?person.name+' さんの予定':'みんなの予定',40,detailY+9,630,'800 24px system-ui,sans-serif','#24334a',1);
    const layerHeight=Math.floor(detailHeight-48);
    if(layer.height!==layerHeight) layer.height=layerHeight;
    text.clearRect(0,0,648,layerHeight);text.textBaseline='top';text.fillStyle='#212538';
    let font=30,title;
    do {text.font='800 '+font+'px system-ui,sans-serif';title=lines(text,proposal?.title || '名前をタップして予定を開示',620);if(title.length*(font+6)<layerHeight*.6 || font<=20) break;font-=2;} while(true);
    title.forEach((value,i)=>text.fillText(value,8,i*(font+6)));
    const descY=title.length*(font+6)+12;
    text.font='400 24px system-ui,sans-serif';
    const contentKey=proposal?JSON.stringify([proposal.id,proposal.revision,proposal.title,proposal.rich,proposal.locations,proposal.links,layerHeight]):'';
    if(contentKey!==cachedKey) {
      cachedKey=contentKey;focusAt=at;
      const body=proposal?[plain(proposal.rich),...(proposal.locations || []),...(proposal.links || [])].filter(Boolean).join('\n'):'';
      cachedLines=lines(text,body,620);
    }
    text.save();text.beginPath();text.rect(0,descY,648,Math.max(0,layerHeight-descY));text.clip();
    const overflow=Math.max(0,cachedLines.length*33-(layerHeight-descY));
    const scroll=Math.min(overflow,Math.max(0,at-focusAt-4000)*.025);
    cachedLines.forEach((value,i)=>text.fillText(value,8,descY+i*33-scroll));text.restore();
    const progress=proposal?Math.max(0,Math.min(1,frame.revealProgress?.[key] ?? 1)):1;
    showLayer(layer,36,detailY+43,648,layerHeight,progress);
    const signature=JSON.stringify(frame.wheelCandidates);
    if(signature!==wheelKey) {paintWheel=createWheelRenderer(disk,frame.wheelCandidates,1);wheelKey=signature;}
    paintWheel(frame.turns);
    ctx.drawImage(disk,100,654,520,520);
    ctx.fillStyle='#d84d40';ctx.strokeStyle='#792c33';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(343,655);ctx.lineTo(377,655);ctx.lineTo(360,700);ctx.closePath();ctx.fill();ctx.stroke();
    const count=frame.people.filter(item=>item.proposal).length;
    write(frame.winner?'決定！':frame.spinning?'ルーレット抽選中…':count+' / '+frame.people.length+' 件 開示',36,1184,648,'800 29px system-ui,sans-serif','#24334a',1);
    write('1日ルーレット',36,1234,648,'400 20px system-ui,sans-serif','#676b70',1);
  };
}

export async function startRecording({read,onReady,onError,onStop}) {
  if(!recordingSupported()) throw new Error('このブラウザでは動画を作成できません。ChromeやSafariの最新版でお試しください。');
  const first=read();
  if(!first) throw new Error('時間枠を開いてから記録してください。');
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
  const paint=painter(canvas);
  const baseline=first.spin?.id || '';
  let audio,stream,recorder,frameId,wake,videoTrack,reason='',cancelled=false,stopping=false,cleaned=false;
  let endSpin='',endAt=0,lastPaint=-Infinity,bytes=0;
  let origin=0,began=0,timeline,lastFrame=first,started=false,rejectStart;
  const reduceMotion=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || false;
  const chunks=[];
  let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  function cleanup() {
    if(cleaned) return;cleaned=true;
    cancelAnimationFrame(frameId);
    document.removeEventListener('visibilitychange',hidden);
    stream?.getTracks().forEach(track=>track.stop());
    audio?.close();wake?.release().catch(()=>{});
  }
  const timestamp=()=>audio?.now?audio.now():performance.now();
  function paintFrame(raw) {
    lastFrame=raw;
    const time=Math.max(0,timestamp()-origin);
    const frame=timeline(raw,time);
    paint(frame,time);
    videoTrack?.requestFrame?.();
    for(const cue of frame.cues) audio?.[cue.kind]?.(cue.elapsed || 0);
    return frame;
  }
  function stop(message='') {
    if(stopping) return done;
    stopping=true;reason=message;cancelAnimationFrame(frameId);
    if(started && !cancelled && !document.hidden) {
      try {paintFrame(read() || lastFrame);} catch {}
      // Submit the final picture before asking the encoder to flush its tracks.
      setTimeout(()=>{if(recorder?.state!=='inactive') recorder.stop();},70);
    } else if(recorder?.state!=='inactive') recorder.stop();
    return done;
  }
  function hidden() {if(document.hidden) stop('画面が非表示になったため、そこまでの動画を保存しました。');}
  try {
    // Canvas + app audio only: no camera, microphone, password dialog or other tabs.
    audio=await recordingAudio();
    paint(recordingTimeline(first,reduceMotion)(first,0),0);
    stream=canvas.captureStream(0);
    videoTrack=stream.getVideoTracks?.()[0];
    if(typeof videoTrack?.requestFrame!=='function') {
      stream.getTracks().forEach(track=>track.stop());
      stream=canvas.captureStream(24);videoTrack=stream.getVideoTracks?.()[0];
    }
    for(const track of audio?.stream.getAudioTracks() || []) stream.addTrack(track);
    const mimeType=recordingMime();
    recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:2500000});
    recorder.ondataavailable=event=>{
      if(event.data?.size) {chunks.push(event.data);bytes+=event.data.size;}
      if(bytes>120*1024*1024) stop('動画の容量が大きくなったため記録を終了しました。');
    };
    recorder.onerror=()=>{
      cancelled=true;
      const error=new Error('動画の記録に失敗しました。ブラウザの空き容量や対応形式を確認してください。');
      if(started) onError(error);else rejectStart?.(error);
      stop();
    };
    recorder.onstop=()=>{
      cleanup();
      try {
        if(!cancelled && bytes) {
          const type=recorder.mimeType || chunks[0].type || mimeType || 'video/webm';
          const blob=new Blob(chunks,{type});
          const extension=type.includes('mp4')?'mp4':'webm';
          onReady({blob,extension,reason});
        } else if(!cancelled) onError(new Error('動画データを作成できませんでした。もう一度お試しください。'));
      } finally {try{onStop?.();}finally{resolveDone();}}
    };
    let timer;
    const start=new Promise((resolve,reject)=>{
      rejectStart=reject;
      timer=setTimeout(()=>reject(new Error('動画の記録を開始できませんでした。ページを更新してお試しください。')),5000);
      recorder.onstart=()=>{
        started=true;origin=timestamp();began=performance.now();
        timeline=recordingTimeline(read() || first,reduceMotion);
        try {paintFrame(read() || first);resolve();} catch(error){reject(error);}
      };
    });
    try {recorder.start(1000);videoTrack?.requestFrame?.();await start;} finally {clearTimeout(timer);}
    document.addEventListener('visibilitychange',hidden);
    globalThis.navigator?.wakeLock?.request('screen').then(lock=>{if(stopping) lock.release().catch(()=>{});else wake=lock;}).catch(()=>{});
    function draw(at) {
      if(stopping) return;
      try {
        const raw=read();
        if(!raw) {stop('時間枠を移動したため記録を終了しました。');return;}
        if(at-lastPaint<1000/24) {frameId=requestAnimationFrame(draw);return;}
        const frame=paintFrame(raw);lastPaint=at;
        if(frame.winner && frame.spin?.id!==baseline && !frame.spinning) {
          if(endSpin!==frame.spin.id) {endSpin=frame.spin.id;endAt=at;}
          if(at-endAt>=3500) {stop();return;}
        }
        if(at-began>=5*60000) {stop('5分経過したため、そこまでの動画を保存しました。');return;}
        frameId=requestAnimationFrame(draw);
      } catch(error) {onError(new Error('動画の描画が中断されました。記録できた部分を保存します。'));stop();}
    }
    frameId=requestAnimationFrame(draw);
    return {stop,cancel(){cancelled=true;return stop();}};
  } catch(error) {cleanup();throw error;}
}
