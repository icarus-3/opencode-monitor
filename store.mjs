import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { extract, median, analyze } from './metrics.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const parse=x=>{try{return JSON.parse(x)}catch{return null}};
export class Store {
  constructor(root,config) {
    this.root=root;this.config=config; this.warnings=[];this.lastScan=null;this.dirtyStreams=new Set();
    fs.mkdirSync(path.join(root,'data'),{recursive:true});
    this.db=new DatabaseSync(path.join(root,'data','monitor.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,ts TEXT NOT NULL,model TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS record_time ON records(ts); CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,ts TEXT,model TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS state(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS baselines(model TEXT,bucket TEXT,data TEXT,PRIMARY KEY(model,bucket));
      CREATE TABLE IF NOT EXISTS streams(id TEXT PRIMARY KEY,ts INTEGER,model TEXT);`);
    if(this.state('extractor').version!==2) {this.db.prepare("DELETE FROM state WHERE id LIKE 'db:%'").run();this.saveState('extractor',{version:2});}
    this.seed();
  }
  state(id) {return parse(this.db.prepare('SELECT data FROM state WHERE id=?').get(id)?.data)??{};}
  saveState(id,obj) {this.db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(id,JSON.stringify(obj));}
  record(id,r) {const old=this.db.prepare('SELECT data FROM records WHERE id=?').get(id);if(old&&parse(old.data)?.seed&&!r.seed)return;
    this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(id,r.timestamp,r.model,JSON.stringify({...r,id}));}
  event(id,e) {this.db.prepare('INSERT OR REPLACE INTO events VALUES(?,?,?,?)').run(id,e.timestamp,e.model??'unknown',JSON.stringify({...e,id}));}
  seed() {
    const f=path.join(this.root,'seed','measurements.json'); if(!fs.existsSync(f)) return;
    const rows=JSON.parse(fs.readFileSync(f,'utf8')), ids=JSON.parse(fs.readFileSync(path.join(this.root,'seed','identities.json'),'utf8'));
    for(const x of rows) {
      const r={timestamp:x.startUTC,model:x.assistant_models,input_tokens:x.input_tokens,cache_read_tokens:x.cache_read_tokens,cache_write_tokens:x.cache_write_tokens,output_tokens:x.text_output_tokens,reasoning_tokens:x.reasoning_tokens,total_output_tokens:x.total_output_tokens,context_bucket:x.target_input===0?'0K':x.target_input===900000?'900K+':x.target_input/1000+'K',ttft:x.first_token_delay_est_s,decode_duration:x.decode_span_est_s,decode_tps:x.decode_tps_est,total_duration:x.request_total_est_s,process_duration:x.process_total_s,e2e_tps:x.total_output_tokens/x.request_total_est_s,benchmark_process_e2e_tps:x.e2e_output_tps,e2e_scope:'stream_to_last_part',cost:x.cost,http_status:null,compaction:x.compaction,tool_calls:x.tool_calls,steps:1,complete:true,quality:'part_estimate',timing:'log_stream',seed:true,source:'benchmark measurements.json',session_id:x.sessionID};
      if(this.config.includeExampleRecords!==false)this.record(x.sessionID+':'+ids[x.id],r);
    }
    for(const model of new Set(rows.map(x=>x.assistant_models))) for(const target of new Set(rows.map(x=>x.target_input))) {
      const group=rows.filter(x=>x.assistant_models===model&&x.target_input===target), b={model,bucket:target===0?'0K':target===900000?'900K+':target/1000+'K',decode_tps:median(group.map(x=>x.decode_tps_est)),ttft:median(group.map(x=>x.first_token_delay_est_s)),n:group.length,source:'reference benchmark; not personal calibration'};
      this.db.prepare('INSERT OR IGNORE INTO baselines VALUES(?,?,?)').run(model,b.bucket,JSON.stringify(b));
    }
  }
  scanLogs(dir) {
    if(!fs.existsSync(dir)) {this.warnings.push('日志目录不存在：'+dir);return;}
    for(const name of fs.readdirSync(dir).filter(x=>/\.log(?:\.\d+)?$/.test(x))) {
      const file=path.join(dir,name), stat=fs.statSync(file), st=this.state('log:'+file);
      let offset=st.offset??0;
      const fd=fs.openSync(file,'r');
      try {
        const h=Buffer.alloc(Math.min(128,stat.size));fs.readSync(fd,h,0,h.length,0);const head=hash(h);
        if(offset>stat.size||(st.head&&st.head!==head)) {offset=0;st.pending={};}
        const pending=st.pending??{};
        // Bound each batch; leave incomplete final line for the next poll.
        const data=Buffer.alloc(Math.min(stat.size-offset,8*1024*1024));fs.readSync(fd,data,0,data.length,offset);
        const end=data.lastIndexOf(10);if(end<0) return;
        const lines=data.subarray(0,end+1).toString('utf8').split(/\r?\n/);
        this.db.exec('BEGIN');
        try {for(const line of lines) {
          const ts=line.match(/\btimestamp=(\S+)/)?.[1], session=line.match(/\bsession\.id=(\S+)/)?.[1], run=line.match(/\brun=(\S+)/)?.[1]??'default';
          if(!ts||!Number.isFinite(Date.parse(ts)))continue;
          const key=run+'|'+(session??'');
          const msg=line.match(/\bmessageID=(\S+)/)?.[1];
          if(/\bmessage=process\b/.test(line)&&session&&msg) pending[key]={msg,session};
          const provider=line.match(/\bproviderID=(\S+)/)?.[1], model=line.match(/\bmodelID=(\S+)/)?.[1];
          if(/\bmessage=stream\b/.test(line)&&session&&provider&&model) {
            const context=pending[key];const modelName=provider+'/'+model;
            if(context) {context.model=modelName;this.db.prepare('INSERT OR IGNORE INTO streams VALUES(?,?,?)').run(session+':'+context.msg,Date.parse(ts),modelName);this.dirtyStreams.add(context.msg);}
          }
          if(/\blevel=ERROR\b/.test(line)) {
            // Inspect error fields only: digits elsewhere (timestamps, IDs, tokens) are never HTTP codes.
            const payload=line.slice(line.indexOf('level=ERROR')+11), structured=payload.match(/(?:statusCode|status|httpStatus)(?:\\?"|')?\s*[:=]\s*(?:\\?"|')?(\d{3})\b/i), http=payload.match(/\bHTTP\s+(\d{3})\b/i);
            const status=Number(structured?.[1]??http?.[1])||null;
            const type=payload.match(/\b(FreeUsageLimitError|FreeTierError|RateLimitError|APIError|APICallError|TimeoutError|AuthenticationError)\b/)?.[1]??'LoggedError';
            const context=pending[key];
            this.event('log:'+hash(file+'\n'+line),{timestamp:new Date(ts).toISOString(),model:provider&&model?provider+'/'+model:context?.model??'unknown',kind:'error',http_status:status,error_type:type,message:status?'HTTP '+status+' / '+type:type,source:file,session_id:session??null,message_id:context?.msg??null});
          }
          if(/\b(?:message=(?:compacting|compaction)|agent=compaction)\b/.test(line)) this.event('log:'+hash(file+'\n'+line),{timestamp:new Date(ts).toISOString(),model:pending[key]?.model??'unknown',kind:'compaction',message:'日志记录 compaction',source:file});
        }
        this.saveState('log:'+file,{offset:offset+end+1,head,pending});this.db.exec('COMMIT');} catch(e) {this.db.exec('ROLLBACK');throw e;}
      } finally {fs.closeSync(fd);}
    }
  }
  scanDatabase(file) {
    if(!fs.existsSync(file)) {this.warnings.push('数据库不存在：'+file);return;}
    // readOnly never creates/modifies source schema or switches its journal mode.
    const source=new DatabaseSync(file,{readOnly:true});
    try {
      source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000; BEGIN');
      const st=this.state('db:'+file), since=Math.max(0,(st.watermark??0)-2000);
      // Both tables matter: a part can finish after the parent message was observed.
      const changed=source.prepare(`SELECT id FROM message WHERE time_updated>=? UNION SELECT message_id id FROM part WHERE time_updated>=?`).all(since,since);
      const seen=new Set(changed.map(x=>x.id));for(const id of this.dirtyStreams)if(!seen.has(id))changed.push({id});
      const maxM=source.prepare('SELECT MAX(time_updated) n FROM message').get().n??0, maxP=source.prepare('SELECT MAX(time_updated) n FROM part').get().n??0;
      const get=source.prepare('SELECT id,session_id,data FROM message WHERE id=?');
      const parts=source.prepare(`SELECT id, json_extract(data,'$.type') type,json_extract(data,'$.time') time FROM part WHERE message_id=?`);
      this.db.exec('BEGIN');
      try {for(const {id} of changed) {
        const row=get.get(id);if(!row)continue;const m=parse(row.data);if(!m)continue;
        if(m.role==='user') {
          const ps=parts.all(id);for(const p of ps.filter(p=>p.type==='compaction')) this.event('part:'+p.id,{timestamp:new Date(m.time.created).toISOString(),model:m.model?m.model.providerID+'/'+m.model.modelID:'unknown',kind:'compaction',message:'持久化 compaction part',source:file,session_id:row.session_id});
          continue;
        }
        if(m.role!=='assistant'||!m.providerID||!m.modelID||!Number.isFinite(m.time?.created))continue;
        const ps=parts.all(id).map(p=>({type:p.type,time:parse(p.time)})), key=row.session_id+':'+id;
        const stream=this.db.prepare('SELECT * FROM streams WHERE id=?').get(key), r=extract(m,ps,stream?.model===m.providerID+'/'+m.modelID?stream.ts:null);
        r.source=file;r.session_id=row.session_id;r.message_id=id;r.seed=false;r.http_status=Number(m.error?.data?.statusCode)||null;
        this.record(key,r);
        if(m.error) {
          this.event('message:'+key,{timestamp:r.timestamp,model:r.model,kind:'error',http_status:r.http_status,error_type:m.error.name??'SessionError',message:(m.error.name??'SessionError')+(r.http_status?' / HTTP '+r.http_status:''),source:file,session_id:row.session_id,message_id:id});
        }
      }
      this.saveState('db:'+file,{watermark:Math.max(maxM,maxP)});this.db.exec('COMMIT');} catch(e) {this.db.exec('ROLLBACK');throw e;}
      source.exec('COMMIT');
    } finally {source.close();}
  }
  scan() {
    const begin=Date.now();this.warnings=[];
    if(!this.config.databases.length)this.warnings.push('未发现 OpenCode 数据库。请在 config.json 的 databases 中填写 opencode.db 的完整路径，然后重启。No OpenCode database found; configure its path in config.json.');
    for(const dir of this.config.logDirectories)try{this.scanLogs(dir)}catch(e){this.warnings.push('日志读取失败 '+dir+'：'+e.message)}
    for(const file of this.config.databases)try{this.scanDatabase(file)}catch(e){this.warnings.push('数据库读取失败 '+file+'：'+e.message)}
    this.dirtyStreams.clear();
    this.lastScan=new Date().toISOString();this.scanMs=Date.now()-begin;
  }
  dashboard(query={}) {
    const models=this.db.prepare('SELECT DISTINCT model FROM records ORDER BY model').all().map(x=>x.model);
    const model=query.model??(models.includes(this.config.defaultModel)?this.config.defaultModel:this.db.prepare('SELECT model FROM records ORDER BY ts DESC LIMIT 1').get()?.model??this.config.defaultModel);
    if(!models.includes(model)&&model!=='all')models.push(model);
    const rows=this.db.prepare('SELECT data FROM records WHERE (? = ? OR model=?) ORDER BY ts,id').all(model,'all',model).map(x=>parse(x.data));
    const bases=this.db.prepare('SELECT data FROM baselines ORDER BY model,bucket').all().map(x=>parse(x.data));
    const full=analyze(rows,bases,this.config.rollingWindow), from=query.from?Date.parse(query.from):null,to=query.to?Date.parse(query.to):null;
    if((query.from&&!Number.isFinite(from))||(query.to&&!Number.isFinite(to)))throw Error('无效时间范围');
    const included=x=>(from==null||Date.parse(x.timestamp)>=from)&&(to==null||Date.parse(x.timestamp)<=to);
    const visible=full.rows.filter(included), diagnostics=analyze(visible.map(x=>({...x})),bases,this.config.rollingWindow).diagnostics;
    const valid=visible.filter(x=>x.decode_tps!=null), recent=valid.slice(-20), allEvents=this.db.prepare('SELECT data FROM events ORDER BY ts,id').all().map(x=>parse(x.data)).filter(x=>(model==='all'||x.model===model)&&included(x));
    // Session errors are preferred to matching log events for the same message/status.
    const canonical=allEvents.filter(x=>!x.id.startsWith('log:')||!allEvents.some(y=>y.id.startsWith('message:')&&y.session_id===x.session_id&&y.message_id===x.message_id&&y.http_status===x.http_status));
    const errors=canonical.filter(x=>x.kind==='error');
    return {models,selectedModel:model,updated:this.lastScan,scan_ms:this.scanMs,warnings:this.warnings,sources:{databases:this.config.databases,logs:this.config.logDirectories},baselines:bases.filter(x=>model==='all'||x.model===model),summary:{requests:visible.length,completed:visible.filter(x=>x.complete).length,valid_timing:valid.length,latest_tps:valid.at(-1)?.decode_tps??null,median20_tps:median(recent.map(x=>x.decode_tps)),baseline:median(recent.map(x=>x.baseline)),relative:median(recent.map(x=>x.normalized_tps)),ttft:median(recent.map(x=>x.ttft)),input_tokens:visible.reduce((s,x)=>s+(x.input_tokens??0),0),output_tokens:visible.reduce((s,x)=>s+(x.total_output_tokens??0),0),cache_read_tokens:visible.reduce((s,x)=>s+(x.cache_read_tokens??0),0),cost:visible.reduce((s,x)=>s+(x.cost??0),0),http429:errors.filter(x=>x.http_status===429).length,errors:errors.length,last_error:errors.at(-1)??null,compactions:canonical.filter(x=>x.kind==='compaction').length,unknown_model_errors:this.db.prepare("SELECT count(*) n FROM events WHERE model='unknown'").get().n},diagnostics,rows:visible,events:canonical};
  }
}
