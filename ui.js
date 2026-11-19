import {api} from './api.js';
export const $ = (id) => document.getElementById(id);
export const e = (value) => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const safeUrl = (s) => /^https?:\/\/[^\s/<>"']+[^\s<>"']*$/i.test(s || '');
export const yen = (amount) => new Intl.NumberFormat('ja-JP',{style:'currency',currency:'JPY'}).format(amount);
const zone = {timeZone:'Asia/Tokyo'};
export const hour = (ms) => new Intl.DateTimeFormat('ja-JP',{...zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(ms);
export const date = (ms) => new Intl.DateTimeFormat('ja-JP',{...zone,month:'long',day:'numeric',weekday:'short'}).format(ms);
export const time = (ms) => new Intl.DateTimeFormat('ja-JP',{...zone,month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(ms);
export const localDate = (ms) => new Date(ms+9*3600000).toISOString().slice(0,16);
export const timestamp = (value) => value ? Date.parse(value+':00+09:00') : NaN;
export const required = '<span class="required">必須 *</span>';
export const optional = '<span class="optional">任意</span>';
export const initials = (name) => Array.from(name || '？').slice(0,1).join('');
const shapes = {
  calendar:'<rect x="4" y="6" width="16" height="15" rx="3"/><path d="M8 3v6m8-6v6M4 11h16"/>',
  pen:'<path d="m4 20 4-.8L20 7l-3-3L5 16l-1 4Zm11-14 3 3"/>',
  wallet:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 9h16m-5 6h2"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="m12 2 2 3 4 .5.5 4L22 12l-3.5 2.5-.5 4-4 .5-2 3-2-3-4-.5-.5-4L2 12l3.5-2.5.5-4 4-.5 2-3Z"/>',
  lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  back:'<path d="M19 12H5m6 6-6-6 6-6"/>',
  bolt:'<path d="m13 2-8 12h6l-1 8 9-12h-6l1-8Z"/>',
  speaker:'<path d="M4 9h4l5-4v14l-5-4H4Zm13-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute:'<path d="M4 9h4l5-4v14l-5-4H4Zm13 1 5 5m0-5-5 5"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m3-14a3 3 0 0 1 0 6m2 8v-2a5 5 0 0 0-2-4"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  image:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="9" r="1"/><path d="m4 17 5-4 3 2 4-4 5 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  spark:'<path d="M12 2c0 6-4 10-10 10 6 0 10 4 10 10 0-6 4-10 10-10-6 0-10-4-10-10Z"/>'
};
export const icon = (name, size = 20) => '<svg width="'+size+'" height="'+size+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(shapes[name] || '')+'</svg>';

let noticeTimeout;
export function notify(message, error = false) {
  $('notice').textContent = message;
  $('notice').className = error ? 'visible error' : 'visible';
  clearTimeout(noticeTimeout);
  noticeTimeout = setTimeout(()=>$('notice').className='', error ? 6500 : 3800);
}
export function modal(title, html) {
  const dialog = $('modal');
  $('modal-body').innerHTML = '<div class="modal-top"><h2 id="modal-title">'+e(title)+'</h2><button type="button" id="close-modal" class="icon-btn" aria-label="閉じる">×</button></div>'+html;
  $('close-modal').onclick = ()=>dialog.close();
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
}
export function closeModal() { $('modal').close(); }
export function bindForm(id, callback, onError) {
  const form = $(id);
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const primary = event.submitter || form.querySelector('[type="submit"]');
    if (form.dataset.busy) return;
    form.dataset.busy = 'true';
    if (primary) primary.disabled = true;
    const errorArea = form.querySelector('.form-error');
    if (errorArea) errorArea.textContent = '';
    try { await callback(form, primary); }
    catch (error) {
      if (errorArea) errorArea.textContent = error.message;
      else notify(error.message,true);
      onError?.(error);
    } finally {
      delete form.dataset.busy;
      if (primary) primary.disabled = false;
    }
  });
}
export function richView(rich) {
  // Rebuild the allowlisted markup before insertion, including data read back from Sheets.
  const source = new DOMParser().parseFromString(rich || '', 'text/html');
  const target = document.createElement('div');
  const tags = new Set(['b','strong','i','em','u','s','strike','del','br','div','p','span','a','font','ul','ol','li','blockquote','h1','h2','h3','h4']);
  const styles = ['color','background-color','text-align','font-size','font-family','font-weight','font-style','text-decoration','margin-left'];
  function copy(nodes,parent) {
    for (const node of nodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        parent.append(document.createTextNode(node.textContent));
        continue;
      }
      const tag = node.localName;
      if (!tags.has(tag)) continue;
      const element = document.createElement(tag);
      for (const key of styles) {
        const value = node.style.getPropertyValue(key);
        if (value && !/[()]|url/i.test(value.replace(/^rgba?\([\d,.\s]+\)$/i,''))) element.style.setProperty(key,value);
      }
      if (tag === 'a' && safeUrl(node.getAttribute('href'))) {
        element.href = node.getAttribute('href');
        element.target = '_blank';
        element.rel = 'noopener noreferrer';
      }
      if (tag === 'font') {
        for (const key of ['face','size','color']) {
          const value = node.getAttribute(key);
          if (value && /^[a-zA-Z0-9# ,\-]{1,45}$/.test(value)) element.setAttribute(key,value);
        }
      }
      parent.append(element);
      copy(node.childNodes,element);
    }
  }
  copy(source.body.childNodes,target);
  return target.innerHTML;
}

const images = new Map();
export function clearImages() { images.clear(); }
export async function mediaSrc(request) {
  const key = JSON.stringify(request);
  if (!images.has(key)) {
    if (images.size >= 12) images.delete(images.keys().next().value);
    images.set(key,api('media.get',request).then(data => 'data:image/jpeg;base64,'+data.photo).catch(error => {
      images.delete(key);
      throw error;
    }));
  }
  return images.get(key);
}
export function photoButton(request, label) {
  return '<button class="secondary" type="button" data-photo="'+e(JSON.stringify(request))+'">'+icon('image',17)+' '+e(label)+'</button>';
}
export async function showPhoto(button) {
  button.disabled = true;
  try {
    const src = await mediaSrc(JSON.parse(button.dataset.photo));
    modal('写真', '<a class="photo-full-link" href="'+src+'" download="photo.jpg" aria-label="写真をダウンロード"><img class="photo-full" src="'+src+'" alt="登録された写真"></a>');
  } catch (error) { notify(error.message,true); }
  finally { button.disabled = false; }
}
export function copyText(value) {
  const manual = () => modal('コピーする内容','<p>下の内容を選択してコピーしてください。</p><code class="code">'+e(value)+'</code>');
  return navigator.clipboard ? navigator.clipboard.writeText(value).then(()=>notify('コピーしました。')).catch(manual) : manual();
}
