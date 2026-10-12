export const weights = Object.freeze({pain:20,payment:25,buyerAccess:15,competitionGap:15,feasibility:15,advantage:10});
export function assess(factors){
  const entries=Object.entries(weights);
  let observed=0, weighted=0;
  for(const [key,weight] of entries){
    const v=factors[key];
    if(v==null)continue;
    if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw new RangeError(`Invalid ${key}`);
    observed+=weight;weighted+=v*weight;
  }
  return {score:observed===0?null:Math.round(weighted/observed*100),coverage:observed,missing:entries.filter(([k])=>factors[k]==null).map(([k])=>k),rubric:'v1'};
}
