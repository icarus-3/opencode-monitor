import {execFile} from 'node:child_process';
const transfers=new Set();
export function cancelRemoteLogs(){for(const child of transfers)child.kill();}
// Project on the SSH host. Message text, prompts, tool output, and credentials never cross SSH.
export const logScript=directories=>[
 'import os,glob,json,re,hashlib',
 'dirs='+JSON.stringify(directories),
 'out=[]',
 'for directory in dirs:',
 ' for file in sorted(glob.glob(os.path.join(os.path.expanduser(directory),"*.log*"))):',
 '  pending={}',
 '  with open(file,"r",errors="replace") as f:',
 '   for line in f:',
 '    def val(key):',
 '     m=re.search(r"\\b"+re.escape(key)+r"=(\\S+)",line)',
 '     return m.group(1) if m else None',
 '    ts=val("timestamp");sid=val("session.id");run=val("run") or "default"',
 '    if not ts: continue',
 '    key=(run,sid)',
 '    if val("message")=="process" and sid and val("messageID"): pending[key]={"message_id":val("messageID")}',
 '    ctx=pending.get(key,{})',
 '    model=(val("providerID")+"/"+val("modelID")) if val("providerID") and val("modelID") else ctx.get("model","unknown")',
 '    item={"id":hashlib.sha256((file+line).encode()).hexdigest(),"timestamp":ts,"session_id":sid,"message_id":ctx.get("message_id"),"model":model}',
 '    if val("message")=="stream" and sid and ctx:',
 '     ctx["model"]=model;item["kind"]="stream"',
 '    elif val("level")=="ERROR":',
 '     payload=line.split("level=ERROR",1)[-1]',
 '     status=re.search(r"(?:statusCode|status|httpStatus)[\\\\\\\"\x27]*\\s*[:=]\\s*[\\\\\\\"\x27]*(\\d{3})\\b|\\bHTTP\\s+(\\d{3})\\b",payload,re.I)',
 '     typ=re.search(r"\\b(FreeUsageLimitError|FreeTierError|RateLimitError|APIError|APICallError|TimeoutError|AuthenticationError)\\b",payload)',
 '     item.update(kind="error",http_status=int(next(x for x in status.groups() if x)) if status else None,error_type=typ.group(1) if typ else "LoggedError")',
 '    elif val("message") in ("compacting","compaction") or val("agent")=="compaction": item["kind"]="compaction"',
 '    else: continue',
 '    out.append(item)',
 'print(json.dumps(out,separators=(",",":")))'
].join('\n');
export function remoteLogs(source){
  if(!source.logDirectories?.length)return Promise.resolve([]);
  if(typeof source.host!=='string'||source.host.startsWith('-'))return Promise.reject(Error('Invalid SSH host'));
  const encoded=Buffer.from(logScript(source.logDirectories)).toString('base64');
  return new Promise((resolve,reject)=>{
    const child=execFile(process.platform==='win32'?'ssh.exe':'ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6','-o','ClearAllForwardings=yes',source.host,`python3 -c "import base64;exec(base64.b64decode('${encoded}'))"`],{windowsHide:true,timeout:source.timeoutMs??18000,maxBuffer:32*1024*1024},(e,out)=>{transfers.delete(child);if(e)return reject(Error('SSH log projection failed: '+e.code));try{resolve(JSON.parse(out))}catch{reject(Error('Invalid SSH log projection'))}});
    transfers.add(child);
  });
}
