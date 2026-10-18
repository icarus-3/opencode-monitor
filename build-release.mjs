import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import crypto from 'node:crypto';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {safePackagePath,verifyPackage} from './updater.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),destination=process.argv[2];if(!destination)throw Error('Usage: node build-release.mjs OUTPUT_DIRECTORY');
const out=path.resolve(destination),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const files=execFileSync('git',['-c','safe.directory='+root,'-C',root,'ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean).filter(f=>f!=='update-manifest.json');
const stage=fs.mkdtempSync(path.join(os.tmpdir(),'monitor-release-')),packageRoot=path.join(stage,'opencode-monitor');fs.mkdirSync(packageRoot);
const hashes={};for(const file of files){const source=safePackagePath(root,file);if(!fs.lstatSync(source).isFile())throw Error('Package source is not a regular file');const target=safePackagePath(packageRoot,file);fs.mkdirSync(path.dirname(target),{recursive:true});const bytes=fs.readFileSync(source);fs.writeFileSync(target,bytes);hashes[file]=crypto.createHash('sha256').update(bytes).digest('hex');}
fs.writeFileSync(path.join(packageRoot,'update-manifest.json'),JSON.stringify({schema:1,version,files:hashes},null,2)+'\n');verifyPackage(packageRoot);fs.mkdirSync(out,{recursive:true});
const zip=path.join(out,`opencode-monitor-${version}-windows-x64.zip`),update=path.join(out,`opencode-monitor-${version}-update.zip`);
execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'pack-release.ps1'),'-Stage',stage,'-Archive',zip],{windowsHide:true,stdio:'pipe'});
fs.copyFileSync(zip,update);const hash=crypto.createHash('sha256').update(fs.readFileSync(zip)).digest('hex');fs.writeFileSync(path.join(out,`SHA256SUMS-${version}.txt`),[zip,update].map(f=>hash+'  '+path.basename(f)).join('\n')+'\n');console.log(JSON.stringify({version,zip,update,sha256:hash,stage:packageRoot}));
