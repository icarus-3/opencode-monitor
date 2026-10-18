import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {median} from './metrics.mjs';
import crypto from 'node:crypto';
export function importSeed(store,dir){
  if(!fs.existsSync(path.join(dir,'measurements.json')))return;
  const rows=JSON.parse(fs.readFileSync(path.join(dir,'measurements.json'),'utf8'));
  const ids=JSON.parse(fs.readFileSync(path.join(dir,'identities.json'),'utf8'));
  for(const x of rows){
    const r={timestamp:x.startUTC,model:x.assistant_models,input_tokens:x.input_tokens,cache_read_tokens:x.cache_read_tokens,cache_write_tokens:x.cache_write_tokens,output_tokens:x.text_output_tokens,reasoning_tokens:x.reasoning_tokens,total_output_tokens:x.total_output_tokens,context_bucket:x.target_input===0?'0K':x.target_input===900000?'900K+':x.target_input/1000+'K',ttft:x.first_token_delay_est_s,decode_duration:x.decode_span_est_s,decode_tps:x.decode_tps_est,total_duration:x.request_total_est_s,process_duration:x.process_total_s,e2e_tps:x.total_output_tokens/x.request_total_est_s,benchmark_process_e2e_tps:x.e2e_output_tps,cost:x.cost,compaction:x.compaction,tool_calls:x.tool_calls,steps:1,complete:true,quality:'legacy_benchmark_estimate',timing:'log_stream',seed:true,source:'benchmark measurements.json',session_id:x.sessionID};
    const id=x.sessionID+':'+ids[x.id];
    const original=Object.fromEntries(Object.entries(x).filter(([k,v])=>typeof v==='number'||typeof v==='boolean'||['id','startUTC','sessionID','assistant_models','finish'].includes(k)));
    const provenance=path.join(dir,'provenance.json');
    store.raw(id,'legacy_seed',dir,{measurement:original,message_id:ids[x.id],provenance_sha256:fs.existsSync(provenance)?crypto.createHash('sha256').update(fs.readFileSync(provenance)).digest('hex'):null},'legacy_estimate');
    const old=store.db.prepare('SELECT data FROM records WHERE id=?').get(id);
    const existing=old?JSON.parse(old.data):null;
    store.record(id,existing?.seed?{...r,...existing}:r);
  }
  for(const model of new Set(rows.map(x=>x.assistant_models)))for(const target of new Set(rows.map(x=>x.target_input))){
    const g=rows.filter(x=>x.assistant_models===model&&x.target_input===target),b={model,bucket:target===0?'0K':target===900000?'900K+':target/1000+'K',decode_tps:median(g.map(x=>x.decode_tps_est)),ttft:median(g.map(x=>x.first_token_delay_est_s)),n:g.length,source:'frozen benchmark seed'};
    store.db.prepare('INSERT OR IGNORE INTO baselines VALUES(?,?,?)').run(model,b.bucket,JSON.stringify(b));
  }
}
export function importHistory(store,file){
  if(path.resolve(file)===path.resolve(store.root,'data','monitor.sqlite'))throw Error('Cannot import database into itself');
  const source=new DatabaseSync(file,{readOnly:true});
  try{
    store.db.exec("VACUUM INTO '"+path.join(store.root,'data','destination-before-import-'+Date.now()+'.sqlite').replaceAll("'","''")+"'");
    const backup=path.join(store.root,'data','import-backup-'+Date.now()+'.sqlite');
    source.exec("VACUUM INTO '"+backup.replaceAll("'","''")+"'");
    store.db.exec('BEGIN');
    try{
      for(const row of source.prepare('SELECT id,data FROM records').all()){
        const r=JSON.parse(row.data);store.archive(row.id,r);
        const old=store.db.prepare('SELECT data FROM records WHERE id=?').get(row.id);
        store.record(row.id,old?{...r,...JSON.parse(old.data),...(r.seed?r:{})}:r);
      }
      for(const table of ['events','baselines','streams']){
        const columns=source.prepare('PRAGMA table_info('+table+')').all().map(c=>c.name);
        if(!columns.length)continue;
        const insert=store.db.prepare('INSERT OR IGNORE INTO '+table+'('+columns.join(',')+') VALUES('+columns.map(()=>'?').join(',')+')');
        for(const r of source.prepare('SELECT * FROM '+table).all())insert.run(...columns.map(c=>r[c]));
      }
      store.db.exec('COMMIT');return backup;
    }catch(e){store.db.exec('ROLLBACK');throw e;}
  }finally{source.close();}
}
