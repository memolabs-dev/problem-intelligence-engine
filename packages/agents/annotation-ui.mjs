import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';

/**
 * A single-file offline annotation interface. It does not fetch anything,
 * send results anywhere, or display the model's similarity/decisions.
 */
export function validateBlindQueue(queue){
 if(queue?.kind!=='unlabeled_human_annotation_queue'||!Array.isArray(queue.pairs)||!queue.pairs.length)throw Error('Expected a nonempty blind annotation queue');
 const seen=new Set();
 for(const row of queue.pairs){
  if(!/^[a-f0-9]{24}$/.test(row?.pairId||'')||seen.has(row.pairId))throw Error('Invalid or duplicate pair ID');
  seen.add(row.pairId);
  for(const side of ['left','right']){
   const item=row[side];
   if(!item?.observationId||typeof item.title!=='string'||typeof item.body!=='string'||!/^https:\/\//.test(item.url||''))throw Error('Invalid source in blind annotation queue');
  }
 }
 return queue;
}
export function makeOfflineAnnotationPage(blind){
 validateBlindQueue(blind);
 // Escape the HTML parser's script-end delimiter and its equivalent sequences.
 // No source text is ever rendered as HTML by the browser script.
 const embedded=JSON.stringify(blind).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
 return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'none'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<title>Memo Labs · Blind pair review</title>
<style>
:root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;color:#202325;background:#f7f8f8;font-synthesis:none}
*{box-sizing:border-box}body{margin:0}header{border-bottom:1px solid #e4e8e7;background:white;padding:20px max(24px,calc((100vw - 1160px)/2))}
main{max-width:1160px;margin:0 auto;padding:28px 24px 70px}h1{font-size:23px;letter-spacing:-.7px;margin:0 0 4px}h2{font-size:17px;margin:0 0 14px;line-height:1.4}p{line-height:1.55}.muted{color:#65716e;font-size:14px}
.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin-bottom:24px}.control{display:flex;flex-direction:column;gap:6px;font-size:13px;color:#52615d}
input,textarea,button{font:inherit}input,textarea{border:1px solid #cdd6d1;border-radius:9px;padding:10px 12px;background:white;color:#202325}
input:focus,textarea:focus,button:focus-visible,a:focus-visible{outline:2px solid #547b6e;outline-offset:2px}
input{min-width:200px}button{border:1px solid #d5ded9;border-radius:9px;padding:11px 16px;background:white;color:#203029;cursor:pointer}
button:hover{background:#f2f6f4}.primary{background:#254d3e;color:white;border-color:#254d3e}.primary:hover{background:#386452}
button[aria-pressed="true"]{border-color:#254d3e;background:#e6f0ea;font-weight:650}
.progress{margin:20px 0}.track{height:5px;background:#e0e7e2;border-radius:20px;overflow:hidden}.fill{height:100%;background:#416c58;transition:width .15s}
.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.card{background:white;border:1px solid #dfe6e1;border-radius:14px;padding:24px;min-height:250px;overflow-wrap:anywhere}
.card p{white-space:pre-wrap;font-size:14px;color:#42504b}.card a{color:#285d48;text-decoration:underline;text-underline-offset:3px;font-size:13px}
.label{font-size:12px;text-transform:uppercase;letter-spacing:1.3px;color:#687974;font-weight:650;margin-bottom:8px}
.panel{background:white;border:1px solid #dfe6e1;border-radius:14px;padding:24px;margin-top:18px}
.choices{display:flex;flex-wrap:wrap;gap:9px;margin:12px 0 18px}.choices button{flex:1;min-width:160px}
textarea{display:block;width:100%;resize:vertical;min-height:85px}.nav{display:flex;justify-content:space-between;gap:14px;margin-top:19px}.nav button{min-width:115px}
button:disabled{cursor:not-allowed;opacity:.4}.notice{min-height:1.5em;color:#9c503c;margin-top:10px;font-size:14px}.foot{margin-top:35px;color:#66716d;font-size:13px}
@media(max-width:750px){.cards{grid-template-columns:1fr}.card{min-height:unset}.controls{align-items:stretch}.controls>button{width:100%}}
</style>
</head>
<body>
<header><h1>Pair review</h1><div class="muted">Memo Labs Dev · Evidence-based problem research · Offline annotation</div></header>
<main>
<p class="muted">You are reviewing whether two source reports describe the <strong>same concrete user difficulty</strong>. Similar technology alone is not sufficient. No model predictions are shown.</p>
<section class="controls">
<label class="control">Reviewer pseudonym<input id="reviewer" placeholder="e.g. reviewer-one" autocomplete="off" maxlength="60"></label>
<button id="import" type="button">Import saved answers</button><input id="importFile" type="file" accept=".json,application/json" hidden>
<button id="export" class="primary" type="button">Export answers (.json)</button>
</section>
<div class="progress"><div class="muted" id="progressText"></div><div class="track" role="progressbar" aria-label="Review progress" aria-valuemin="0" aria-valuemax="${blind.pairs.length}" id="progress"><div class="fill" id="fill"></div></div></div>
<section class="cards" aria-label="Two original source reports">
<article class="card"><div class="label">Source A</div><h2 id="titleA"></h2><p id="bodyA"></p><a id="urlA" target="_blank" rel="noopener noreferrer">Open original source ↗</a></article>
<article class="card"><div class="label">Source B</div><h2 id="titleB"></h2><p id="bodyB"></p><a id="urlB" target="_blank" rel="noopener noreferrer">Open original source ↗</a></article>
</section>
<section class="panel" aria-label="Your judgment">
<h2>Do these describe the same underlying problem?</h2>
<div class="choices">
<button type="button" data-label="same_problem" aria-pressed="false">Same problem</button>
<button type="button" data-label="different_problem" aria-pressed="false">Different problems</button>
<button type="button" data-label="uncertain" aria-pressed="false">Uncertain</button>
</div>
<label class="control" for="reason">Rationale — required for every completed answer</label><textarea id="reason" placeholder="Which concrete failure or unmet need matches or differs?"></textarea>
<p id="notice" class="notice" role="status" aria-live="polite"></p>
<div class="nav"><button type="button" id="previous">← Previous</button><div class="muted" id="counter" aria-live="polite"></div><button type="button" id="next">Next →</button></div>
</section>
<p class="foot">Works entirely in your browser. Exports are saved locally and are never sent to Memo Labs or any external service. Labels remain human-supplied and do not constitute independently verified identities.</p>
</main>
<script id="blind" type="application/json">${embedded}</script>
<script>
"use strict";
const blind=JSON.parse(document.getElementById('blind').textContent);
const byId=id=>document.getElementById(id);
const answers=blind.pairs.map(pair=>({pairId:pair.pairId,label:null,reason:null}));
let index=0;
const VALID=new Set(['same_problem','different_problem','uncertain']);
const safeReviewer=value=>/^[a-zA-Z0-9_-]{3,60}$/.test(value);
function saveCurrent(){
 const row=answers[index],text=byId('reason').value.trim();
 row.reason=text||null;
 if(row.label&&!text){byId('notice').textContent='Please add your reasoning for this answer.';return false;}
 byId('notice').textContent='';
 return true;
}
function render(){
 const pair=blind.pairs[index];
 for(const [side,id] of [['left','A'],['right','B']]){
  const value=pair[side];
  byId('title'+id).textContent=value.title||'Untitled source';
  byId('body'+id).textContent=value.body||'No excerpt available; consult the original source.';
  byId('url'+id).href=value.url;
 }
 byId('reason').value=answers[index].reason||'';
 for(const button of document.querySelectorAll('[data-label]'))button.setAttribute('aria-pressed',String(button.dataset.label===answers[index].label));
 byId('counter').textContent=(index+1)+' / '+blind.pairs.length;
 byId('previous').disabled=index===0;
 byId('next').disabled=index===blind.pairs.length-1;
 const completed=answers.filter(x=>x.label&&x.reason?.trim()).length;
 byId('progressText').textContent=completed+' of '+blind.pairs.length+' pairs reviewed';
 byId('progress').setAttribute('aria-valuenow',String(completed));
 byId('fill').style.width=(100*completed/blind.pairs.length)+'%';
}
for(const button of document.querySelectorAll('[data-label]'))button.addEventListener('click',()=>{
 answers[index].label=button.dataset.label;byId('notice').textContent='';render();
});
byId('reason').addEventListener('input',()=>{answers[index].reason=byId('reason').value.trim()||null;renderProgressOnly();});
function renderProgressOnly(){
 const completed=answers.filter(x=>x.label&&x.reason?.trim()).length;
 byId('progressText').textContent=completed+' of '+blind.pairs.length+' pairs reviewed';
 byId('progress').setAttribute('aria-valuenow',String(completed));
 byId('fill').style.width=(100*completed/blind.pairs.length)+'%';
}
byId('next').addEventListener('click',()=>{if(saveCurrent()&&index<answers.length-1){index++;render();}});
byId('previous').addEventListener('click',()=>{if(saveCurrent()&&index>0){index--;render();}});
byId('export').addEventListener('click',()=>{
 if(!saveCurrent())return;
 const reviewer=byId('reviewer').value.trim();
 if(!safeReviewer(reviewer)){byId('notice').textContent='Use a 3–60 character reviewer pseudonym (letters, digits, dash or underscore).';return;}
 const payload={kind:'human_pair_annotations',reviewer,annotations:answers};
 const blob=new Blob([JSON.stringify(payload,null,2)+'\\n'],{type:'application/json'});
 const url=URL.createObjectURL(blob);
 const link=document.createElement('a');link.href=url;link.download='pie-annotations-'+reviewer+'.json';
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 byId('notice').textContent='Saved your answers locally. Keep this file private.';
});
byId('import').addEventListener('click',()=>byId('importFile').click());
byId('importFile').addEventListener('change',async event=>{
 const file=event.target.files?.[0];if(!file)return;
 try{
  const payload=JSON.parse(await file.text());
  if(payload?.kind!=='human_pair_annotations'||!safeReviewer(payload.reviewer)||!Array.isArray(payload.annotations)||payload.annotations.length!==answers.length)throw Error('Invalid annotation file');
  const lookup=new Map(payload.annotations.map(x=>[x.pairId,x]));
  if(lookup.size!==answers.length)throw Error('Duplicate pair IDs');
  for(let i=0;i<answers.length;i++){
   const row=lookup.get(answers[i].pairId);
   if(!row||(row.label!==null&&!VALID.has(row.label))||(row.label&&(!row.reason||typeof row.reason!=='string')))throw Error('Annotation set does not match this blind queue');
  }
  for(const answer of answers){const row=lookup.get(answer.pairId);answer.label=row.label;answer.reason=row.reason||null;}
  byId('reviewer').value=payload.reviewer;byId('notice').textContent='Answers restored locally.';render();
 }catch(error){byId('notice').textContent='Import refused: '+String(error.message).slice(0,120);}
 event.target.value='';
});
render();
</script>
</body></html>`;
}
export async function writeOfflineAnnotationPage(blind,path){
 if(typeof path!=='string'||!path.endsWith('.html'))throw Error('Expected an HTML output path');
 const html=makeOfflineAnnotationPage(blind);
 await writeFile(path,html,{mode:0o600,flag:'wx'});
 return {path:resolve(path),pairs:blind.pairs.length,bytes:Buffer.byteLength(html)};
}
if(process.argv[1]?.endsWith('/packages/agents/annotation-ui.mjs')){
 const [source,destination]=process.argv.slice(2);
 if(!source||!destination)throw Error('Usage: npm run eval:annotation-ui -- /path/to/blind.json /path/to/review.html');
 const blind=JSON.parse(await readFile(source,'utf8'));
 console.log(JSON.stringify(await writeOfflineAnnotationPage(blind,destination)));
}
