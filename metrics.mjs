export const median = xs => { const a=xs.filter(Number.isFinite).sort((a,b)=>a-b); return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null; };
export const bucket = n => n==null?null:n<50000?'0K':n<300000?'100K':n<700000?'500K':'900K+';
export function extract(m, parts, stream=null) {
  const t=m.tokens, outputParts=parts.filter(p=>['text','reasoning'].includes(p.type));
  const p=outputParts.filter(p=>Number.isFinite(p.time?.start)&&Number.isFinite(p.time?.end)&&p.time.end>=p.time.start);
  const first=p.length?Math.min(...p.map(p=>p.time.start)):null, last=p.length?Math.max(...p.map(p=>p.time.end)):null;
  const steps=parts.filter(p=>p.type==='step-finish');
  const input=t? (t.input??0)+(t.cache?.read??0)+(t.cache?.write??0):null, output=t?(t.output??0)+(t.reasoning??0):null;
  const valid=steps.length===1&&output>0&&m.time?.completed&&first!=null&&last>first&&p.length>0&&!m.error;
  const start=Number.isFinite(stream)&&stream<=first&&stream>=m.time.created-1000?stream:null;
  const duration=valid?(last-first)/1000:null, total=start!=null&&last>start?(last-start)/1000:null;
  return {timestamp:new Date(start??m.time.created).toISOString(), model:`${m.providerID}/${m.modelID}`,input_tokens:input,cache_read_tokens:t?.cache?.read??null,cache_write_tokens:t?.cache?.write??null,output_tokens:t?.output??null,reasoning_tokens:t?.reasoning??null,total_output_tokens:output,context_bucket:bucket(input),ttft:valid&&start!=null?(first-start)/1000:null,decode_duration:duration,decode_tps:duration?output/duration:null,total_duration:total,e2e_tps:total&&valid?output/total:null,e2e_scope:'stream_to_last_part',cost:m.cost??null,compaction:!!m.summary||m.agent==='compaction',tool_calls:parts.filter(p=>p.type==='tool').length,steps:steps.length,complete:!!m.time?.completed,timed_parts:p.length,output_parts:outputParts.length,quality:valid?(p.length===outputParts.length?'part_estimate':'partial_part_timing_estimate'):steps.length>1?'multiple_steps_no_timing':'incomplete_or_missing_timestamps',timing:start!=null?'log_stream':'no_stream_TTFT_unavailable'};
}
export function analyze(rows, bases, window=5) {
  const flagsProvided=rows.length>0&&rows.every(r=>typeof r.tps_outlier==='boolean');
  if(!flagsProvided) {
    const groups=new Map();
    for(const r of rows) {
      if(r.seed||!Number.isFinite(r.decode_tps)||r.decode_tps<=0) continue;
      const values=groups.get(r.model)??[];values.push(r.decode_tps);groups.set(r.model,values);
    }
    const limits=new Map();
    for(const [model,values] of groups) {
      if(values.length<20) continue;
      const center=median(values),mad=median(values.map(v=>Math.abs(v-center)));
      limits.set(model,center+Math.max(6*1.4826*mad,center*0.5));
    }
    for(const r of rows) {
      const limit=limits.get(r.model);
      r.tps_outlier=!r.seed&&Number.isFinite(r.decode_tps)&&Number.isFinite(limit)&&r.decode_tps>limit;
      r.tps_outlier_limit=limit??null;
    }
  }
  for(const r of rows) r.included_tps=r.tps_outlier?null:r.decode_tps;
  const baseline=new Map(bases.map(b=>[b.model+'|'+b.bucket,b])); let cumulative=0;
  const history=[], rolling=new Map();
  for(const r of rows) {
    cumulative+=(r.input_tokens??0)+(r.total_output_tokens??0); r.cumulative_tokens=cumulative;
    const b=baseline.get(r.model+'|'+r.context_bucket); r.baseline=b?.decode_tps??null;
    r.normalized_tps=r.included_tps&&r.baseline?r.included_tps/r.baseline:null;
    r.normalized_ttft=r.ttft!=null&&b?.ttft>0?r.ttft/b.ttft:null;
    r.comparable=!!(r.normalized_tps&&r.total_output_tokens>=128&&!r.compaction&&!r.tool_calls&&r.steps===1);
    const recent=rolling.get(r.model)??[];
    if(r.comparable) {history.push(r);recent.push(r.normalized_tps);if(recent.length>window)recent.shift();rolling.set(r.model,recent);}
    r.rolling_median=r.comparable?median(recent):null;
  }
  const models=[...new Set(rows.map(r=>r.model))];
  const diagnostics=models.map(model=>{
    const all=history.filter(r=>r.model===model), live=all.filter(r=>!r.seed), recent=live.slice(-20), values=recent.map(r=>r.normalized_tps), relative=median(values);
    let slope=null, change=null;
    if(recent.length>=5) {
      const xs=recent.map(r=>(Date.parse(r.timestamp)-Date.parse(recent[0].timestamp))/3600000), mx=xs.reduce((a,b)=>a+b,0)/xs.length, my=values.reduce((a,b)=>a+b,0)/values.length, den=xs.reduce((s,x)=>s+(x-mx)**2,0);
      slope=den?xs.reduce((s,x,i)=>s+(x-mx)*(values[i]-my),0)/den:null;
      for(let k=5;k<=values.length-5;k++) {const before=median(values.slice(0,k)),after=median(values.slice(k)), ratio=after/before; if(!change||Math.abs(Math.log(ratio))>Math.abs(Math.log(change.ratio))) change={timestamp:recent[k].timestamp,ratio,before,after};}
    }
    let state='No throttling', explanation='未检测到持续 decode 下降；这不证明服务端没有限流。';
    const low=values.slice(-10).filter(x=>x<0.8).length;
    if(!bases.some(b=>b.model===model)) explanation='缺少该模型的独立基准，无法判断相对性能或 throttling；不会套用其他模型的基准。';
    else if(recent.length<10) explanation=`证据不足：仅 ${recent.length} 条非基准可比较样本（需至少 10 条）；基准样本不用于证明长期稳定。`;
    else if(relative<0.8&&values.slice(-5).every(x=>x<0.85)) {state='Possible throttling'; explanation='最近样本相对同模型/context 基准持续偏低；负载、输出内容、缓存及客户端计时仍可解释。'; if(recent.length>=20&&low>=8&&median(values.slice(-10))<0.7&&(slope<0||change?.ratio<0.8)) {state='Likely throttling';explanation='至少 20 条样本，最近 10 条中至少 8 条低于基准 80%，中位低于 70%，且有负趋势或下降分段；仅表示强性能异常，无法证明服务端策略。';}}
    return {model,state,explanation,post_seed_samples:live.length,excluded_outliers:rows.filter(r=>r.model===model&&r.tps_outlier&&!r.seed).length,relative,slope_per_hour:slope,change_point:change&&Math.abs(change.ratio-1)>=0.2?change:null,ttft_relative:median(recent.map(r=>r.normalized_ttft)),ttft_note:'TTFT 单独观察，不作为 decode 限速证据；context 已分桶，缓存/网络/排队未校正。'};
  });
  return {rows,diagnostics};
}
