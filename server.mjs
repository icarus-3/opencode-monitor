import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { discover } from './discover.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const configPath=path.join(root,fs.existsSync(path.join(root,'config.json'))?'config.json':'config.example.json');
const config=discover(JSON.parse(fs.readFileSync(configPath,'utf8')));
const store=new Store(root,config);
store.scan();
const interval=setInterval(()=>store.scan(),Math.max(5,config.pollSeconds)*1000);
let eventChild=null;
let eventRetry=null;
let stopping=false;
const remoteEventChildren=new Map();
const remoteEventRetries=new Map();

function scheduleEventReconnect(){
  if(stopping||eventRetry)return;
  eventRetry=setTimeout(()=>{eventRetry=null;connectOpenCodeEvents();},5000);
}
function acceptEvent(raw,sourceId=null){
  try{
    let event=JSON.parse(raw);
    if(typeof event==='string')event=JSON.parse(event);
    if(event&&typeof event==='object')store.captureEvent(event,sourceId);
  }catch{}
}
function connectOpenCodeEvents(){
  if(stopping||eventChild)return;
  const cli=path.join(process.env.LOCALAPPDATA??'','Programs','@opencodedesktop','resources','opencode-cli.exe');
  if(!fs.existsSync(cli)){store.setEventStreamStatus('offline');scheduleEventReconnect();return;}
  store.setEventStreamStatus('connecting');
  const child=spawn(cli,['api','GET','/api/event'],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  eventChild=child;
  const decoder=new StringDecoder('utf8');
  let buffer='',dataLines=[];
  const consumeLine=line=>{
    if(line===''){
      if(dataLines.length)acceptEvent(dataLines.join('\n'));
      dataLines=[];
      return;
    }
    if(line.startsWith('data:')){dataLines.push(line.slice(5).trimStart());return;}
    if(line.trimStart().startsWith('{'))acceptEvent(line.trim());
  };
  child.once('spawn',()=>store.setEventStreamStatus('connected'));
  child.stdout.on('data',chunk=>{
    buffer+=decoder.write(chunk);
    let at;
    while((at=buffer.indexOf('\n'))>=0){
      let line=buffer.slice(0,at);buffer=buffer.slice(at+1);
      if(line.endsWith('\r'))line=line.slice(0,-1);
      consumeLine(line);
    }
  });
  child.stdout.on('end',()=>{
    buffer+=decoder.end();
    if(buffer)consumeLine(buffer);
    if(dataLines.length)acceptEvent(dataLines.join('\n'));
    dataLines=[];
  });
  child.once('error',()=>{
    if(eventChild===child)eventChild=null;
    store.setEventStreamStatus('offline');
    scheduleEventReconnect();
  });
  child.once('exit',()=>{
    if(eventChild===child)eventChild=null;
    store.setEventStreamStatus('offline');
    scheduleEventReconnect();
  });
}
function scheduleRemoteEventReconnect(source){
  const id=source.id??source.host;
  if(stopping||remoteEventRetries.has(id))return;
  remoteEventRetries.set(id,setTimeout(()=>{
    remoteEventRetries.delete(id);
    connectRemoteOpenCodeEvents(source);
  },30000));
}
function connectRemoteOpenCodeEvents(source){
  const id=source.id??source.host;
  if(stopping||remoteEventChildren.has(id))return;
  const python=[
    'import glob,os,sys',
    'pids=[]',
    'for f in glob.glob("/proc/[0-9]*/comm"):',
    ' try:',
    '  if open(f).read().strip()=="opencode": pids.append(f.split("/")[2])',
    ' except Exception: pass',
    'if not pids: sys.exit(23)',
    'pid=max(pids,key=lambda x:int(x))',
    'exe="/proc/"+pid+"/exe"',
    'os.execv(exe,[exe,"api","GET","/api/event"])'
  ].join('\n');
  const command='python3 -c "import base64;exec(base64.b64decode(\''+Buffer.from(python,'utf8').toString('base64')+'\'))"';
  const child=spawn(process.platform==='win32'?'ssh.exe':'ssh',[
    '-o','BatchMode=yes',
    '-o','ConnectTimeout=6',
    '-o','ClearAllForwardings=yes',
    '-o','ServerAliveInterval=10',
    '-o','ServerAliveCountMax=3',
    source.host,
    command
  ],{windowsHide:true,stdio:['ignore','pipe','ignore']});
  remoteEventChildren.set(id,child);
  store.setRemoteEventStatus(id,'connecting');
  const decoder=new StringDecoder('utf8');
  let buffer='',dataLines=[];
  const consumeLine=line=>{
    if(line===''){
      if(dataLines.length){acceptEvent(dataLines.join('\n'),id);store.setRemoteEventStatus(id,'streaming');}
      dataLines=[];
      return;
    }
    if(line.startsWith('data:')){dataLines.push(line.slice(5).trimStart());return;}
    if(line.trimStart().startsWith('{')){acceptEvent(line.trim(),id);store.setRemoteEventStatus(id,'streaming');}
  };
  child.once('spawn',()=>store.setRemoteEventStatus(id,'connected'));
  child.stdout.on('data',chunk=>{
    buffer+=decoder.write(chunk);
    let at;
    while((at=buffer.indexOf('\n'))>=0){
      let line=buffer.slice(0,at);buffer=buffer.slice(at+1);
      if(line.endsWith('\r'))line=line.slice(0,-1);
      consumeLine(line);
    }
  });
  child.stdout.on('end',()=>{
    buffer+=decoder.end();
    if(buffer)consumeLine(buffer);
    if(dataLines.length)acceptEvent(dataLines.join('\n'),id);
    dataLines=[];
  });
  const disconnected=()=>{
    if(remoteEventChildren.get(id)!==child)return;
    remoteEventChildren.delete(id);
    store.setRemoteEventStatus(id,'offline');
    scheduleRemoteEventReconnect(source);
  };
  child.once('error',disconnected);
  child.once('exit',disconnected);
}
function stopEventStream(){
  stopping=true;
  if(eventRetry){clearTimeout(eventRetry);eventRetry=null;}
  const child=eventChild;eventChild=null;
  if(child)child.kill();
  for(const timer of remoteEventRetries.values())clearTimeout(timer);
  remoteEventRetries.clear();
  for(const child of remoteEventChildren.values())child.kill();
  remoteEventChildren.clear();
}

const server=http.createServer((req,res)=>{
  const host=req.headers.host??'';
  if(!['127.0.0.1:'+config.port,'localhost:'+config.port].includes(host)){res.writeHead(403);res.end('Local host only');return;}
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/api/dashboard'){
    try{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(store.dashboard(Object.fromEntries(url.searchParams))));}
    catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}
    return;
  }
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(files[url.pathname]){
    res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(root,'public',files[url.pathname])));
    return;
  }
  res.writeHead(404);res.end('Not found');
});
server.on('error',e=>{
  console.error(e.message);
  clearInterval(interval);
  stopEventStream();
  store.db.close();
  process.exitCode=1;
});
server.listen(config.port,'127.0.0.1',()=>{
  fs.writeFileSync(path.join(root,'data','server.pid'),String(process.pid));
  connectOpenCodeEvents();
  for(const source of config.sshDatabases??[])connectRemoteOpenCodeEvents(source);
  console.log('OpenCode Monitor http://127.0.0.1:'+config.port+' — read-only sources; Ctrl+C to stop');
});
function stop(){
  clearInterval(interval);
  stopEventStream();
  server.close(()=>{
    store.db.close();
    const pid=path.join(root,'data','server.pid');
    if(fs.existsSync(pid)&&fs.readFileSync(pid,'utf8')===String(process.pid))fs.unlinkSync(pid);
    process.exit(0);
  });
}
process.on('SIGINT',stop);
process.on('SIGTERM',stop);