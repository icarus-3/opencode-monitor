import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';import {execFileSync} from 'node:child_process';
import {Store} from './store.mjs';import {importHistory,importSeed} from './legacy.mjs';
import {projectMessage} from './telemetry.mjs';import {syncRemoteDatabase} from './remote.mjs';import {logScript} from './remote-logs.mjs';
import {analyze,tokenUsageBuckets} from './metrics.mjs';
const cfg={databases:[],logDirectories:[],defaultModel:'all',rollingWindow:5};
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'monitor-regression-'));
const record=(model='p/a',extra={})=>({timestamp:new Date(1000).toISOString(),model,input_tokens:100,total_output_tokens:100,decode_tps:10,seed:false,...extra});
test('default all includes every model and export pagination keeps all rows',()=>{
 const s=new Store(root(),cfg);try{
 s.record('a',record());s.record('b',record('p/b'));assert.equal(s.dashboard().rows.length,2);
 const page=s.exportData('history',{limit:1});const next=s.exportData('history',{after:page.next,snapshot:page.snapshot,limit:1});assert.equal(page.items.length+next.items.length,2);assert.equal(next.done,true);
 assert.throws(()=>s.exportData('history',{limit:'-1'}));}finally{s.db.close();}
});
test('same id updates archive history and preserve benchmark-only fields',()=>{
 const s=new Store(root(),cfg);try{s.record('a',record('p/a',{seed:true,process_duration:9,benchmark_process_e2e_tps:11}));s.record('a',record('p/a',{decode_tps:99}));assert.equal(s.dashboard().rows[0].benchmark_process_e2e_tps,11);assert.equal(s.dashboard().rows[0].decode_tps,10);assert.ok(s.exportData('versions').items.length>=1);}finally{s.db.close();}
});
function v2Fixture(dir){const file=path.join(dir,'source.sqlite'),db=new DatabaseSync(file);db.exec('CREATE TABLE session_v2(id TEXT PRIMARY KEY);CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT,PRIMARY KEY(session_id,id))');const m={model:{providerID:'p',id:'a'},time:{created:1000,completed:6000},tokens:{input:100,output:1000},finish:'stop',content:[{type:'text',text:'SECRET BODY'}]};const insert=db.prepare('INSERT INTO session_message VALUES(?,?,?,?,?,?,?)');insert.run('m1','s','assistant',1,1000,1000,JSON.stringify(m));insert.run('m2','s','assistant',2,10000,10000,JSON.stringify({...m,time:{created:10000,completed:15000}}));return {db,file,m};}
test('late and out-of-order timing recomputes a message behind the watermark, duplicates are idempotent',async()=>{
 const dir=root(),{db,file}=v2Fixture(dir),s=new Store(dir,{...cfg,databases:[file]});try{
 await s.scan();assert.equal(s.dashboard().rows[0].decode_tps,null);
 for(const [type,created]of [['session.text.ended',6000],['session.text.started',2000],['session.text.started',2000]])s.captureEvent({type,created,data:{sessionID:'s',assistantMessageID:'m1',ordinal:0,text:'SECRET BODY'}});
 await s.scan();assert.equal(s.dashboard().rows[0].decode_tps,250);assert.equal(s.db.prepare('SELECT count(*) n FROM live_parts').get().n,1);
 assert.ok(!JSON.stringify(s.exportData('telemetry')).includes('SECRET BODY'));assert.equal(s.dashboard().rows[0].ttft,null);
 }finally{s.db.close();db.close();}
});
test('V2 and local log errors canonicalize while raw representations remain available',()=>{
 const s=new Store(root(),cfg);try{const e={timestamp:new Date(1000).toISOString(),model:'p/a',kind:'error',http_status:429,session_id:'s',message_id:'m'};s.event('log:x',e);s.event('v2:message:s:m',e);assert.equal(s.dashboard().summary.http429,1);assert.equal(s.db.prepare('SELECT count(*) n FROM events').get().n,2);}finally{s.db.close();}
});
test('malformed timing events cannot create remote undefined identities',()=>{const s=new Store(root(),cfg);try{s.captureEvent({type:'session.text.started',created:1000,data:{assistantMessageID:'m',ordinal:0}},'remote');assert.equal(s.db.prepare('SELECT count(*) n FROM live_parts').get().n,0);}finally{s.db.close();}});
test('in-place legacy migration backs up SQLite and preserves opaque legacy fields',()=>{
 const dir=root();fs.mkdirSync(path.join(dir,'data'));const f=path.join(dir,'data','monitor.sqlite'),old=new DatabaseSync(f);old.exec('CREATE TABLE records(id TEXT PRIMARY KEY,ts TEXT NOT NULL,model TEXT NOT NULL,data TEXT NOT NULL)');old.prepare('INSERT INTO records VALUES(?,?,?,?)').run('old',record().timestamp,'p/a',JSON.stringify(record('p/a',{unique_benchmark_field:42})));old.close();
 const s=new Store(dir,cfg);try{assert.equal(s.dashboard().rows[0].unique_benchmark_field,42);const backup=fs.readdirSync(path.join(dir,'data')).find(x=>x.startsWith('backup-before'));assert.ok(backup);assert.equal(s.exportData('diagnostics').integrity,'ok');}finally{s.db.close();}
});
test('explicit history import backs up source and destination, collision loses no fields',()=>{
 const a=new Store(root(),cfg),b=new Store(root(),cfg);try{a.record('r',record('p/a',{legacy_extra:42}));b.record('r',record('p/a',{new_extra:43}));const backup=importHistory(b,path.join(a.root,'data','monitor.sqlite'));assert.ok(fs.existsSync(backup));assert.equal(b.dashboard().rows[0].legacy_extra,42);assert.equal(b.dashboard().rows[0].new_extra,43);assert.equal(a.dashboard().rows[0].legacy_extra,42);}finally{a.db.close();b.db.close();}
});
test('seed import is opt-in data, restores frozen baselines, repeats safely',()=>{
 const dir=root(),seed=path.join(dir,'seed');fs.mkdirSync(seed);fs.writeFileSync(path.join(seed,'identities.json'),JSON.stringify({a:'message'}));fs.writeFileSync(path.join(seed,'measurements.json'),JSON.stringify([{id:'a',sessionID:'s',startUTC:new Date(1000).toISOString(),assistant_models:'p/a',target_input:0,input_tokens:10,total_output_tokens:100,decode_tps_est:20,request_total_est_s:5,process_total_s:6,e2e_output_tps:16}]));const s=new Store(dir,cfg);try{importSeed(s,seed);assert.equal(s.dashboard().rows.length,1);assert.equal(s.dashboard().baselines.length,1);assert.equal(s.dashboard().rows[0].process_duration,6);}finally{s.db.close();}
});
test('privacy projection rejects message, tool, credential and nested metadata payloads',()=>{const p=projectMessage({role:'assistant',summary:'SECRET',tokens:{input:{secret:'SECRET'}},content:[{type:'tool',input:'SECRET',output:'SECRET'}],error:{name:'APIError',data:{statusCode:429,responseBody:'SECRET'}},apiKey:'SECRET'});assert.ok(!JSON.stringify(p).includes('SECRET'));assert.equal(p.error.data.statusCode,429);});
test('outlier filtering and frontend history limits do not discard tokens or source records',()=>{
 const rows=Array.from({length:141},(_,i)=>record('p/a',{timestamp:new Date(1000+i*1000).toISOString(),decode_tps:i===140?10000:100}));
 const result=analyze(rows,[]);assert.equal(result.rows.length,141);assert.equal(result.rows.at(-1).tps_outlier,true);assert.equal(result.rows.at(-1).decode_tps,10000);assert.equal(tokenUsageBuckets(result.rows).total_tokens,141*200);
});
const python=process.env.TEST_PYTHON;
test('SSH projected content hash detects old-row changes without changing count/update/seq; no body transferred',{skip:!python},async()=>{
 const dir=root(),{db,file,m}=v2Fixture(dir),target=path.join(dir,'remote.sqlite');
 const runner=async(host,command)=>{const encoded=command.match(/b64decode\('([^']+)'\)/)[1];const out=execFileSync(python,['-c',Buffer.from(encoded,'base64').toString()],{encoding:null,stdio:['ignore','pipe','pipe']});return {meta:runner.meta,compressed:out};};
 // execFileSync does not expose successful stderr; use spawnSync for the same remote protocol.
 const {spawnSync}=await import('node:child_process');
 const local=async(host,command)=>{const encoded=command.match(/b64decode\('([^']+)'\)/)[1],r=spawnSync(python,['-c',Buffer.from(encoded,'base64').toString()],{maxBuffer:32*1024*1024});assert.equal(r.status,0,r.stderr.toString());return {meta:JSON.parse(r.stderr.toString().trim().slice('OPENCODE_MONITOR_META '.length)),compressed:r.stdout};};
 try{const first=await syncRemoteDatabase({host:'fixture',path:file},target,null,local);assert.equal(first.changed,true);const d=new DatabaseSync(target,{readOnly:true});assert.ok(!JSON.stringify(d.prepare('SELECT data FROM session_message').all()).includes('SECRET BODY'));d.close();const same=await syncRemoteDatabase({host:'fixture',path:file},target,first.signature,local);assert.equal(same.changed,false);db.prepare("UPDATE session_message SET data=? WHERE id='m1'").run(JSON.stringify({...m,tokens:{input:123,output:1000}}));const second=await syncRemoteDatabase({host:'fixture',path:file},target,first.signature,local);assert.equal(second.changed,true);assert.notEqual(first.signature,second.signature);}finally{db.close();}
});
test('SSH log projection retains stream/errors/compaction and strips secrets',{skip:!python},()=>{const dir=root();fs.writeFileSync(path.join(dir,'a.log'),'timestamp=2026-10-18T00:00:00Z level=INFO run=x session.id=s message=process messageID=m\ntimestamp=2026-10-18T00:00:01Z level=INFO run=x session.id=s message=stream providerID=p modelID=a\ntimestamp=2026-10-18T00:00:02Z level=ERROR run=x session.id=s statusCode=429 error=RateLimitError secret=SECRET\n');const out=execFileSync(python,['-c',logScript([dir])],{encoding:'utf8'});assert.ok(!out.includes('SECRET'));const items=JSON.parse(out);assert.equal(items.length,2);assert.equal(items[0].kind,'stream');assert.equal(items[1].http_status,429);});
