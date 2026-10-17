const $=id=>document.getElementById(id);
const fmt=n=>n==null||!Number.isFinite(Number(n))?'—':Number(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const tokenFmt=n=>n==null||!Number.isFinite(Number(n))?'—':Math.round(Number(n)).toLocaleString('zh-CN');
const time=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value));
const axisTime=value=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function renderChart(rows){
  if(!rows.length){$('speed-chart').innerHTML='<div class="empty">还没有有效速度记录</div>';return;}
  const W=1000,H=390,L=82,R=28,T=25,B=62;
  const rates=rows.map(r=>r.included_tps);
  const low=Math.min(...rates),high=Math.max(...rates),pad=Math.max((high-low)*0.16,high*0.08,8);
  const ymin=Math.max(0,low-pad),ymax=high+pad;
  let xmin=Date.parse(rows[0].timestamp),xmax=Date.parse(rows[rows.length-1].timestamp);
  if(xmin===xmax)xmax=xmin+1000;
  const x=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R);
  const y=v=>H-B-(v-ymin)/(ymax-ymin)*(H-T-B);
  let html='<svg class="plot" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="生成速度随时间变化">';
  for(let i=0;i<=4;i++){
    const v=ymin+(ymax-ymin)*i/4,py=y(v);
    html+='<line x1="'+L+'" x2="'+(W-R)+'" y1="'+py+'" y2="'+py+'" class="grid"/>';
    html+='<text x="'+(L-12)+'" y="'+(py+4)+'" text-anchor="end">'+esc(fmt(v))+'</text>';
  }
  for(let i=0;i<=4;i++){
    const value=xmin+(xmax-xmin)*i/4,px=x(value);
    html+='<text x="'+px+'" y="'+(H-31)+'" text-anchor="'+(i===0?'start':i===4?'end':'middle')+'">'+esc(axisTime(value))+'</text>';
  }
  const points=rows.map(r=>x(Date.parse(r.timestamp))+','+y(r.included_tps)).join(' ');
  html+='<polyline points="'+points+'" class="speed-line"/>';
  rows.forEach(r=>{
    const px=x(Date.parse(r.timestamp)),py=y(r.included_tps);
    html+='<circle cx="'+px+'" cy="'+py+'" r="3.2" class="speed-point"><title>'+esc(time(r.timestamp)+' · '+fmt(r.included_tps)+' tok/s')+'</title></circle>';
  });
  html+='<text x="'+L+'" y="'+(H-7)+'">时间（北京时间）</text>';
  html+='<text x="'+L+'" y="14">tok/s</text></svg>';
  $('speed-chart').innerHTML=html;
}
let loading=false;
function setBucketHistoryExpanded(expanded){
  const toggle=$('token-bucket-history-toggle'),history=$('token-bucket-history');
  toggle.setAttribute('aria-expanded',String(expanded));
  history.hidden=!expanded;
  toggle.textContent=expanded?'收起历史区间':'展开历史区间（'+(toggle.dataset.count??0)+'）';
}
$('token-bucket-history-toggle').addEventListener('click',()=>setBucketHistoryExpanded($('token-bucket-history-toggle').getAttribute('aria-expanded')!=='true'));
async function refresh(){
  if(loading)return;
  loading=true;
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const d=await response.json();
    const history=d.rows.filter(r=>!r.seed&&!r.tps_outlier&&Number.isFinite(r.included_tps));
    const latest=history.at(-1);
    const latestRaw=d.rows.filter(r=>!r.seed).at(-1);
    const newerUnmeasured=!!(latestRaw&&(!latest||Date.parse(latestRaw.timestamp)>Date.parse(latest.timestamp)));
    const isPartial=r=>String(r?.quality||'').includes('partial_part_timing_estimate');
    const recent=history.slice(-20);
    const average=recent.length?recent.reduce((sum,r)=>sum+r.included_tps,0)/recent.length:null;
    const partialRecent=recent.filter(isPartial).length;
    const chartRows=history.slice(-120);
    $('model-name').textContent=d.selectedModel||'';
    $('updated').textContent='更新于 '+time(d.updated)+' · 每 8 秒自动刷新';
    $('live-speed').textContent=latest?fmt(latest.included_tps):'—';
    if(newerUnmeasured){
      const reason=latestRaw.tps_outlier?'最新调用测速异常，已剔除':!latestRaw.complete?'最新调用尚未完成':latestRaw.quality==='incomplete_or_missing_timestamps'?'最新回复没有可用片段计时':'最新调用计时不完整';
      $('live-time').textContent=reason+(latest?' · 显示上次有效值 '+time(latest.timestamp):' · 暂无有效测速');
    }else{$('live-time').textContent=latest?'最近测得 '+time(latest.timestamp)+(isPartial(latest)?' · 部分计时估算':''):'等待有效记录';}
    $('live-time').classList.toggle('stale',newerUnmeasured);
    $('average-speed').textContent=fmt(average);
    $('average-count').textContent='基于 '+recent.length+' 条；已排除异常高值；部分计时估算 '+partialRecent+' 条';
    const inputTokens=Number(d.summary?.input_tokens??0),outputTokens=Number(d.summary?.output_tokens??0);
    const tokenUsage=d.token_usage||{};
    $('token-total').textContent=tokenFmt(tokenUsage.total_tokens??(inputTokens+outputTokens));
    $('token-breakdown').textContent='输入 '+tokenFmt(tokenUsage.input_tokens??inputTokens)+' · 输出 '+tokenFmt(tokenUsage.output_tokens??outputTokens);
    const bucketSize=Number(tokenUsage.bucket_size)||10000000,currentBucket=tokenUsage.current||{};
    $('token-interval-label').textContent='每 '+tokenFmt(bucketSize)+' tokens 区间均速';
    const completedBuckets=tokenUsage.recent_completed||[],latestBucket=completedBuckets.at(-1);
    $('token-interval-speed').textContent=fmt(latestBucket?.average_tps);
    const latestText=latestBucket?'最近完成第 '+latestBucket.index+' 段 · '+latestBucket.valid_samples+' 次有效测速（按调用平均）· 异常高值已剔除':'尚未完成第一个区间';
    $('token-interval-caption').textContent=latestText+' · 当前第 '+(currentBucket.index??1)+' 段进度 '+tokenFmt(currentBucket.used_tokens??0)+' / '+tokenFmt(bucketSize)+' tokens';
    const olderBuckets=completedBuckets.slice(0,-1),historyToggle=$('token-bucket-history-toggle'),bucketHistory=$('token-bucket-history');
    const historyExpanded=olderBuckets.length>0&&historyToggle.getAttribute('aria-expanded')==='true';
    historyToggle.dataset.count=String(olderBuckets.length);
    historyToggle.hidden=olderBuckets.length===0;
    historyToggle.textContent=historyExpanded?'收起历史区间':'展开历史区间（'+olderBuckets.length+'）';
    bucketHistory.hidden=!historyExpanded;
    bucketHistory.innerHTML=olderBuckets.map(item=>'<span class="bucket-chip">第 '+item.index+' 段 · '+(item.average_tps==null?'—':fmt(item.average_tps)+' tok/s')+'</span>').join('');
    $('chart-range').textContent='最近 '+chartRows.length+' 条有效测速';
    $('error').textContent=(d.warnings||[]).join('；');
    renderChart(chartRows);
  }catch(error){
    $('error').textContent='读取失败：'+error.message+'。请确认监控服务正在运行。';
  }finally{loading=false;}
}
refresh();
setInterval(refresh,8000);
