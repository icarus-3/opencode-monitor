const $=id=>document.getElementById(id), fmt=(n,d=2)=>n==null?'—':Number(n).toLocaleString('zh-CN',{maximumFractionDigits:d,minimumFractionDigits:d}), integer=n=>fmt(n,0);
const time=s=>new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(s));
const esc=s=>String(s??'—').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function table(id,headers,rows){$(id).innerHTML='<div class="scroll"><table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(v=>'<td>'+esc(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function plot(id,series,xLabel,yLabel,isTime=true){
  const all=series.flatMap(s=>s.points).filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  if(!all.length){$(id).innerHTML='<div class="empty">暂无可用数据</div>';return;}
  const W=660,H=260,L=62,R=20,T=15,B=46;
  let xmin=Math.min(...all.map(p=>p.x)),xmax=Math.max(...all.map(p=>p.x)),ymin=Math.min(0,...all.map(p=>p.y)),ymax=Math.max(...all.map(p=>p.y))*1.12;
  if(xmax===xmin)xmax=xmin+1;if(ymax===ymin)ymax=ymin+1;
  const x=v=>L+(v-xmin)/(xmax-xmin)*(W-L-R), y=v=>H-B-(v-ymin)/(ymax-ymin)*(H-T-B);
  let html=`<svg class="plot" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel+' 随 '+xLabel)}">`;
  for(let i=0;i<=4;i++){let v=ymin+(ymax-ymin)*i/4;html+=`<line x1="${L}" x2="${W-R}" y1="${y(v)}" y2="${y(v)}" stroke="#e9eef5"/><text x="${L-8}" y="${y(v)+4}" text-anchor="end">${fmt(v,1)}</text>`;}
  for(let i=0;i<=3;i++){let v=xmin+(xmax-xmin)*i/3;html+=`<text x="${x(v)}" y="${H-26}" text-anchor="${i===0?'start':i===3?'end':'middle'}">${esc(isTime?time(v):fmt(v/1000000,2)+'M')}</text>`;}
  for(const s of series){const ps=s.points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));if(!s.dots)html+=`<polyline fill="none" stroke="${s.color}" stroke-width="1.8" ${s.dash?'stroke-dasharray="5 4"':''} points="${ps.map(p=>x(p.x)+','+y(p.y)).join(' ')}"/>`;html+=ps.map(p=>`<circle cx="${x(p.x)}" cy="${y(p.y)}" r="${s.dots?4:2.7}" fill="${s.color}"><title>${esc((isTime?time(p.x):integer(p.x)+' tokens')+' · '+s.label+' '+fmt(p.y)+(p.tip?' · '+p.tip:''))}</title></circle>`).join('');}
  html+=`<text x="${L}" y="${H-5}">${esc(xLabel)}</text><text x="${L}" y="12">${esc(yLabel)}</text></svg>`;$(id).innerHTML=html;
}
let loading=false,loaded=false;
async function refresh(){if(loading)return;loading=true;$('refresh').disabled=true;
  try{const q=new URLSearchParams();if(loaded)q.set('model',$('model').value);for(const key of ['from','to'])if($(key).value)q.set(key,new Date($(key).value+':00+08:00').toISOString());
    const res=await fetch('/api/dashboard?'+q);if(!res.ok)throw Error('读取失败：HTTP '+res.status);const d=await res.json();
    if(!loaded){$('model').innerHTML=d.models.map(m=>`<option value="${esc(m)}">${esc(m)}</option>`).join('')+'<option value="all">全部模型（判断按模型分开）</option>';$('model').value=d.selectedModel;loaded=true;}
    $('updated').textContent='最近采集 '+time(d.updated)+' · 采集耗时 '+integer(d.scan_ms)+' ms · 页面刷新 '+time(Date.now());$('error').textContent=d.warnings.join('\n');
    const s=d.summary,cards=[['最近 decode TPS',fmt(s.latest_tps),'tok/s · 最近一次有效记录'],['最近 20 次 median',fmt(s.median20_tps),'tok/s · 当前筛选范围'],['参考 baseline',fmt(s.baseline),'tok/s · 最近20次对应基准的中位数'],['Relative performance',fmt(s.relative==null?null:s.relative*100)+'%','逐条 normalized TPS 的中位数'],['TTFT median',fmt(s.ttft)+' s','最近20条速度记录中的可用 TTFT'],['已采集调用',integer(s.requests),'完成 '+integer(s.completed)+' · 可估速 '+integer(s.valid_timing)],['累计 input',integer(s.input_tokens),'包含 cache.read + cache.write'],['累计 output',integer(s.output_tokens),'正文 + reasoning'],['429 / 其他错误',integer(s.http429)+' / '+integer(s.errors-s.http429),'日志错误事件数 · 非精确 HTTP 次数'],['Compaction / cost',integer(s.compactions)+' / $'+fmt(s.cost,4),'客户端报告金额 · 不代表新增费用']];
    $('summary').innerHTML=cards.map(c=>`<div class="card"><span>${esc(c[0])}</span><strong>${esc(c[1])}</strong><span>${esc(c[2])}</span></div>`).join('');
    $('status').innerHTML=d.diagnostics.map(a=>`<div class="status ${a.state==='Likely throttling'?'bad':a.state==='Possible throttling'?'warn':''}"><strong>${esc(a.state)}</strong> <span class="badge">${esc(a.model)}</span><p>${esc(a.explanation)}</p><small>非基准可比较样本 ${a.post_seed_samples} · normalized 趋势斜率 ${fmt(a.slope_per_hour==null?null:a.slope_per_hour*100)} 百分点/小时 · TTFT relative ${fmt(a.ttft_relative)}× · 分段变化 ${a.change_point?esc(time(a.change_point.timestamp)+' 后/前 '+fmt(a.change_point.ratio)+'×'):'未检出 ≥20% 分段变化'}</small><small>${esc(a.ttft_note)}</small></div>`).join('')||'<div class="status">筛选范围内无样本，无法判断。</div>';
    const r=d.rows, point=(a,field,token=false)=>({x:token?a.cumulative_tokens:Date.parse(a.timestamp),y:a[field],tip:a.model+' / '+a.context_bucket});
    plot('decode',[{label:'decode TPS',color:'#2865b7',points:r.map(a=>point(a,'decode_tps'))},{label:'baseline',color:'#8d9bb0',dash:true,points:r.map(a=>point(a,'baseline'))}],'时间 UTC+8','tok/s');
    plot('normalized',[{label:'relative',color:'#2865b7',points:r.map(a=>point(a,'normalized_tps',true))},{label:'rolling median',color:'#26876b',points:r.map(a=>point(a,'rolling_median',true))}],'累计 input + output tokens','相对基准（1 = 100%）',false);
    plot('ttft',[{label:'TTFT',color:'#2865b7',points:r.map(a=>point(a,'ttft'))}],'时间 UTC+8','秒');
    plot('events-chart',[{label:'429',color:'#c34242',dots:true,points:d.events.filter(e=>e.http_status===429).map(e=>({x:Date.parse(e.timestamp),y:3,tip:e.message}))},{label:'error',color:'#d58d2e',dots:true,points:d.events.filter(e=>e.kind==='error'&&e.http_status!==429).map(e=>({x:Date.parse(e.timestamp),y:2,tip:e.message}))},{label:'compaction',color:'#8996a8',dots:true,points:d.events.filter(e=>e.kind==='compaction').map(e=>({x:Date.parse(e.timestamp),y:1}))}],'时间 UTC+8','事件类型：1 压缩 / 2 错误 / 3 429');
    table('baselines',['模型','Context bucket','n','Median decode tok/s','Median TTFT s','来源'],d.baselines.map(b=>[b.model,b.bucket,b.n,fmt(b.decode_tps),fmt(b.ttft),b.source]));
    $('last-error').textContent=s.last_error?time(s.last_error.timestamp)+' · '+s.last_error.model+' · '+s.last_error.message:'当前筛选范围未捕获错误。';
    table('events',['时间 UTC+8','模型','类型','HTTP','说明'],d.events.slice(-100).reverse().map(e=>[time(e.timestamp),e.model,e.kind,e.http_status,e.message]));
    table('records',['时间 UTC+8','模型','Context','Input','Cache read','Text / reasoning','Decode s','TPS','Relative %','TTFT s','E2E TPS','总耗时 s','Cost $','标记'],r.slice(-100).reverse().map(a=>[time(a.timestamp),a.model,a.context_bucket,integer(a.input_tokens),integer(a.cache_read_tokens),integer(a.output_tokens)+' / '+integer(a.reasoning_tokens),fmt(a.decode_duration),fmt(a.decode_tps),fmt(a.normalized_tps==null?null:a.normalized_tps*100),fmt(a.ttft),fmt(a.e2e_tps),fmt(a.total_duration),fmt(a.cost,6),[a.seed?'seed':'',a.compaction?'compaction':'',a.tool_calls?'tools:'+a.tool_calls:'',a.quality,a.timing].filter(Boolean).join(' · ')]));
    $('sources').textContent=JSON.stringify(d.sources,null,2)+'；未知模型事件 '+s.unknown_model_errors+'（全部时间）。';
  }catch(e){$('error').textContent='监控页面刷新失败：'+e.message+'。请确认服务正在运行。';}finally{loading=false;$('refresh').disabled=false;}}
$('refresh').addEventListener('click',refresh);$('model').addEventListener('change',refresh);$('from').addEventListener('change',refresh);$('to').addEventListener('change',refresh);setInterval(()=>{if($('auto').checked)refresh()},8000);refresh();
