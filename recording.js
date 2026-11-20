import {recordingAudio} from './wheel.js?v=20261120-features1';

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
function painter(canvas) {
  const ctx=canvas.getContext('2d');
  const layer=document.createElement('canvas');layer.width=648;layer.height=320;
  const text=layer.getContext('2d');
  const mosaic=document.createElement('canvas');
  let focused='',focusAt=0,cachedKey='',cachedLines=[];
  function write(value,x,y,width,font,color,max=2) {
    ctx.font=font;ctx.fillStyle=color;
    const wrapped=lines(ctx,value,width);
    wrapped.slice(0,max).forEach((line,i)=>ctx.fillText(line+(i===max-1 && wrapped.length>max?'…':''),x,y+i*38));
  }
  return frame=>{
    const at=performance.now();
    ctx.fillStyle='#f6f5ef';ctx.fillRect(0,0,720,1280);
    ctx.textBaseline='top';
    write(frame.eventTitle,36,30,648,'800 28px system-ui,sans-serif','#212538',1);
    write(frame.slotTitle,36,80,648,'600 23px system-ui,sans-serif','#676b70',1);
    const person=frame.winner || frame.people.find(item=>item.userId===frame.focusId) || frame.people.find(item=>item.proposal) || frame.people[0];
    const proposal=person?.proposal;
    const key=person?.userId || '';
    const focusKey=key+':'+!!frame.winner;
    if (focusKey!==focused) {focused=focusKey;focusAt=at;cachedKey='';}
    ctx.fillStyle=frame.winner?'#fbefce':'#fffdf7';ctx.fillRect(24,137,672,440);
    write(frame.winner?'採用された予定':person?person.name+' さんの予定':'みんなの予定',40,158,630,'800 27px system-ui,sans-serif','#24334a',1);
    if (frame.winner) write(person.name+' さん',40,201,630,'600 23px system-ui,sans-serif','#676b70',1);
    text.clearRect(0,0,648,320);text.textBaseline='top';
    text.fillStyle='#212538';text.font='800 32px system-ui,sans-serif';
    const title=lines(text,proposal?.title || '名前をタップして予定を開示',620);
    title.forEach((value,i)=>text.fillText(value,8,i*42));
    const descY=title.length*42+16;
    text.font='400 24px system-ui,sans-serif';
    const contentKey=proposal?JSON.stringify([proposal.id,proposal.revision,proposal.title,proposal.rich,proposal.locations,proposal.links]):'';
    if(contentKey!==cachedKey) {
      cachedKey=contentKey;focusAt=at;
      const body=proposal?[plain(proposal.rich),...(proposal.locations || []),...(proposal.links || [])].filter(Boolean).join('\n'):'';
      cachedLines=lines(text,body,620);
    }
    text.save();text.beginPath();text.rect(0,descY,648,Math.max(0,320-descY));text.clip();
    const overflow=Math.max(0,cachedLines.length*33-(320-descY));
    const scroll=Math.min(overflow,Math.max(0,at-focusAt-4000)*.025);
    cachedLines.forEach((value,i)=>text.fillText(value,8,descY+i*33-scroll));text.restore();
    const progress=proposal?Math.max(0,Math.min(1,frame.revealProgress?.[key] ?? 1)):1;
    ctx.save();ctx.globalAlpha=.23+.77*progress;
    if(progress<1) {
      const scale=.025+.975*progress*progress;
      mosaic.width=Math.max(1,Math.round(648*scale));mosaic.height=Math.max(1,Math.round(320*scale));
      mosaic.getContext('2d').drawImage(layer,0,0,mosaic.width,mosaic.height);
      ctx.imageSmoothingEnabled=false;ctx.drawImage(mosaic,36,frame.winner?240:215,648,320);
    } else ctx.drawImage(layer,36,frame.winner?240:215);
    ctx.restore();
    if(frame.wheel) ctx.drawImage(frame.wheel,80,604,560,560);
    ctx.fillStyle='#d84d40';ctx.strokeStyle='#792c33';ctx.lineWidth=3;
    ctx.beginPath();ctx.moveTo(343,605);ctx.lineTo(377,605);ctx.lineTo(360,650);ctx.closePath();ctx.fill();ctx.stroke();
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
  let audio,stream,recorder,frameId,wake,reason='',cancelled=false,stopping=false;
  let endSpin='',endAt=0,lastPaint=-Infinity,bytes=0;
  const chunks=[];
  const began=performance.now();
  let resolveDone;
  const done=new Promise(resolve=>{resolveDone=resolve;});
  function cleanup() {
    cancelAnimationFrame(frameId);
    document.removeEventListener('visibilitychange',hidden);
    stream?.getTracks().forEach(track=>track.stop());
    audio?.close();wake?.release().catch(()=>{});
  }
  function stop(message='') {
    if(stopping) return done;
    stopping=true;reason=message;cancelAnimationFrame(frameId);
    if(recorder?.state!=='inactive') recorder.stop();
    return done;
  }
  function hidden() {if(document.hidden) stop('画面が非表示になったため、そこまでの動画を保存しました。');}
  try {
    // Canvas + app audio only: no camera, microphone, password dialog or other tabs.
    audio=await recordingAudio();
    paint(first);
    stream=canvas.captureStream(30);
    for(const track of audio?.stream.getAudioTracks() || []) stream.addTrack(track);
    const mimeType=recordingMime();
    recorder=new MediaRecorder(stream,{...(mimeType?{mimeType}:{}),videoBitsPerSecond:2500000});
    recorder.ondataavailable=event=>{
      if(event.data?.size) {chunks.push(event.data);bytes+=event.data.size;}
      if(bytes>120*1024*1024) stop('動画の容量が大きくなったため記録を終了しました。');
    };
    recorder.onerror=()=>{cancelled=true;onError(new Error('動画の記録に失敗しました。ブラウザの空き容量や対応形式を確認してください。'));stop();};
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
    recorder.start(1000);
    document.addEventListener('visibilitychange',hidden);
    globalThis.navigator?.wakeLock?.request('screen').then(lock=>{if(stopping) lock.release().catch(()=>{});else wake=lock;}).catch(()=>{});
    function draw(at) {
      if(stopping) return;
      try {
        const frame=read();
        if(!frame) {stop('時間枠を移動したため記録を終了しました。');return;}
        if(at-lastPaint>=30) {paint(frame);lastPaint=at;}
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
