import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {Store} from './store.mjs';
test('Windows installer imports legacy history and writes startup plugin without touching global config',{skip:process.platform!=='win32',timeout:20000},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-install-')),old=path.join(root,'old'),target=path.join(root,'installed'),plugins=path.join(root,'config','plugins');
 fs.mkdirSync(old);fs.copyFileSync('config.example.json',path.join(old,'config.json'));
 const s=new Store(old,{defaultModel:'all',databases:[],logDirectories:[]});s.record('a',{timestamp:new Date().toISOString(),model:'p/a',input_tokens:100,legacy_unique:42});s.db.close();
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('install.ps1'),'-InstallDir',target,'-LegacyRoot',old,'-PluginDirectories',plugins,'-SkipDefaultPluginDirectories','-NoStart'],{windowsHide:true,stdio:'pipe'});
 const installed=new Store(target,{defaultModel:'all',databases:[],logDirectories:[]});try{assert.equal(installed.dashboard().rows[0].legacy_unique,42);assert.ok(fs.readdirSync(path.join(target,'data')).some(x=>x.startsWith('import-backup')));}finally{installed.db.close();}
 assert.ok(fs.existsSync(path.join(target,'MonitorTray.exe')));const plugin=fs.readFileSync(path.join(plugins,'opencode-monitor.js'),'utf8');assert.ok(plugin.includes(target.replaceAll('\\','/')));assert.ok(plugin.includes('setup:'));assert.ok(plugin.includes('server:'));
});
