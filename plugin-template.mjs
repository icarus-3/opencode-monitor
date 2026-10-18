import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// Installer replaces this with an absolute path; no shell or process polling.
const root=__MONITOR_ROOT__;
const timingTypes=new Set(['session.text.started','session.text.ended','session.reasoning.started','session.reasoning.ended']);
async function send(endpoint,event){
  try{
    const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
    const token=fs.readFileSync(path.join(root,'data','control.token'),'utf8').trim();
    await fetch('http://127.0.0.1:'+cfg.port+endpoint,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(event),signal:AbortSignal.timeout(1000)});
  }catch{}
}
function forward(event){
  if(!timingTypes.has(event?.type))return;
  const d=event.data??event.properties??{};
  // Project before transport as well as before persistence.
  void send('/api/events',{type:event.type,created:event.created,data:{sessionID:d.sessionID,assistantMessageID:d.assistantMessageID,ordinal:d.ordinal}});
}
const launch=async()=>{
  if(process.platform!=='win32')return;
  try{
    fs.mkdirSync(path.join(root,'data'),{recursive:true});
    fs.appendFileSync(path.join(root,'data','plugin-starts.jsonl'),JSON.stringify({timestamp:new Date().toISOString(),event:'plugin_setup'})+'\n');
    // Run an immutable copy so an active startup subscription cannot lock update files.
    const bytes=fs.readFileSync(path.join(root,'OpenCodeWindowHook.exe'));
    const bridgeDir=path.join(root,'data','window-hook');fs.mkdirSync(bridgeDir,{recursive:true});
    const bridgeExe=path.join(bridgeDir,'OpenCodeWindowHook-'+crypto.createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.exe');
    try{fs.writeFileSync(bridgeExe,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
    const bridge=spawn(bridgeExe,['--parent',String(process.pid),'--root',root],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});
    bridge.on('error',e=>fs.appendFileSync(path.join(root,'data','plugin-error.log'),new Date().toISOString()+' desktop hook: '+e.message+'\n'));bridge.unref();
    const child=spawn(path.join(root,'MonitorTray.exe'),[],{cwd:root,windowsHide:true,detached:true,stdio:'ignore'});
    child.on('error',e=>{fs.appendFileSync(path.join(root,'data','plugin-error.log'),new Date().toISOString()+' '+e.message+'\n');});
    child.unref();
    const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
    for(let i=0;i<40;i++){
      try{const h=await(await fetch('http://127.0.0.1:'+cfg.port+'/api/health',{signal:AbortSignal.timeout(200)})).json();if(h.app==='opencode-monitor')break;}catch{}
      await new Promise(r=>setTimeout(r,125));
    }
  }catch(e){fs.appendFileSync(path.join(root,'data','plugin-error.log'),e.message+'\n');}
};
export default {
  id:'opencode-monitor',
  setup:async(ctx)=>{
    await launch();void send('/api/plugin-connected',{});
    const controller=new AbortController();
    void(async()=>{try{for await(const event of ctx.event.subscribe({signal:controller.signal}))forward(event);}catch{}})();
    return ()=>controller.abort();
  },
  server:async()=>{await launch();void send('/api/plugin-connected',{});return {event:async({event})=>forward(event)};}
};
