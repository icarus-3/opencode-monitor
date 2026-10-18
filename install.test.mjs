import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {execFileSync} from 'node:child_process';import {Store} from './store.mjs';
test('Windows installer imports legacy history and writes startup plugin without touching global config',{skip:process.platform!=='win32',timeout:20000},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-install-')),old=path.join(root,'old'),target=path.join(root,'installed'),plugins=path.join(root,'config','plugins');
 fs.mkdirSync(old);fs.copyFileSync('config.example.json',path.join(old,'config.json'));
 const s=new Store(old,{defaultModel:'all',databases:[],logDirectories:[]});s.record('a',{timestamp:new Date().toISOString(),model:'p/a',input_tokens:100,legacy_unique:42});s.db.close();
 execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('install.ps1'),'-InstallDir',target,'-LegacyRoot',old,'-PluginDirectories',plugins,'-SkipDefaultPluginDirectories','-NoStart'],{windowsHide:true,stdio:'pipe'});
 const installed=new Store(target,{defaultModel:'all',databases:[],logDirectories:[]});try{assert.equal(installed.dashboard().rows[0].legacy_unique,42);assert.ok(fs.readdirSync(path.join(target,'data')).some(x=>x.startsWith('import-backup')));}finally{installed.db.close();}
 assert.ok(fs.existsSync(path.join(target,'MonitorTray.exe')));const plugin=fs.readFileSync(path.join(plugins,'opencode-monitor.js'),'utf8');assert.ok(plugin.includes(target.replaceAll('\\','/')));assert.ok(plugin.includes('setup:'));assert.ok(plugin.includes('server:'));
});
test('hook update preserves foreign plugins and can roll back its own generated hooks',{skip:process.platform!=='win32'},()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-hook-sync-')),owned=path.join(root,'own','opencode-monitor.js'),foreign=path.join(root,'foreign','opencode-monitor.js'),backup=path.join(root,'backup');
 fs.mkdirSync(path.join(root,'data'));fs.mkdirSync(path.dirname(owned));fs.mkdirSync(path.dirname(foreign));
 fs.copyFileSync('plugin-template.mjs',path.join(root,'plugin-template.mjs'));
 const original='const root='+JSON.stringify(root.replaceAll('\\','/'))+';\n// old plugin';
 const foreignText='const root="C:/some-other-monitor";\n// leave alone';fs.writeFileSync(owned,original);fs.writeFileSync(foreign,foreignText);
 fs.writeFileSync(path.join(root,'data','installed-plugins.json'),JSON.stringify([owned,foreign]));
 const args=['-NoProfile','-ExecutionPolicy','Bypass','-File',path.resolve('sync-hooks.ps1'),'-InstallDir',root,'-BackupDir',backup];
 execFileSync('powershell.exe',args,{windowsHide:true,stdio:'pipe'});assert.ok(fs.readFileSync(owned,'utf8').includes('OpenCodeWindowHook'));assert.equal(fs.readFileSync(foreign,'utf8'),foreignText);
 execFileSync('powershell.exe',[...args,'-Rollback'],{windowsHide:true,stdio:'pipe'});assert.equal(fs.readFileSync(owned,'utf8'),original);assert.equal(fs.readFileSync(foreign,'utf8'),foreignText);
});
