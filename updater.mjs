import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {execFile,spawn} from 'node:child_process';import {promisify} from 'node:util';import {DatabaseSync} from 'node:sqlite';
const exec=promisify(execFile);
export const REPOSITORY='icarus-3/opencode-monitor';
export const RELEASES_URL=`https://github.com/${REPOSITORY}/releases`;
export function parseReleaseFeed(text){
  if(!text.includes(`<id>tag:github.com,2008:${RELEASES_URL}</id>`)||!/<feed\b/.test(text))throw Error('Invalid GitHub release feed');
  const releases=[];
  for(const entry of text.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/g)){
    for(const link of entry[1].matchAll(/<link\b[^>]*>/g)){
      if(!/\brel=["']alternate["']/.test(link[0]))continue;
      const url=link[0].match(/\bhref=["']([^"']+)["']/)?.[1];
      if(!url?.startsWith(RELEASES_URL+'/tag/'))continue;
      const tag=url.slice((RELEASES_URL+'/tag/').length),version=tag.replace(/^v/,'');
      try{compareVersions(version,version);}catch{continue;}
      const name=`opencode-monitor-${version}-windows-x64.zip`;
      releases.push({tag_name:tag,draft:false,prerelease:version.includes('-rc.'),html_url:url,assets:[{name,browser_download_url:`${RELEASES_URL}/download/${tag}/${name}`} ]});break;
    }
  }
  if(!releases.length)throw Error('GitHub feed has no supported releases');return releases;
}
export function releaseChecksum(text,filename){
  const matches=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(line=>line.match(/^([a-fA-F0-9]{64})[ \t]+\*?([^\r\n]+)$/)).filter(m=>m&&m[2]===filename);
  if(matches.length!==1)throw Error('Missing or ambiguous release SHA256 checksum');return 'sha256:'+matches[0][1].toLowerCase();
}
async function limitedText(response,limit=1024*1024){
  let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>limit)throw Error('Update metadata exceeds limit');chunks.push(chunk);}return Buffer.concat(chunks).toString('utf8');
}
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
  constructor(root,{fetcher=fetch,current,now=Date.now}={}){
    this.root=root;this.fetcher=fetcher;this.now=now;this.current=current??JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;this.cached=null;this.pending=null;this.applying=false;this.apiRetryAt=0;
    this.cachePath=path.join(root,'data','update-check-cache.json');
    try{const saved=JSON.parse(fs.readFileSync(this.cachePath,'utf8'));if(Number.isFinite(saved.apiRetryAt))this.apiRetryAt=Math.min(saved.apiRetryAt,this.now()+86400000);}catch{}
  }
  saveBackoff(){try{fs.mkdirSync(path.dirname(this.cachePath),{recursive:true});fs.writeFileSync(this.cachePath,JSON.stringify({apiRetryAt:this.apiRetryAt}));}catch{}}
  async check(force=false){
    if(!force&&this.cached&&this.now()-this.cached.checked<300000)return this.cached;
    if(this.pending)return this.pending;
    this.pending=(async()=>{
      let releases,source='github-api',apiError='GitHub API 暂处等待期';
      if(this.now()>=this.apiRetryAt){
        try{
          const response=await this.fetcher(`https://api.github.com/repos/${REPOSITORY}/releases?per_page=30`,{headers:{Accept:'application/vnd.github+json','User-Agent':'OpenCode-Monitor'},signal:AbortSignal.timeout(8000)});
          if(!response.ok){
            const reset=Number(response.headers.get('x-ratelimit-reset'))*1000,retry=response.headers.get('retry-after');
            const retryAt=retry?(Number.isFinite(Number(retry))?this.now()+Number(retry)*1000:Date.parse(retry)):0;
            this.apiRetryAt=Math.min(this.now()+86400000,Math.max(this.now()+60000,Number.isFinite(reset)?reset:0,Number.isFinite(retryAt)?retryAt:0));this.saveBackoff();
            throw Error(response.status===403||response.status===429?'GitHub API 请求受限':'GitHub API HTTP '+response.status);
          }
          const parsed=JSON.parse(await limitedText(response));if(!Array.isArray(parsed)||parsed.some(r=>!r||typeof r.tag_name!=='string'||!Array.isArray(r.assets)))throw Error('Invalid release response');releases=parsed;this.apiRetryAt=0;this.saveBackoff();
        }catch(e){apiError=e.message;if(!this.apiRetryAt){this.apiRetryAt=this.now()+60000;this.saveBackoff();}}
      }
      if(!releases){
        source='github-releases-feed';
        try{const response=await this.fetcher(RELEASES_URL+'.atom',{headers:{Accept:'application/atom+xml','User-Agent':'OpenCode-Monitor'},signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('发布订阅 HTTP '+response.status);releases=parseReleaseFeed(await limitedText(response));}
        catch(e){throw Error(apiError+'；备用发布源不可用：'+e.message+'。可稍后重试或访问 '+RELEASES_URL);}
      }
      const release=selectRelease(releases,this.current);
      if(release&&source==='github-releases-feed'){
        const version=release.tag_name.replace(/^v/,''),asset=release.assets[0];
        const response=await this.fetcher(`${RELEASES_URL}/download/${release.tag_name}/SHA256SUMS-${version}.txt`,{signal:AbortSignal.timeout(10000)});
        if(!response.ok)throw Error('发布校验文件暂不可用（HTTP '+response.status+'），请稍后重试');
        asset.digest=releaseChecksum(await limitedText(response,65536),asset.name);asset.digest_source='repository-release-checksums';
      }
      this.cached={current:this.current,available:!!release,latest:release?.tag_name.replace(/^v/,''),url:release?.html_url??RELEASES_URL,checked:this.now(),source,api_retry_at:this.apiRetryAt||undefined,release};return this.cached;
    })().finally(()=>{this.pending=null;});return this.pending;
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
