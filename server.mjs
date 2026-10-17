import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { Store } from './store.mjs';
import { discover } from './discover.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const config=discover(JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')));
const store=new Store(root,config);store.scan();
const interval=setInterval(()=>store.scan(),Math.max(5,config.pollSeconds)*1000);
const server=http.createServer((req,res)=>{
  const host=req.headers.host??'';
  if(!['127.0.0.1:'+config.port,'localhost:'+config.port].includes(host)){res.writeHead(403);res.end('Local host only');return;}
  const url=new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(url.pathname==='/api/dashboard') {try{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(store.dashboard(Object.fromEntries(url.searchParams))));}catch(e){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:e.message}));}return;}
  const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};
  if(files[url.pathname]) {res.setHeader('Content-Type',url.pathname.endsWith('.js')?'text/javascript; charset=utf-8':url.pathname.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');res.end(fs.readFileSync(path.join(root,'public',files[url.pathname])));return;}
  res.writeHead(404);res.end('Not found');
});
server.on('error',e=>{console.error(e.message);clearInterval(interval);store.db.close();process.exitCode=1});
server.listen(config.port,'127.0.0.1',()=>{fs.writeFileSync(path.join(root,'data','server.pid'),String(process.pid));console.log(`OpenCode Monitor http://127.0.0.1:${config.port} — read-only sources; Ctrl+C to stop`);});
function stop(){clearInterval(interval);server.close(()=>{store.db.close();const pid=path.join(root,'data','server.pid');if(fs.existsSync(pid)&&fs.readFileSync(pid,'utf8')===String(process.pid))fs.unlinkSync(pid);process.exit(0)});}
process.on('SIGINT',stop);process.on('SIGTERM',stop);
