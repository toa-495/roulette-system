const config = window.ROULETTE_CONFIG || {};
export const pollMs = Math.max(2000, Number(config.POLL_MS) || 3000);
export const configured = /^https:\/\/script\.google\.com\/(?:macros\/s\/|a\/macros\/[a-zA-Z0-9.-]+\/s\/|a\/[a-zA-Z0-9.-]+\/macros\/s\/)[A-Za-z0-9_-]+\/exec$/.test(config.GAS_URL || '')
  || !!window.google?.script?.run;

export function uid() { return crypto.randomUUID(); }
const sessionKey = 'roulette.session:' + location.pathname.replace(/index\.html$/, '');
export function token() { return sessionStorage.getItem(sessionKey) || ''; }
export function setToken(value) {
  if (value) sessionStorage.setItem(sessionKey, value);
  else sessionStorage.removeItem(sessionKey);
}
export class ApiError extends Error {
  constructor(code,message) { super(message); this.code = code; }
}
async function fetchJson(body) {
  if (window.google?.script?.run) {
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => reject(new ApiError('NETWORK','通信がタイムアウトしました。')), 28000);
      window.google.script.run
        .withSuccessHandler(value => { clearTimeout(timer); resolve(value); })
        .withFailureHandler(() => { clearTimeout(timer); reject(new ApiError('NETWORK','GASとの通信に失敗しました。')); })
        .rpc(body);
    });
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(),28000);
  try {
    const response = await fetch(config.GAS_URL, {
      method:'POST',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:JSON.stringify(body),
      credentials:'omit',
      redirect:'follow',
      cache:'no-store',
      referrerPolicy:'no-referrer',
      signal:controller.signal
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
      throw new ApiError('NETWORK','JSON応答を受信できません。GASの /exec URL と公開範囲を確認してください。');
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('NETWORK','GASに接続できませんでした。通信環境とウェブアプリの公開設定を確認してください。');
  } finally { clearTimeout(timeout); }
}

export async function api(action, payload = {}, options = {}) {
  if (!configured) throw new ApiError('CONFIG','config.js に GAS の /exec URL を設定してください。');
  const body = {action, payload, token:token(), requestId:options.requestId || uid()};
  const send = async () => {
    const before = Date.now();
    const result = await fetchJson(body);
    const arrived = Date.now();
    if (!result?.ok) throw new ApiError(result?.code || 'NETWORK',result?.message || '応答を読み込めませんでした。');
    const data = result.data;
    if (data && !Array.isArray(data) && Number.isFinite(result.serverTime)) {
      Object.defineProperty(data,'clock', {value:result.serverTime - (before+arrived)/2});
    }
    return data;
  };
  try { return await send(); }
  catch (error) {
    if (!options.retry || error.code !== 'NETWORK') throw error;
    return send();
  }
}
export async function passwordProof(username, password) {
  const {salt} = await api('auth.salt',{username});
  const encoded = new TextEncoder();
  const material = await crypto.subtle.importKey('raw',encoded.encode(password),'PBKDF2',false,['deriveBits']);
  const bytes = Uint8Array.from(salt.match(/../g),chunk=>parseInt(chunk,16));
  const proof = await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:bytes,iterations:600000},material,256);
  return Array.from(new Uint8Array(proof),byte=>byte.toString(16).padStart(2,'0')).join('');
}
