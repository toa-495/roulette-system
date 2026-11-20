import {api} from './api.js';
import {$,e,icon,modal,notify} from './ui.js';
let vault=null,hideTimer=null,holdTimer=null,recap=null;
function stopTimers(){clearTimeout(hideTimer);clearTimeout(holdTimer);}
function current(v){return vault===v && $('modal')?.open && !!$('mission-private');}
export function hideMission(clear=false){stopTimers();if(!vault)return;vault.visible=false;if(clear){vault=null;return;}renderVault();}
function renderVault(){
  const body=$('mission-private'),v=vault;if(!body||!v||!$('modal').open)return;
  if(v.loading){body.innerHTML='<p role="status">読み込み中…</p>';return;}
  if(v.error){body.innerHTML='<p role="alert" class="form-error">'+e(v.error)+'</p>';return;}
  if(!v.data?.assigned){
    body.innerHTML='<div class="mission-locked">'+icon('lock',30)+'<h3>秘密のミッション</h3><p class="muted">自然にできそうな3つの指令を受け取れます。</p><button type="button" class="primary" data-action="mission-claim" '+(v.data?.canClaim?'':'disabled')+'>3つ受け取る</button>'+
      (!v.data?.canClaim?'<p class="muted">イベントの開始後に受け取れます。</p>':'')+'</div>';
    return;
  }
  if(!v.visible){
    body.innerHTML='<div class="mission-locked">'+icon('eye-off',30)+'<h3>ミッションを隠しています</h3><p class="muted">覗き見防止のため、長押ししたときだけ15秒間表示します。</p><p class="muted">達成済み '+v.data.completedCount+' / 3</p><button type="button" class="primary mission-hold" id="mission-hold">長押しして見る</button></div>';
    const button=$('mission-hold'),start=()=>{clearTimeout(holdTimer);holdTimer=setTimeout(()=>{if(current(v)){v.visible=true;renderVault();}},700);},cancel=()=>clearTimeout(holdTimer);
    button.addEventListener('pointerdown',ev=>{if(ev.button!==undefined&&ev.button!==0)return;start();});
    for(const name of ['pointerup','pointercancel','pointerleave'])button.addEventListener(name,cancel);
    button.addEventListener('keydown',ev=>{if((ev.key==='Enter'||ev.key===' ')&&!ev.repeat)start();});
    button.addEventListener('keyup',cancel);
    button.addEventListener('contextmenu',ev=>ev.preventDefault());return;
  }
  clearTimeout(hideTimer);hideTimer=setTimeout(()=>hideMission(),15000);
  body.innerHTML='<div class="mission-private-head"><p class="muted">15秒後に自動で隠れます</p><button type="button" class="secondary" data-action="mission-hide">'+icon('eye-off',16)+' 隠す</button></div>'+
    '<div class="mission-options">'+v.data.missions.map((m,i)=>'<article class="mission-option"><div class="mission-private-head"><strong>MISSION '+(i+1)+'</strong><span class="chip">'+e(m.category)+'</span></div><h3>'+e(m.title)+'</h3><p class="muted">'+e(m.guide||'')+'</p>'+
      '<button type="button" class="'+(m.completed?'secondary':'primary')+'" data-action="mission-toggle" data-key="'+e(m.id)+'" data-completed="'+(!m.completed)+'">'+(m.completed?'達成済み（取り消す）':'達成した！')+'</button></article>').join('')+'</div>';
}
export function missionTeaser(){return '<section class="panel mission-teaser"><div class="mission-teaser-title">'+icon('lock',24)+'<div><h2>秘密のミッション</h2><p class="muted">内容は本人だけに表示</p></div></div><button class="secondary" type="button" data-action="mission-open">秘密のカードを開く</button></section>';}
export async function missionOpen(eventId,userId){
  hideMission(true);const v={eventId,userId,loading:true,visible:false,data:null,error:''};vault=v;
  modal('秘密のミッション','<div id="mission-private"></div>');renderVault();
  try{const data=await api('mission.mine',{eventId});if(current(v)){v.data=data;v.loading=false;renderVault();}}
  catch(err){if(current(v)){v.loading=false;v.error=err.message;renderVault();}}
}
export async function missionClaim(eventId,userId){
  const v=vault;if(!v||v.eventId!==eventId||v.userId!==userId)return;v.loading=true;renderVault();
  try{const data=await api('mission.claim',{eventId},{retry:true});if(current(v)){v.data=data;v.loading=false;renderVault();notify('3つのミッションが届きました。');}}
  catch(err){if(current(v)){v.error=err.message;v.loading=false;renderVault();}}
}
export async function missionToggle(eventId,userId,id,completed){
  const v=vault;if(!v||v.eventId!==eventId||v.userId!==userId)return;hideMission();v.loading=true;renderVault();
  try{const data=await api('mission.toggle',{eventId,missionId:id,completed},{retry:true});if(current(v)){v.data=data;v.loading=false;renderVault();notify(completed?'達成を記録しました！':'達成を取り消しました。');}}
  catch(err){if(current(v)){v.error=err.message;v.loading=false;renderVault();}}
}
export function missionRecapHtml(eventId,finalDrawId){
  const entry=recap?.key===eventId+':'+finalDrawId?recap:null;
  if(!entry?.data)return '<section class="panel mission-recap"><div class="spread"><h2>秘密ミッションの答え合わせ</h2><button class="secondary" data-action="mission-recap-retry">更新</button></div><p role="status">'+e(entry?.error||'読み込み中…')+'</p></section>';
  return '<section class="panel mission-recap"><div class="spread"><h2>秘密ミッションの答え合わせ</h2><button class="secondary" data-action="mission-recap-retry">更新</button></div>'+
    '<div class="stack">'+entry.data.participants.map(p=>'<div class="mission-recap-person"><h3>'+e(p.name)+'　'+p.completedCount+'/3 達成</h3>'+
      (p.assigned?'<ol>'+p.missions.map(m=>'<li class="'+(m.completed?'mission-done':'')+'">'+(m.completed?'✓ ':'')+e(m.title)+'</li>').join('')+'</ol>':'<p class="muted">未受取</p>')+'</div>').join('')+'</div></section>';
}
export async function missionLoadRecap(eventId,finalDrawId,redraw){
  const key=eventId+':'+finalDrawId;if(recap?.key===key)return;const entry={key,data:null,error:''};recap=entry;
  try{const data=await api('mission.recap',{eventId});if(recap===entry){entry.data=data;redraw();}}
  catch(err){if(recap===entry){entry.error=err.message;redraw();}}
}
export function missionRecapReset(){recap=null;}
$('modal').addEventListener('close',()=>hideMission(true));
window.addEventListener('blur',()=>hideMission());
document.addEventListener('visibilitychange',()=>{if(document.hidden)hideMission();});
