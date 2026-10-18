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
function setSourceUsageExpanded(expanded){
  const toggle=$('source-usage-toggle'),list=$('source-usage-list');
  toggle.setAttribute('aria-expanded',String(expanded));
  list.hidden=!expanded;
  toggle.textContent=expanded?'收起来源用量':'展开来源用量（'+(toggle.dataset.count??0)+'）';
}
$('source-usage-toggle').addEventListener('click',()=>setSourceUsageExpanded($('source-usage-toggle').getAttribute('aria-expanded')!=='true'));
async function refresh(){
  if(loading)return;
  loading=true;
  try{
    const response=await fetch('/api/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const d=await response.json();
    const history=d.rows.filter(r=>!r.seed&&!r.tps_outlier&&Number.isFinite(r.included_tps));
    const latest=history.at(-1);
    const recent=history.slice(-20);
    const average=recent.length?recent.reduce((sum,r)=>sum+r.included_tps,0)/recent.length:null;
    const chartRows=history.slice(-120);
    $('model-name').textContent=d.selectedModel||'';
    $('updated').textContent='更新于 '+time(d.updated)+' · 每 8 秒自动刷新';
    $('live-speed').textContent=latest?fmt(latest.included_tps):'—';
    $('live-time').textContent=latest?'有效值时间 '+time(latest.timestamp):'暂无有效值';
    $('live-time').classList.remove('stale');
    $('average-speed').textContent=fmt(average);
    $('average-count').textContent='基于 '+recent.length+' 条；已排除异常高值';
    const inputTokens=Number(d.summary?.input_tokens??0),outputTokens=Number(d.summary?.output_tokens??0);
    const tokenUsage=d.token_usage||{};
    $('token-total').textContent=tokenFmt(tokenUsage.total_tokens??(inputTokens+outputTokens));
    $('token-breakdown').textContent='输入 '+tokenFmt(tokenUsage.input_tokens??inputTokens)+' · 输出 '+tokenFmt(tokenUsage.output_tokens??outputTokens);
    const sourceRows=tokenUsage.sources||[],sourceToggle=$('source-usage-toggle'),sourceList=$('source-usage-list');
    const sourceExpanded=sourceRows.length>0&&sourceToggle.getAttribute('aria-expanded')==='true';
    sourceToggle.dataset.count=String(sourceRows.length);
    sourceToggle.hidden=sourceRows.length===0;
    sourceToggle.textContent=sourceExpanded?'收起来源用量':'展开来源用量（'+sourceRows.length+'）';
    sourceList.hidden=!sourceExpanded;
    sourceList.innerHTML=sourceRows.map(source=>'<div class="source-usage-row"><strong class="source-usage-name">'+esc(source.label)+'</strong><span class="source-usage-totals">输入 '+tokenFmt(source.input_tokens)+' · 输出 '+tokenFmt(source.output_tokens)+' · 合计 '+tokenFmt(source.total_tokens)+' tokens</span></div>').join('');
    const bucketSize=Number(tokenUsage.bucket_size)||10000000,currentBucket=tokenUsage.current||{};
    $('token-interval-label').textContent='每 '+tokenFmt(bucketSize)+' tokens 区间均速';
    const completedBuckets=tokenUsage.recent_completed||[],latestBucket=completedBuckets.at(-1);
    const currentHasSpeed=Number(currentBucket.valid_samples)>0&&Number.isFinite(Number(currentBucket.average_tps));
    $('token-interval-speed').textContent=fmt(currentHasSpeed?currentBucket.average_tps:latestBucket?.average_tps);
    const latestText=currentHasSpeed?'当前第 '+currentBucket.index+' 段进行中 · 暂时均速 · '+currentBucket.valid_samples+' 次有效测速'+(latestBucket?' · 最近已完成第 '+latestBucket.index+' 段':''):latestBucket?'最近完成第 '+latestBucket.index+' 段 · '+latestBucket.valid_samples+' 次有效测速（按调用平均）· 异常高值已剔除':'尚未完成第一个区间';
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
