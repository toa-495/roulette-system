import {e,icon} from './ui.js';

let timeout;
const dialog=()=>document.getElementById('winner-dialog');

export function dismissWinner(){
  clearTimeout(timeout);
  const node=dialog();
  if(node?.open)node.close();
}
export function showWinner({heading,name,detail=''}) {
  if(!name)return;
  const node=dialog();
  const body=document.getElementById('winner-dialog-content');
  if(!node||!body)return;
  dismissWinner();
  const sparks=Array.from({length:30},(_,i)=>{const angle=i*2.399,dist=120+(i%6)*23;return '<span class="win-confetti" style="--i:'+i+';--delay:'+(i%6)+';--dx:'+Math.round(Math.cos(angle)*dist)+'px;--dy:'+Math.round(Math.sin(angle)*dist)+'px"></span>';}).join('');
  body.innerHTML='<div class="win-confetti-area" aria-hidden="true">'+sparks+'</div>'+
    '<div class="win-symbol">'+icon('spark',38)+'</div>'+
    '<p class="win-heading">'+e(heading)+'</p>'+
    '<h2 class="win-name" id="winner-heading">'+e(name)+'</h2>'+
    (detail?'<p class="win-detail">'+e(detail)+'</p>':'')+
    '<button type="button" class="primary win-dismiss" data-action="winner-close">結果を確認</button>';
  node.showModal();
  timeout=setTimeout(dismissWinner,6000);
}
document.getElementById('winner-dialog')?.addEventListener('click',event=>{
  if(event.target===dialog())dismissWinner();
});
document.getElementById('winner-dialog')?.addEventListener('close',()=>clearTimeout(timeout));
