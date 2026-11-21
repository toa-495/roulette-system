import {recordingAudio,createWheelRenderer,spinPosition,colorAt} from './wheel.js?v=20261120-ui2';

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
        currentSpin={id:frame.spin.id,at,elapsed,lastTick:-1,lastSound:-Infinity,finished:elapsed>=frame.spin.duration,startedLive:elapsed<frame.spin.duration};
        if(elapsed<frame.spin.duration) cues.push({kind:'roll',elapsed:elapsed/1000,duration:frame.spin.duration/1000});
      }
      pose=spinPosition(frame.spin,currentSpin.elapsed+at-currentSpin.at,reduceMotion);
      const tick=Math.floor(pose.turns*frame.spin.candidates.length);
      if(pose.progress>0 && pose.progress<1 && tick!==currentSpin.lastTick && currentSpin.lastTick>=0 && at-currentSpin.lastSound>=42) {
        cues.push({kind:'tick'});currentSpin.lastSound=at;
      }
      currentSpin.lastTick=tick;
      if(pose.progress===1 && !currentSpin.finished) {cues.push({kind:'finish'});currentSpin.finished=true;}
    }
    // A vote's last spin winner is not necessarily the overall winner in multi-round mode.
    const winner=frame.spin && pose.progress===1 ? frame.winner : null;
    const sinceFinish=frame.spin && currentSpin ? currentSpin.elapsed+at-currentSpin.at-frame.spin.duration : -1;
    const showVictory=!!frame.spin && !!currentSpin?.startedLive && pose.progress===1 &&
      sinceFinish>=0 && sinceFinish<3500;
    const drawn=showVictory?frame.spin.candidates.find(person=>person.userId===frame.spin.winnerId):null;
    const celebration=showVictory && (winner||drawn)?{
      label:winner?(frame.kind==='meeting-place'?'集合場所が決定！':'採用する予定が決定！'):'今回の当選',
      name:winner?.name||drawn?.name||'',
      detail:winner?.proposal?.title||''
    }:null;
    const candidates=frame.kind==='meeting-place'
      ? (frame.spin?.candidates || frame.people.map(person=>({userId:person.userId,name:person.name,title:''})))
      : frame.spin?frame.spin.candidates:frame.people.map(person=>({userId:person.userId,name:person.name,title:person.proposal?.title || '未開示'}));
    return {...frame,winner,celebration,spinning:!!frame.spin && pose.progress<1,revealProgress:progress,turns:pose.turns,cues,
      wheelCandidates:candidates.map(person=>({...person,title:progress[person.userId]===undefined || progress[person.userId]>=1?person.title:frame.people.find(item=>item.userId===person.userId)?.proposal?'開示中…':'未開示'}))};
  };
}
function painter(canvas) {
  const ctx=canvas.getContext('2d');
  const layer=document.createElement('canvas');
  const text=layer.getContext('2d');
  const mosaic=document.createElement('canvas');
  const disk=document.createElement('canvas');
  let paintWheel,wheelKey='';
  const fitted=new Map(),bodies=new Map(),opened=new Map();
  const ink='#242734',soft='#555b67',paper='#f6f5ef',white='#fffefb',line='#e2e0d7';
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
  function box(x,y,width,height,radius,fill,stroke=line) {
    const r=Math.min(radius,width/2,height/2);
    ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+width-r,y);
    ctx.quadraticCurveTo(x+width,y,x+width,y+r);ctx.lineTo(x+width,y+height-r);
    ctx.quadraticCurveTo(x+width,y+height,x+width-r,y+height);ctx.lineTo(x+r,y+height);
    ctx.quadraticCurveTo(x,y+height,x,y+height-r);ctx.lineTo(x,y+r);
    ctx.quadraticCurveTo(x,y,x+r,y);ctx.closePath();ctx.fillStyle=fill;ctx.fill();
    if(stroke) {ctx.strokeStyle=stroke;ctx.lineWidth=1.6;ctx.stroke();}
  }
  function write(value,x,y,width,size=24,color=ink,weight=600) {
    ctx.font=weight+' '+size+'px system-ui,sans-serif';ctx.fillStyle=color;
    ctx.fillText(fit(ctx,value,width),x,y);
  }
  function body(proposal,width,size) {
    const key=JSON.stringify([proposal?.title,proposal?.rich,proposal?.locations,proposal?.links,width,size]);
    if(!bodies.has(key)) {
      text.font='400 '+size+'px system-ui,sans-serif';
      const content=proposal?[plain(proposal.rich),...(proposal.locations || []),...(proposal.links || [])].filter(Boolean).join('\n'):'';
      if(bodies.size>100) bodies.clear();bodies.set(key,lines(text,content,width));
    }
    return bodies.get(key);
  }
  function content(person,x,y,width,height,progress,at,{size=24,titleOffset=0,compact=false}={}) {
    layer.width=Math.floor(width);layer.height=Math.max(1,Math.floor(height));
    text.textBaseline='top';text.fillStyle=ink;
    text.font='700 '+size+'px system-ui,sans-serif';
    text.fillText(fit(text,person.proposal?.title || '未開示',width-titleOffset),titleOffset,0);
    if(!compact) {
      const descSize=Math.max(15,size-2),descY=size+16;
      const wrapped=body(person.proposal,width,descSize);
      const key=JSON.stringify([person.userId,person.openedAt || 0,person.proposal?.title,person.proposal?.rich]);
      if(!opened.has(key)) opened.set(key,at);
      const available=Math.max(0,height-descY),lineHeight=descSize+8;
      const overflow=Math.max(0,wrapped.length*lineHeight-available);
      const scroll=Math.min(overflow,Math.max(0,at-opened.get(key)-4000)*.025);
      text.font='400 '+descSize+'px system-ui,sans-serif';
      text.save();text.beginPath();text.rect(0,descY,width,available);text.clip();
      wrapped.forEach((value,i)=>text.fillText(value,0,descY+i*lineHeight-scroll));text.restore();
    }
    showLayer(layer,x,y,width,height,person.proposal?progress:1);
  }
  function drawDisk(frame,diskY,wheelSize) {
    const signature=JSON.stringify(frame.wheelCandidates);
    if(signature!==wheelKey) {paintWheel=createWheelRenderer(disk,frame.wheelCandidates,1);wheelKey=signature;}
    paintWheel(frame.turns);
    ctx.drawImage(disk,(720-wheelSize)/2,diskY,wheelSize,wheelSize);
    const pointerY=diskY+wheelSize*28/520;
    ctx.fillStyle='#e47757';ctx.strokeStyle='#792c33';ctx.lineWidth=4;
    ctx.beginPath();ctx.moveTo(343,pointerY-9);ctx.lineTo(377,pointerY-9);ctx.lineTo(360,pointerY+40);ctx.closePath();ctx.fill();ctx.stroke();
  }
  function meeting(frame,at) {
    let top=112;
    if(frame.winner) {
      const place=frame.winner.proposal.title.replace(/\s+/g,' ');
      ctx.font='700 28px system-ui,sans-serif';
      const wrapped=lines(ctx,place,624),height=80+wrapped.length*35;
      box(24,top,672,height,32,'#fbefce','#e7d5ab');
      write('決定した集合場所',48,top+22,624,24,'#493c29',700);
      wrapped.forEach((line,i)=>write(line,48,top+62+i*35,624,28,ink,800));
      top+=height+20;
    }
    const wheelSize=Math.min(608,960-top-76);
    box(24,top,672,wheelSize+76,32,'#e9ede3');
    write('集合場所ルーレット',48,top+20,430,28,ink,800);
    write(frame.spinning?'抽選中…':frame.winner?'決定！':'抽選前',544,top+25,130,21,'#334734',700);
    drawDisk(frame,top+58,wheelSize);
    const candidates=frame.wheelCandidates,pageSize=4,pageCount=Math.max(1,Math.ceil(candidates.length/pageSize));
    const page=Math.floor(at/4000)%pageCount,offset=page*pageSize,shown=candidates.slice(offset,offset+pageSize);
    const listY=top+wheelSize+96;
    box(24,listY,672,210,30,white);
    write('抽選する参加者'+(pageCount>1?'　'+(offset+1)+'〜'+(offset+shown.length)+' / '+candidates.length:''),48,listY+20,624,24,ink,800);
    shown.forEach((person,i)=>{
      const x=48+(i%2)*320,y=listY+67+Math.floor(i/2)*65;
      ctx.beginPath();ctx.arc(x+7,y+9,6,0,Math.PI*2);ctx.fillStyle=colorAt(offset+i);ctx.fill();
      ctx.font='600 21px system-ui,sans-serif';
      const wrapped=lines(ctx,person.name,274);
      wrapped.slice(0,2).forEach((line,j)=>write(line+(j===1 && wrapped.length>2?'…':''),x+23,y+j*27,274,21,ink,600));
    });
  }
  function victoryOverlay(frame){
    const victory=frame.celebration;
    if(!victory)return;
    // Render into the exported video canvas, independently of the browser's
    // foreground dialog: no screen capture, microphone or UI controls are recorded.
    ctx.save();
    ctx.fillStyle='rgba(9,23,35,.79)';
    ctx.fillRect(0,0,720,1280);
    const width=642,x=39,y=405,height=405;
    box(x,y,width,height,34,'#fff8da','#f3d37c');
    ctx.fillStyle='#e9bb53';
    ctx.beginPath();ctx.arc(360,y+90,39,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#5d4928';
    ctx.font='800 32px system-ui,sans-serif';
    ctx.fillText('★',345,y+70);
    write(victory.label,x+34,y+151,width-68,25,'#805b24',800);
    const size=48;
    ctx.font='900 '+size+'px system-ui,sans-serif';
    const nameLines=lines(ctx,victory.name,width-82).slice(0,3);
    nameLines.forEach((line,i)=>write(line,x+42,y+198+i*55,width-84,size,'#233a44',900));
    if(victory.detail) {
      ctx.font='700 24px system-ui,sans-serif';
      const detailLines=lines(ctx,victory.detail,width-82).slice(0,2);
      detailLines.forEach((line,i)=>write(line,x+42,y+336+i*28,width-84,23,'#66512d',700));
    }
    // Deterministic confetti stays visible for the video result hold.
    const colors=['#ee9781','#6b9a84','#e6bd47','#708fba','#b68ad0'];
    for(let i=0;i<35;i++){
      const a=i*2.399,rr=110+(i%7)*39,px=360+Math.cos(a)*rr,py=y+195+Math.sin(a)*rr;
      if(px<10||px>710||py<20||py>1250)continue;
      ctx.fillStyle=colors[i%colors.length];ctx.save();ctx.translate(px,py);ctx.rotate(a);
      ctx.fillRect(-5,-8,10,16);ctx.restore();
    }
    ctx.restore();
  }
  return (frame,at)=>{
    ctx.fillStyle=paper;ctx.fillRect(0,0,720,1280);ctx.textBaseline='top';
    write(frame.eventTitle,32,24,656,30,ink,800);write(frame.slotTitle,32,68,656,22,soft,400);
    if(frame.kind==='meeting-place') {
      meeting(frame,at);write('1日ルーレット',32,1234,656,20,soft,400);victoryOverlay(frame);return;
    }
    let top=112;
    // Match the normal room: a separate result card, everyone's cards, then the wheel.
    if(frame.winner) {
      box(24,top,672,178,32,'#fbefce','#e7d5ab');
      box(48,top+18,218,36,18,'#f2d48a',null);
      ctx.beginPath();ctx.moveTo(66,top+24);ctx.quadraticCurveTo(68,top+34,77,top+36);
      ctx.quadraticCurveTo(68,top+38,66,top+48);ctx.quadraticCurveTo(64,top+38,55,top+36);
      ctx.quadraticCurveTo(64,top+34,66,top+24);ctx.strokeStyle='#493c29';ctx.lineWidth=1.5;ctx.stroke();
      write('採用された予定',85,top+25,176,22,'#493c29',700);
      write(frame.winner.name,48,top+65,624,20,soft,400);
      content(frame.winner,48,top+91,624,76,frame.revealProgress?.[frame.winner.userId] ?? 1,at,{size:25});
      top+=198;
    }
    const columns=frame.people.length<=1?1:frame.people.length<=4?2:3;
    const rows=Math.max(1,Math.ceil(frame.people.length/columns));
    const rowHeight=frame.people.length<=2?190:Math.min(144,Math.floor(304/rows));
    const panelHeight=100+rows*rowHeight;
    box(24,top,672,panelHeight,32,white);
    write('みんなの予定',48,top+25,400,32,ink,800);
    const count=frame.people.filter(item=>item.proposal).length;
    box(520,top+24,152,39,20,'#e3eddf',null);
    write(count+' / '+frame.people.length+' 開示',536,top+34,128,20,'#334734',700);
    const cellWidth=(624-(columns-1)*16)/columns;
    for(const [index,person] of frame.people.entries()) {
      const x=48+index%columns*(cellWidth+16),y=top+76+Math.floor(index/columns)*rowHeight;
      const compact=rowHeight<68,height=rowHeight-(compact?3:12);
      box(x,y,cellWidth,height,compact?9:24,white);
      if(compact) {
        write(person.name,x+8,y+4,cellWidth-16,Math.max(10,Math.min(16,rowHeight*.32)),ink,700);
        content(person,x+8,y+rowHeight*.48,cellWidth-16,Math.max(8,height-rowHeight*.48-2),frame.revealProgress?.[person.userId] ?? 1,at,{size:Math.max(9,Math.min(14,rowHeight*.29)),compact:true});
      } else {
        const size=columns===3?20:rowHeight>160?27:rowHeight>100?23:18;
        const radius=columns===3?16:rowHeight>100?23:16,nameX=columns===3?x+60:x+24+radius*2+12;
        ctx.beginPath();ctx.arc(x+20+radius,y+20+radius,radius,0,Math.PI*2);ctx.fillStyle='#ede8cc';ctx.fill();
        write(Array.from(person.name)[0] || '',x+20+radius-size*.38,y+20+radius-size*.5,size,size,ink,700);
        write(person.name,nameX,y+(rowHeight<120?12:20),cellWidth-(nameX-x)-16,size,ink,700);
        const contentY=rowHeight<120?34:54;
        content(person,x+20,y+contentY,cellWidth-40,height-contentY-12,frame.revealProgress?.[person.userId] ?? 1,at,{size:rowHeight>160?26:rowHeight>=120?21:16,titleOffset:nameX-x-20,compact:rowHeight<100});
      }
    }
    const wheelY=top+panelHeight+20;
    const wheelSize=Math.min(640,1188-wheelY-80);
    box(24,wheelY,672,wheelSize+80,32,'#e9ede3');
    write('ルーレット',48,wheelY+24,390,30,ink,800);
    if(frame.spinning || frame.winner) write(frame.spinning?'抽選中…':'決定！',532,wheelY+29,140,22,'#334734',700);
    drawDisk(frame,wheelY+62,wheelSize);
    write('1日ルーレット',32,1234,656,20,soft,400);
    victoryOverlay(frame);
  };
}

export async function startRecording({read,onReady,onError,onStop}) {
  if(!recordingSupported()) throw new Error('このブラウザでは動画を作成できません。ChromeやSafariの最新版でお試しください。');
  const first=read();
  if(!first) throw new Error('時間枠を開いてから記録してください。');
  const canvas=document.createElement('canvas');canvas.width=720;canvas.height=1280;
  const paint=painter(canvas);
  const baseline=first.spinning?'':first.spin?.id || '';
  let audio,stream,recorder,frameId,wake,videoTrack,reason='',cancelled=false,stopping=false,cleaned=false;
  let endSpin='',endAt=0,lastPaint=-Infinity,bytes=0;
  let origin=0,began=0,timeline,lastFrame=first,started=false,rejectStart;
  let capturedFrames=0,recordedCues=0,mediaElapsed=0;
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
    mediaElapsed=time;capturedFrames++;
    const frame=timeline(raw,time);
    paint(frame,time);
    videoTrack?.requestFrame?.();
    for(const cue of frame.cues) audio?.[cue.kind]?.(cue.elapsed || 0,cue.duration);
    recordedCues+=frame.cues.length;
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
    // Keep an automatic frame cadence as well as requesting completed frames.
    // Some engines advertise requestFrame() but emit only the initial frame at 0fps.
    stream=canvas.captureStream(24);
    videoTrack=stream.getVideoTracks?.()[0];
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
          onReady({blob,extension,reason,diagnostics:{capturedFrames,recordedCues,mediaElapsed,audio:!!audio,tracks:stream.getTracks().map(track=>track.kind)}});
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
        if(!raw) {stop('画面を移動したため記録を終了しました。');return;}
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
  } catch(error) {cancelled=true;if(recorder?.state==='recording') recorder.stop();cleanup();throw error;}
}
