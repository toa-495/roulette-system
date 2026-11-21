// Browser-memory-only generic roulette. Nothing is stored in Sheets or localStorage.
export const CUSTOM_MIN=2;
export const CUSTOM_MAX=30;
export function equalPercents(count){
  if(!Number.isInteger(count)||count<CUSTOM_MIN||count>CUSTOM_MAX)throw new Error('項目数は2〜30で選んでください。');
  const base=Math.floor(10000/count),remainder=10000%count;
  return Array.from({length:count},(_,i)=>String((base+(i<remainder?1:0))/100));
}
export function makeCustomState(count=2){
  return {entries:equalPercents(count).map((percent,i)=>({id:'custom_'+i,label:'項目'+(i+1),percent})),spin:null};
}
export function resizeCustom(state,count){
  const percents=equalPercents(count);
  state.entries=percents.map((percent,i)=>({
    id:'custom_'+i,label:state.entries[i]?.label ?? '項目'+(i+1),percent
  }));
  state.spin=null;
  return state;
}
export function balanceCustom(state){
  const percents=equalPercents(state.entries.length);
  state.entries.forEach((entry,i)=>{entry.percent=percents[i];});
  state.spin=null;
}
export function customCandidates(state){
  if(!state?.entries?.length)throw new Error('項目を登録してください。');
  const names=new Set();
  let total=0;
  const result=[];
  for(const entry of state.entries){
    const name=String(entry.label||'').trim();
    if(!name)throw new Error('すべての項目に名前を入力してください。');
    if(name.length>60)throw new Error('項目名は60文字以内にしてください。');
    if(names.has(name))throw new Error('項目名が重複しています。区別できる名前にしてください。');
    names.add(name);
    const raw=String(entry.percent).trim();
    if(!/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(raw))throw new Error('確率は0〜100％、小数点以下2桁までで入力してください。');
    const units=Math.round(Number(raw)*100);
    if(!Number.isSafeInteger(units)||units<0||units>10000)throw new Error('確率は0〜100％で入力してください。');
    total+=units;
    if(units>0)result.push({userId:entry.id,name,title:'',weight:units});
  }
  if(total!==10000)throw new Error('当選確率の合計を100％にしてください（現在 '+(total/100).toFixed(2)+'％）。');
  if(!result.length)throw new Error('当選する項目を1つ以上設定してください。');
  return result;
}
export function percentSum(state){
  return state.entries.reduce((total,entry)=>{
    const raw=String(entry.percent).trim();
    return total+(/^(?:\d{1,3})(?:\.\d{1,2})?$/.test(raw)?Number(raw):0);
  },0);
}
