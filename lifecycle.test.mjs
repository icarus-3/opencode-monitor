import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,execFile} from 'node:child_process';import {promisify} from 'node:util';
import http from 'node:http';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('Windows real tray starts hidden server, repeated launches share one listener, secure APIs and shutdown clean up',{skip:process.platform!=='win32',timeout:40000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-lifecycle-'));
 for(const f of fs.readdirSync('.').filter(x=>/\.(mjs|exe|json)$/.test(x)&&!x.includes('template')))fs.copyFileSync(f,path.join(dir,f));
 fs.cpSync('public',path.join(dir,'public'),{recursive:true});
 fs.copyFileSync('stop.ps1',path.join(dir,'stop.ps1'));
 fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({port:18765,pollSeconds:5,databases:[],logDirectories:[],sshDatabases:[],defaultModel:'all'}));
 const tray=spawn(path.join(dir,'MonitorTray.exe'),[],{cwd:dir,windowsHide:true,stdio:'ignore'});
 const get=p=>fetch('http://127.0.0.1:18765'+p);let health;
 try{
 for(let i=0;i<100;i++){try{health=await(await get('/api/health')).json();break;}catch{await sleep(150);}}
 assert.equal(health?.app,'opencode-monitor');assert.equal(path.resolve(health.root),path.resolve(dir));
 for(let i=0;i<100&&!fs.existsSync(path.join(dir,'data','tray.pid'));i++)await sleep(100);
 assert.ok(fs.existsSync(path.join(dir,'data','tray.pid')),'tray reached ready state');
 const second=spawn(path.join(dir,'MonitorTray.exe'),[],{cwd:dir,windowsHide:true,stdio:'ignore'});
 await new Promise(r=>second.on('exit',r));assert.equal((await(await get('/api/health')).json()).pid,health.pid);
 assert.equal((await get('/')).status,200);assert.equal((await get('/api/diagnostics')).status,200);
 assert.equal((await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST'})).status,403);
 assert.equal((await fetch('http://127.0.0.1:18765/api/history',{headers:{Origin:'https://example.com'}})).status,403);
 const token=fs.readFileSync(path.join(dir,'data','control.token'),'utf8');
 fs.renameSync(path.join(dir,'config.json'),path.join(dir,'config.example.json'));
 await promisify(execFile)('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(dir,'stop.ps1')],{windowsHide:true});
 for(let i=0;i<80&&tray.exitCode===null;i++)await sleep(150);
 assert.notEqual(tray.exitCode,null);await assert.rejects(()=>get('/api/health'));
 }finally{if(tray.exitCode===null)tray.kill();}
});
test('port conflict produces a visible diagnostic and leaves the other service untouched',{skip:process.platform!=='win32',timeout:15000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-conflict-'));
 fs.copyFileSync('MonitorTray.exe',path.join(dir,'MonitorTray.exe'));fs.writeFileSync(path.join(dir,'config.json'),JSON.stringify({port:18767}));
 const other=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'other-service'}));});await new Promise(r=>other.listen(18767,'127.0.0.1',r));
 const tray=spawn(path.join(dir,'MonitorTray.exe'),[],{cwd:dir,windowsHide:true,stdio:'ignore'});
 try{const error=path.join(dir,'data','startup-error.txt');for(let i=0;i<70&&!fs.existsSync(error);i++)await sleep(100);assert.ok(fs.existsSync(error));assert.ok(fs.readFileSync(error,'utf8').includes('18767'));assert.equal((await(await fetch('http://127.0.0.1:18767')).json()).app,'other-service');}finally{tray.kill();await new Promise(r=>other.close(r));}
});
