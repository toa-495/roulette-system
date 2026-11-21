import {api,configured,pollMs,passwordProof,setToken,token,uid} from './api.js';
import {$,e,icon,yen,initials,hour,date,time,richView,safeUrl,photoButton,showPhoto,notify,modal,closeModal,bindForm,copyText,clearImages} from './ui.js';
import {editProposal,editExpense,userForm,eventForm,registrations,passwordForm} from './forms.js?v=20261121-supplement1';
import {wheel,colorAt,toggleSound,initAudio,soundOn,revealSound} from './wheel.js?v=20261120-ui2';
import {startRecording,recordingSupported} from './recording.js?v=20261121-custom-victory1';
import {nameCandidates,nameSpin} from './names.js?v=20261120-finale1';
import {makeCustomState,resizeCustom,balanceCustom,customCandidates,percentSum} from './custom.js?v=20261121-custom1';
import {showWinner,dismissWinner} from './celebration.js?v=20261121-victory1';
import {missionTeaser,missionOpen,missionClaim,missionToggle,hideMission,missionRecapHtml,missionLoadRecap,missionRecapReset} from './missions.js?v=20261121-midnight2';

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
let meetingDrawPending = false;
let ticket = 0;
let homeTicket = 0;
let adminTicket = 0;
let stoppedWheel;
let stoppedCustomWheel;
const customRoulette=makeCustomState();
const celebrationArmed=new Set();
const celebrationShown=new Set();
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
let roomPreparation;
const localReveals=new Map();
const completedSpins=new Set();
const nameSettings=new Map();
let overviewCache;
function localRevealKey(slot,id) {return JSON.stringify([eventId,slot.id,slot.meetingRoundId || '',id]);}
function visualOpenedAt(slot,person) {return localReveals.get(localRevealKey(slot,person.userId))?.openedAt || person.openedAt;}
function savingReveals(slot) {return slot.people.some(person=>localReveals.get(localRevealKey(slot,person.userId))?.pending);}

function clearRoomPreparation() {roomPreparation=null;}
function preparedRoom(slot) {
  const entry=roomPreparation;
  return entry && entry.eventId===eventId && entry.slotId===slot.id && entry.viewer===user?.id
    && entry.version===slot.contentVersion && entry.spinId===(slot.spin?.id || '') ? entry.data : null;
}
async function prepareRoom(slot) {
  if(!slot.open || (slot.spin && !slot.meetingFirst) || typeof slot.contentVersion!=='string' || !user) {clearRoomPreparation();return;}
  const old=roomPreparation;
  if(old && old.eventId===eventId && old.slotId===slot.id && old.viewer===user.id && old.version===slot.contentVersion && old.spinId===(slot.spin?.id || '')
    && (old.data || old.promise || Date.now()-old.failedAt<15000)) return old.promise;
  const entry={eventId,slotId:slot.id,viewer:user.id,version:slot.contentVersion,spinId:slot.spin?.id || ''};
  roomPreparation=entry;
  entry.promise=(async()=>{
    try {
      const data=await api('room.prepare',{eventId:entry.eventId,slotId:entry.slotId,...slotAccess(entry.slotId,entry.eventId)});
      const current=state?.slots.find(item=>item.id===entry.slotId);
      if(roomPreparation!==entry || user?.id!==entry.viewer || eventId!==entry.eventId || slotId!==entry.slotId
        || !current?.open || (current.spin?.id || '')!==entry.spinId || current.contentVersion!==entry.version) return;
      if(data.eventId===entry.eventId && data.slotId===entry.slotId && data.contentVersion===entry.version && data.lastSpinId===entry.spinId) entry.data=data;
      else entry.failedAt=Date.now();
    } catch(error) {
      entry.failedAt=Date.now();
      if(error.code==='AUTH_REQUIRED' && roomPreparation===entry) handle(error);
    } finally {entry.promise=null;}
  })();
  return entry.promise;
}

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
function activeSpin(slot) { return slot.spin && !completedSpins.has(slot.spin.id) && now() < slot.spin.startAt+slot.spin.duration; }
function watchedSpinCelebration(spin){
  if(!spin || !celebrationArmed.has(spin.id) || celebrationShown.has(spin.id) || !state || view!=='day')return;
  const m=state.meeting;
  let heading='',name='',detail='';
  if(!slotId && m?.spin?.id===spin.id){
    if(activeSpin(m))return;
    const final=!state.roundsEnabled || m.round?.finished;
    if(final && !m.place)return; // Await the server result; never expose a location early.
    const finalId=final?(m.round?.winnerId || spin.winnerId):spin.winnerId;
    const people=meetingWheelPeople(m);
    name=people.find(p=>p.userId===finalId)?.name ||
      m.members.find(p=>p.userId===finalId || p.id===finalId)?.name ||
      m.round?.wins?.find(p=>p.userId===finalId)?.name || '';
    heading=final?'集合場所が決定！':(m.round?.phase==='sudden'?'サドンデスへ！':'第'+(m.round?.completedRegular||1)+'回の当選');
    detail=final?m.place:'次の回の勝負へ';
  }else{
    const slot=state.slots.find(p=>p.id===slotId && p.spin?.id===spin.id);
    if(!slot || activeSpin(slot))return;
    const final=!state.roundsEnabled || slot.round?.finished;
    const chosen=final?(slot.adoptedUserId || slot.round?.winnerId || spin.winnerId):spin.winnerId;
    const person=slot.people.find(p=>p.userId===chosen);
    name=person?.name || spin.candidates?.find(p=>p.userId===chosen)?.name || '';
    heading=final?'採用する予定が決定！':(slot.round?.phase==='sudden'?'サドンデスへ！':'第'+(slot.round?.completedRegular||1)+'回の当選');
    detail=final?(slot.winner?.title || person?.proposal?.title || ''):'次の回の勝負へ';
  }
  if(!name)return;
  celebrationShown.add(spin.id);celebrationArmed.delete(spin.id);
  if(celebrationShown.size>120)celebrationShown.delete(celebrationShown.values().next().value);
  showWinner({heading,name,detail});
}
function watchForCompletedSpin(){
  if(!state || view!=='day')return;
  const source=slotId?state.slots.find(p=>p.id===slotId):state.meeting;
  const spin=source?.spin;
  if(!spin)return;
  if(activeSpin(source))celebrationArmed.add(spin.id);
  else watchedSpinCelebration(spin);
}
function spinFinished(spin){
  if(spin){
    completedSpins.add(spin.id);
    if(completedSpins.size>100)completedSpins.delete(completedSpins.values().next().value);
  }
  render();
  if(spin)void refreshState(true);
}
function localSpinFinished(config,category){
  const spin=config.spin;
  if(!spin || celebrationShown.has(spin.id))return;
  completedSpins.add(spin.id);celebrationShown.add(spin.id);
  render();
  const selected=spin.candidates.find(p=>p.userId===spin.winnerId);
  if(view==='names' && selected)showWinner({heading:category==='name'?'今回選ばれたのは':'ルーレットの結果',name:selected.name});
}
function navButtons() {
  const items = [['day','当日','calendar'],['plans','予定登録','pen'],['money','お金','wallet'],['names','ルーレット','users'],['overview','振り返り','spark']];
  if (user.role === 'admin') items.push(['admin','管理','settings']);
  return '<nav class="nav'+(user.role==='admin'?' nav--admin':'')+'" aria-label="メインメニュー">'+items.map(([key,name,symbol]) =>
    '<button type="button" data-action="nav" data-key="'+key+'" '+(key==='overview' && !state?.overview?.available?'disabled title="最後の時間枠の抽選後に解放"':'')+' '+(view===key?'aria-current="page"':'')+'>'+icon(symbol,18)+name+'</button>').join('')+'</nav>';
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
  localReveals.clear();completedSpins.clear();
  nameSettings.clear();overviewCache=null;
  dismissWinner();celebrationArmed.clear();celebrationShown.clear();
  const reset=makeCustomState();customRoulette.entries=reset.entries;customRoulette.spin=null;
  clearRoomPreparation();
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
      for(const slot of next.slots || []) if(slot.open) for(const person of slot.people) {
        const local=localReveals.get(localRevealKey(slot,person.userId));
        if(local?.pending && !person.proposal) {person.proposal=local.proposal;person.openedAt=local.openedAt;}
        if(local?.pending && (slot.round?slot.round.finished && slot.adoptedUserId===person.userId:slot.spin?.winnerId===person.userId) && person.proposal) slot.winner={name:person.name,...person.proposal};
      }
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
      clearRoomPreparation();
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
  stoppedCustomWheel?.();
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
      notify(data.version>=6?'GASと接続できました。1日の予定一覧も使えます。':data.version>=5?'GASと接続できました。集合場所・到着確認の機能も使えます。':data.version>=4?'GASと接続できました。先読み機能も使えます。':'GASと接続できました。');
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
  closeLockedPlanEditor();
  stoppedWheel?.();
  stoppedCustomWheel?.();
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
    dismissWinner();celebrationArmed.clear();
    hideMission(true);missionRecapReset();
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
  else if (view==='overview') {page.innerHTML=renderOverview();void loadOverview();if(state.missions?.enabled&&state.overview?.available)void missionLoadRecap(eventId,state.overview.finalDrawId,()=>{if(user&&view==='overview')render();});}
  else if (view==='names') {page.innerHTML=renderNames();wireNames();wireCustom();}
  else if (shownSlot) {
    page.innerHTML = renderRoom(shownSlot);
    wireRoom(shownSlot);
  } else {
    page.innerHTML = renderDay();
    wireMeeting();
    const nextEnd = Math.min(...state.slots.filter(activeSpin).map(slot=>slot.spin.startAt+slot.spin.duration));
    if (Number.isFinite(nextEnd)) spinTimer = setTimeout(render,Math.max(40,nextEnd-now()+25));
  }
  watchForCompletedSpin();
  if(shownSlot) void prepareRoom(shownSlot);
  else clearRoomPreparation();
  setSync(offline);
}
function roundSettingsHtml(slot) {
  const round=state.roundsEnabled && slot?.round;
  if(!round) return '';
  if(!round.canConfigure) {
    return '<div class="round-settings round-fixed">'+icon('lock',15)+
      '<span>勝負回数：<strong>'+round.target+'回</strong>（開始後は変更不可）</span></div>';
  }
  return '<div class="round-settings"><label class="round-settings-field">'+
    '<span>勝負回数</span><input type="number" inputmode="numeric" min="1" max="10" step="1" value="'+round.target+
    '" aria-label="勝負回数（1〜10回）" data-round-input></label><span class="round-unit">回（1〜10）</span>'+
    '<button type="button" class="secondary" data-action="round-save" data-key="'+e(slot.id)+'" '+(pending?'disabled':'')+'>設定を保存</button>'+
    (round.canLegacyExtend?'<p class="round-legacy"></p>':
    '<p class="round-help">初期値1回。勝負を回すまでは変更できます。</p>')+'</div>';
}
function roundScoreHtml(round) {
  if(!state.roundsEnabled || !round || !round.baseDrawId) return '';
  const status=round.phase==='sudden'?'同率最多！サドンデスへ':
    round.phase==='spinning'?'抽選中…':round.finished?'勝負が決まりました':
    '第'+round.completedRegular+'回まで終了／残り'+round.remaining+'回';
  const labels=(round.wins||[]).map(p=>'<li><span>'+e(p.name)+'</span><strong>'+p.count+'勝</strong></li>').join('');
  return '<section class="round-score" aria-label="ルーレットの勝敗"><div class="round-score-head"><strong>'+
    '勝敗：'+round.completedRegular+' / '+round.target+'回</strong><span class="chip">'+e(status)+'</span></div>'+
    '<ul class="round-score-list">'+labels+'</ul>'+
    (round.finished?'<p class="round-winner">'+icon('spark',15)+' 最終勝者：'+e((round.wins||[]).find(p=>p.userId===round.winnerId)?.name||'参加者')+'</p>':'')+
    (round.phase==='sudden'?'<p class="round-sudden">最多勝のメンバーだけで、決着の1回を回します。</p>':'')+
    '</section>';
}
function roundSpinButtonLabel(round,hasSpin,meeting=false) {
  if(!round) return hasSpin?(meeting?'集合場所を選び直す':'もう一度回す'):(meeting?'集合場所を決める':'ルーレットを回す');
  if(round.phase==='sudden') return 'サドンデスを回す';
  if(round.finished) return '勝負をやり直す';
  if(round.phase==='continue') return '第'+(round.drawnRegular+1)+'回を回す';
  if(round.phase==='spinning') return '抽選中…';
  return meeting?'集合場所を決める':'第1回を回す';
}

function renderDay() {
  return (state.missions?.enabled?missionTeaser():'')+
    (state.overview?.available?'<section class="panel overview-invite"><div><h2>今日の1日を並べて見よう</h2><p>採用された予定と、みんなが考えた1日の予定を一覧で見られます。</p></div><button class="primary" type="button" data-action="nav" data-key="overview">振り返りを見る</button></section>':'')+
    renderMeeting()+
    '<div class="section-head"><h2>当日の時間枠</h2><div class="spread"><span class="sync" id="sync-label"></span><button type="button" class="secondary" data-action="share">イベントURLをコピー</button></div></div>'+
    '<div class="stack">'+state.slots.map(slot=>{
      const spinning=activeSpin(slot);
      const result=!spinning && (!state.roundsEnabled||slot.round?.finished) && slot.winner;
      const round=state.roundsEnabled?slot.round:null;
      const status=slot.meetingFirst && !slot.open?'全員の到着待ち':
        !slot.open?'解禁 '+time(slot.openAt):spinning?'抽選中':
        round?.phase==='sudden'?'サドンデス待ち':
        round?.phase==='continue'?'途中経過 '+round.completedRegular+'/'+round.target+'回':
        result?'決定済み':slot.meetingFirst?'到着完了・予定は未開示':
        slot.winnerUnavailable?'再抽選できます':slot.registration+'件登録';
      return '<article class="panel slot-card"><div class="slot-time">'+e(hour(slot.start)+'〜'+hour(slot.end))+'</div>'+
        '<div><h3>'+e(slot.title || 'この時間の予定')+'</h3><span class="chip '+(!slot.open?'locked':'')+'">'+(!slot.open?icon('lock',13):'')+e(status)+'</span></div>'+
        '<button class="secondary" type="button" data-action="slot" data-key="'+e(slot.id)+'" '+(!slot.open?'disabled':'')+'>'+
        (!slot.open?'解禁前':result?'結果を見る':'開く')+icon('arrow',16)+'</button>'+
        (!slot.open && !slot.meetingFirst?'<button class="quiet slot-preview" type="button" data-action="unlock-slot" data-key="'+e(slot.id)+'">管理者パスワードで開く</button>':'')+
        (!slot.meetingFirst?roundSettingsHtml(slot):'')+
        (result?'<details class="slot-winner"><summary><strong>'+e(result.title)+'</strong> <span class="muted">／ '+e(result.name)+'</span></summary><div>'+proposalContent(result,slot.id,false)+'</div></details>':'')+
        '</article>';
    }).join('')+'</div>';
}
function renderMeeting() {
  const m=state.meeting;if(!m) return '';
  const spinning=!!activeSpin(m);
  const done=(state.roundsEnabled?!!m.round?.finished:!!m.spin) && !spinning;
  const place=done?(m.place || ''):'';
  const names=m.members.map(member=>'<li class="'+(member.arrived?'arrived':'')+'">'+e(member.name)+'　'+
    (done?(member.arrived?'到着済み':'到着待ち'):(member.registered?'登録済み':'登録待ち'))+'</li>').join('');
  const first=state.slots.find(slot=>slot.id===m.slotId);
  const round=state.roundsEnabled?m.round:null;
  const restart=!!round?.finished || (!round && !!m.spin);
  return '<section class="panel meeting-panel"><div class="spread"><h2>集合場所ルーレット</h2><span class="chip">'+m.registered+' / '+m.total+' 登録</span></div>'+
    '<p class="muted">全員の最初の予定がそろうと集合場所を決められます。</p>'+
    roundSettingsHtml(first)+
    recordingControls('meeting')+
    '<div class="spread"><span></span><button class="icon-btn" data-action="sound" type="button" aria-pressed="'+soundOn()+'" aria-label="集合場所ルーレット音">'+icon(soundOn()?'speaker':'mute')+'</button></div>'+
    (m.ready || m.spin?'<div class="meeting-wheel"><canvas id="meeting-wheel" width="520" height="520" aria-label="集合場所のルーレット"></canvas><svg id="meeting-pointer" class="pointer" viewBox="0 0 30 47" aria-hidden="true"><path d="M3 3h24L15 43Z" fill="#d84d40" stroke="#792c33" stroke-width="2"/></svg></div>':'')+
    roundScoreHtml(round)+
    (place?'<div class="first-plan-note"><strong>集合場所</strong><p>'+e(place)+'</p><p class="muted">最初の予定は、全員が到着してから開示します。</p></div>':'')+
    (spinning?'<p role="status">集合場所を抽選しています…</p>':'')+
    '<div class="draw-actions"><button class="primary" type="button" data-action="meeting-spin" data-restart="'+restart+'" '+
      (!m.ready || spinning || pending || recordingPending?'disabled':'')+'>'+e(roundSpinButtonLabel(round,!!m.spin,true))+'</button>'+
    (round && (round.phase==='continue'||round.phase==='sudden')?
      '<button class="quiet" type="button" data-action="meeting-restart" '+(spinning||pending?'disabled':'')+'>勝数をリセットして最初から</button>':'')+
    (done && !m.needsReroll?'<button class="'+(m.myArrived?'secondary':'primary')+'" type="button" data-action="meeting-arrive" '+(m.myArrived || pending?'disabled':'')+'>'+(m.myArrived?'到着を確認しました':'集合場所に着いた')+'</button>':'')+'</div>'+
    (m.needsReroll?'<p>選ばれた人が参加者から外れています。集合場所を選び直してください。</p>':'')+
    '<ul class="summary-list meeting-members">'+names+'</ul></section>';
}
function meetingWheelPeople(m) {
  // Older GAS versions expose anonymous choice IDs; map them to member display names.
  const ordered=state.members.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const tieOnly=state.roundsEnabled && m.round?.phase==='sudden';
  const source=tieOnly?m.candidates.filter(person=>m.round.tieUserIds.includes(person.realUserId))
    .map((person,i)=>({...person,userId:'choice_'+i})):m.spin?.candidates || m.candidates;
  return source.map(person=>{
    const match=/^choice_(\d+)$/.exec(String(person.userId));
    const fallback=match?ordered[Number(match[1])]?.name:'';
    const name=/^集合場所\s*\d+$/.test(person.name)?fallback || '参加者':person.name || fallback || '参加者';
    return {...person,name,title:''};
  });
}
function wireMeeting() {
  const m=state?.meeting;if(!m || !$('meeting-wheel')) return;
  // Only names are drawn, never the location text.
  const people=meetingWheelPeople(m);
  stoppedWheel=wheel($('meeting-wheel'),$('meeting-pointer'),people,m.round?.phase==='sudden'?null:m.spin,clock,()=>{
    spinFinished(m.spin);
    void refreshState(true);
  });
}
async function meetingAction(action,restart=false) {
  const m=state.meeting;if(!m || pending || recordingPending || activeSpin(m)) return;
  if(action==='meeting.spin' && restart && !confirm('勝負全体を最初からやり直します。集合場所と到着確認もリセットされます。よろしいですか？')) return;
  const selected=eventId;pending=true;
  if(action==='meeting.spin') meetingDrawPending=true;
  await initAudio();render();
  try {
    const next=await api(action,{eventId:selected,previousMeetingId:m.spin?.id || '',meetingId:m.spin?.id || '',restart:!!restart,accessTokens:eventAccess()},{retry:true});
    if(selected===eventId && user) {++ticket;clock=next.clock ?? clock;state=next;if(slotId && !state.slots.find(s=>s.id===slotId)?.open)slotId='';}
  } finally {meetingDrawPending=false;pending=false;if(user)render();}
}
function renderOverview() {
  if(!state.overview?.available) return '<section class="panel empty"><h1>振り返り</h1><p>最後の時間枠のルーレットが終わると、今日の予定と全員の案を一覧で見られます。</p>'+(!state.overview?'<p>この機能を使うにはGASの更新が必要です。</p>':'')+'</section>';
  const entry=overviewCache,key=eventId+':'+state.stamp;
  if(entry?.key!==key || !entry.data) return '<section class="panel"><h1>振り返り</h1><p role="status">'+e(entry?.key===key && entry.error?entry.error:'みんなの1日の予定を読み込んでいます…')+'</p>'+(entry?.error?'<button class="secondary" data-action="overview-retry">再読み込み</button>':'')+'</section>';
  const data=entry.data;
  function cell(proposal,slotId,selected=false) {
    if(!proposal) return '<p class="muted">'+(selected?'未抽選・抽選中・対象外':'未登録')+'</p>';
    return '<strong>'+e(proposal.title)+'</strong>'+(selected?'<p class="muted">'+e(proposal.name)+'</p>':'')+'<div class="rich-view overview-excerpt">'+richView(proposal.rich)+'</div><details><summary>詳細を見る</summary>'+proposalContent(proposal,slotId,false)+'</details>';
  }
  return '<div class="section-head"><h1>振り返り</h1><span class="chip">全員の案を解放しました</span></div><section class="panel overview-scroll" tabindex="0" aria-label="1日の予定の比較表"><table class="overview-table"><thead><tr><th scope="col">時間</th><th scope="col" class="adopted">採用された1日</th>'+data.members.map(member=>'<th scope="col">'+e(member.name)+'の考えた1日</th>').join('')+'</tr></thead><tbody>'+data.slots.map(slot=>'<tr><th scope="row">'+e(hour(slot.start)+'〜'+hour(slot.end))+'<br>'+e(slot.title || '')+'</th><td class="adopted">'+cell(slot.selected,slot.id,true)+'</td>'+data.plans.map(member=>'<td>'+cell(member.proposals.find(p=>p.slotId===slot.id)?.proposal,slot.id)+'</td>').join('')+'</tr>').join('')+'</tbody></table></section>'+(state.missions?.enabled?missionRecapHtml(eventId,state.overview.finalDrawId):'');
}
async function loadOverview() {
  if(!state?.overview?.available) {overviewCache=null;return;}
  const key=eventId+':'+state.stamp;
  if(overviewCache?.key===key) return;
  const entry={key,viewer:user.id,eventId};overviewCache=entry;
  try {
    const data=await api('day.overview',{eventId});
    if(overviewCache===entry && user?.id===entry.viewer && eventId===entry.eventId) entry.data=data;
  } catch(error) {entry.error=error.message;if(error.code==='AUTH_REQUIRED')handle(error);}
  finally {if(overviewCache===entry && view==='overview' && user)render();}
}
function namesConfig() {
  let config=nameSettings.get(eventId);
  if(!config) {config={equal:true,people:new Map(),spin:null};nameSettings.set(eventId,config);}
  const ids=new Set(state.members.map(member=>member.id));
  for(const id of config.people.keys()) if(!ids.has(id))config.people.delete(id);
  for(const member of state.members) if(!config.people.has(member.id))config.people.set(member.id,{selected:true,weight:'1'});
  // An old result stays labeled as the last result; current candidates are rebuilt from current members.
  return config;
}
function namesData(config) {
  try {const candidates=nameCandidates(state.members,config);return {candidates,total:candidates.reduce((n,p)=>n+p.weight,0)};}
  catch(error) {return {candidates:[],total:0,error:error.message};}
}
function renderNames() {
  const config=namesConfig(),busy=!!activeSpin(config),{candidates,total,error}=namesData(config);
  const winner=!busy && config.spin?.candidates.find(p=>p.userId===config.spin.winnerId);
  return '<div class="section-head"><h1>ルーレット</h1><button class="icon-btn" data-action="sound" type="button" aria-pressed="'+soundOn()+'" aria-label="名前ルーレット音">'+icon(soundOn()?'speaker':'mute')+'</button></div><p class="muted">このイベントの参加者から選びます。結果はこの端末だけに表示し、予定の抽選には影響しません。</p><div class="two-col"><section class="panel"><h2>参加者と当たりやすさ</h2><label class="name-equal"><input id="name-equal" type="checkbox" '+(config.equal?'checked':'')+' '+(busy?'disabled':'')+'> 等倍（選んだ全員を同じ確率にする）</label><p class="muted">倍率は比率です。例：1倍と2倍なら、2倍の人が2倍当たりやすくなります。0倍は当たりません。</p><div class="name-choices">'+state.members.map(member=>{
    const choice=config.people.get(member.id),candidate=candidates.find(p=>p.userId===member.id);
    return '<div class="name-choice"><label><input type="checkbox" data-name-select="'+e(member.id)+'" '+(choice.selected?'checked':'')+' '+(busy?'disabled':'')+'> '+e(member.name)+'</label><label class="name-weight"><input type="number" data-name-weight="'+e(member.id)+'" aria-label="'+e(member.name)+'の倍率" min="0" max="1000" step="0.001" value="'+e(config.equal?'1':choice.weight)+'" '+(busy || config.equal || !choice.selected?'disabled':'')+'> 倍</label><output data-name-odds="'+e(member.id)+'">'+(total && candidate?(candidate.weight/total*100).toFixed(1):'0.0')+'%</output></div>';
  }).join('')+'</div><p class="form-error" id="name-error" role="alert">'+e(error || '')+'</p></section><section class="panel draw-panel"><h2>誰になるかな？</h2><div class="wheel-wrap"><canvas id="name-wheel" width="520" height="520" aria-label="名前ルーレットの円盤"></canvas><svg id="name-pointer" class="pointer" viewBox="0 0 30 47" aria-hidden="true"><path d="M3 3h24L15 43Z" fill="#d84d40" stroke="#792c33" stroke-width="2"/></svg></div><div id="name-result" role="status">'+(busy?'<p>ルーレットが回っています…</p>':winner?'<div class="first-plan-note"><span>今回選ばれたのは</span><h2>'+e(winner.name)+'</h2></div>':'')+'</div><button class="primary" data-action="name-spin" id="name-spin" '+(busy || !total || error?'disabled':'')+'>'+(busy?'抽選中':'ルーレットを回す')+'</button></section></div>'+renderCustom();
}
function wireNames() {
  const config=namesConfig(),data=namesData(config),busy=!!activeSpin(config);
  if($('name-wheel'))stoppedWheel=wheel($('name-wheel'),$('name-pointer'),config.spin?.candidates || data.candidates,config.spin,0,()=>localSpinFinished(config,'name'));
  if($('name-equal'))$('name-equal').onchange=event=>{config.equal=event.target.checked;config.spin=null;render();};
  for(const node of main.querySelectorAll('[data-name-select]'))node.onchange=event=>{config.people.get(node.dataset.nameSelect).selected=event.target.checked;config.spin=null;render();};
  for(const node of main.querySelectorAll('[data-name-weight]'))node.oninput=()=>{
    if(busy) return;
    config.people.get(node.dataset.nameWeight).weight=node.value;config.spin=null;
    const current=namesData(config);
    for(const output of main.querySelectorAll('[data-name-odds]')) {const p=current.candidates.find(p=>p.userId===output.dataset.nameOdds);output.textContent=(current.total && p?(p.weight/current.total*100).toFixed(1):'0.0')+'%';}
    $('name-error').textContent=current.error || '';$('name-result').innerHTML='';$('name-spin').disabled=!current.total || !!current.error;
    stoppedWheel?.();stoppedWheel=wheel($('name-wheel'),$('name-pointer'),current.candidates,null,0,()=>{});
  };
}
async function runNameSpin() {
  const config=namesConfig();if(activeSpin(config)||activeSpin(customRoulette))return;
  await initAudio();config.spin=nameSpin(nameCandidates(state.members,config));render();
}


function customData(){
  try{
    const candidates=customCandidates(customRoulette);
    return {candidates,total:100,error:''};
  }catch(error){return {candidates:[],total:percentSum(customRoulette),error:error.message};}
}
function renderCustom(){
  const busy=!!activeSpin(customRoulette),config=customRoulette;
  const {candidates,total,error}=customData();
  const winner=!busy && config.spin?.candidates.find(p=>p.userId===config.spin.winnerId);
  return '<div class="section-head custom-heading"><div><h2>自由ルーレット</h2><p class="muted">好きな項目と確率で、何でも抽選。その場限り・保存なし。</p></div></div>'+
    '<div class="two-col custom-layout"><section class="panel"><div class="spread"><h3>項目と当選確率</h3>'+
    '<button class="secondary" type="button" data-action="custom-equal" '+(busy?'disabled':'')+'>均等にする</button></div>'+
    '<label class="custom-count-label">項目数 <input id="custom-count" type="number" min="2" max="30" step="1" inputmode="numeric" value="'+config.entries.length+'" '+(busy?'disabled':'')+' aria-label="項目数（2〜30）"></label>'+
    '<p class="muted">2〜30項目を設定できます。確率は合計100％にしてください。0％は抽選から外れます。</p>'+
    '<div class="custom-rows">'+config.entries.map((item,i)=>
      '<div class="custom-row"><span class="custom-index">'+(i+1)+'</span>'+
      '<label class="custom-name"><span class="visually-hidden">項目'+(i+1)+'の名前</span>'+
      '<input type="text" data-custom-name="'+i+'" value="'+e(item.label)+'" maxlength="60" placeholder="項目名" '+(busy?'disabled':'')+'></label>'+
      '<label class="custom-chance"><input type="number" data-custom-percent="'+i+'" min="0" max="100" step="0.01" inputmode="decimal" value="'+e(item.percent)+'" aria-label="'+(i+1)+'番目の項目の確率" '+(busy?'disabled':'')+'><span>％</span></label></div>').join('')+
    '</div><div class="custom-total">合計：<strong id="custom-total">'+Number(total).toFixed(2)+'％</strong></div>'+
    '<p class="form-error" id="custom-error" role="alert">'+e(error)+'</p></section>'+
    '<section class="panel draw-panel"><h3>何が当たるかな？</h3>'+
    '<div class="wheel-wrap"><canvas id="custom-wheel" width="520" height="520" aria-label="自由ルーレットの円盤"></canvas>'+
    '<svg id="custom-pointer" class="pointer" viewBox="0 0 30 47" aria-hidden="true">'+
    '<path d="M3 3h24L15 43Z" fill="#d84d40" stroke="#792c33" stroke-width="2"/></svg></div>'+
    '<div id="custom-result" role="status">'+(busy?'<p>ルーレットが回っています…</p>':
      winner?'<div class="first-plan-note"><span>今回選ばれたのは</span><h2>'+e(winner.name)+'</h2></div>':'')+'</div>'+
    '<button class="primary custom-spin-btn" type="button" data-action="custom-spin" id="custom-spin" '+(busy || error || !candidates.length?'disabled':'')+'>'+
    (busy?'抽選中…':'ルーレットを回す')+'</button></section></div>';
}
function updateCustomPreview(){
  const {candidates,total,error}=customData();
  const sum=$('custom-total'),err=$('custom-error'),button=$('custom-spin');
  if(sum)sum.textContent=Number(total).toFixed(2)+'％';
  if(err)err.textContent=error || '';
  if(button)button.disabled=!!error || !candidates.length;
  if($('custom-result'))$('custom-result').innerHTML='';
  stoppedCustomWheel?.();
  const canvas=$('custom-wheel'),pointer=$('custom-pointer');
  if(canvas && pointer)stoppedCustomWheel=wheel(canvas,pointer,candidates,null,0,()=>{});
}
function wireCustom(){
  const config=customRoulette,data=customData();
  const canvas=$('custom-wheel'),pointer=$('custom-pointer');
  if(canvas && pointer){
    stoppedCustomWheel=wheel(canvas,pointer,config.spin?.candidates || data.candidates,config.spin,0,
      ()=>localSpinFinished(config,'custom'));
  }
  const count=$('custom-count');
  if(count)count.onchange=()=>{
    const raw=count.value.trim();
    if(!/^(?:[2-9]|[12]\d|30)$/.test(raw)){notify('項目数は2〜30の整数で指定してください。',true);count.value=String(config.entries.length);return;}
    resizeCustom(config,Number(raw));render();
  };
  for(const input of main.querySelectorAll('[data-custom-name]'))input.oninput=()=>{
    if(activeSpin(config))return;
    const item=config.entries[Number(input.dataset.customName)];
    if(!item)return;
    item.label=input.value;config.spin=null;updateCustomPreview();
  };
  for(const input of main.querySelectorAll('[data-custom-percent]'))input.oninput=()=>{
    if(activeSpin(config))return;
    const item=config.entries[Number(input.dataset.customPercent)];
    if(!item)return;
    item.percent=input.value;config.spin=null;updateCustomPreview();
  };
}
async function runCustomSpin(){
  if(activeSpin(customRoulette)||activeSpin(namesConfig()))return;
  const candidates=customCandidates(customRoulette);
  await initAudio();
  customRoulette.spin=nameSpin(candidates);
  render();
}

function firstPlanMeetingLocked(slot) {
  return !!slot?.meetingFirst && (!!state?.meeting?.spin || meetingDrawPending);
}
function planEditable(slot) {
  return !!slot?.editable && !firstPlanMeetingLocked(slot);
}
function planLockReason(slot) {
  if(firstPlanMeetingLocked(slot)) return '集合場所の抽選開始後は、タイトルと説明が固定されます。場所の補足・URL・画像は編集できます。';
  return 'タイトルと説明の編集期限を過ぎました。登録済みの予定なら補足情報を編集できます。';
}
function closeLockedPlanEditor() {
  const form=$('edit-proposal');
  if(!form || !$('modal')?.open || !state) return;
  const slot=state.slots.find(item=>item.id===form.dataset.slotId);
  // Keep an existing supplemental editor open while the state is being polled;
  // close only the full editor that could otherwise overwrite locked core fields.
  if(slot && !planEditable(slot) && form.dataset.mode!=='supplemental') {
    closeModal();
    notify(planLockReason(slot),true);
  }
}
function renderPlans() {
  return '<div class="section-head"><h2>自分の予定</h2></div><div class="stack">'+state.slots.map(slot=>{
    const editable=planEditable(slot);
    const meetingLocked=firstPlanMeetingLocked(slot);
    const hasPlan=!!slot.mine;
    const detailsEditable=!editable && hasPlan && slot.supplementalEditable===true;
    const status=editable?(hasPlan?'登録済み':'未登録'):
      (hasPlan?(detailsEditable?'タイトル・説明固定':'編集締切'):'登録締切');
    const lockNote=meetingLocked
      ? '集合場所の抽選が始まったため、タイトル・説明と集合場所は固定です。場所の補足・URL・画像は編集できます。'
      : 'タイトルと説明は編集締切です。場所・URL・画像は引き続き編集できます。';
    const action=editable||detailsEditable?'plan':'preview-plan';
    const buttonText=editable?(hasPlan?'編集する':'登録する'):
      hasPlan?(detailsEditable?'補足情報を編集':'内容を見る'):'登録終了';
    return '<article class="panel slot-card"><div class="slot-time">'+e(hour(slot.start)+'〜'+hour(slot.end))+'</div>'+
      '<div><h3>'+e(slot.title || 'この時間の予定')+'</h3><span class="chip '+(!editable?'locked':'')+'">'+
      (!editable?icon('lock',13):'')+e(status)+'</span>'+
      (hasPlan?'<p><strong>'+e(slot.mine.title)+'</strong></p>':'')+
      (detailsEditable?'<p class="muted plan-locked-note">'+e(lockNote)+'</p>':'')+
      (slot.editAt && editable?'<p class="muted">本文の締切 '+e(time(slot.editAt))+'</p>':'')+'</div>'+
      '<button class="secondary" type="button" data-action="'+action+'" data-key="'+e(slot.id)+'" '+(!editable && !hasPlan?'disabled':'')+'>'+
      e(buttonText)+'</button></article>';
  }).join('')+'</div>';
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
    const key = JSON.stringify([eventId,slot.id,item.userId,visualOpenedAt(slot,item)]);
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
  const ready = slot.people.length>0 && revealed.length===slot.people.length && !roomRevealing.size && !savingReveals(slot);
  const round=state.roundsEnabled?slot.round:null;
  const sudden=round?.phase==='sudden';
  const finishedSudden=!!slot.spin && slot.spin.roundType==='sudden' && round?.finished;
  const candidates=(spinning || finishedSudden)?slot.spin.candidates:(sudden?revealed.filter(person=>round.tieUserIds.includes(person.userId)):revealed);
  const hint = spinning?'ルーレットが回っています…':savingReveals(slot)?'開示を保存しています…':!slot.people.length?'登録された予定がまだありません。':roomRevealing.size?'予定を開示しています…':!ready?'全員の予定を開示すると回せます。':'';
  const win = !spinning && (!round || round.finished) && slot.winner;
  const personRows = slot.people.map(item=>{
    const face = '<span class="avatar" aria-hidden="true">'+e(initials(item.name))+'</span>';
    const name=e(item.name)+(slot.meetingFirst && (round?round.finished && slot.adoptedUserId===item.userId:slot.spin?.winnerId===item.userId)?' <span class="chip">最初の予定</span>':'');
    if (!item.proposal) return '<div class="person"><button class="person-button" type="button" data-action="reveal" data-key="'+e(item.userId)+'">'+face+
      '<span class="person-summary-text"><strong>'+name+'</strong><br><small>タップして予定を開示</small></span>'+icon('lock',17)+'</button></div>';
    return '<details class="person" data-open-person="'+e(item.userId)+'" '+(expanded.has(item.userId)?'open':'')+'><summary>'+face+
      '<span class="person-summary-text"><strong>'+name+'</strong><br><small '+revealAttrs('person-title',item.userId)+'>'+e(item.proposal.title)+'</small></span></summary>'+
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
    (slot.meetingFirst?'':roundSettingsHtml(slot))+roundScoreHtml(round)+
    '<div class="wheel-wrap"><canvas id="wheel" width="520" height="520" aria-label="ルーレット円盤"></canvas>'+
    '<svg id="pointer" class="pointer" viewBox="0 0 30 47" aria-hidden="true"><path d="M3 3h24L15 43Z" fill="#d84d40" stroke="#792c33" stroke-width="2"/><path d="M8 7h14L15 30Z" fill="#f67d63"/></svg></div>'+
    '<div class="draw-actions">'+(slot.meetingFirst?'':'<button class="primary" id="spin" type="button" data-action="spin" data-restart="'+(round?round.finished:!!slot.spin)+'" '+(!ready || spinning || pending?'disabled':'')+'>'+
    icon('bolt',17)+e(roundSpinButtonLabel(round,!!slot.spin))+'</button>'+
    (round && (round.phase==='continue'||round.phase==='sudden')?
      '<button class="quiet" type="button" data-action="round-restart" '+(spinning||pending?'disabled':'')+'>勝数をリセットして最初から</button>':'')+
    (hint?'<p class="muted">'+e(hint)+'</p>':'')+
    (slot.spin?'<button class="quiet" type="button" data-action="history" '+(spinning || roomRevealing.size?'disabled':'')+'>抽選履歴</button>':''))+'</div>'+
    (candidates.length?'<ul class="candidates" aria-label="抽選候補">'+candidates.map((item,i)=>
      '<li><span class="color-dot" style="--swatch:'+colorAt(i)+'"></span><span><strong>'+e(item.name)+'</strong> · <span '+revealAttrs('candidate-title',item.userId)+'>'+e(item.title)+'</span></span></li>').join('')+'</ul>':'')+
    '</section></div>';
}
function wireRoom(slot) {
  const candidates = candidatesFor(slot);
  const spinning = activeSpin(slot);
  const sudden=state.roundsEnabled && slot.round?.phase==='sudden';
  const finishedSudden=!!slot.spin && slot.spin.roundType==='sudden' && slot.round?.finished;
  const unchanged = !sudden && slot.spin && JSON.stringify(candidates)===JSON.stringify(slot.spin.candidates);
  // Canvas text cannot share the DOM blur animation. Keep its title hidden until the same reveal ends.
  const displayCandidates = (slot.meetingFirst?slot.spin.candidates.map(item=>({...item,title:slot.people.find(p=>p.userId===item.userId)?.proposal?.title || '未開示'})):(spinning||finishedSudden)?slot.spin.candidates:slot.people.filter(item=>!sudden || slot.round.tieUserIds.includes(item.userId)).map(item=>({userId:item.userId,name:item.name,title:item.proposal?.title || '未開示'}))).map(item=>
    roomRevealing.has(item.userId)?{...item,title:'開示中…'}:item);
  stoppedWheel = wheel($('wheel'),$('pointer'),displayCandidates,
    sudden?null:(spinning || finishedSudden || unchanged || slot.meetingFirst ? slot.spin : null),clock,()=>spinFinished(slot.spin));
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
function recordingControls(kind='room') {
  const active=!!recordingSession;
  const available=kind!=='meeting' || state?.meeting?.ready || state?.meeting?.spin;
  return '<div class="recording-bar"><button class="'+(active?'secondary':'primary')+'" type="button" data-action="'+(active?'stop-recording':kind==='meeting'?'start-meeting-recording':'start-recording')+'" '+(!recordingSupported() || !available || recordingPending?'disabled':'')+'>'+ 
    (recordingPending?'準備中…':active?'記録を終了して保存':'記録開始')+'</button></div>';
}
function recordFrame(context) {
  if(!user || eventId!==context.eventId || view!=='day') return null;
  if(context.kind==='meeting') {
    if(slotId || !state?.meeting) return null;
    const m=state.meeting,spinning=!!activeSpin(m);
    // Show participant names on the wheel; disclose only the winning meeting place after it stops.
    const candidates=meetingWheelPeople(m);
    const revealedPlace=!spinning && (!state.roundsEnabled || m.round?.finished) && m.place ? m.place : '';
    const winningId=m.round?.winnerId || m.spin?.winnerId || '';
    const matching=candidates.find(p=>p.userId===winningId || p.realUserId===winningId) ||
      m.members.find(p=>p.userId===winningId || p.id===winningId) ||
      m.round?.wins?.find(p=>p.userId===winningId);
    const people=candidates.map(person=>({userId:person.userId,name:person.name,
      proposal:revealedPlace && (person.userId===winningId || person.realUserId===winningId)?
        {title:revealedPlace,rich:'',locations:[],links:[]}:null}));
    const spin=m.spin?Object.fromEntries(['id','startAt','duration','turns','angle','winnerId','number'].map(key=>[key,m.spin[key]])):null;
    if(spin) spin.candidates=candidates;
    const finalWinner=spin && revealedPlace?{
      userId:winningId,name:matching?.name || '参加者',
      proposal:{title:revealedPlace,rich:'',locations:[],links:[]}
    }:null;
    return {kind:'meeting-place',eventTitle:state.event.title,slotTitle:'集合場所ルーレット',people,spin,spinning,
      serverNow:now(),winner:finalWinner,
      revealProgress:Object.fromEntries(people.map(person=>[person.userId,1]))};
  }
  if(slotId!==context.slotId) return null;
  const slot=state?.slots.find(item=>item.id===context.slotId);
  if(!slot?.open) return null;
  const spinning=!!activeSpin(slot);
  const finished=!!(slot.round?slot.round.finished:slot.spin) && !activeSpin(slot);
  const selected=finished && slot.people.find(person=>person.userId===(slot.adoptedUserId || slot.spin?.winnerId) && person.proposal);
  return {
    eventTitle:state.event.title,slotTitle:slot.title || hour(slot.start)+'〜'+hour(slot.end),
    people:slot.people.map(person=>({...person,openedAt:visualOpenedAt(slot,person)})),focusId:recordingFocusId,spin:slot.spin,spinning,
    serverNow:now(),
    winner:finished && selected?selected:null,
    revealProgress:Object.fromEntries(slot.people.map(person=>{
      const key=JSON.stringify([eventId,slot.id,person.userId,visualOpenedAt(slot,person)]);
      const began=revealStarts.get(key);
      return [person.userId,began===undefined?0:Math.min(1,(performance.now()-began)/REVEAL_MS)];
    })),
  };
}
async function startRoomRecording(slot) {
  if(!slot?.open) return;
  return startAppRecording({eventId,slotId:slot.id});
}
async function startMeetingRecording() {
  if(!state?.meeting || (!state.meeting.ready && !state.meeting.spin)) return;
  return startAppRecording({eventId,kind:'meeting'});
}
async function startAppRecording(context) {
  if(recordingSession || recordingPending || !recordFrame(context)) return;
  const generation=++recordingGeneration;
  recordingPending=true;render();
  let made=false,stopReason='';
  try {
    const controller=await startRecording({
      read:()=>recordFrame(context),
      onReady:({blob,extension,reason})=>{
        if(generation!==recordingGeneration || !user) return;
        if(savedVideo) URL.revokeObjectURL(savedVideo.url);
        savedVideo={blob,url:URL.createObjectURL(blob),filename:(context.kind==='meeting'?'meeting-roulette-':'roulette-')+new Date().toISOString().replace(/[:.]/g,'-')+'.'+extension};
        made=true;stopReason=reason;
      },
      onError:error=>{if(generation===recordingGeneration && user) handle(error);},
      onStop:()=>{
        if(generation!==recordingGeneration) return;
        recordingSession=null;recordingPending=false;
        if(user) {render();if(made) {dismissWinner();showSavedVideo();if(stopReason) notify(stopReason);}}
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
  const selectedEvent=eventId,viewer=user.id;
  const cached=preparedRoom(slot)?.proposals.find(proposal=>proposal.userId===item);
  const key=localRevealKey(slot,item),prior=slot.people.find(person=>person.userId===item);
  if(localReveals.get(key)?.pending) return;
  const local=cached && prior?{openedAt:now(),proposal:cached,pending:true,prior:{...prior}}:null;
  if(local) {localReveals.set(key,local);prior.proposal=cached;prior.openedAt=local.openedAt;
    if(slot.round?slot.round.finished && slot.adoptedUserId===item:slot.spin?.winnerId===item) slot.winner={name:prior.name,...cached};render();}
  ++ticket;
  try {
  const result=await api('reveal.open',{eventId:selectedEvent,slotId:slot.id,userId:item,
    ...(cached?{knownRevision:cached.revision}:{}),...slotAccess(slot.id,selectedEvent)},{retry:true});
  if(eventId!==selectedEvent || user?.id!==viewer || !state) return;
  ++ticket;
  const current=state.slots.find(row=>row.id===slot.id);
  const person=current?.people.find(row=>row.userId===item);
  const proposal=result.proposal || (result.proposalRevision===cached?.revision?cached:null);
  if(local) local.pending=false;
  if(person && proposal && Number.isFinite(result.openedAt)) {
    person.proposal=proposal;person.openedAt=result.openedAt;
    if(current.round?current.round.finished && current.adoptedUserId===item:current.spin?.winnerId===item) current.winner={name:person.name,...proposal};
    if(result.contentVersion) current.contentVersion=result.contentVersion;
    state.stamp='';render();
  } else await refreshState(true); // Compatibility with GAS v3 until it is updated.
  } catch(error) {
    if(local) {local.pending=false;const person=state?.slots.find(s=>s.id===slot.id)?.people.find(p=>p.userId===item);
      if(person?.openedAt===local.openedAt) {Object.assign(person,local.prior);const current=state.slots.find(s=>s.id===slot.id);if(current.round?current.round.finished && current.adoptedUserId===item:current.spin?.winnerId===item)current.winner=person.proposal?{name:person.name,...person.proposal}:null;}}
    if(eventId===selectedEvent && user?.id===viewer) {render();await refreshState(true);}
    throw error;
  }
}
async function runSpin(slot,forceRestart=false) {
  if(slot.meetingFirst || pending || activeSpin(slot) || roomRevealing.size || savingReveals(slot)) return;
  const restart=forceRestart || (slot.round?slot.round.finished:!!slot.spin);
  if(restart && !confirm('この勝負全体を最初からやり直します。途中の勝数もリセットします。よろしいですか？'))return;
  initAudio();
  pending=true;
  if($('spin'))$('spin').disabled=true;
  const context=eventId;
  const prepared=!slot.spin && preparedRoom(slot)?.initialDraw;
  try {
    const result=await api('draw.spin',{eventId:context,slotId:slot.id,previousSpinId:slot.spin?.id || '',
      candidateSignature:JSON.stringify(candidatesFor(slot)),restart,
      ...(prepared?{preparedVersion:slot.contentVersion}:{}),
      ...slotAccess(slot.id,context)},{retry:true});
    if(eventId===context && state){
      ++ticket;
      clock=result.clock??clock;
      const current=state.slots.find(item=>item.id===slot.id);
      if(current && (!current.spin || result.number>=current.spin.number)){
        const {people,contentVersion,round,...spin}=result;
        current.spin=spin;
        if(people)current.people=people;
        if(contentVersion)current.contentVersion=contentVersion;
        if(round)current.round=round;
        current.adoptedUserId=round?.finished?round.winnerId:'';
        const adoptedId=current.adoptedUserId || (!round?result.winnerId:'');
        const winner=current.people.find(person=>person.userId===adoptedId && person.proposal);
        current.winner=winner?{name:winner.name,...winner.proposal}:null;
        clearRoomPreparation();
        state.stamp='';
        render();
      }
    }
  }catch(error){clearRoomPreparation();await refreshState(true);throw error;}
  finally{pending=false;if(eventId===context && state)render();}
}
async function historyModal(slot) {
  const result = await api('draw.history',{eventId,slotId:slot.id,...slotAccess(slot.id)});
  modal('抽選履歴','<div class="stack">'+result.map(item=>{
    const winner = item.candidates.find(person=>person.userId===item.winnerId);
    return '<details class="form-box"><summary><strong>第'+item.number+'回　'+e(item.snapshot.title)+'</strong>　'+e(winner?.name || '')+'</summary>'+
      '<p class="muted">'+e(time(item.createdAt)+' · '+item.actorName+' が抽選')+'</p><div class="rich-view">'+richView(item.snapshot.rich)+'</div></details>';
  }).join('')+'</div>');
}
async function saveRoundSetting(button,slotKey) {
  if(pending || !state?.roundsEnabled) return;
  const slot=state.slots.find(item=>item.id===slotKey);
  if(!slot?.round?.canConfigure) throw new Error('この時間枠の勝負回数は変更できません。');
  const input=button.closest('.round-settings')?.querySelector('input[data-round-input]');
  const raw=input?.value?.trim()||'';
  if(!/^(?:[1-9]|10)$/.test(raw))throw new Error('勝負回数は1〜10の整数で入力してください。');
  const count=Number(raw);
  if(slot.round.canLegacyExtend && count>1 &&
     !confirm('今の採用結果を第1回として引き継いで勝負を延長します。この回数変更は一度だけ可能です。よろしいですか？'))return;
  const selected=eventId;
  pending=true;button.disabled=true;
  try{
    const next=await api('rounds.configure',{eventId:selected,slotId:slot.id,count,
      previousSpinId:slot.round?.lastSpinId || (slot.meetingFirst?state.meeting?.spin?.id:slot.spin?.id) || ''},{retry:true});
    if(selected===eventId&&user){++ticket;clock=next.clock??clock;state=next;
      if(slotId && !state.slots.find(item=>item.id===slotId)?.open)slotId='';
      render();notify('勝負回数を保存しました。');}
  }finally{pending=false;if(selected===eventId&&user)render();}
}

async function doAction(button) {
  const action = button.dataset.action;
  const key = button.dataset.key;
  const slot = state?.slots.find(item=>item.id===(['slot','plan','preview-plan','unlock-slot'].includes(action)?key:slotId));
  const expense = state?.expenses.find(item=>item.id===key);
  if(['nav','back','slot','unlock-slot','logout'].includes(action)) {hideMission(true);await finishRecording();}
  switch (action) {
    case 'nav':
      dismissWinner();
      if (key==='admin' && user.role!=='admin') return;
      if(key==='overview' && !state?.overview?.available)return;
      view = key;
      slotId = '';
      render();
      if (view==='admin') await refreshAdmin();
      else await refreshState();
      return;
    case 'retry': return refreshEverything();
    case 'overview-retry': overviewCache=null;render();return;
    case 'mission-open': return missionOpen(eventId,user.id);
    case 'mission-claim': return missionClaim(eventId,user.id);
    case 'mission-toggle': return missionToggle(eventId,user.id,key,button.dataset.completed==='true');
    case 'mission-hide': hideMission();return;
    case 'mission-recap-retry': missionRecapReset();render();return;
    case 'winner-close': dismissWinner();return;
    case 'name-spin': return runNameSpin();
    case 'custom-spin': return runCustomSpin();
    case 'custom-equal': balanceCustom(customRoulette);render();return;
    case 'back': dismissWinner();slotId = ''; render(); return;
    case 'slot': if (slot?.open) { dismissWinner();slotId = slot.id; initAudio(); render(); } return;
    case 'unlock-slot': if(slot && !slot.open) unlockSlot(slot); return;
    case 'start-recording': return startRoomRecording(slot);
    case 'start-meeting-recording': return startMeetingRecording();
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
    case 'round-save': return saveRoundSetting(button,key);
    case 'meeting-spin': return meetingAction('meeting.spin',button.dataset.restart==='true');
    case 'meeting-restart': return meetingAction('meeting.spin',true);
    case 'round-restart': return runSpin(slot,true);
    case 'meeting-arrive': return meetingAction('meeting.arrive');
    case 'history': return historyModal(slot);
    case 'plan': {
      if(!slot || (!planEditable(slot) && (!slot.mine || slot.supplementalEditable!==true))) {
        notify(slot?planLockReason(slot):'時間枠を確認してください。',true);
        render();
        return;
      }
      const updatedSlot={...slot,meetingLocationLocked:
        slot.meetingLocationLocked ?? (!!slot.meetingFirst && !!state?.meeting?.spin)};
      return editProposal(eventId,updatedSlot,user,()=>refreshState(true),
        ()=>planEditable(state?.slots.find(item=>item.id===slot.id)));
    }
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
  dismissWinner();
  hideMission(true);
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
