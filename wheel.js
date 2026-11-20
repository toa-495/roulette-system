const TAU = Math.PI*2;
const colors = ['#e47757','#f0bb4b','#77ae91','#7c93dc','#b76ca3','#5cb8c1','#ee8c8e','#aaa151'];
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let sound = localStorage.getItem('roulette.sound') !== 'off';
let context;

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
  const silence=context.createConstantSource?.();
  if(silence) {silence.offset.value=0;silence.connect(output);silence.start();}
  // A recording gets only cues produced by its own timeline, never live UI cues.
  return {
    stream:output.stream,
    now:()=>context.currentTime*1000,
    reveal:elapsed=>revealSound(output,elapsed,sources),
    tick:()=>clickSound(false,output,sources),
    finish:()=>clickSound(true,output,sources),
    close(){for(const source of sources){try{source.stop();}catch{}}sources.clear();if(silence){silence.stop();silence.disconnect();}output.disconnect();output.stream.getTracks().forEach(track=>track.stop());}
  };
}
export function revealSound(output = null,elapsed = 0,sources = null) {
  if (!sound || !context || context.state !== 'running') return;
  for (const [i,frequency] of [392,494,587,784,988].entries()) {
    const delay=i*.34-elapsed;
    const age=Math.max(0,-delay);
    if(age>=.55) continue;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = context.currentTime + Math.max(0,delay) + (output?1/24:0);
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency,at);
    const level=age<.025?.001*Math.pow(90,age/.025):.09*Math.pow(.001/.09,(age-.025)/.525);
    gain.gain.setValueAtTime(Math.max(.001,level),at);
    if(age<.025) gain.gain.exponentialRampToValueAtTime(.09,at+.025-age);
    gain.gain.exponentialRampToValueAtTime(.001,at+.55-age);
    oscillator.connect(gain);
    gain.connect(output || context.destination);
    sources?.add(oscillator);
    oscillator.onended=()=>{sources?.delete(oscillator);oscillator.disconnect();gain.disconnect();};
    oscillator.start(at);oscillator.stop(at+.56-age);
  }
}
export function toggleSound() {
  sound = !sound;
  localStorage.setItem('roulette.sound',sound ? 'on' : 'off');
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
  const step = TAU/n;
  const disk = document.createElement('canvas');
  disk.width = disk.height = 520*dpr;
  const dial = disk.getContext('2d');
  dial.scale(dpr,dpr);
  dial.translate(center,center);
  for (let i=0;i<n;i++) {
    const point = i*step - Math.PI/2;
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
    if (slices[i]) {
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
      onFinish();
    }
  }
  const active = spin && elapsed(performance.now())<spin.duration;
  // Paint synchronously, so a new canvas is never blank for one animation frame.
  paint(spin?(active?spinPosition(spin,elapsed(performance.now()),reduced.matches).turns:spin.angle):0);
  if (active) frame = requestAnimationFrame(stepFrame);
  else if(timing) timing.finished=true;
  return () => cancelAnimationFrame(frame);
}
