import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
const exec=promisify(execFile);
export const REPOSITORY='icarus-3/opencode-monitor';
export function compareVersions(a,b){
  const parse=v=>String(v).replace(/^v/,'').match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/);
  const x=parse(a),y=parse(b);if(!x||!y)throw Error('Unsupported version format');
  for(let i=1;i<=3;i++){const n=Number(x[i])-Number(y[i]);if(n)return Math.sign(n);}
  if(x[4]===y[4])return 0;if(x[4]===undefined)return 1;if(y[4]===undefined)return -1;return Math.sign(Number(x[4])-Number(y[4]));
}
export function selectRelease(releases,current){
  return releases.filter(r=>!r.draft&&(!r.prerelease||current.includes('-rc.')))
    .filter(r=>{try{return compareVersions(r.tag_name,current)>0;}catch{return false;}})
    .sort((a,b)=>compareVersions(b.tag_name,a.tag_name))
    .find(r=>(r.assets??[]).some(a=>a.name===`opencode-monitor-${r.tag_name.replace(/^v/,'')}-windows-x64.zip`));
}
export function safePackagePath(root,relative){
  if(typeof relative!=='string'||relative.includes('\\')||relative.includes(':')||relative.startsWith('/')||relative.split('/').some(x=>!x||x==='.'||x==='..'))throw Error('Unsafe package path');
  if(/^(?:data|runtime|seed|node_modules|\.git)(?:\/|$)/i.test(relative)||/^config\.json$/i.test(relative))throw Error('Package may not contain personal data or configuration');
  const result=path.resolve(root,...relative.split('/'));if(!result.startsWith(path.resolve(root)+path.sep))throw Error('Package path escapes directory');return result;
}
export function verifyPackage(root){
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'update-manifest.json'),'utf8'));
  if(manifest.schema!==1||!manifest.files||Object.keys(manifest.files).length>300)throw Error('Invalid update manifest');
  for(const required of ['server.mjs','MonitorTray.exe','UpdateLauncher.exe','package.json','update.ps1','config.example.json'])if(!manifest.files[required])throw Error('Incomplete update package: '+required);
  for(const [file,digest]of Object.entries(manifest.files)){
    const target=safePackagePath(root,file);const stat=fs.lstatSync(target);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Invalid package file');
    if(!/^[a-f0-9]{64}$/.test(digest)||crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex')!==digest)throw Error('Package checksum mismatch: '+file);
  }
  if(JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version!==manifest.version)throw Error('Manifest version mismatch');return manifest;
}
export async function stageLocalPackage(packageRoot,installRoot){
  const manifest=verifyPackage(packageRoot),stage=path.join(installRoot,'data','update-staging',Date.now()+'-'+crypto.randomBytes(4).toString('hex'));
  fs.mkdirSync(stage,{recursive:true});
  for(const file of Object.keys(manifest.files)){const dest=safePackagePath(stage,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.copyFileSync(safePackagePath(packageRoot,file),dest);}
  fs.copyFileSync(path.join(packageRoot,'update-manifest.json'),path.join(stage,'update-manifest.json'));verifyPackage(stage);return {stage,version:manifest.version};
}
export async function launchUpdate(root,prepared,port,{readinessAttempts=60}={}){
  verifyPackage(prepared.stage);
  const backup=path.join(root,'data','update-backups',Date.now()+'-'+crypto.randomBytes(4).toString('hex'));fs.mkdirSync(backup,{recursive:true});
  const dbPath=path.join(root,'data','monitor.sqlite');if(fs.existsSync(dbPath)){const db=new DatabaseSync(dbPath,{readOnly:true});try{db.exec("PRAGMA busy_timeout=5000; VACUUM INTO '"+path.join(backup,'monitor.sqlite').replaceAll("'","''")+"'");}finally{db.close();}}
  const helper=path.join(backup,'apply.ps1');fs.copyFileSync(path.join(prepared.stage,'update.ps1'),helper);
  const readPid=name=>{try{return Number(fs.readFileSync(path.join(root,'data',name),'utf8'))||0;}catch{return 0;}};
  const launcher=path.join(backup,'UpdateLauncher.exe'),installedLauncher=path.join(root,'UpdateLauncher.exe');fs.copyFileSync(fs.existsSync(installedLauncher)?installedLauncher:path.join(prepared.stage,'UpdateLauncher.exe'),launcher);
  const args=['--apply-update',path.join(root,'data','update-helper.log'),'-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',helper,'-InstallDir',root,'-StagedDir',prepared.stage,'-BackupDir',backup,'-ServerProcessId',String(readPid('server.pid')),'-TrayProcessId',String(readPid('tray.pid')),'-Port',String(port),'-ReadinessAttempts',String(readinessAttempts)];
  // A detached native winexe owns PowerShell until completion. PowerShell itself
  // silently exits when launched as DETACHED_PROCESS on Windows PowerShell 5.1.
  let helperPid;
  await new Promise((resolve,reject)=>{const child=spawn(launcher,args,{windowsHide:true,detached:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{helperPid=child.pid;child.unref();resolve();});});
  return {version:prepared.version,backup,helperPid};
}
export class Updater{
  constructor(root,{fetcher=fetch,current}={}){this.root=root;this.fetcher=fetcher;this.current=current??JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;this.cached=null;this.pending=null;this.applying=false;}
  async check(force=false){
    if(!force&&this.cached&&Date.now()-this.cached.checked<300000)return this.cached;
    if(this.pending)return this.pending;
    this.pending=(async()=>{const response=await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`,{headers:{Accept:'application/vnd.github+json','User-Agent':'OpenCode-Monitor'},signal:AbortSignal.timeout(8000)});if(!response.ok)throw Error('GitHub HTTP '+response.status);const releases=await response.json();if(!Array.isArray(releases))throw Error('Invalid release response');const release=selectRelease(releases,this.current);this.cached={current:this.current,available:!!release,latest:release?.tag_name.replace(/^v/,''),url:release?.html_url,checked:Date.now(),release};return this.cached;})().finally(()=>{this.pending=null;});return this.pending;
  }
  async prepare(){
    if(this.applying)throw Error('Update already in progress');this.applying=true;
    try{
      const info=await this.check(true);if(!info.available)throw Error('No newer release available');
      const asset=info.release.assets.find(a=>a.name===`opencode-monitor-${info.latest}-windows-x64.zip`);
      if(!asset.browser_download_url?.startsWith(`https://github.com/${REPOSITORY}/releases/download/`))throw Error('Unexpected update source');
      if(!/^sha256:[a-f0-9]{64}$/.test(asset.digest??''))throw Error('Release is missing a trusted GitHub SHA256 digest');
      const response=await this.fetcher(asset.browser_download_url,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Download HTTP '+response.status);
      let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>50*1024*1024)throw Error('Update package exceeds limit');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks);if(crypto.createHash('sha256').update(bytes).digest('hex')!==asset.digest.slice(7))throw Error('Download checksum mismatch');
      const work=path.join(this.root,'data','update-downloads',Date.now().toString());fs.mkdirSync(work,{recursive:true});const zip=path.join(work,'package.zip');fs.writeFileSync(zip,bytes);
      const extracted=path.join(work,'unpacked');await exec('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(this.root,'stage-package.ps1'),'-Archive',zip,'-Destination',extracted],{windowsHide:true,timeout:30000});
      const prepared=await stageLocalPackage(path.join(extracted,'opencode-monitor'),this.root);if(prepared.version!==info.latest)throw Error('Downloaded version mismatch');return prepared;
    }catch(e){this.applying=false;throw e;}
  }
}
