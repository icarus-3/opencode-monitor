import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {extract,analyze,bucket} from './metrics.mjs';import {Store} from './store.mjs';
import {discover} from './discover.mjs';
const msg=(time=1000)=>({role:'assistant',providerID:'p',modelID:'m',time:{created:time,completed:time+5000},tokens:{input:100,output:900,reasoning:100,cache:{read:200,write:10}},cost:0});
const parts=[{type:'text',time:{start:2000,end:6000}},{type:'step-finish'}];
test('metrics use reasoning + text, summed input, stream timestamp; missing start stays null',()=>{
 const r=extract(msg(),parts,1500);assert.equal(r.input_tokens,310);assert.equal(r.total_output_tokens,1000);assert.equal(r.ttft,.5);assert.equal(r.decode_tps,250);assert.equal(r.e2e_tps,1000/4.5);assert.equal(extract(msg(),parts).ttft,null);assert.equal(extract(msg(),[...parts,{type:'step-finish'}],1500).decode_tps,null);
 assert.equal(extract(msg(),[...parts,{type:'reasoning'}],1500).decode_tps,null);assert.equal(bucket(49999),'0K');assert.equal(bucket(50000),'100K');assert.equal(bucket(700000),'900K+');
});
test('no bundled personal history is imported by default',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-empty-'));const s=new Store(temp,{databases:[],logDirectories:[],defaultModel:'all',rollingWindow:5});
 const d=s.dashboard();assert.equal(d.rows.length,0);assert.equal(d.summary.input_tokens,0);assert.equal(d.summary.output_tokens,0);assert.equal(d.baselines.length,0);assert.equal(d.selectedModel,'all');s.db.close();
});test('incremental source ingestion: completion updates, deduplication, real 429 vs timestamp digits, rotation',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-source-')),file=path.join(root,'source.db'),logs=path.join(root,'logs');fs.mkdirSync(logs);
 const db=new DatabaseSync(file);db.exec('CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,session_id TEXT,time_created INTEGER,time_updated INTEGER,data TEXT);');
 const m=msg();delete m.time.completed;db.prepare('INSERT INTO message VALUES(?,?,?,?,?)').run('m','s',1000,1000,JSON.stringify(m));
 fs.writeFileSync(path.join(logs,'opencode.log'),'timestamp=2026-10-17T01:00:00.429Z level=ERROR run=r message=failed error.error=TimeoutError\ntimestamp=2026-10-17T01:00:01Z level=INFO run=r message=process session.id=s messageID=m\ntimestamp=2026-10-17T01:00:02Z level=INFO run=r message=stream providerID=p modelID=m session.id=s\ntimestamp=2026-10-17T01:00:03Z level=ERROR run=r session.id=s statusCode=429 error.error=RateLimitError\n');
 const s=new Store(root,{databases:[file],logDirectories:[logs],defaultModel:'p/m',rollingWindow:5});s.scan();let d=s.dashboard({model:'all'});assert.equal(d.rows.length,1);assert.equal(d.rows[0].decode_tps,null);assert.equal(d.summary.http429,1);assert.equal(d.summary.errors,2);s.scan();assert.equal(s.dashboard({model:'all'}).summary.errors,2);
 db.prepare('UPDATE message SET data=?,time_updated=5000 WHERE id=?').run(JSON.stringify(msg()),'m');for(let i=0;i<parts.length;i++)db.prepare('INSERT INTO part VALUES(?,?,?,?,?,?)').run('p'+i,'m','s',2000,6000,JSON.stringify(parts[i]));s.scan();assert.equal(s.dashboard().rows[0].decode_tps,250);assert.equal(s.dashboard().rows.length,1);
 fs.writeFileSync(path.join(logs,'opencode.log'),'timestamp=2026-10-17T02:00:00Z level=ERROR message=error httpStatus=503\n');s.scan();assert.equal(s.dashboard({model:'all'}).summary.errors,3);s.db.close();db.close();
});
test('conservative sustained decrease detector: isolated dip vs prolonged drop',()=>{
 const bases=[{model:'p/m',bucket:'0K',decode_tps:250,ttft:1}];const rows=Array.from({length:20},(_,i)=>({model:'p/m',timestamp:new Date(1792240000000+i*60000).toISOString(),context_bucket:'0K',decode_tps:250*(i<10?1:.5),total_output_tokens:1000,input_tokens:1000,steps:1,seed:false}));
 assert.equal(analyze(rows,bases).diagnostics[0].state,'Likely throttling');assert.equal(analyze(rows.slice(0,11),bases).diagnostics[0].state,'No throttling');
 assert.equal(analyze(rows.map(x=>({...x,tool_calls:1})),bases).diagnostics[0].post_seed_samples,0);
});
test('automatic XDG discovery and explicit paths; empty history stays empty',()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-discovery-')),xdg=path.join(temp,'xdg'),source=path.join(xdg,'opencode');fs.mkdirSync(path.join(source,'log'),{recursive:true});fs.writeFileSync(path.join(source,'opencode.db'),'');
 const found=discover({databases:['auto'],logDirectories:['auto']},{XDG_DATA_HOME:xdg},path.join(temp,'home'));assert.ok(found.databases.includes(path.join(source,'opencode.db')));assert.ok(found.logDirectories.includes(path.join(source,'log')));
 const manual=discover({databases:[path.join(temp,'custom.db')],logDirectories:[]},{},temp);assert.deepEqual(manual.databases,[path.join(temp,'custom.db')]);assert.deepEqual(manual.logDirectories,[]);
 const s=new Store(temp,{databases:[],logDirectories:[],defaultModel:'all',rollingWindow:5});const d=s.dashboard();assert.equal(d.rows.length,0);assert.equal(d.baselines.length,0);assert.equal(d.selectedModel,'all');s.db.close();
});
