export function nameCandidates(members,settings) {
  const result=[];
  for(const member of members) {
    const choice=settings.people.get(member.id);
    if(!choice?.selected) continue;
    const raw=settings.equal?1:Number(choice.weight),weight=Math.round(raw*1000);
    if(!Number.isFinite(raw) || raw<0 || raw>1000 || Math.abs(raw*1000-weight)>0.00001 || (!settings.equal && String(choice.weight).trim()==='')) throw new Error('倍率は0〜1000、小数点以下3桁までで入力してください。');
    if(weight) result.push({userId:member.id,name:member.name,title:'',weight});
  }
  return result;
}
function randomBelow(count) {
  if(!globalThis.crypto?.getRandomValues) throw new Error('抽選に必要な機能を使えません。HTTPSのページで開いてください。');
  const limit=0x100000000-0x100000000%count,bytes=new Uint32Array(1);
  do {crypto.getRandomValues(bytes);} while(bytes[0]>=limit);
  return bytes[0]%count;
}
export function nameSpin(candidates,random=randomBelow,at=Date.now()) {
  if(!candidates.length) throw new Error('参加者を選び、1人以上の倍率を0より大きくしてください。');
  if(candidates.length>30 || candidates.some(p=>!Number.isInteger(p.weight) || p.weight<=0 || p.weight>1000000)) throw new Error('参加者と倍率を確認してください。');
  const total=candidates.reduce((sum,p)=>sum+p.weight,0),ticket=random(total);
  if(!Number.isInteger(ticket) || ticket<0 || ticket>=total) throw new Error('抽選値を取得できませんでした。もう一度お試しください。');
  let before=0,index=0;
  while(ticket>=before+candidates[index].weight) before+=candidates[index++].weight;
  const offset=(200+random(601))/1000,point=(before+candidates[index].weight*offset)/total;
  return {id:'names_'+at+'_'+random(1000000000),startAt:at+200,duration:7500,turns:8+random(3),
    angle:(1-point)%1,winnerId:candidates[index].userId,candidates:candidates.map(p=>({...p}))};
}
