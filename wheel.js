const TAU = Math.PI*2;
const colors = ['#e47757','#f0bb4b','#77ae91','#7c93dc','#b76ca3','#5cb8c1','#ee8c8e','#aaa151'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let sound = localStorage.getItem('roulette.sound') !== 'off';
let context;
let snareBuffer;
const rollGates=new Set(),liveRolls=new Map();

export const soundOn = () => sound;
export async function initAudio(force = false) {
  if (!sound && !force) return;
  const Audio = window.AudioContext || window.webkitAudioContext;
  if (!Audio) return;
  try {
    context ||= new Audio();
    if (context.state !== 'running') await context.resume();
  } catch {}
}
export async function recordingAudio() {
  await initAudio(true);
  if (!context || context.state !== 'running') return null;
  const output = context.createMediaStreamDestination();
  const sources=new Set();
  const rolls=[];
  const silence=context.createConstantSource?.();
  if(silence) {silence.offset.value=0;silence.connect(output);silence.start();}
  // A recording gets only cues produced by its own timeline, never live UI cues.
  return {
    stream:output.stream,
    now:()=>context.currentTime*1000,
    reveal:elapsed=>revealSound(output,elapsed,sources),
    tick:()=>clickSound(false,output,sources),
    finish:()=>clickSound(true,output,sources),
    roll:(elapsed,duration)=>{const roll=drumRoll(output,elapsed,duration,sources);if(roll)rolls.push(roll);},
    close(){for(const roll of rolls)roll.stop();for(const source of sources){try{source.stop();}catch{}}sources.clear();if(silence){silence.stop();silence.disconnect();}output.disconnect();output.stream.getTracks().forEach(track=>track.stop());}
  };
}
export function revealSound(output = null,elapsed = 0,sources = null) {
  if (!sound || !context || context.state !== 'running') return;
  // An original ascending flourish and a bright major chord, synthesized locally.
  for (const [i,frequency] of [587.33,739.99,880,1174.66,1479.98].entries()) {
    const delay=[0,.12,.24,.38,.38][i]-elapsed,duration=i<3?.3:.9;
    const age=Math.max(0,-delay);
    if(age>=duration) continue;
    for(const [partial,peak] of [[1,.085],[2,.024]]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + Math.max(0,delay) + (output?1/24:0);
    oscillator.type = partial===1?'triangle':'sine';
    oscillator.frequency.setValueAtTime(frequency*partial*.97,at);
    oscillator.frequency.exponentialRampToValueAtTime(frequency*partial,at+.025);
    const level=age<.012?.001*Math.pow(peak/.001,age/.012):peak*Math.pow(.001/peak,(age-.012)/(duration-.012));
    gain.gain.setValueAtTime(Math.max(.001,level),at);
    if(age<.012) gain.gain.exponentialRampToValueAtTime(peak,at+.012-age);
    gain.gain.exponentialRampToValueAtTime(.001,at+duration-age);
    oscillator.connect(gain);
    gain.connect(output || context.destination);
    sources?.add(oscillator);
    oscillator.onended=()=>{sources?.delete(oscillator);oscillator.disconnect();gain.disconnect();};
    oscillator.start(at);oscillator.stop(at+duration+.01-age);
    }
  }
}
function drumRoll(output=null,elapsed=0,duration=7.5,sources=null) {
  if(!context || context.state!=='running' || !context.createBufferSource || elapsed>=duration) return null;
  if(!snareBuffer) {
    const rate=context.sampleRate || 48000;
    snareBuffer=context.createBuffer(1,Math.floor(rate*.12),rate);
    const data=snareBuffer.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;
  }
  const gate=context.createGain(),active=new Set();
  gate.gain.setValueAtTime(sound?1:0,context.currentTime);gate.connect(output || context.destination);rollGates.add(gate);
  const release=()=>{rollGates.delete(gate);gate.disconnect();};
  const begin=Math.max(0,elapsed),beat=60/138;
  function track(source,nodes,at,length) {
    active.add(source);sources?.add(source);
    source.onended=()=>{active.delete(source);sources?.delete(source);source.disconnect();nodes.forEach(node=>node.disconnect());if(!active.size)release();};
    source.start(at);source.stop(at+length);
  }
  function noise(t,frequency,peak,length=.065) {
    if(t<begin || t>=duration) return;
    const source=context.createBufferSource(),filter=context.createBiquadFilter(),gain=context.createGain();
    const at=context.currentTime+t-elapsed+(output?1/24:0);
    source.buffer=snareBuffer;filter.type='highpass';filter.frequency.setValueAtTime(frequency,at);
    gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(peak,at+.003);gain.gain.exponentialRampToValueAtTime(.0001,at+length);
    source.connect(filter);filter.connect(gain);gain.connect(gate);track(source,[filter,gain],at,length+.01);
  }
  function tone(t,frequency,type,peak,length,end=frequency) {
    if(t<begin || t>=duration || !context.createOscillator) return;
    const source=context.createOscillator(),gain=context.createGain(),at=context.currentTime+t-elapsed+(output?1/24:0);
    source.type=type;source.frequency.setValueAtTime(frequency,at);source.frequency.exponentialRampToValueAtTime(end,at+Math.min(.07,length));
    gain.gain.setValueAtTime(.0001,at);gain.gain.linearRampToValueAtTime(peak,at+.006);gain.gain.exponentialRampToValueAtTime(.0001,at+length);
    source.connect(gain);gain.connect(gate);track(source,[gain],at,length+.01);
  }
  // An original, bouncy game-show groove: kick, swung hats, bass and bright marimba notes.
  const melody=[523.25,659.25,783.99,880,783.99,659.25,587.33,783.99];
  for(let i=0;i*beat/2<duration;i++) {
    const t=i*beat/2+(i%2?beat*.07:0);
    noise(t,6000,.018,.025);
    tone(t,melody[i%melody.length],'sine',.045,.17);
    tone(t,melody[i%melody.length]*2,'sine',.01,.09);
    if(i%2===0) {
      tone(t,145,'sine',.13,.12,48);
      tone(t,[130.81,196,174.61,196][Math.floor(i/2)%4],'triangle',.055,.2);
    }
    if(i%4===2) noise(t,1000,.09,.085);
  }
  // Keep a real roll, then build excitement with faster strokes in the final stretch.
  for(let i=0,t=0;t<duration;i++) {
    noise(t,1400,(.025+.05*t/duration)*(i%2?.65:1));
    t+=beat/(t>duration*.68?4+12*(t/duration-.68)/.32:2);
  }
  return {stop(){for(const source of active){try{source.stop();}catch{}}active.clear();release();}};
}
export function toggleSound() {
  sound = !sound;
  localStorage.setItem('roulette.sound',sound ? 'on' : 'off');
  for(const gate of rollGates) gate.gain.setValueAtTime(sound?1:0,context.currentTime);
  initAudio();
  return sound;
}
function clickSound(finish = false,output = null,sources = null) {
  if (!sound || !context || context.state !== 'running') return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const at = context.currentTime + (output?1/24:0);
  oscillator.type = finish ? 'sine' : 'triangle';
  oscillator.frequency.setValueAtTime(finish ? 590 : 1150,at);
  oscillator.frequency.exponentialRampToValueAtTime(finish ? 780 : 640,at+0.033);
  gain.gain.setValueAtTime(finish ? 0.12 : 0.07,at);
  gain.gain.exponentialRampToValueAtTime(0.001,at+(finish ? 0.23 : 0.042));
  oscillator.connect(gain);
  gain.connect(output || context.destination);
  sources?.add(oscillator);
  oscillator.onended=()=>{sources?.delete(oscillator);oscillator.disconnect();gain.disconnect();};
  oscillator.start(at);
  oscillator.stop(at+(finish ? 0.24 : 0.05));
}
export const colorAt = (index) => colors[index%colors.length];
function truncate(ctx,text,width) {
  if (ctx.measureText(text).width <= width) return text;
  const chars = Array.from(text);
  while (chars.length && ctx.measureText(chars.join('')+'…').width > width) chars.pop();
  return chars.join('')+'…';
}

export function createWheelRenderer(canvas,candidates,pixelRatio = window.devicePixelRatio || 1) {
  const dpr = Math.min(2,pixelRatio);
  canvas.width = canvas.height = 520*dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr,dpr);
  const center = 260;
  const radius = 232;
  const slices = candidates.length ? candidates : colors.map(()=>null);
  const n = slices.length;
  const weights=slices.map(item=>item?.weight ?? 1),total=weights.reduce((a,b)=>a+b,0);
  let position=0;
  const disk = document.createElement('canvas');
  disk.width = disk.height = 520*dpr;
  const dial = disk.getContext('2d');
  dial.scale(dpr,dpr);
  dial.translate(center,center);
  for (let i=0;i<n;i++) {
    const step=TAU*weights[i]/total;
    const point = position - Math.PI/2;position+=step;
    dial.beginPath();
    dial.moveTo(0,0);
    dial.arc(0,0,radius,point,point+step);
    dial.closePath();
    dial.fillStyle = colorAt(i);
    dial.fill();
    dial.strokeStyle = '#fffc';
    dial.lineWidth = 2;
    dial.stroke();
    dial.save();
    dial.rotate(point+step/2);
    dial.beginPath();
    dial.arc(radius-13,0,3.2,0,TAU);
    dial.fillStyle = '#fff9';
    dial.fill();
    if (slices[i] && step>.025) {
      const {name,title} = slices[i];
      const flip = Math.cos(point+step/2) < -0.04;
      dial.translate(140,0);
      if (flip) dial.rotate(Math.PI);
      dial.fillStyle = '#181b26';
      dial.textAlign = 'center';
      dial.textBaseline = 'middle';
      const compact = n > 16;
      dial.font = '800 '+(compact?13:21)+'px system-ui,sans-serif';
      dial.fillText(truncate(dial,name,133),0,compact?-7:-10);
      dial.font = '600 '+(compact?11:16)+'px system-ui,sans-serif';
      dial.fillText(truncate(dial,title,135),0,compact?7:15);
    }
    dial.restore();
  }
  function paint(rotations) {
    ctx.clearRect(0,0,520,520);
    ctx.save();
    ctx.translate(center,center);
    ctx.beginPath();
    ctx.arc(0,0,249,0,TAU);
    ctx.fillStyle = '#fffdf6';
    ctx.shadowColor = '#261c2938';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#252736';
    ctx.lineWidth = 2.8;
    ctx.stroke();
    ctx.save();
    ctx.rotate((rotations%1)*TAU);
    ctx.drawImage(disk,-260,-260,520,520);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0,0,radius,0,TAU);
    ctx.strokeStyle = '#191a2366';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0,0,40,0,TAU);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#272939';
    ctx.stroke();
    ctx.fillStyle = '#25394a';
    ctx.beginPath();
    ctx.moveTo(0,-23); ctx.quadraticCurveTo(3,-3,23,0);
    ctx.quadraticCurveTo(3,3,0,23); ctx.quadraticCurveTo(-3,3,-23,0);
    ctx.quadraticCurveTo(-3,-3,0,-23); ctx.fill();
    ctx.restore();
  }
  return paint;
}
export function spinPosition(spin,elapsed,reduceMotion = false) {
  const progress=Math.max(0,Math.min(1,elapsed/spin.duration));
  const ease=(1-Math.pow(1-progress,3.8))-2.7*progress*Math.pow(1-progress,11);
  const turns=reduceMotion?(progress===1?spin.angle:0):(spin.turns+spin.angle)*ease;
  return {progress,turns};
}
const spinClocks=new Map();
export function wheel(canvas,pointer,candidates,spin,clock,onFinish) {
  const paint=createWheelRenderer(canvas,candidates);
  let frame;
  let timing;
  if(spin) {
    timing=spinClocks.get(spin.id);
    if(!timing) {
      timing={at:performance.now(),elapsed:Date.now()+clock-spin.startAt,lastTick:-1,lastSound:-Infinity,pointerTime:-Infinity,finished:false};
      spinClocks.set(spin.id,timing);
      if(spinClocks.size>80) spinClocks.delete(spinClocks.keys().next().value);
    }
  }
  const elapsed=at=>timing.elapsed+at-timing.at;
  function stepFrame(now) {
    const {progress:p,turns}=spinPosition(spin,elapsed(now),reduced.matches);
    paint(turns);
    const tick = Math.floor(turns*candidates.length);
    if (tick !== timing.lastTick && timing.lastTick >= 0 && p > 0 && p < 1) {
      timing.pointerTime = now;
      if (now-timing.lastSound >= 42) { clickSound(); timing.lastSound = now; }
    }
    timing.lastTick = tick;
    const impulse = Math.max(0,1-(now-timing.pointerTime)/115);
    pointer.style.transform = reduced.matches ? '' : 'rotate('+(impulse*12)+'deg)';
    if (p < 1) frame = requestAnimationFrame(stepFrame);
    else {
      pointer.style.transform = '';
      if(!timing.finished) clickSound(true);
      timing.finished=true;
      if(!timing.notified) {timing.notified=true;onFinish();}
    }
  }
  const active = spin && elapsed(performance.now())<spin.duration;
  let roll=spin && liveRolls.get(spin.id);
  if(active) {
    if(roll) clearTimeout(roll.timer);
    else {const audio=drumRoll(null,elapsed(performance.now())/1000,spin.duration/1000);if(audio){roll={audio};liveRolls.set(spin.id,roll);}}
  }
  // Paint synchronously, so a new canvas is never blank for one animation frame.
  paint(spin?(active?spinPosition(spin,elapsed(performance.now()),reduced.matches).turns:spin.angle):0);
  if (active) frame = requestAnimationFrame(stepFrame);
  else if(timing) {timing.finished=true;if(!timing.notified){timing.notified=true;Promise.resolve().then(onFinish);}}
  return () => {cancelAnimationFrame(frame);if(roll)roll.timer=setTimeout(()=>{roll.audio.stop();liveRolls.delete(spin.id);},0);};
}
