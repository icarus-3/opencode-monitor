import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawn,execFileSync} from 'node:child_process';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(check,message){for(let i=0;i<130;i++){if(await check())return;await pause(100);}assert.fail(message);}
test('desktop window events restart a quit Monitor with a persistent plugin host, without polling or touching real OpenCode',{skip:process.platform!=='win32',timeout:65000},async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-window-hook-')),bundle=path.join(dir,'monitor'),fake=path.join(dir,'allowed','OpenCode.exe'),other=path.join(dir,'other','OpenCode.exe');fs.mkdirSync(bundle,{recursive:true});fs.mkdirSync(path.dirname(fake));fs.mkdirSync(path.dirname(other));
 for(const f of fs.readdirSync('.').filter(x=>/\.(mjs|exe|json)$/.test(x)&&!x.includes('template')))fs.copyFileSync(f,path.join(bundle,f));fs.cpSync('public',path.join(bundle,'public'),{recursive:true});
 fs.writeFileSync(path.join(bundle,'config.json'),JSON.stringify({port:18765,pollSeconds:5,databases:[],logDirectories:[],sshDatabases:[],defaultModel:'all',desktopExecutables:[fake]}));
 const source=path.join(dir,'window.cs');fs.writeFileSync(source,'using System;using System.Windows.Forms;class Window { [STAThread] static void Main(){var form=new Form();form.Text="Monitor isolated startup test";var timer=new Timer();timer.Interval=1500;timer.Tick+=(s,e)=>{form.Hide();form.Show();};timer.Start();Application.Run(form);} }');
 execFileSync(path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/target:winexe','/reference:System.Windows.Forms.dll','/out:'+fake,source],{windowsHide:true,stdio:'pipe'});fs.copyFileSync(fake,other);
 const host=spawn(process.execPath,['-e','setInterval(()=>{},10000)'],{windowsHide:true,stdio:'ignore'});
 const hook=spawn(path.join(bundle,'OpenCodeWindowHook.exe'),['--parent',String(host.pid),'--root',bundle],{windowsHide:true,stdio:'ignore'});
 const windows=[];const pidFile=path.join(bundle,'data','tray.pid');
 async function stop(){try{const token=fs.readFileSync(path.join(bundle,'data','control.token'),'utf8').trim();await fetch('http://127.0.0.1:18765/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});}catch{}await until(()=>!fs.existsSync(pidFile),'tray stopped');}
 try{
  await until(()=>fs.existsSync(path.join(bundle,'data','window-hook.pid')),'window subscription ready');
  const duplicate=spawn(path.join(bundle,'OpenCodeWindowHook.exe'),['--parent',String(host.pid),'--root',bundle],{windowsHide:true,stdio:'ignore'});await until(()=>duplicate.exitCode!==null,'duplicate subscription exits');
  windows.push(spawn(other,[],{stdio:'ignore'}));await pause(1800);assert.equal(fs.existsSync(pidFile),false,'unapproved executable is ignored');
  windows.push(spawn(fake,[],{stdio:'ignore'}));await until(()=>fs.existsSync(pidFile),'first desktop process starts Monitor');
  const health=await(await fetch('http://127.0.0.1:18765/api/health')).json();assert.equal(path.resolve(health.root),path.resolve(bundle));
  await stop();await pause(2200);assert.equal(fs.existsSync(pidFile),false,'same desktop process showing windows does not undo explicit quit');
  windows.at(-1).kill();await until(()=>windows.at(-1).exitCode!==null||windows.at(-1).signalCode!==null,'isolated window closed');
  windows.push(spawn(fake,[],{stdio:'ignore'}));await until(()=>fs.existsSync(pidFile),'reopened desktop starts Monitor despite same plugin host');
  assert.notEqual((await(await fetch('http://127.0.0.1:18765/api/health')).json()).pid,health.pid);
  assert.equal(host.exitCode,null,'plugin host unchanged');await stop();
  host.kill();await until(()=>hook.exitCode!==null||hook.signalCode!==null,'event hook exits with plugin host');assert.equal(fs.existsSync(path.join(bundle,'data','window-hook.pid')),false);
 }finally{for(const p of windows)if(p.exitCode===null)p.kill();await stop();if(host.exitCode===null)host.kill();if(hook.exitCode===null)hook.kill();}
});
