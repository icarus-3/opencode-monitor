import {analyze, tokenUsageBuckets} from './metrics.mjs';

// A measurement is the most recent uninterrupted run of one exact provider/model.
// Imported history remains stored but never seeds a newly started measurement.
export function measurement(rows, epoch, bucketSize, after=0){
  const eligible=rows.filter(r=>!r.seed&&(r._rowid==null||r._rowid>after)&&Date.parse(r.timestamp)>=Date.parse(epoch))
    .sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp)||String(a.id).localeCompare(String(b.id)));
  const model=eligible.at(-1)?.model??null;
  let first=eligible.length;
  while(first>0&&eligible[first-1].model===model)first--;
  const segment=eligible.slice(first).map(r=>({...r,tps_outlier:undefined}));
  const analyzed=analyze(segment,[]).rows;
  const valid=analyzed.filter(r=>Number.isFinite(r.included_tps)&&r.included_tps>0);
  const recent=valid.slice(-20);
  return {model,epoch,started_at:segment[0]?.timestamp??epoch,run_id:segment[0]?.id??null,
    requests:segment.length,valid_samples:valid.length,
    latest_tps:valid.at(-1)?.included_tps??null,latest_at:valid.at(-1)?.timestamp??null,
    average20_tps:recent.length?recent.reduce((s,r)=>s+r.included_tps,0)/recent.length:null,
    average20_samples:recent.length,token_usage:tokenUsageBuckets(analyzed,bucketSize),
    chart:valid.slice(-120),records:analyzed.slice(-20).reverse()};
}
