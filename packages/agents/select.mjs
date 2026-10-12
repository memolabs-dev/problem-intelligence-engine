import {extractProblem} from './extract.mjs';

export function observationGroup(observation){
 const match=/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+(?:[/?#]|$)/i.exec(String(observation?.url||''));
 return match?'github:'+match[1].toLowerCase():observation?.id?.startsWith('hackernews:')?'hackernews':'other';
}
function score(string){
 let h=2166136261;
 for(const char of string){h^=char.charCodeAt(0);h=Math.imul(h,16777619);}
 return h>>>0;
}
function roundRobin(rows,seed){
 const groups=new Map();
 for(const row of rows){
  const key=observationGroup(row);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(row);
 }
 for(const list of groups.values())list.sort((a,b)=>score(seed+':'+a.id)-score(seed+':'+b.id)||a.id.localeCompare(b.id));
 const order=[...groups.keys()].sort((a,b)=>score(seed+':'+a)-score(seed+':'+b)||a.localeCompare(b));
 const selected=[];
 let progressing=true;
 while(progressing){
  progressing=false;
  for(const group of order){
   const next=groups.get(group).shift();
   if(next){selected.push(next);progressing=true;}
  }
 }
 return selected;
}
/**
 * Explore unrecognized observations instead of filtering everything through
 * the same heuristic that the language model is meant to improve.
 */
export function selectForLLM(observations,{limit=15,explorationFraction=0.3,seed='pie-balanced-v1'}={}){
 if(!Array.isArray(observations)||!Number.isInteger(limit)||limit<1||limit>500)throw Error('Invalid balanced selection');
 if(typeof explorationFraction!=='number'||!Number.isFinite(explorationFraction)||explorationFraction<0||explorationFraction>1)throw Error('Invalid exploration fraction');
 const seen=new Set();
 const unique=observations.filter(row=>{
  if(!row?.id||seen.has(row.id))return false;
  seen.add(row.id);return true;
 });
 const signal=roundRobin(unique.filter(o=>Boolean(extractProblem(o))),seed+':signal');
 const exploration=roundRobin(unique.filter(o=>!extractProblem(o)),seed+':explore');
 const explorationGoal=Math.min(exploration.length,Math.round(Math.min(limit,unique.length)*explorationFraction));
 const signalGoal=Math.min(signal.length,Math.min(limit,unique.length)-explorationGoal);
 const selected=[...signal.slice(0,signalGoal),...exploration.slice(0,explorationGoal)];
 const used=new Set(selected.map(x=>x.id));
 for(const row of roundRobin([...signal.slice(signalGoal),...exploration.slice(explorationGoal)],seed+':fill')){
  if(selected.length>=limit)break;
  if(!used.has(row.id)){selected.push(row);used.add(row.id);}
 }
 return {rows:selected,stats:{population:unique.length,signalPopulation:signal.length,explorationPopulation:exploration.length,chosenSignals:selected.filter(o=>Boolean(extractProblem(o))).length,chosenExploration:selected.filter(o=>!extractProblem(o)).length,groups:[...new Set(selected.map(observationGroup))].sort()}};
}
