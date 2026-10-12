const STOP=new Set(['the','and','for','with','from','this','that','into','when','have','will','does','not','are','but','can','should','what','how','why','using','use','need','want','issue','error','bug','support','feature','request','node','npm','ask','hn']);
const SYNONYMS=new Map([['crashes','crash'],['crashed','crash'],['crashing','crash'],['fails','fail'],['failed','fail'],['files','file'],['huge','large'],['slowly','slow'],['slower','slow'],['processing','process']]);
export function tokens(statement) {
 return new Set((String(statement).toLowerCase().match(/[a-z0-9]{3,}/g)||[]).map(x=>SYNONYMS.get(x)||x).filter(x=>!STOP.has(x)));
}
export function similarity(a,b) {
 const x=tokens(a),y=tokens(b);
 if(!x.size||!y.size)return 0;
 const intersection=[...x].filter(t=>y.has(t)).length;
 return intersection/(x.size+y.size-intersection);
}
export function clusterProblems(problems,{threshold=0.6}={}) {
 if(!Number.isFinite(threshold)||threshold<0||threshold>1)throw new RangeError('Invalid threshold');
 const clusters=[];
 // Complete-link prevents unrelated issues joining through a chain of borderline matches.
 for(const problem of [...problems].sort((a,b)=>String(a.statement).localeCompare(String(b.statement)))) {
  let cluster=clusters.find(c=>c.members.every(m=>similarity(m.statement,problem.statement)>=threshold));
  if(!cluster){cluster={representative:problem.statement,members:[]};clusters.push(cluster);}
  cluster.members.push(problem);
 }
 return clusters;
}
