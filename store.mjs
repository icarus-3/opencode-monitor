import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { syncRemoteDatabase } from './remote.mjs';
import { DatabaseSync } from 'node:sqlite';
import { extract, median, analyze, bucket } from './metrics.mjs';
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const parse=x=>{try{return JSON.parse(x)}catch{return null}};
const sourceId=x=>String(x??'remote').replace(/[^A-Za-z0-9._-]/g,'_').slice(0,60)||'remote';
export class Store {
  constructor(root,config) {
    this.root=root;this.config=config; this.warnings=[];this.lastScan=null;this.dirtyStreams=new Set();this.eventStreamStatus='connecting';this.scanPromise=null;this.remoteSources=new Map();this.remoteStatus=new Map();
    for(const source of config.sshDatabases??[]){
      const id=sourceId(source.id??source.host),file=path.join(root,'data','remote-sources',id+'.sqlite');
      if(this.remoteSources.has(file))throw new Error('Duplicate SSH source id: '+id);
      this.remoteSources.set(file,{...source,id});
    }
    fs.mkdirSync(path.join(root,'data'),{recursive:true});
    this.db=new DatabaseSync(path.join(root,'data','monitor.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,ts TEXT NOT NULL,model TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS record_time ON records(ts); CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY,ts TEXT,model TEXT,data TEXT);
      CREATE TABLE IF NOT EXISTS state(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE IF NOT EXISTS baselines(model TEXT,bucket TEXT,data TEXT,PRIMARY KEY(model,bucket));
      CREATE TABLE IF NOT EXISTS streams(id TEXT PRIMARY KEY,ts INTEGER,model TEXT); CREATE TABLE IF NOT EXISTS live_parts(session_id TEXT NOT NULL,message_id TEXT NOT NULL,part_type TEXT NOT NULL,ordinal INTEGER NOT NULL,start_ms INTEGER,end_ms INTEGER,PRIMARY KEY(session_id,message_id,part_type,ordinal));`);
    if(this.state('extractor').version!==4) {this.db.prepare("DELETE FROM state WHERE id LIKE 'db:%' OR id LIKE 'dbv2:%'").run();this.saveState('extractor',{version:4});}
  }
  state(id) {return parse(this.db.prepare('SELECT data FROM state WHERE id=?').get(id)?.data)??{};}
  saveState(id,obj) {this.db.prepare('INSERT OR REPLACE INTO state VALUES(?,?)').run(id,JSON.stringify(obj));}
  recordId(file,key) {const source=this.remoteSources.get(file);return source?'ssh:'+source.id+':'+key:key;}
  liveSessionId(file,session) {const source=this.remoteSources.get(file);return source?'ssh:'+source.id+':'+session:session;}
  setRemoteEventStatus(id,status) {const old=this.remoteStatus.get(id)??{};this.remoteStatus.set(id,{...old,eventStream:status});}
  record(id,r) { this.db.prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?)').run(id,r.timestamp,r.model,JSON.stringify({...r,id})); }
  event(id,e) {this.db.prepare('INSERT OR REPLACE INTO events VALUES(?,?,?,?)').run(id,e.timestamp,e.model??'unknown',JSON.stringify({...e,id}));}
  setEventStreamStatus(status) { this.eventStreamStatus=status; }
  captureEvent(event,sourceId=null) {
    if(!event||typeof event!=='object')return;
    const type=event.type;
    const parts={
      'session.text.started':['text','start'],'session.text.ended':['text','end'],
      'session.reasoning.started':['reasoning','start'],'session.reasoning.ended':['reasoning','end']
    };
    const spec=parts[type];if(!spec)return;
    let data=event.data??event.properties??{};
    if(typeof data==='string'){try{data=JSON.parse(data)}catch{return}}
    if(!data||typeof data!=='object')return;
    const sourceSession=data.sessionID??event.sessionID??event.aggregateID;
    const session=sourceId?'ssh:'+sourceId+':'+sourceSession:sourceSession;
    const message=data.assistantMessageID??event.assistantMessageID;
    const ordinal=Number(data.ordinal);
    let created=Number(event.created);
    if(!Number.isFinite(created)&&typeof event.created==='string')created=Date.parse(event.created);
    if(!session||!message||!Number.isSafeInteger(ordinal)||ordinal<0||!Number.isFinite(created))return;
    if(spec[1]==='start'){
      this.db.prepare('INSERT INTO live_parts(session_id,message_id,part_type,ordinal,start_ms,end_ms) VALUES(?,?,?,?,?,NULL) ON CONFLICT(session_id,message_id,part_type,ordinal) DO UPDATE SET start_ms=COALESCE(live_parts.start_ms,excluded.start_ms)').run(session,message,spec[0],ordinal,created);
    }else{
      this.db.prepare('INSERT INTO live_parts(session_id,message_id,part_type,ordinal,start_ms,end_ms) VALUES(?,?,?,?,NULL,?) ON CONFLICT(session_id,message_id,part_type,ordinal) DO UPDATE SET end_ms=excluded.end_ms').run(session,message,spec[0],ordinal,created);
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
    const source=new DatabaseSync(file,{readOnly:true});
    try {
      source.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000');
      const tables=new Set(source.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
      if(!tables.has('message')||!tables.has('part')) {
        if(tables.has('session_message')&&tables.has('session_v2')) {this.scanDatabaseV2(file,source);return;}
        throw new Error('不支持的 OpenCode 数据库结构：未找到 message/part 或 session_v2/session_message');
      }
      source.exec('BEGIN');
      const st=this.state('db:'+file), since=Math.max(0,(st.watermark??0)-2000);
      const changed=source.prepare(`SELECT id FROM message WHERE time_updated>=? UNION SELECT message_id id FROM part WHERE time_updated>=?`).all(since,since);
      const seen=new Set(changed.map(x=>x.id));for(const id of this.dirtyStreams)if(!seen.has(id))changed.push({id});
      const maxM=source.prepare('SELECT MAX(time_updated) n FROM message').get().n??0, maxP=source.prepare('SELECT MAX(time_updated) n FROM part').get().n??0;
      const get=source.prepare('SELECT id,session_id,data FROM message WHERE id=?');
      const parts=source.prepare(`SELECT id, json_extract(data,'$.type') type,json_extract(data,'$.time') time FROM part WHERE message_id=?`);
      this.db.exec('BEGIN');
      try {for(const {id} of changed) {
        const row=get.get(id);if(!row)continue;const m=parse(row.data);if(!m)continue;
        if(m.role==='user') {
          const ps=parts.all(id);for(const p of ps.filter(p=>p.type==='compaction')) this.event('part:'+this.recordId(file,p.id),{timestamp:new Date(m.time.created).toISOString(),model:m.model?m.model.providerID+'/'+m.model.modelID:'unknown',kind:'compaction',message:'持久化 compaction part',source:file,session_id:row.session_id});
          continue;
        }
        if(m.role!=='assistant'||!m.providerID||!m.modelID||!Number.isFinite(m.time?.created))continue;
        const ps=parts.all(id).map(p=>({type:p.type,time:parse(p.time)})), key=row.session_id+':'+id,recordId=this.recordId(file,key);
        const stream=this.db.prepare('SELECT * FROM streams WHERE id=?').get(key), r=extract(m,ps,stream?.model===m.providerID+'/'+m.modelID?stream.ts:null);
        r.source=file;r.session_id=row.session_id;r.message_id=id;r.seed=false;r.http_status=Number(m.error?.data?.statusCode)||null;
        this.record(recordId,r);
        if(m.error) {
          this.event('message:'+recordId,{timestamp:r.timestamp,model:r.model,kind:'error',http_status:r.http_status,error_type:m.error.name??'SessionError',message:(m.error.name??'SessionError')+(r.http_status?' / HTTP '+r.http_status:''),source:file,session_id:row.session_id,message_id:id});
        }
      }
      this.saveState('db:'+file,{watermark:Math.max(maxM,maxP)});this.db.exec('COMMIT');} catch(e) {this.db.exec('ROLLBACK');throw e;}
      source.exec('COMMIT');
    } finally {source.close();}
  }
  scanDatabaseV2(file, source) {
    const stateId='dbv2:'+file, state=this.state(stateId), since=Math.max(0,(state.watermark??0)-2000);
    source.exec('BEGIN');
    let localTransaction=false;
    try {
      const selectAssistant=source.prepare(`SELECT id,session_id,time_created,time_updated,
        json_extract(data,'$.model.providerID') provider_id,json_extract(data,'$.model.id') model_id,
        json_extract(data,'$.tokens.input') tokens_input,json_extract(data,'$.tokens.output') tokens_output,
        json_extract(data,'$.tokens.reasoning') tokens_reasoning,json_extract(data,'$.tokens.cache.read') cache_read,
        json_extract(data,'$.tokens.cache.write') cache_write,json_extract(data,'$.time.created') message_created,
        json_extract(data,'$.time.completed') message_completed,json_extract(data,'$.finish') finish,
        json_extract(data,'$.cost') cost,json_extract(data,'$.agent') agent,
        json_extract(data,'$.error.name') error_name,json_extract(data,'$.error.data.statusCode') http_status
        FROM session_message WHERE type='assistant' AND time_updated>=? ORDER BY time_updated,seq`);
      const changed=selectAssistant.all(since), changedIds=new Set(changed.map(x=>x.id));
      for(const id of this.dirtyStreams) if(!changedIds.has(id)) {const row=source.prepare("SELECT id,session_id,time_created,time_updated,json_extract(data,'$.model.providerID') provider_id,json_extract(data,'$.model.id') model_id,json_extract(data,'$.tokens.input') tokens_input,json_extract(data,'$.tokens.output') tokens_output,json_extract(data,'$.tokens.reasoning') tokens_reasoning,json_extract(data,'$.tokens.cache.read') cache_read,json_extract(data,'$.tokens.cache.write') cache_write,json_extract(data,'$.time.created') message_created,json_extract(data,'$.time.completed') message_completed,json_extract(data,'$.finish') finish,json_extract(data,'$.cost') cost,json_extract(data,'$.agent') agent,json_extract(data,'$.error.name') error_name,json_extract(data,'$.error.data.statusCode') http_status FROM session_message WHERE type='assistant' AND id=?").get(id);if(row){changed.push(row);changedIds.add(id);}}
      const compactions=source.prepare(`SELECT id,session_id,time_created,json_extract(data,'$.model.providerID') provider_id,json_extract(data,'$.model.id') model_id FROM session_message WHERE type='compaction' AND time_updated>=?`).all(since);
      const maxUpdated=source.prepare('SELECT MAX(time_updated) n FROM session_message').get().n??0;
      const content=source.prepare(`SELECT json_extract(c.value,'$.type') type,json_extract(c.value,'$.time.created') start,json_extract(c.value,'$.time.completed') end FROM session_message m JOIN json_each(m.data,'$.content') c WHERE m.id=? AND m.session_id=? AND m.type='assistant'`);
      this.db.exec('BEGIN');localTransaction=true;
      for(const row of changed) {
        if(!row.provider_id||!row.model_id)continue;
        const model=row.provider_id+'/'+row.model_id,key=row.session_id+':'+row.id,recordId=this.recordId(file,key),contentParts=content.all(row.id,row.session_id);
        const outputParts=contentParts.filter(p=>p.type==='text'||p.type==='reasoning'),ordinals={text:0,reasoning:0},timed=[];
        const livePart=this.db.prepare('SELECT start_ms,end_ms FROM live_parts WHERE session_id=? AND message_id=? AND part_type=? AND ordinal=?');
        let usedLiveTiming=false;
        for(const part of outputParts){
          const ordinal=ordinals[part.type]++,live=livePart.get(this.liveSessionId(file,row.session_id),row.id,part.type,ordinal);
          const startPart=Number.isFinite(part.start)?part.start:live?.start_ms,endPart=Number.isFinite(part.end)?part.end:live?.end_ms;
          if(Number.isFinite(startPart)&&Number.isFinite(endPart)&&endPart>startPart){
            timed.push({start:startPart,end:endPart});
            if(!Number.isFinite(part.start)||!Number.isFinite(part.end))usedLiveTiming=true;
          }
        }
        const first=timed.length?Math.min(...timed.map(p=>p.start)):null,last=timed.length?Math.max(...timed.map(p=>p.end)):null;
        const inputBase=Number.isFinite(row.tokens_input)?row.tokens_input:null,cacheRead=Number.isFinite(row.cache_read)?row.cache_read:null,cacheWrite=Number.isFinite(row.cache_write)?row.cache_write:null;
        const input=inputBase==null&&cacheRead==null&&cacheWrite==null?null:(inputBase??0)+(cacheRead??0)+(cacheWrite??0);
        const output=(Number.isFinite(row.tokens_output)?row.tokens_output:0)+(Number.isFinite(row.tokens_reasoning)?row.tokens_reasoning:0);
        const complete=Number.isFinite(row.message_completed),steps=row.finish?1:0,toolCalls=contentParts.filter(p=>p.type==='tool').length,hasError=!!row.error_name||row.finish==='error';
        const valid=steps===1&&output>0&&complete&&outputParts.length>0&&timed.length>0&&first!=null&&last>first&&!hasError;
        const stream=this.db.prepare('SELECT * FROM streams WHERE id=?').get(key),created=Number.isFinite(row.message_created)?row.message_created:row.time_created;
        const start=Number.isFinite(stream?.ts)&&stream.ts<=first&&stream.ts>=created-1000?stream.ts:null;
        const duration=valid?(last-first)/1000:null,total=start!=null&&last>start?(last-start)/1000:null;
        const quality=valid?(timed.length===outputParts.length?(usedLiveTiming?'v2_live_event_part_timing':'v2_projected_part_timing'):'v2_partial_part_timing_estimate'):'incomplete_or_missing_timestamps';
        const r={timestamp:new Date(start??created).toISOString(),model,input_tokens:input,cache_read_tokens:cacheRead,cache_write_tokens:cacheWrite,output_tokens:Number.isFinite(row.tokens_output)?row.tokens_output:null,reasoning_tokens:Number.isFinite(row.tokens_reasoning)?row.tokens_reasoning:null,total_output_tokens:output,context_bucket:bucket(input),ttft:valid&&start!=null?(first-start)/1000:null,decode_duration:duration,decode_tps:duration?output/duration:null,total_duration:total,e2e_tps:total&&valid?output/total:null,e2e_scope:start!=null?'stream_to_last_part':'unavailable_without_stream',cost:Number.isFinite(row.cost)?row.cost:null,compaction:row.agent==='compaction',tool_calls:toolCalls,steps,complete,timed_parts:timed.length,output_parts:outputParts.length,quality,timing:start!=null?'log_stream':'no_stream_TTFT_unavailable'};
        r.source=file;r.session_id=row.session_id;r.message_id=row.id;r.seed=false;r.http_status=Number(row.http_status)||null;this.record(recordId,r);
        if(hasError)this.event('v2:message:'+recordId,{timestamp:r.timestamp,model,kind:'error',http_status:r.http_status,error_type:row.error_name??'AssistantError',message:(row.error_name??'AssistantError')+(r.http_status?' / HTTP '+r.http_status:''),source:file,session_id:row.session_id,message_id:row.id});
      }
      for(const row of compactions) {const model=row.provider_id&&row.model_id?row.provider_id+'/'+row.model_id:'unknown';this.event('v2:compaction:'+this.recordId(file,row.id),{timestamp:new Date(row.time_created).toISOString(),model,kind:'compaction',message:'OpenCode V2 compaction',source:file,session_id:row.session_id});}
      this.saveState(stateId,{watermark:maxUpdated});this.db.exec('COMMIT');localTransaction=false;source.exec('COMMIT');
    } catch(e) {if(localTransaction)this.db.exec('ROLLBACK');try{source.exec('ROLLBACK')}catch{}throw e;}
  }  scan() {
    if(this.scanPromise)return this.scanPromise;
    this.scanPromise=this.scanAll().catch(e=>{
      this.warnings.push('Scan failed: '+e.message);
      this.lastScan=new Date().toISOString();
      this.scanMs=0;
    }).finally(()=>{this.scanPromise=null;});
    return this.scanPromise;
  }
  async scanAll() {
    const begin=Date.now();this.warnings=[];
    const remoteSources=this.config.sshDatabases??[];
    const synchronized=await Promise.all(remoteSources.map(async source=>{
      const id=sourceId(source.id??source.host);
      const snapshot=path.join(this.root,'data','remote-sources',id+'.sqlite');
      fs.rmSync(snapshot,{force:true});
      const previous=this.state('remote-source:'+id).signature??null;
      try {
        const info=await syncRemoteDatabase({...source,id},snapshot,previous);
        const old=this.remoteStatus.get(id)??{};
        this.remoteStatus.set(id,{...old,id,host:source.host,connected:true,lastCheck:new Date().toISOString(),records:info.records??old.records??0,changed:info.changed});
        return {source:{...source,id},snapshot,info,error:null};
      } catch(error) {
        const old=this.remoteStatus.get(id)??{};
        this.remoteStatus.set(id,{...old,id,host:source.host,connected:false,lastCheck:new Date().toISOString(),error:error.message});
        this.warnings.push('SSH '+id+': '+error.message);
        return {source:{...source,id},snapshot,info:null,error};
      }
    }));
    for(const dir of this.config.logDirectories)try{this.scanLogs(dir)}catch(e){this.warnings.push('Log read failed '+dir+': '+e.message);}
    const pending=synchronized.filter(item=>!item.error&&item.info.changed);
    const files=[...this.config.databases,...pending.map(item=>item.snapshot)];
    if(!this.config.databases.length&&!remoteSources.length)this.warnings.push('No OpenCode database found; configure its path in config.json.');
    try {
      for(const file of files)try {
        this.scanDatabase(file);
        const remote=pending.find(item=>item.snapshot===file);
        if(remote) {
          this.saveState('remote-source:'+remote.source.id,{signature:remote.info.signature});
          const status=this.remoteStatus.get(remote.source.id);
          if(status)status.lastIngested=new Date().toISOString();
        }
      }catch(e){this.warnings.push('Database read failed '+file+': '+e.message);}
    } finally {
      for(const item of synchronized)fs.rmSync(item.snapshot,{force:true});
      this.dirtyStreams.clear();
      this.lastScan=new Date().toISOString();this.scanMs=Date.now()-begin;
    }
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
    const timed=visible.filter(x=>x.decode_tps!=null), valid=timed.filter(x=>!x.tps_outlier), recent=valid.slice(-20), allEvents=this.db.prepare('SELECT data FROM events ORDER BY ts,id').all().map(x=>parse(x.data)).filter(x=>(model==='all'||x.model===model)&&included(x));
    // Session errors are preferred to matching log events for the same message/status.
    const canonical=allEvents.filter(x=>!x.id.startsWith('log:')||!allEvents.some(y=>y.id.startsWith('message:')&&y.session_id===x.session_id&&y.message_id===x.message_id&&y.http_status===x.http_status));
    const errors=canonical.filter(x=>x.kind==='error');
    const remoteTimingWarnings=(this.config.sshDatabases??[]).filter(source=>{const status=this.remoteStatus.get(sourceId(source.id??source.host));return status?.eventStream==='offline'&&(status.records??0)>0;}).map(source=>'SSH event timing is disconnected: '+sourceId(source.id??source.host)+'; new remote timing may be incomplete');
    return {models,selectedModel:model,updated:this.lastScan,scan_ms:this.scanMs,warnings:[...this.warnings,...remoteTimingWarnings,...(this.eventStreamStatus==='offline'?['OpenCode 实时事件流未连接，文本片段计时不完整']:[])],sources:{databases:this.config.databases,logs:this.config.logDirectories,sshDatabases:(this.config.sshDatabases??[]).map(source=>{const id=sourceId(source.id??source.host),status=this.remoteStatus.get(id);return {id,host:source.host,connected:status?.connected??false,eventStream:status?.eventStream??'connecting',records:status?.records??null,lastCheck:status?.lastCheck??null,lastIngested:status?.lastIngested??null,error:status?.error??null};})},baselines:bases.filter(x=>model==='all'||x.model===model),summary:{requests:visible.length,completed:visible.filter(x=>x.complete).length,valid_timing:timed.length,included_timing:valid.length,excluded_outliers:timed.length-valid.length,latest_tps:valid.at(-1)?.decode_tps??null,median20_tps:median(recent.map(x=>x.decode_tps)),baseline:median(recent.map(x=>x.baseline)),relative:median(recent.map(x=>x.normalized_tps)),ttft:median(recent.map(x=>x.ttft)),input_tokens:visible.reduce((s,x)=>s+(x.input_tokens??0),0),output_tokens:visible.reduce((s,x)=>s+(x.total_output_tokens??0),0),cache_read_tokens:visible.reduce((s,x)=>s+(x.cache_read_tokens??0),0),cost:visible.reduce((s,x)=>s+(x.cost??0),0),http429:errors.filter(x=>x.http_status===429).length,errors:errors.length,last_error:errors.at(-1)??null,compactions:canonical.filter(x=>x.kind==='compaction').length,unknown_model_errors:this.db.prepare("SELECT count(*) n FROM events WHERE model='unknown'").get().n},diagnostics,rows:visible,events:canonical};
  }
}
