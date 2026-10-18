import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,spawnSync} from 'node:child_process';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
test('installed OpenCode V1 and desktop V2 load the same plugin without wrapper scripts',{skip:!process.env.TEST_V1||!process.env.TEST_V2,timeout:60000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-cli-')),bundle=path.join(dir,'monitor'),config=path.join(dir,'config','opencode');fs.mkdirSync(bundle,{recursive:true});fs.mkdirSync(path.join(config,'plugins'),{recursive:true});
 for(const f of fs.readdirSync('.').filter(x=>/\.(mjs|exe|json)$/.test(x)&&!x.includes('template')))fs.copyFileSync(f,path.join(bundle,f));fs.cpSync('public',path.join(bundle,'public'),{recursive:true});
 fs.writeFileSync(path.join(bundle,'config.json'),JSON.stringify({port:18765,pollSeconds:5,defaultModel:'all',databases:[],logDirectories:[],sshDatabases:[]}));
 fs.writeFileSync(path.join(config,'plugins','opencode-monitor.js'),fs.readFileSync('plugin-template.mjs','utf8').replace('__MONITOR_ROOT__',JSON.stringify(bundle.replaceAll('\\','/'))));
 let tray;const kill=c=>{if(c?.pid)spawnSync('taskkill.exe',['/PID',String(c.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});};
 const env={...process.env,XDG_CONFIG_HOME:path.dirname(config),XDG_DATA_HOME:path.join(dir,'data'),XDG_CACHE_HOME:path.join(dir,'cache'),XDG_STATE_HOME:path.join(dir,'state'),OPENCODE_CONFIG:''};
 const v1=spawn(process.env.TEST_V1,['debug','wait'],{cwd:dir,env,windowsHide:true,stdio:'ignore'});
 const log=path.join(bundle,'data','plugin-starts.jsonl');
 try{
 for(let i=0;i<150&&!fs.existsSync(log);i++)await pause(100);
 assert.ok(fs.existsSync(log),'V1 plugin initialization');
 for(let i=0;i<100&&!fs.existsSync(path.join(bundle,'data','tray.pid'));i++)await pause(100);
 assert.ok(fs.existsSync(path.join(bundle,'data','tray.pid')));tray=Number(fs.readFileSync(path.join(bundle,'data','tray.pid')));
 v1.kill();
 const token=fs.readFileSync(path.join(bundle,'data','control.token'),'utf8');await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});await pause(1800);
 const v2=spawn(process.env.TEST_V2,['serve','--hostname','127.0.0.1','--port','18766'],{cwd:dir,env:{...env,XDG_DATA_HOME:path.join(dir,'data-v2')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let secret='';const consume=b=>{secret+=b.toString();};v2.stdout.on('data',consume);v2.stderr.on('data',consume);
 try{
 let password;for(let i=0;i<150;i++){password=secret.match(/server password (\S+)/)?.[1];if(password)break;await pause(100);}assert.ok(password,'V2 standalone ready');
 let plugin;
 for(let i=0;i<100;i++){
   const response=await fetch('http://127.0.0.1:18766/api/plugin',{headers:{Authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64')}});const d=await response.json();plugin=d.data.find(x=>x.id==='opencode-monitor');if(plugin?.state.status==='active')break;await pause(100);
 }
 assert.equal(plugin?.state.status,'active');
 for(let i=0;i<100&&!fs.existsSync(path.join(bundle,'data','tray.pid'));i++)await pause(100);
 const health=await(await fetch('http://127.0.0.1:18765/api/health')).json();assert.equal(health.app,'opencode-monitor');
 const t=fs.readFileSync(path.join(bundle,'data','control.token'),'utf8');await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+t}});await pause(1800);
 }finally{kill(v2);}
 }finally{
   try{const health=await(await fetch('http://127.0.0.1:18765/api/health')).json();if(path.resolve(health.root)===path.resolve(bundle)){const t=fs.readFileSync(path.join(bundle,'data','control.token'),'utf8');await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+t}});}}catch{}
   for(let i=0;i<80&&fs.existsSync(path.join(bundle,'data','tray.pid'));i++)await pause(100);
   kill(v1);
 }
});
