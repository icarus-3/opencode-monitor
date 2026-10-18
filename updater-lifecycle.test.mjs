import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import crypto from 'node:crypto';import {spawn,execFileSync} from 'node:child_process';import {Store} from './store.mjs';import {stageLocalPackage,launchUpdate} from './updater.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function copyBundle(target){fs.mkdirSync(target,{recursive:true});for(const file of fs.readdirSync('.',{withFileTypes:true}).filter(x=>x.isFile()&&x.name!=='config.json'))fs.copyFileSync(file.name,path.join(target,file.name));fs.cpSync('public',path.join(target,'public'),{recursive:true});}
function manifest(root){const files={};for(const base of ['', 'public'])for(const entry of fs.readdirSync(path.join(root,base),{withFileTypes:true})){if(!entry.isFile()||entry.name==='update-manifest.json')continue;const relative=base?base+'/'+entry.name:entry.name;files[relative]=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,relative))).digest('hex');}fs.writeFileSync(path.join(root,'update-manifest.json'),JSON.stringify({schema:1,version:JSON.parse(fs.readFileSync('package.json')).version,files}));}
test('real Windows update replaces files, backs up SQLite, preserves config/history and restarts one tray',{skip:process.platform!=='win32',timeout:80000},async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-update-e2e-')),target=path.join(parent,'installed'),packageRoot=path.join(parent,'package');copyBundle(target);copyBundle(packageRoot);manifest(packageRoot);
 fs.unlinkSync(path.join(target,'UpdateLauncher.exe')); // rc.1 had no native update launcher.
 const p=JSON.parse(fs.readFileSync(path.join(target,'package.json')));p.version='0.0.0';fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(p));
 const config={port:18765,pollSeconds:5,databases:[],logDirectories:[],sshDatabases:[],defaultModel:'all',user_setting:'preserve-me'};fs.writeFileSync(path.join(target,'config.json'),JSON.stringify(config));
 const hook=path.join(parent,'opencode-monitor.js');fs.mkdirSync(path.join(target,'data'),{recursive:true});fs.writeFileSync(hook,'const root='+JSON.stringify(target.replaceAll('\\','/'))+';\n// previous hook');fs.writeFileSync(path.join(target,'data','installed-plugins.json'),JSON.stringify([hook]));
 const s=new Store(target,config);s.record('retained',{id:'retained',timestamp:new Date(1000).toISOString(),model:'p/A',input_tokens:100,custom_metric:42});s.db.close();
 const initial=spawn(path.join(target,'MonitorTray.exe'),[],{cwd:target,windowsHide:true,stdio:'ignore'});
 try{
   for(let i=0;i<150&&!fs.existsSync(path.join(target,'data','tray.pid'));i++)await sleep(100);
   assert.ok(fs.existsSync(path.join(target,'data','tray.pid')));
   assert.equal((await(await fetch('http://127.0.0.1:18765/api/health')).json()).version,'0.0.0');
   // The initiating CLI must exit before replacement, as it does in a real local update.
   const output=execFileSync(process.execPath,[path.join(packageRoot,'update-local.mjs'),target],{windowsHide:true,encoding:'utf8'});
   const result={backup:output.split('backup: ')[1].trim()};
   let status;for(let i=0;i<300;i++){try{status=JSON.parse(fs.readFileSync(path.join(target,'data','update-status.json'),'utf8').replace(/^\uFEFF/,''));if(['installed','failed'].includes(status.state))break;}catch{}await sleep(100);}
   assert.equal(status?.state,'installed',JSON.stringify(status));
   assert.equal((await(await fetch('http://127.0.0.1:18765/api/health')).json()).version,JSON.parse(fs.readFileSync('package.json')).version);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target,'config.json'))),config);assert.ok(fs.existsSync(path.join(result.backup,'monitor.sqlite')));
   assert.ok(fs.readFileSync(hook,'utf8').includes('OpenCodeWindowHook'));assert.ok(fs.existsSync(path.join(result.backup,'hooks','plugin-hooks.json')));
   const next=new Store(target,config);try{assert.equal(next.dashboard().rows[0].custom_metric,42);assert.equal(next.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');}finally{next.db.close();}
 }finally{
   try{const token=fs.readFileSync(path.join(target,'data','control.token'),'utf8').trim();await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});}catch{}
   for(let i=0;i<80&&fs.existsSync(path.join(target,'data','tray.pid'));i++)await sleep(100);if(initial.exitCode===null)initial.kill();
 }
});
test('failed startup rolls back program files and restarts the old version with history intact',{skip:process.platform!=='win32',timeout:60000},async()=>{
 const parent=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-rollback-')),target=path.join(parent,'installed'),packageRoot=path.join(parent,'package');copyBundle(target);copyBundle(packageRoot);
 const p=JSON.parse(fs.readFileSync(path.join(target,'package.json')));p.version='0.0.0';fs.writeFileSync(path.join(target,'package.json'),JSON.stringify(p));
 const source=path.join(parent,'noop.cs');fs.writeFileSync(source,'class Empty { static void Main() {} }');
 execFileSync(path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/target:winexe','/out:'+path.join(packageRoot,'MonitorTray.exe'),source],{windowsHide:true,stdio:'pipe'});manifest(packageRoot);
 const config={port:18765,pollSeconds:5,databases:[],logDirectories:[],sshDatabases:[],defaultModel:'all'};fs.writeFileSync(path.join(target,'config.json'),JSON.stringify(config));const s=new Store(target,config);s.record('retained',{timestamp:new Date(1000).toISOString(),model:'p/A',input_tokens:100,custom_metric:42});s.db.close();
 const initial=spawn(path.join(target,'MonitorTray.exe'),[],{cwd:target,windowsHide:true,stdio:'ignore'});let helperPid;
 try{
   for(let i=0;i<150&&!fs.existsSync(path.join(target,'data','tray.pid'));i++)await sleep(100);
   assert.ok(fs.existsSync(path.join(target,'data','tray.pid')));
   const prepared=await stageLocalPackage(packageRoot,target);const applied=await launchUpdate(target,prepared,18765,{readinessAttempts:2});helperPid=applied.helperPid;
   const token=fs.readFileSync(path.join(target,'data','control.token'),'utf8').trim();await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});
   let status;for(let i=0;i<300;i++){try{status=JSON.parse(fs.readFileSync(path.join(target,'data','update-status.json'),'utf8').replace(/^\uFEFF/,''));if(status.state==='failed')break;}catch{}await sleep(100);}assert.equal(status?.state,'failed');
   let health;for(let i=0;i<100;i++){try{health=await(await fetch('http://127.0.0.1:18765/api/health')).json();if(fs.existsSync(path.join(target,'data','tray.pid')))break;}catch{}await sleep(100);}assert.equal(health?.version,'0.0.0');assert.ok(fs.existsSync(path.join(target,'data','tray.pid')),'restored tray ready before shutdown');
   const next=new Store(target,config);try{assert.equal(next.dashboard().rows[0].custom_metric,42);}finally{next.db.close();}
 }finally{
   try{const status=JSON.parse(fs.readFileSync(path.join(target,'data','update-status.json'),'utf8').replace(/^\uFEFF/,''));if(status.state==='failed'&&status.helper_pid)process.kill(status.helper_pid);}catch{}
   if(helperPid)try{process.kill(helperPid);}catch{}
   try{const token=fs.readFileSync(path.join(target,'data','control.token'),'utf8').trim();await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});}catch{}
   for(let i=0;i<80&&fs.existsSync(path.join(target,'data','tray.pid'));i++)await sleep(100);if(initial.exitCode===null)initial.kill();
 }
});
