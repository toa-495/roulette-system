import {api,uid,passwordProof} from './api.js';
import {$,e,icon,required,optional,modal,closeModal,bindForm,notify,copyText,richView,mediaSrc,localDate,timestamp,hour,date,yen,safeUrl} from './ui.js';

const field = (label, content, flag='') => '<label class="fields"><span>'+label+flag+'</span>'+content+'</label>';
const input = (name, value='', attrs='') => '<input name="'+name+'" value="'+e(value)+'" '+attrs+'>';
const textArea = (name, value='', attrs='') => '<textarea name="'+name+'" '+attrs+'>'+e(value)+'</textarea>';
const submit = (label='保存する') => '<div class="form-error" role="alert"></div><button class="primary" type="submit">'+label+'</button>';
const lines = (value) => String(value).split(/\r?\n/).map(line=>line.trim()).filter(Boolean);
function button(label, action, commandValue='') {
  const [name, text] = label.split('|');
  return '<button type="button" data-format="'+action+'" data-format-value="'+e(commandValue)+'" title="'+e(name)+'" aria-label="'+e(name)+'">'+(text || name)+'</button>';
}
function toolbar() {
  return '<div class="toolbar" aria-label="説明の書式">'+[
    button('太字|<b>B</b>','bold'),button('斜体|<i>I</i>','italic'),button('下線|<u>U</u>','underline'),button('取り消し線|<s>S</s>','strikeThrough'),
    '<select data-format="fontSize" aria-label="文字サイズ"><option value="">サイズ</option><option value="2">小</option><option value="3">標準</option><option value="5">大</option><option value="6">特大</option></select>',
    '<select data-format="fontName" aria-label="フォント"><option value="">フォント</option><option value="sans-serif">ゴシック</option><option value="serif">明朝</option><option value="monospace">等幅</option></select>',
    '<label class="color-tool">文字色 <input type="color" data-format="foreColor" value="#274a61"></label>',
    '<label class="color-tool">背景色 <input type="color" data-format="hiliteColor" value="#f4ca67"></label>',
    button('左寄せ|左','justifyLeft'),button('中央寄せ|中央','justifyCenter'),button('右寄せ|右','justifyRight'),
    button('箇条書き|・リスト','insertUnorderedList'),button('番号付きリスト|1. リスト','insertOrderedList'),
    button('インデント追加|字下げ','indent'),button('インデント解除|字上げ','outdent'),
    button('引用','formatBlock','blockquote'),button('リンク','createLink'),button('リンク解除','unlink'),button('書式クリア','removeFormat')
  ].join('')+'</div>';
}

function bindEditor() {
  const editor = $('editor');
  let savedRange;
  function remember() {
    const selection = window.getSelection();
    if (selection?.rangeCount && editor.contains(selection.anchorNode) && editor.contains(selection.focusNode)) {
      savedRange = selection.getRangeAt(0).cloneRange();
    }
  }
  for (const action of ['pointerup','keyup','input','blur']) editor.addEventListener(action,remember);
  const commands = editor.parentElement.querySelector('.toolbar');
  commands.addEventListener('pointerdown', event => {
    remember();
    if (event.target.closest('button')) event.preventDefault();
  });
  function apply(target) {
    let value = target.dataset.formatValue || target.value;
    const command = target.dataset.format;
    if (command === 'createLink') {
      value = prompt('リンク先のURL（https:// または http://）');
      if (!value) return;
      if (!safeUrl(value)) { notify('リンク先のURLを確認してください。',true); return; }
    }
    editor.focus();
    if (savedRange && editor.contains(savedRange.startContainer)) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(savedRange);
    }
    if (command === 'createLink' && window.getSelection()?.isCollapsed) {
      const link = '<a href="'+e(value)+'">'+e(value)+'</a>';
      document.execCommand('insertHTML',false,link);
    } else {
      document.execCommand(command,false,value || null);
    }
    remember();
    if (target.tagName === 'SELECT') target.selectedIndex = 0;
  }
  commands.addEventListener('click', event => {
    const target = event.target.closest('button[data-format]');
    if (target) apply(target);
  });
  commands.addEventListener('change',event=>apply(event.target));
  editor.addEventListener('paste',event => {
    event.preventDefault();
    document.execCommand('insertText',false,event.clipboardData.getData('text/plain'));
  });
  editor.addEventListener('drop',event=>event.preventDefault());
  $('preview-rich').onclick = () => {
    const preview = $('rich-preview');
    preview.hidden = !preview.hidden;
    preview.innerHTML = richView(editor.innerHTML);
  };
}
function photoField(label) {
  return '<div class="form-box photo-control"><label class="fields"><span>'+label+optional+'</span><input aria-label="'+label+'" id="choose-photo" type="file" accept="image/*"></label><img id="photo-preview" class="photo-preview" alt="画像プレビュー" hidden><span id="photo-state" role="status" class="muted"></span><button type="button" id="remove-photo" class="secondary" hidden>写真を外す</button></div>';
}
async function jpeg(file) {
  if (file.size > 30*1024*1024) throw new Error('30 MB以下の写真を選んでください。');
  const image = new Image();
  const url = URL.createObjectURL(file);
  try {
    await new Promise((resolve,reject)=>{
      image.onload = resolve;
      image.onerror = ()=>reject(new Error('この端末で画像を読み込めません。JPEG・PNGでお試しください。'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    for (const [side,quality] of [[1600,.78],[1400,.69],[1100,.62],[800,.59]]) {
      const ratio = Math.min(1,side/Math.max(image.naturalWidth,image.naturalHeight));
      canvas.width = Math.max(1,Math.round(image.naturalWidth*ratio));
      canvas.height = Math.max(1,Math.round(image.naturalHeight*ratio));
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0,0,canvas.width,canvas.height);
      ctx.drawImage(image,0,0,canvas.width,canvas.height);
      const src = canvas.toDataURL('image/jpeg',quality);
      if (src.startsWith('data:image/jpeg;base64,') && src.length <= 1200022) return src;
    }
    throw new Error('写真を圧縮できませんでした。小さな画像でお試しください。');
  } finally { URL.revokeObjectURL(url); }
}
function bindPhoto(existing, request) {
  const picker = $('choose-photo'), preview = $('photo-preview'), remove = $('remove-photo'), state = $('photo-state');
  let photo, pending, version = 0;
  const display = (src) => {
    preview.hidden = !src;
    remove.hidden = !src && !existing;
    if (src) preview.src = src;
    else preview.removeAttribute('src');
  };
  if (existing) {
    state.textContent = '登録済みの写真を読み込み中…';
    remove.hidden = false;
    mediaSrc(request).then(src => {
      if (version === 0) { state.textContent = ''; display(src); }
    }).catch(()=>{ if (version === 0) state.textContent = '登録済みの写真の読み込みに失敗しました。'; });
  }
  picker.onchange = () => {
    if (!picker.files.length) return;
    const id = ++version;
    state.textContent = '写真を圧縮しています…';
    pending = jpeg(picker.files[0]).then(src => {
      if (id !== version) return;
      photo = src.split(',')[1];
      display(src);
      state.textContent = '保存を押すと写真が登録されます。';
    }).catch(error => {
      if (id === version) state.textContent = error.message;
    });
  };
  remove.onclick = () => {
    version++;
    photo = null;
    picker.value = '';
    state.textContent = '保存を押すと写真が外れます。';
    display('');
    remove.hidden = true;
  };
  return async () => { await pending; return photo; };
}

export function editProposal(eventId,slot,user,done) {
  const data = slot.mine;
  const first=slot.meetingFirst;
  const meetingHint='集合場所に使います。\n最寄駅集合の場合は、〇駅\nのようにご記入ください。最寄り駅でなくても大丈夫です。\n駅から遠い場合は、目的地が分からないように場所を示してください。';
  modal(data ? '自分の予定を編集' : '自分の予定を登録',
    '<p class="muted">'+e(hour(slot.start)+'〜'+hour(slot.end))+'</p><form id="edit-proposal">'+
    field('タイトル',input('title',data?.title,'required maxlength="100"'),required)+
    '<div class="fields"><span id="editor-label" class="label">説明'+required+'</span><div class="editor-frame">'+toolbar()+
    '<div id="editor" class="editor" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="editor-label" aria-required="true">'+richView(data?.rich)+'</div></div>'+
    '<div><button id="preview-rich" class="secondary" type="button">書式をプレビュー</button></div><div id="rich-preview" class="rich-view panel" hidden></div></div>'+
    (first?'<div class="fields"><span class="label">集合場所'+required+' <span class="info-help"><button type="button" class="info-mark" aria-label="集合場所の書き方" aria-describedby="meeting-help">ⓘ</button><span class="info-tooltip" id="meeting-help" role="tooltip">'+e(meetingHint)+'</span></span></span>'+input('locations',data?.locations?.[0] || '', 'required maxlength="180" aria-label="集合場所" aria-describedby="meeting-help" placeholder="例：〇駅の改札前"')+'</div>':
      field('場所候補（1行につき1件）',textArea('locations',data?.locations.join('\n'),'rows="2"'),optional))+
    field('参考URL（1行につき1件）',textArea('links',data?.links.join('\n'),'rows="2"'),optional)+photoField('参考画像')+submit()+'</form>');
  bindEditor();
  const getPhoto = bindPhoto(data?.image,{eventId,slotId:slot.id,userId:user.id,kind:'proposal',key:data?.image});
  const request = uid();
  bindForm('edit-proposal', async form => {
    const f = new FormData(form);
    if (!($('editor').textContent || '').replace(/[\s\u200b-\u200d\ufeff]/gu,'')) throw new Error('説明を入力してください。');
    if(first && !String(f.get('locations') || '').trim()) throw new Error('集合場所を入力してください。');
    await api('proposal.save',{eventId,slotId:slot.id,revision:data?.revision || 0,title:f.get('title'),rich:$('editor').innerHTML,
      locations:lines(f.get('locations')),links:lines(f.get('links')),photo:await getPhoto()},{requestId:request,retry:true});
    closeModal();
    notify('予定を保存しました。');
    await done();
  });
}

export function editExpense(state, current, user, done) {
  const {event,members,slots,summary} = state;
  const oldIds = current ? [current.payerId,...Object.keys(current.shares)] : [];
  const people = [...members,...summary.balances.filter(item=>oldIds.includes(item.id)&&!members.some(member=>member.id===item.id))];
  const options = (rows,id) => rows.map(item=>'<option value="'+e(item.id)+'" '+(item.id===id?'selected':'')+'>'+e(item.name)+'</option>').join('');
  modal(current ? '支出を編集' : '支出を追加',
    '<p class="muted">登録者と管理者が編集・削除できます。</p><form id="edit-expense">'+
    field('支出名',input('title',current?.title,'required maxlength="100"'),required)+
    '<div class="field-pair">'+field('支払日時（日本時間）',input('paidAt',localDate(current?.paidAt || Date.now()),'type="datetime-local" required'),required)+
    field('立替えた人','<select name="payerId">'+options(people,current?.payerId || user.id)+'</select>',required)+'</div>'+
    field('時間枠','<select name="slotId"><option value="">指定なし</option>'+options(slots.map(slot=>({id:slot.id,name:hour(slot.start)+' '+(slot.title || '')})),current?.slotId)+'</select>',optional)+
    '<fieldset class="form-box"><legend>負担の分け方</legend><div class="seg"><label class="check"><input type="radio" name="mode" value="equal" '+(current?.mode!=='custom'?'checked':'')+'>割り勘登録</label><label class="check"><input type="radio" name="mode" value="custom" '+(current?.mode==='custom'?'checked':'')+'>各自登録</label></div>'+
    '<div id="equal-fields" class="fields">'+field('合計金額（円）',input('total',current?.total,'type="number" inputmode="numeric" min="1" max="100000000" step="1"'),required)+
    '<span class="label">負担する人'+required+'</span><div class="check-grid">'+people.map(person=>'<label class="check"><input type="checkbox" name="share" value="'+e(person.id)+'" '+(!current || Object.hasOwn(current.shares,person.id)?'checked':'')+'>'+e(person.name)+'</label>').join('')+'</div></div>'+
    '<div id="custom-fields" class="fields">'+people.map(person=>field(e(person.name)+'の負担（円）',input('share-'+person.id,current?.shares[person.id] ?? '','type="number" inputmode="numeric" min="0" max="100000000" step="1" placeholder="0"'))).join('')+'<span id="custom-total" class="label"></span></div></fieldset>'+
    field('備考',textArea('notes',current?.notes,'maxlength="2500" rows="2"'),optional)+photoField('レシート写真')+
    submit()+'</form>');
  const form = $('edit-expense');
  function refreshMode() {
    const equal = form.elements.mode.value === 'equal';
    $('equal-fields').hidden = !equal;
    $('custom-fields').hidden = equal;
    $('equal-fields').querySelectorAll('input').forEach(el=>{el.disabled = !equal;});
    $('custom-fields').querySelectorAll('input').forEach(el=>{el.disabled = equal;});
    form.elements.total.required = equal;
    $('custom-total').textContent = '合計 '+yen(people.reduce((sum,person)=>sum+Number(form.elements['share-'+person.id].value),0));
  }
  form.addEventListener('input',refreshMode);
  refreshMode();
  const getPhoto = bindPhoto(current?.image,{eventId:event.id,kind:'expense',id:current?.id,key:current?.image});
  const request = uid();
  bindForm('edit-expense',async form=>{
    const f = new FormData(form);
    const mode = f.get('mode');
    await api('expense.save',{
      id:current?.id,eventId:event.id,revision:current?.revision || 0,title:f.get('title'),paidAt:timestamp(f.get('paidAt')),payerId:f.get('payerId'),
      slotId:f.get('slotId'),mode,total:Number(f.get('total')),shareIds:f.getAll('share'),
      shares:mode==='custom'?Object.fromEntries(people.map(person=>[person.id,Number(f.get('share-'+person.id))])):undefined,
      notes:f.get('notes'),photo:await getPhoto()
    },{requestId:request,retry:true});
    closeModal();
    notify('支出を保存しました。');
    await done();
  });
}

export function userForm(item,current,done) {
  modal(item ? 'ユーザーを編集' : 'ユーザーを発行',
    '<form id="edit-user">'+field('ユーザー名',input('username',item?.username,'required pattern="[A-Za-z0-9][A-Za-z0-9_.\\-]{2,31}" autocomplete="off" '+(item?'readonly':'')),required)+
    field('表示名',input('name',item?.name,'required maxlength="40"'),required)+
    field('権限','<select name="role"><option value="member">参加者</option><option value="admin" '+(item?.role==='admin'?'selected':'')+'>管理者</option></select>')+
    (item && item.id!==current.id?'<label class="check"><input name="reset" type="checkbox">初回設定コードを再発行し、既存のパスワードとログインを無効化する</label>':'')+
    submit(item?'保存する':'発行する')+'</form>');
  const request = uid();
  bindForm('edit-user',async form=>{
    const f = new FormData(form);
    const response = await api('admin.user',{id:item?.id,revision:item?.revision || 0,username:f.get('username'),name:f.get('name'),
      role:f.get('role'),reset:f.has('reset')},{requestId:request,retry:true});
    if (response.code) {
      modal('初回設定コード','<div class="stack"><p>ユーザー名は <strong>'+e(response.user.username)+'</strong> です。本人に設定コードを渡してください。有効期限は48時間です。</p>'+
        '<code class="code">'+e(response.code)+'</code><button class="secondary" id="copy-invite" type="button">ユーザー名とコードをコピー</button></div>');
      $('copy-invite').onclick = ()=>copyText('ユーザー名 '+response.user.username+'\n初回設定コード '+response.code);
    } else { closeModal(); notify('ユーザー情報を保存しました。'); }
    await done();
  });
}

export function eventForm(item,users,current,done) {
  const today = localDate(Date.now()).slice(0,10);
  const start = item ? localDate(item.start) : today+'T10:00';
  const end = item ? localDate(item.end) : today+'T18:00';
  modal(item?'イベントを編集':'イベントを作成',
    '<form id="edit-event">'+field('イベント名',input('title',item?.title,'required maxlength="80"'),required)+
    '<div class="field-pair">'+field('開催開始（日本時間）',input('start',start,'type="datetime-local" required'),required)+
    field('開催終了（日本時間）',input('end',end,'type="datetime-local" required'),required)+'</div>'+
    '<fieldset class="form-box"><legend>参加者'+required+'</legend><div class="check-grid">'+users.map(user=>
    '<label class="check"><input name="member" type="checkbox" value="'+e(user.id)+'" '+((item?.memberIds || [current.id]).includes(user.id)?'checked':'')+'>'+e(user.name)+'</label>').join('')+'</div></fieldset>'+
    '<label class="check"><input name="anytime" type="checkbox" '+(!item || item.editHours===null?'checked':'')+'>時間枠の予定をいつでも編集できる</label>'+
    field('編集締切（各時間枠の開始の何時間前）',input('editHours',item?.editHours ?? 1,'type="number" min="0" max="720" step="any" required'))+
    field('開示・抽選解禁（各時間枠の開始の何時間前）',input('unlockHours',item?.unlockHours ?? 0,'type="number" min="0" max="720" step="any" required'))+
    '<fieldset class="form-box"><legend>時間枠'+required+'</legend><div class="spread"><button type="button" class="secondary" id="auto-slots">約2時間ずつで作成</button><button type="button" class="secondary" id="add-slot">時間枠を追加</button></div>'+
    '<div id="slots-editor"></div></fieldset>'+submit(item?'保存する':'作成する')+'</form>');
  const form = $('edit-event');
  const target = $('slots-editor');
  function syncDeadline() { form.elements.editHours.disabled = form.elements.anytime.checked; }
  form.elements.anytime.onchange = syncDeadline;
  syncDeadline();
  function addSlot(slot) {
    const row = document.createElement('div');
    row.className = 'slot-edit';
    row.dataset.slot = slot.id || uid();
    row.innerHTML = '<div class="field-pair">'+field('枠の開始',input('slotStart',localDate(slot.start),'type="datetime-local" required'))+
      field('枠の終了',input('slotEnd',localDate(slot.end),'type="datetime-local" required'))+'</div><div class="field-pair">'+
      field('時間枠名',input('slotTitle',slot.title,'maxlength="55"'),optional)+'<button type="button" class="secondary">この枠を外す</button></div>';
    row.querySelector('button').onclick = ()=>row.remove();
    target.append(row);
  }
  function autoSlots(ask) {
    const first = timestamp(form.elements.start.value);
    const last = timestamp(form.elements.end.value);
    if (!Number.isFinite(first) || !Number.isFinite(last) || first>=last || last-first>48*3600000) {
      notify('開催開始・終了を確認してください。',true); return;
    }
    if (ask && target.childElementCount && !confirm('入力中の時間枠を作り直しますか？')) return;
    if (item?.registration.length) { notify('予定登録済みのイベントは各時間枠を個別に編集してください。',true); return; }
    target.replaceChildren();
    for (let at=first; at<last; at+=7200000) addSlot({start:at,end:Math.min(last,at+7200000)});
  }
  $('auto-slots').onclick = ()=>autoSlots(true);
  $('add-slot').onclick = ()=>{
    const previous = target.lastElementChild?.querySelector('[name="slotEnd"]').value;
    const first = timestamp(previous || form.elements.start.value);
    if (!Number.isFinite(first)) { notify('開催開始を入力してください。',true); return; }
    addSlot({start:first,end:first+7200000});
  };
  if (item) item.slots.forEach(addSlot);
  else autoSlots(false);
  const request = uid();
  bindForm('edit-event', async form => {
    const f = new FormData(form);
    const slots = [...target.children].map(row=>({
      id:row.dataset.slot,
      start:timestamp(row.querySelector('[name="slotStart"]').value),
      end:timestamp(row.querySelector('[name="slotEnd"]').value),
      title:row.querySelector('[name="slotTitle"]').value
    }));
    await api('admin.event',{
      id:item?.id,revision:item?.revision || 0,title:f.get('title'),start:timestamp(f.get('start')),end:timestamp(f.get('end')),
      memberIds:f.getAll('member'),slots,editHours:f.has('anytime')?null:Number(f.get('editHours')),unlockHours:Number(f.get('unlockHours'))
    },{requestId:request,retry:true});
    closeModal();
    notify(item?'イベントを保存しました。':'イベントを作成しました。');
    await done();
  });
}
export function registrations(event,users) {
  modal('登録状況', '<div class="stack">'+event.slots.map(slot=>{
    const done = new Set(event.registration.filter(row=>row.slotId===slot.id).map(row=>row.userId));
    return '<section class="form-box"><h3>'+e(hour(slot.start)+'〜'+hour(slot.end)+' '+(slot.title || ''))+'</h3>'+
      '<ul class="summary-list">'+event.memberIds.map(id=>'<li><span>'+e(users.find(user=>user.id===id)?.name || '参加者')+
        '</span><strong>'+(done.has(id)?'登録済み':'未登録')+'</strong></li>').join('')+'</ul></section>';
  }).join('')+'</div>');
}
export function passwordForm(user, done) {
  modal('パスワード変更','<form id="edit-password">'+
    field('現在のパスワード',input('current','','type="password" autocomplete="current-password" required maxlength="128"'),required)+
    field('新しいパスワード（12文字以上）',input('new','','type="password" autocomplete="new-password" minlength="12" maxlength="128" required'),required)+
    field('新しいパスワードの確認',input('confirm','','type="password" autocomplete="new-password" minlength="12" maxlength="128" required'),required)+
    submit('変更する')+'</form>');
  bindForm('edit-password',async form=>{
    const fields = new FormData(form);
    if (fields.get('new') !== fields.get('confirm')) throw new Error('新しいパスワードが一致していません。');
    const currentProof = await passwordProof(user.username,fields.get('current'));
    const newProof = await passwordProof(user.username,fields.get('new'));
    await api('auth.password',{currentProof,newProof});
    closeModal();
    notify('パスワードを変更しました。');
    done();
  });
}
