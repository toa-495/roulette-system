import {api,configured,pollMs,passwordProof,setToken,token,uid} from './api.js';
import {$,e,icon,yen,initials,hour,date,time,richView,safeUrl,photoButton,showPhoto,notify,modal,closeModal,bindForm,copyText,clearImages} from './ui.js';
import {editProposal,editExpense,userForm,eventForm,registrations,passwordForm} from './forms.js';
import {wheel,colorAt,toggleSound,initAudio,soundOn,revealSound} from './wheel.js?v=20261120-features1';
import {startRecording,recordingSupported} from './recording.js?v=20261120-features1';

const main = $('main');
const dialog = $('modal');
let home, state, admin;
let user;
let view = 'day';
const hosted = typeof window.ROULETTE_HOST === 'string';
let eventId = new URL(location.href).searchParams.get('event') || '';
if (hosted && window.google?.script?.url) {
  const initialEvent = await new Promise(resolve=>window.google.script.url.getLocation(location=>resolve(location.parameter.event || '')));
  if (initialEvent) eventId = initialEvent;
}
let slotId = '';
let clock = 0;
let offline = false;
let pending = false;
let ticket = 0;
let homeTicket = 0;
let adminTicket = 0;
let stoppedWheel;
let spinTimer;
let revealTimer;
let lastSlot = '';
const REVEAL_MS = 2400;
const revealStarts = new Map();
let roomRevealing = new Map();
let expanded = new Set();
let syncRunning = false;
const slotGrants = new Map();
let recordingSession;
let recordingPending = false;
let recordingGeneration = 0;
let recordingFocusId = '';
let savedVideo;

function now() { return Date.now()+clock; }
function slotAccess(id,selectedEvent = eventId) {
  const key=JSON.stringify([selectedEvent,id]);
  const grant=slotGrants.get(key);
  if(!grant || grant.expiresAt<=now()) {slotGrants.delete(key);return {};}
  return {accessToken:grant.accessToken};
}
function eventAccess(selectedEvent = eventId) {
  return Object.fromEntries(Array.from(slotGrants.values()).filter(grant=>grant.eventId===selectedEvent && grant.expiresAt>now()).map(grant=>[grant.slotId,grant.accessToken]));
}
function activeSpin(slot) { return slot.spin && now() < slot.spin.startAt+slot.spin.duration; }
function navButtons() {
  const items = [['day','当日','calendar'],['plans','予定登録','pen'],['money','お金','wallet']];
  if (user.role === 'admin') items.push(['admin','管理','settings']);
  return '<nav class="nav" aria-label="メインメニュー">'+items.map(([key,name,symbol]) =>
    '<button type="button" data-action="nav" data-key="'+key+'" '+(view===key?'aria-current="page"':'')+'>'+icon(symbol,18)+name+'</button>').join('')+'</nav>';
}
function updateUrl() {
  if (hosted) return;
  const url = new URL(location.href);
  if (eventId) url.searchParams.set('event',eventId);
  else url.searchParams.delete('event');
  history.replaceState(null,'',url);
}
function clearAuth(message) {
  ticket++;
  homeTicket++;
  adminTicket++;
  setToken('');
  clearImages();
  revealStarts.clear();
  slotGrants.clear();
  clearTimeout(revealTimer);
  recordingGeneration++;
  recordingSession?.controller.cancel();
  recordingSession=null;recordingPending=false;
  if(savedVideo) URL.revokeObjectURL(savedVideo.url);
  savedVideo=null;
  user = home = state = admin = null;
  view = 'day';
  slotId = '';
  pending = false;
  if (dialog.open) closeModal();
  renderLogin();
  if (message) notify(message,true);
}
function handle(error) {
  if (error.code==='AUTH_REQUIRED' && user) { clearAuth(error.message); return; }
  notify(error.message,true);
}
function setSync(value) {
  offline = value;
  const node = $('sync-label');
  if (!node) return;
  node.textContent = offline ? '通信を再試行中' : '同期中';
  node.classList.toggle('offline',offline);
}
async function refreshHome() {
  const my = ++homeTicket;
  const next = await api('home');
  if (my !== homeTicket || !token()) return;
  home = next;
  user = home.user;
  clock = home.clock || 0;
  if (!home.events.some(event=>event.id===eventId)) {
    eventId = home.events[0]?.id || '';
    slotId = '';
    state = null;
    ticket++;
  }
  updateUrl();
}
async function refreshState(force = false) {
  if (!user || !eventId) return;
  const my = ++ticket;
  const selected = eventId;
  try {
    const next = await api('event.get',{eventId:selected,stamp:force ? '' : state?.stamp,accessTokens:eventAccess(selected)});
    if (my !== ticket || selected !== eventId || !user) return;
    clock = next.clock ?? clock;
    setSync(false);
    if (!next.unchanged) {
      state = next;
      if (!state.slots.some(slot => slot.id===slotId && slot.open)) slotId = '';
      render();
    } else if (force) render();
  } catch (error) {
    if (my !== ticket || selected !== eventId || !user) return;
    if (error.code === 'AUTH_REQUIRED') clearAuth(error.message);
    else if (error.code === 'FORBIDDEN') {
      notify(error.message,true);
      clearImages();
      state = null;
      await refreshHome();
      render();
    } else {
      setSync(true);
      if (!state && $('page-content') && view!=='admin') $('page-content').innerHTML = '<div class="panel stack"><p>'+e(error.message)+'</p><button class="secondary" type="button" data-action="retry">再読み込み</button></div>';
      if (force && state) handle(error);
    }
  }
}
async function refreshAdmin() {
  const my = ++adminTicket;
  const next = await api('admin.get');
  if (!user || my !== adminTicket) return;
  admin = next;
  if (view==='admin') render();
}
async function refreshEverything() {
  try {
    await refreshHome();
    if (!user) return;
    render();
    if (view==='admin') await refreshAdmin();
    else await refreshState(true);
  } catch (error) { handle(error); }
}
function renderLogin(activate = false) {
  stoppedWheel?.();
  clearTimeout(spinTimer);
  clearTimeout(revealTimer);
  $('top-actions').innerHTML = '';
  main.setAttribute('aria-busy','false');
  if (!configured) {
    main.innerHTML = '<section class="login panel stack"><span class="brand-wheel" aria-hidden="true"></span><h1>1日ルーレット</h1><p>接続設定が必要です。<code>config.js</code> に Apps Script のウェブアプリ URL を入力してください。</p></section>';
    return;
  }
  main.innerHTML = '<section class="login panel"><span class="brand-wheel" aria-hidden="true"></span><h1>'+(activate?'初回パスワード設定':'ログイン')+'</h1>'+
    '<form id="auth-form"><label class="fields"><span>ユーザー名</span><input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" maxlength="32" required></label>'+
    (activate?'<label class="fields"><span>初回設定コード</span><input name="code" autocomplete="off" spellcheck="false" maxlength="64" required></label>':'')+
    '<label class="fields"><span>'+(activate?'パスワード（12文字以上）':'パスワード')+'</span><input name="password" type="password" autocomplete="'+(activate?'new-password':'current-password')+'" maxlength="128" '+(activate?'minlength="12"':'')+' required></label>'+
    (activate?'<label class="fields"><span>パスワードの確認</span><input name="confirm" type="password" autocomplete="new-password" maxlength="128" minlength="12" required></label>':'')+
    '<div class="form-error" role="alert"></div><button class="primary" type="submit">'+(activate?'登録する':'ログイン')+'</button></form>'+
    '<button id="toggle-auth" class="quiet" type="button">'+(activate?'ログインへ戻る':'初回設定コードをお持ちの方')+'</button><button id="check-api" class="quiet" type="button">GAS接続を確認</button></section>';
  $('toggle-auth').onclick=()=>renderLogin(!activate);
  $('check-api').onclick=async event=>{
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const data = await api('ping');
      if (!data.ready) throw new Error('GASに接続しました。先に setupRoulette を実行してください。');
      notify('GASと接続できました。');
    } catch (error) { handle(error); }
    finally { button.disabled = false; }
  };
  bindForm('auth-form',async form=>{
    const f = new FormData(form);
    const username = f.get('username').trim().toLowerCase();
    if (activate && f.get('password') !== f.get('confirm')) throw new Error('パスワードが一致していません。');
    const proof = await passwordProof(username,f.get('password'));
    if (activate) {
      await api('auth.activate',{username,proof,code:f.get('code')});
    }
    const login = await api('auth.login',{username,proof});
    setToken(login.token);
    user = login.user;
    await refreshEverything();
  });
}
function render() {
  if (!user) return renderLogin();
  stoppedWheel?.();
  clearTimeout(spinTimer);
  clearTimeout(revealTimer);
  $('top-actions').innerHTML = (savedVideo?'<button type="button" class="secondary" data-action="saved-video">動画を保存</button>':'')+
    '<button type="button" class="secondary" data-action="account" aria-label="アカウント設定">'+e(user.name)+'</button>';
  const selected = state?.event || home?.events.find(event=>event.id===eventId);
  const shownSlot = view==='day' && slotId ? state?.slots.find(slot=>slot.id===slotId) : null;
  if (shownSlot?.id !== lastSlot) {
    expanded = new Set();
    lastSlot = shownSlot?.id || '';
  }
  const chooser = home?.events.length ? '<label class="hero-select fields"><span>イベント</span><select id="event-select">'+home.events.map(event=>
    '<option value="'+e(event.id)+'" '+(event.id===eventId?'selected':'')+'>'+e(event.title)+'</option>').join('')+'</select></label>' : '';
  const hero = shownSlot ? '' : '<section class="hero"><div><h1>'+e(selected?.title || 'イベント一覧')+'</h1>'+
    (selected?'<p>'+e(date(selected.start))+'　'+e(hour(selected.start)+'〜'+hour(selected.end))+'</p>':'')+'</div>'+chooser+'</section>';
  main.innerHTML = hero+navButtons()+'<div id="page-content"></div>';
  main.setAttribute('aria-busy','false');
  if ($('event-select')) $('event-select').onchange = async event=>{
    const selectedId=event.target.value;
    // Changing events also ends any recording before the next canvas appears.
    await finishRecording();
    eventId = selectedId;
    slotId = '';
    state = null;
    if (view==='admin') view='day';
    updateUrl();
    render();
    refreshState(true);
  };
  const page = $('page-content');
  if (view==='admin') page.innerHTML = renderAdmin();
  else if (!eventId) page.innerHTML = '<section class="panel empty"><h2>参加中のイベントはありません</h2><p>'+(
    user.role==='admin'?'管理画面からイベントを作成できます。':'管理者にイベントへの追加を依頼してください。')+'</p><button class="secondary" type="button" data-action="retry">再読み込み</button></section>';
  else if (!state) page.innerHTML = '<div class="panel loading">イベントを読み込んでいます…</div>';
  else if (view==='plans') page.innerHTML = renderPlans();
  else if (view==='money') page.innerHTML = renderMoney();
  else if (shownSlot) {
    page.innerHTML = renderRoom(shownSlot);
    wireRoom(shownSlot);
  } else {
    page.innerHTML = renderDay();
    const nextEnd = Math.min(...state.slots.filter(activeSpin).map(slot=>slot.spin.startAt+slot.spin.duration));
    if (Number.isFinite(nextEnd)) spinTimer = setTimeout(render,Math.max(40,nextEnd-now()+25));
  }
  setSync(offline);
}
function renderDay() {
  return '<div class="section-head"><h2>当日の時間枠</h2><div class="spread"><span class="sync" id="sync-label"></span><button type="button" class="secondary" data-action="share">イベントURLをコピー</button></div></div>'+
    '<div class="stack">'+state.slots.map(slot=>{
      const spinning = activeSpin(slot);
      const result = !spinning && slot.winner;
      const status = !slot.open?'解禁 '+time(slot.openAt):spinning?'抽選中':result?'決定済み':slot.winnerUnavailable?'再抽選できます':slot.registration+'件登録';
      return '<article class="panel slot-card"><div class="slot-time">'+e(hour(slot.start)+'〜'+hour(slot.end))+'</div>'+
        '<div><h3>'+e(slot.title || 'この時間の予定')+'</h3><span class="chip '+(!slot.open?'locked':'')+'">'+(!slot.open?icon('lock',13):'')+e(status)+'</span></div>'+
        '<button class="secondary" type="button" data-action="slot" data-key="'+e(slot.id)+'" '+(!slot.open?'disabled':'')+'>'+
        (!slot.open?'解禁前':result?'結果を見る':'開く')+icon('arrow',16)+'</button>'+
        (!slot.open?'<button class="quiet slot-preview" type="button" data-action="unlock-slot" data-key="'+e(slot.id)+'">管理者パスワードで開く</button>':'')+
        (result?'<details class="slot-winner"><summary><strong>'+e(result.title)+'</strong> <span class="muted">／ '+e(result.name)+'</span></summary><div>'+proposalContent(result,slot.id,false)+'</div></details>':'')+
        '</article>';
    }).join('')+'</div>';
}
function renderPlans() {
  return '<div class="section-head"><h2>自分の予定</h2></div><div class="stack">'+state.slots.map(slot=>
    '<article class="panel slot-card"><div class="slot-time">'+e(hour(slot.start)+'〜'+hour(slot.end))+'</div><div><h3>'+
    e(slot.title || 'この時間の予定')+'</h3><span class="chip '+(!slot.editable?'locked':'')+'">'+
    (!slot.editable?'編集締切':slot.mine?'登録済み':'未登録')+'</span>'+
    (slot.mine?'<p><strong>'+e(slot.mine.title)+'</strong></p>':'')+(slot.editAt && slot.editable?'<p class="muted">締切 '+e(time(slot.editAt))+'</p>':'')+'</div>'+
    '<button class="secondary" type="button" data-action="'+(slot.editable?'plan':'preview-plan')+'" data-key="'+e(slot.id)+'" '+(!slot.editable && !slot.mine?'disabled':'')+'>'+
    (slot.editable?(slot.mine?'編集する':'登録する'):(slot.mine?'確認する':'締切済み'))+'</button></article>').join('')+'</div>';
}
function proposalContent(proposal,slot,includeTitle = true) {
  const places = proposal.locations.length ? '<p><strong>場所候補</strong></p><ul>'+proposal.locations.map(place=>'<li>'+e(place)+'</li>').join('')+'</ul>' : '';
  const links = proposal.links.length ? '<p><strong>参考リンク</strong></p><ul>'+proposal.links.filter(safeUrl).map((link,index)=>'<li><a target="_blank" rel="noopener noreferrer" href="'+e(link)+'">リンク '+(index+1)+'</a></li>').join('')+'</ul>' : '';
  return (includeTitle?'<h3>'+e(proposal.title)+'</h3>':'')+'<div class="rich-view">'+richView(proposal.rich)+'</div>'+places+links+
    (proposal.image?photoButton({kind:'proposal',eventId,slotId:slot,userId:proposal.userId,key:proposal.image,...slotAccess(slot)},'参考画像を見る'):'');
}
function candidatesFor(slot) {
  return slot.people.filter(item=>item.proposal).map(item=>({userId:item.userId,name:item.name,title:item.proposal.title}));
}
function prepareReveals(slot) {
  const at = performance.now();
  let newOpening=false;
  roomRevealing = new Map();
  for (const item of slot.people) {
    if (!item.proposal) continue;
    const key = JSON.stringify([eventId,slot.id,item.userId,item.openedAt]);
    if (!revealStarts.has(key)) {
      revealStarts.set(key,at);
      expanded.add(item.userId);
      recordingFocusId=item.userId;
      newOpening=true;
    }
    const elapsed = Math.max(0,at-revealStarts.get(key));
    if (elapsed < REVEAL_MS) roomRevealing.set(item.userId,elapsed);
  }
  if(newOpening) revealSound();
  if (roomRevealing.size) {
    const remaining = Math.min(...Array.from(roomRevealing.values(),elapsed=>REVEAL_MS-elapsed));
    revealTimer = setTimeout(render,Math.ceil(remaining)+20);
  }
}
function revealAttrs(base,userId) {
  const elapsed = roomRevealing.get(userId);
  return 'class="'+base+(elapsed===undefined?'':' revealing')+'"'+
    (elapsed===undefined?'':' style="--reveal-duration:'+REVEAL_MS+'ms;--reveal-delay:-'+elapsed+'ms"');
}
function renderRoom(slot) {
  prepareReveals(slot);
  const spinning = activeSpin(slot);
  const revealed = candidatesFor(slot);
  const ready = slot.people.length>0 && revealed.length===slot.people.length && !roomRevealing.size;
  const candidates = spinning ? slot.spin.candidates : revealed;
  const hint = !slot.people.length ? '登録された予定がまだありません。' : roomRevealing.size ? '予定を開示しています…' : !ready ? '全員の予定を開示すると回せます。' : spinning?'ルーレットが回っています…':'';
  const win = !spinning && slot.winner;
  const personRows = slot.people.map(item=>{
    const face = '<span class="avatar" aria-hidden="true">'+e(initials(item.name))+'</span>';
    if (!item.proposal) return '<div class="person"><button class="person-button" type="button" data-action="reveal" data-key="'+e(item.userId)+'">'+face+
      '<span class="person-summary-text"><strong>'+e(item.name)+'</strong><br><small>タップして予定を開示</small></span>'+icon('lock',17)+'</button></div>';
    return '<details class="person" data-open-person="'+e(item.userId)+'" '+(expanded.has(item.userId)?'open':'')+'><summary>'+face+
      '<span class="person-summary-text"><strong>'+e(item.name)+'</strong><br><small '+revealAttrs('person-title',item.userId)+'>'+e(item.proposal.title)+'</small></span></summary>'+
      '<div '+revealAttrs('person-detail',item.userId)+'>'+proposalContent(item.proposal,slot.id,false)+'</div></details>';
  }).join('');
  return '<div class="spread"><button type="button" class="secondary" data-action="back">'+icon('back',17)+'時間枠一覧</button><span id="sync-label" class="sync"></span></div>'+
    '<div class="slot-head"><h1>'+e(slot.title || hour(slot.start)+'〜'+hour(slot.end))+'</h1><p class="muted">'+e(state.event.title)+(slot.title?'　'+e(hour(slot.start)+'〜'+hour(slot.end)):'')+'</p></div>'+
    (slot.earlyAccess?'<section class="preview-banner"><strong>管理者パスワードで解禁前の操作中</strong><p>予定の開示・抽選は、通常と同じ本番データとして保存されます。</p></section>':'')+
    recordingControls()+
    '<div class="room-grid"><div>'+
    (win?'<section class="panel win-panel"><span class="winner-tag">'+icon('spark',14)+'採用された予定</span><p class="muted">'+e(win.name)+'</p>'+
      '<div '+revealAttrs('winner-content',win.userId)+'>'+proposalContent(win,slot.id)+'</div></section>':(!spinning&&slot.winnerUnavailable?'<section class="panel win-panel"><p>前回の当選者は現在の参加者に含まれていません。必要に応じて再抽選してください。</p></section>':''))+
    '<section class="panel"><div class="spread"><h2>みんなの予定</h2><span class="chip">'+revealed.length+' / '+slot.people.length+' 開示</span></div>'+
    (personRows?'<div class="people">'+personRows+'</div>':'<p class="muted">登録済みの参加者がここに表示されます。</p>')+'</section></div>'+
    '<section class="panel draw-panel"><div class="spread"><h2>ルーレット</h2><button class="icon-btn" id="sound" data-action="sound" type="button" aria-pressed="'+soundOn()+'" aria-label="ルーレット音">'+icon(soundOn()?'speaker':'mute')+'</button></div>'+
    '<div class="wheel-wrap"><canvas id="wheel" width="520" height="520" aria-label="ルーレット円盤"></canvas>'+
    '<svg id="pointer" class="pointer" viewBox="0 0 30 47" aria-hidden="true"><path d="M3 3h24L15 43Z" fill="#d84d40" stroke="#792c33" stroke-width="2"/><path d="M8 7h14L15 30Z" fill="#f67d63"/></svg></div>'+
    '<div class="draw-actions"><button class="primary" id="spin" type="button" data-action="spin" '+(!ready || spinning || pending?'disabled':'')+'>'+
    icon('bolt',17)+(spinning?'抽選中':slot.spin?'もう一度回す':'ルーレットを回す')+'</button>'+
    (hint?'<p class="muted">'+e(hint)+'</p>':'')+
    (slot.spin?'<button class="quiet" type="button" data-action="history" '+(spinning || roomRevealing.size?'disabled':'')+'>抽選履歴</button>':'')+'</div>'+
    (candidates.length?'<ul class="candidates" aria-label="抽選候補">'+candidates.map((item,i)=>
      '<li><span class="color-dot" style="--swatch:'+colorAt(i)+'"></span><span><strong>'+e(item.name)+'</strong> · <span '+revealAttrs('candidate-title',item.userId)+'>'+e(item.title)+'</span></span></li>').join('')+'</ul>':'')+
    '</section></div>';
}
function wireRoom(slot) {
  const candidates = candidatesFor(slot);
  const spinning = activeSpin(slot);
  const unchanged = slot.spin && JSON.stringify(candidates)===JSON.stringify(slot.spin.candidates);
  // Canvas text cannot share the DOM blur animation. Keep its title hidden until the same reveal ends.
  const displayCandidates = (spinning?slot.spin.candidates:candidates).map(item=>
    roomRevealing.has(item.userId)?{...item,title:'開示中…'}:item);
  stoppedWheel = wheel($('wheel'),$('pointer'),displayCandidates,
    spinning || unchanged ? slot.spin : null,clock,render);
  for (const details of main.querySelectorAll('details[data-open-person]')) {
    details.ontoggle = () => {
      if (!details.isConnected) return;
      if (details.open) expanded.add(details.dataset.openPerson);
      else expanded.delete(details.dataset.openPerson);
    };
  }
}
function unlockSlot(slot) {
  const selectedEvent=eventId;
  const viewer=user.id;
  modal('解禁前の時間枠を開く','<p>管理者から教えてもらったパスワードを入力すると、通常と同じページで予定の開示・ルーレット・動画保存を使えます。開示・抽選は本番データとして保存されます。</p>'+
    '<form id="unlock-auth"><label class="fields"><span>管理者のパスワード</span><input name="password" type="password" autocomplete="off" maxlength="128" required></label>'+
    '<details><summary>管理者のユーザー名を変更</summary><label class="fields"><span>管理者ユーザー名</span><input name="adminUsername" value="admin" autocomplete="off" autocapitalize="none" spellcheck="false" required></label></details>'+
    '<div class="form-error" role="alert"></div><button class="primary" type="submit">この時間枠を開く</button></form>');
  bindForm('unlock-auth',async form=>{
    const password=form.elements.password.value;
    const adminUsername=form.elements.adminUsername.value.trim().toLowerCase();
    form.elements.password.value='';
    const proof=await passwordProof(adminUsername,password);
    let result;
    try {result=await api('admin.unlock',{eventId:selectedEvent,slotId:slot.id,adminUsername,proof});}
    catch(error) {
      if(error.code==='VALIDATION_ERROR' && error.message.includes('操作が見つかりません')) throw new Error('この機能を使うには、管理者によるGASの更新が必要です。');
      throw error;
    }
    if(eventId!==selectedEvent || user?.id!==viewer || !dialog.open || !form.isConnected) return;
    if(!result.accessToken || result.slotId!==slot.id || result.eventId!==selectedEvent) throw new Error('時間枠を開けませんでした。GASを最新バージョンに更新してください。');
    slotGrants.set(JSON.stringify([selectedEvent,slot.id]),result);
    ticket++;
    slotId=slot.id;view='day';
    closeModal();
    await initAudio();
    await refreshState(true);
  });
}
dialog.addEventListener('close',()=>{
  for(const input of dialog.querySelectorAll('input[type="password"]')) input.value='';
});
function recordingControls() {
  const active=!!recordingSession;
  const supported=recordingSupported();
  return '<section class="panel recording-bar"><div><h2>'+(active?'<span class="record-dot"></span>動画を記録中':'思い出を動画に')+'</h2><p class="muted">'+
    (active?'次の抽選結果が出たあとに自動停止します。画面を表示したまま操作してください。':supported?'開示前に開始すると、予定の文章・ルーレット・効果音を1本の縦長動画に残せます。':'このブラウザは動画の作成に対応していません。')+'</p></div>'+
    '<button class="'+(active?'secondary':'primary')+'" type="button" data-action="'+(active?'stop-recording':'start-recording')+'" '+(!supported || recordingPending?'disabled':'')+'>'+
    (recordingPending?'準備中…':active?'記録を終了して保存':'記録開始')+'</button></section>';
}
function recordFrame(context) {
  if(!user || eventId!==context.eventId || slotId!==context.slotId || view!=='day') return null;
  const slot=state?.slots.find(item=>item.id===context.slotId);
  if(!slot?.open) return null;
  const spinning=!!activeSpin(slot);
  const finished=slot.spin && now()>=slot.spin.startAt+slot.spin.duration;
  const selected=finished && slot.people.find(person=>person.userId===slot.spin.winnerId && person.proposal);
  return {
    eventTitle:state.event.title,slotTitle:slot.title || hour(slot.start)+'〜'+hour(slot.end),
    people:slot.people,focusId:recordingFocusId,spin:slot.spin,spinning,
    winner:finished && selected?selected:null,
    revealProgress:Object.fromEntries(slot.people.map(person=>{
      const key=JSON.stringify([eventId,slot.id,person.userId,person.openedAt]);
      const began=revealStarts.get(key);
      return [person.userId,began===undefined?0:Math.min(1,(performance.now()-began)/REVEAL_MS)];
    })),
    wheel:$('wheel')
  };
}
async function startRoomRecording(slot) {
  if(recordingSession || recordingPending || !slot?.open) return;
  const context={eventId,slotId:slot.id};
  const generation=++recordingGeneration;
  recordingPending=true;render();
  let made=false,stopReason='';
  try {
    const controller=await startRecording({
      read:()=>recordFrame(context),
      onReady:({blob,extension,reason})=>{
        if(generation!==recordingGeneration || !user) return;
        if(savedVideo) URL.revokeObjectURL(savedVideo.url);
        savedVideo={blob,url:URL.createObjectURL(blob),filename:'roulette-'+new Date().toISOString().replace(/[:.]/g,'-')+'.'+extension};
        made=true;stopReason=reason;
      },
      onError:error=>{if(generation===recordingGeneration && user) handle(error);},
      onStop:()=>{
        if(generation!==recordingGeneration) return;
        recordingSession=null;recordingPending=false;
        if(user) {render();if(made) {showSavedVideo();if(stopReason) notify(stopReason);}}
      }
    });
    if(generation!==recordingGeneration || !recordFrame(context)) {await controller.cancel();return;}
    recordingSession={...context,controller};
  } finally {
    if(generation===recordingGeneration) {recordingPending=false;if(user) render();}
  }
}
async function finishRecording() {
  if(recordingSession) await recordingSession.controller.stop();
  else if(recordingPending) {recordingGeneration++;recordingPending=false;}
}
function showSavedVideo() {
  if(!savedVideo) return;
  const video=savedVideo;
  let shareable=false;
  try {shareable=typeof navigator.share==='function' && navigator.canShare?.({files:[new File([video.blob],video.filename,{type:video.blob.type})]});} catch {}
  modal('動画を保存','<p>保存ボタンで端末に残してください。ページを閉じる前に保存しましょう。</p>'+
    '<video class="recording-preview" controls playsinline src="'+e(video.url)+'"></video><div class="spread">'+
    '<a class="button-link primary" data-video-download href="'+e(video.url)+'" download="'+e(video.filename)+'">動画をダウンロード</a>'+
    (shareable?'<button class="secondary" type="button" data-action="share-video">共有・ファイルに保存</button>':'')+'</div>');
}
async function shareSavedVideo() {
  if(!savedVideo) return;
  try {await navigator.share({files:[new File([savedVideo.blob],savedVideo.filename,{type:savedVideo.blob.type})],title:'1日ルーレット'});savedVideo.saved=true;}
  catch(error) {if(error.name!=='AbortError') throw new Error('共有できませんでした。動画のダウンロードをお試しください。');}
}
function renderMoney() {
  const {summary,expenses} = state;
  return '<div class="section-head"><h2>お金の管理</h2><button type="button" class="primary" data-action="new-expense">'+icon('plus',18)+'支出を追加</button></div>'+
    '<div class="two-col"><section class="panel"><div class="spread"><h3>支出一覧</h3><strong>'+yen(summary.total)+'</strong></div>'+
    (expenses.length?expenses.map(item=>'<article class="expense-card users-row spread"><div><strong>'+e(item.title)+'</strong><p class="muted">'+
    e(time(item.paidAt)+' · '+personName(item.payerId)+' が立替')+'</p></div><button type="button" class="secondary" data-action="expense" data-key="'+
    e(item.id)+'">'+yen(item.total)+icon('arrow',15)+'</button></article>').join(''):'<p class="muted">支出はまだありません。</p>')+
    '</section><section class="panel"><h3>最終精算</h3>'+
    (summary.transfers.length?'<ul class="summary-list">'+summary.transfers.map(transfer=>'<li><span>'+e(transfer.from)+' → '+e(transfer.to)+'</span><strong>'+yen(transfer.amount)+'</strong></li>').join('')+'</ul>':
      '<p class="muted">'+(expenses.length?'受け渡しはありません。':'支出を登録すると精算結果が表示されます。')+'</p>')+
    '<details class="users-row"><summary>内訳を見る</summary><ul class="summary-list">'+summary.balances.map(item=>
    '<li><span><b>'+e(item.name)+'</b><br><small>立替 '+yen(item.paid)+' · 負担 '+yen(item.owed)+'</small></span><strong>'+
    (item.balance>0?'+':'')+yen(item.balance)+'</strong></li>').join('')+'</ul></details></section></div>';
}
function personName(id) {
  return state.summary.balances.find(person=>person.id===id)?.name || '参加者';
}
function expenseDetail(item) {
  modal(item.title,'<div class="stack"><strong>'+yen(item.total)+'</strong><p class="muted">'+
    e(time(item.paidAt)+' · '+personName(item.payerId)+' が立替 · '+(item.mode==='equal'?'割り勘登録':'各自登録'))+
    '</p><ul class="summary-list">'+Object.entries(item.shares).map(([id,value])=>'<li><span>'+e(personName(id))+'</span><strong>'+yen(value)+'</strong></li>').join('')+'</ul>'+
    (item.notes?'<p style="white-space:pre-wrap">'+e(item.notes)+'</p>':'')+
    (item.image?photoButton({eventId,kind:'expense',id:item.id,key:item.image},'レシート写真を拡大'):'')+
    (item.canEdit?'<div class="spread"><button type="button" class="secondary" data-action="edit-expense" data-key="'+e(item.id)+'">編集</button>'+
    '<button type="button" class="danger" data-action="delete-expense" data-key="'+e(item.id)+'">削除</button></div>':'')+'</div>');
}
function renderAdmin() {
  if (!admin) return '<div class="panel stack"><p>管理情報を読み込んでいます。</p><button class="secondary" type="button" data-action="admin-refresh">再読み込み</button></div>';
  return '<div class="section-head"><h2>管理</h2><button class="secondary" type="button" data-action="admin-refresh">更新する</button></div>'+
    '<div class="two-col"><section class="panel"><div class="spread"><h3>イベント</h3><button type="button" class="primary" data-action="event-form">'+icon('plus',16)+'作成</button></div>'+
    admin.events.map(event=>'<div class="users-row"><p><strong>'+e(event.title)+'</strong></p><p class="muted">'+e(date(event.start))+' · '+event.memberIds.length+'人</p>'+
      '<div class="spread"><button type="button" class="secondary" data-action="event-form" data-key="'+e(event.id)+'">設定</button>'+
      '<button type="button" class="secondary" data-action="registrations" data-key="'+e(event.id)+'">登録状況</button></div></div>').join('')+
    '</section><section class="panel"><div class="spread"><h3>ユーザー</h3><button type="button" class="primary" data-action="user-form">'+icon('plus',16)+'発行</button></div>'+
    admin.users.map(item=>'<div class="users-row spread"><p><strong>'+e(item.name)+'</strong><br><span class="muted">'+e(item.username)+
      ' · '+(item.role==='admin'?'管理者':'参加者')+(item.configured?'':' · 初回設定待ち')+'</span></p>'+
      '<button type="button" class="secondary" data-action="user-form" data-key="'+e(item.id)+'">編集</button></div>').join('')+'</section></div>';
}
function account() {
  modal('アカウント','<div class="stack"><p>'+e(user.name)+'（'+e(user.username)+'）</p>'+
    '<button class="secondary" type="button" data-action="password">パスワードを変更</button><button class="secondary" type="button" data-action="logout">ログアウト</button></div>');
}
async function revealPerson(slot,item) {
  await initAudio();
  recordingFocusId=item;
  await api('reveal.open',{eventId,slotId:slot.id,userId:item,...slotAccess(slot.id)},{retry:true});
  await refreshState(true);
}
async function runSpin(slot) {
  if (pending || activeSpin(slot) || roomRevealing.size) return;
  if (slot.spin && !confirm('再抽選しますか？ 新しい結果が採用されます。')) return;
  initAudio();
  pending = true;
  $('spin').disabled = true;
  const context = eventId;
  try {
    const result = await api('draw.spin',{eventId:context,slotId:slot.id,previousSpinId:slot.spin?.id || '',
      candidateSignature:JSON.stringify(candidatesFor(slot)),...slotAccess(slot.id,context)},{retry:true});
    if (eventId===context && state) {
      clock = result.clock ?? clock;
      const current = state.slots.find(item=>item.id===slot.id);
      if (current && (!current.spin || result.number >= current.spin.number)) {
        current.spin = result;
        current.winner = null;
        state.stamp = '';
        render();
      }
    }
  } finally { pending = false; await refreshState(true); }
}
async function historyModal(slot) {
  const result = await api('draw.history',{eventId,slotId:slot.id,...slotAccess(slot.id)});
  modal('抽選履歴','<div class="stack">'+result.map(item=>{
    const winner = item.candidates.find(person=>person.userId===item.winnerId);
    return '<details class="form-box"><summary><strong>第'+item.number+'回　'+e(item.snapshot.title)+'</strong>　'+e(winner?.name || '')+'</summary>'+
      '<p class="muted">'+e(time(item.createdAt)+' · '+item.actorName+' が抽選')+'</p><div class="rich-view">'+richView(item.snapshot.rich)+'</div></details>';
  }).join('')+'</div>');
}
async function doAction(button) {
  const action = button.dataset.action;
  const key = button.dataset.key;
  const slot = state?.slots.find(item=>item.id===(['slot','plan','preview-plan','unlock-slot'].includes(action)?key:slotId));
  const expense = state?.expenses.find(item=>item.id===key);
  if(['nav','back','slot','unlock-slot','logout'].includes(action)) await finishRecording();
  switch (action) {
    case 'nav':
      if (key==='admin' && user.role!=='admin') return;
      view = key;
      slotId = '';
      render();
      if (view==='admin') await refreshAdmin();
      else await refreshState();
      return;
    case 'retry': return refreshEverything();
    case 'back': slotId = ''; render(); return;
    case 'slot': if (slot?.open) { slotId = slot.id; initAudio(); render(); } return;
    case 'unlock-slot': if(slot && !slot.open) unlockSlot(slot); return;
    case 'start-recording': return startRoomRecording(slot);
    case 'stop-recording': return finishRecording();
    case 'saved-video': return showSavedVideo();
    case 'share-video': return shareSavedVideo();
    case 'share': {
      const shared = new URL(hosted ? window.ROULETTE_HOST : location.href);
      if (hosted) shared.searchParams.set('app','1');
      shared.searchParams.set('event',eventId);
      return copyText(shared.href);
    }
    case 'sound': {
      const enabled = toggleSound();
      button.setAttribute('aria-pressed',String(enabled));
      button.innerHTML = icon(enabled?'speaker':'mute');
      notify(enabled?'音をオンにしました。':'音をオフにしました。');
      return;
    }
    case 'reveal': await revealPerson(slot,key); return;
    case 'spin': return runSpin(slot);
    case 'history': return historyModal(slot);
    case 'plan': return editProposal(eventId,slot,user,()=>refreshState(true));
    case 'preview-plan': return modal('自分の予定',proposalContent(slot.mine,slot.id));
    case 'new-expense': return editExpense(state,null,user,()=>refreshState(true));
    case 'expense': return expenseDetail(expense);
    case 'edit-expense': return editExpense(state,expense,user,()=>refreshState(true));
    case 'delete-expense':
      if (!confirm('この支出を削除しますか？ 精算内容も再計算されます。')) return;
      await api('expense.delete',{eventId,id:expense.id,revision:expense.revision},{retry:true});
      closeModal();
      notify('支出を削除しました。');
      return refreshState(true);
    case 'admin-refresh': return refreshAdmin();
    case 'user-form': return userForm(admin.users.find(item=>item.id===key),user,refreshEverything);
    case 'event-form': return eventForm(admin.events.find(item=>item.id===key),admin.users,user,refreshEverything);
    case 'registrations': return registrations(admin.events.find(item=>item.id===key),admin.users);
    case 'account': return account();
    case 'password': return passwordForm(user,()=>clearAuth());
    case 'logout':
      try { await api('auth.logout'); }
      finally { clearAuth(); }
      return;
  }
}
document.addEventListener('click',async event=>{
  if(event.target.closest('a[data-video-download]') && savedVideo) savedVideo.saved=true;
  const button = event.target.closest('button[data-action],button[data-photo]');
  if (!button || button.disabled || !user) return;
  if (button.dataset.photo) { await showPhoto(button); return; }
  if (button.dataset.action==='reveal' || button.dataset.action==='delete-expense') button.disabled = true;
  try { await doAction(button); }
  catch (error) { handle(error); }
  finally {
    if (button.isConnected && (button.dataset.action==='reveal'||button.dataset.action==='delete-expense')) button.disabled = false;
  }
});
$('brand').onclick=async()=>{
  if (!user) return renderLogin();
  await finishRecording();
  view = 'day';
  slotId = '';
  render();
  refreshState(true);
};
async function polling() {
  if (document.hidden || !user || !eventId || view==='admin' || syncRunning) return;
  syncRunning = true;
  try { await refreshState(); } catch (error) { handle(error); }
  finally { syncRunning = false; }
}
setInterval(polling,pollMs);
document.addEventListener('visibilitychange',polling);
window.addEventListener('online',polling);
window.addEventListener('beforeunload',event=>{
  if(recordingSession || recordingPending || (savedVideo && !savedVideo.saved)) {event.preventDefault();event.returnValue='';}
});
if (token() && configured) {
  try { await refreshHome(); render(); await refreshState(true); }
  catch (error) {
    if (error.code === 'AUTH_REQUIRED') clearAuth(error.message);
    else { renderLogin(); notify(error.message,true); }
  }
} else renderLogin();
