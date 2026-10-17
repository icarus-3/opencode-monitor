import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';

function runSsh(host, command, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.platform === 'win32' ? 'ssh.exe' : 'ssh', [
      '-o', 'BatchMode=yes',
      '-o', 'ConnectTimeout=6',
      '-o', 'ClearAllForwardings=yes',
      host,
      command
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [];
    let byteCount = 0;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error('SSH timed out'));
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      byteCount += chunk.length;
      if (byteCount > maxBytes) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          child.kill();
          reject(new Error('Remote snapshot exceeded size limit'));
        }
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on('data', chunk => {
      if (stderr.length < 12000) stderr += chunk.toString('utf8').slice(0, 12000 - stderr.length);
    });
    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('Cannot start SSH: ' + error.message));
    });
    child.once('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error('SSH exited ' + code + (stderr.trim() ? ': ' + stderr.trim().slice(-800) : '')));
        return;
      }
      const lines = stderr.split(/\r?\n/);
      const metaLine = lines.find(line => line.startsWith('OPENCODE_MONITOR_META '));
      if (!metaLine) {
        reject(new Error('Remote did not return database metadata' + (stderr.trim() ? ': ' + stderr.trim().slice(-400) : '')));
        return;
      }
      try {
        resolve({ meta: JSON.parse(metaLine.slice('OPENCODE_MONITOR_META '.length)), compressed: Buffer.concat(chunks) });
      } catch {
        reject(new Error('Invalid remote database metadata'));
      }
    });
  });
}

export async function syncRemoteDatabase(source, target, previousSignature) {
  const remotePath = source.path ?? '~/.local/share/opencode/opencode.db';
  const script = [
    'import gzip,json,os,sqlite3,sys,tempfile,urllib.parse',
    'db_path=os.path.expanduser(' + JSON.stringify(remotePath) + ')',
    'if not os.path.isfile(db_path): raise RuntimeError("OpenCode database not found")',
    'uri="file:"+urllib.parse.quote(db_path,safe="/")+"?mode=ro"',
    'src=sqlite3.connect(uri,uri=True,timeout=4)',
    'src.execute("PRAGMA query_only=ON")',
    'tables={r[0] for r in src.execute("SELECT name FROM sqlite_master WHERE type=\'table\'")}',
    'if "session_message" not in tables: raise RuntimeError("Unsupported OpenCode database: session_message missing")',
    'cols={r[1] for r in src.execute("PRAGMA table_info(session_message)")}',
    'if not {"id","session_id","type","seq","time_created","time_updated","data"}.issubset(cols): raise RuntimeError("Unsupported session_message schema")',
    'row=src.execute("SELECT COUNT(*),MAX(time_updated),MAX(seq) FROM session_message WHERE type IN (\'assistant\',\'compaction\')").fetchone()',
    'signature="|".join("-" if v is None else str(v) for v in row)',
    'previous=' + (previousSignature == null ? 'None' : JSON.stringify(previousSignature)),
    'sys.stderr.write("OPENCODE_MONITOR_META "+json.dumps({"signature":signature,"records":row[0],"last_updated":row[1]},separators=(",",":"))+"\\n")',
    'sys.stderr.flush()',
    'if signature != previous:',
    ' dst=sqlite3.connect(":memory:")',
    ' dst.execute("CREATE TABLE session_v2(id TEXT PRIMARY KEY)")',
    ' dst.execute("CREATE TABLE session_message(id TEXT,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,time_updated INTEGER,data TEXT,PRIMARY KEY(session_id,id))")',
    ' dst.execute("CREATE INDEX session_message_updated ON session_message(type,time_updated,seq)")',
    ' rows=src.execute("SELECT id,session_id,type,seq,time_created,time_updated,data FROM session_message WHERE type IN (\'assistant\',\'compaction\') ORDER BY time_updated,seq")',
    ' for mid,sid,typ,seq,created,updated,raw in rows:',
    '  try: original=json.loads(raw)',
    '  except Exception: continue',
    '  clean={}',
    '  model=original.get("model") if isinstance(original,dict) else None',
    '  if isinstance(model,dict): clean["model"]={k:model.get(k) for k in ("providerID","id") if model.get(k) is not None}',
    '  tm=original.get("time") if isinstance(original,dict) else None',
    '  if isinstance(tm,dict): clean["time"]={k:tm.get(k) for k in ("created","completed") if tm.get(k) is not None}',
    '  tokens=original.get("tokens") if isinstance(original,dict) else None',
    '  if isinstance(tokens,dict):',
    '   clean["tokens"]={k:tokens.get(k) for k in ("input","output","reasoning") if tokens.get(k) is not None}',
    '   cache=tokens.get("cache")',
    '   if isinstance(cache,dict): clean["tokens"]["cache"]={k:cache.get(k) for k in ("read","write") if cache.get(k) is not None}',
    '  for key in ("finish","cost","agent"):',
    '   value=original.get(key) if isinstance(original,dict) else None',
    '   if isinstance(value,(str,int,float,bool)) or value is None: ',
    '    if value is not None: clean[key]=value',
    '  err=original.get("error") if isinstance(original,dict) else None',
    '  if isinstance(err,dict):',
    '   cleanerr={}',
    '   if isinstance(err.get("name"),str): cleanerr["name"]=err["name"]',
    '   detail=err.get("data")',
    '   if isinstance(detail,dict) and isinstance(detail.get("statusCode"),(int,float)): cleanerr["data"]={"statusCode":detail["statusCode"]}',
    '   if cleanerr: clean["error"]=cleanerr',
    '  content=original.get("content") if isinstance(original,dict) else None',
    '  if isinstance(content,list):',
    '   cleancontent=[]',
    '   for part in content:',
    '    if not isinstance(part,dict) or part.get("type") not in ("text","reasoning","tool"): continue',
    '    item={"type":part["type"]}',
    '    parttime=part.get("time")',
    '    if isinstance(parttime,dict): item["time"]={k:parttime.get(k) for k in ("created","completed") if parttime.get(k) is not None}',
    '    cleancontent.append(item)',
    '   clean["content"]=cleancontent',
    '  dst.execute("INSERT INTO session_message VALUES(?,?,?,?,?,?,?)",(mid,sid,typ,seq,created,updated,json.dumps(clean,separators=(",",":"))))',
    ' dst.commit()',
    ' try: raw=dst.serialize()',
    ' except AttributeError:',
    '  fd,tmp=tempfile.mkstemp(prefix="opencode-monitor-",suffix=".sqlite"); os.close(fd)',
    '  out=sqlite3.connect(tmp)',
    '  dst.backup(out); out.close()',
    '  with open(tmp,"rb") as f: raw=f.read()',
    '  os.unlink(tmp)',
    ' sys.stdout.buffer.write(gzip.compress(raw,compresslevel=1)); sys.stdout.buffer.flush()',
    ' dst.close()',
    'src.close()'
  ].join('\n');
  const encoded = Buffer.from(script, 'utf8').toString('base64');
  const command = 'python3 -c "import base64;exec(base64.b64decode(\'' + encoded + '\'))"';
  const { meta, compressed } = await runSsh(source.host, command, source.timeoutMs ?? 18000, source.maxCompressedBytes ?? 32 * 1024 * 1024);
  if (typeof meta.signature !== 'string') throw new Error('Remote metadata missing signature');
  if (meta.signature === previousSignature) return { signature: meta.signature, records: meta.records, changed: false };
  if (!compressed.length) throw new Error('Remote database changed but no snapshot was returned');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = target + '.' + process.pid + '.tmp';
  try {
    await pipeline(Readable.from([compressed]), createGunzip(), createWriteStream(temporary, { flags: 'w' }));
    const stat = fs.statSync(temporary);
    if (stat.size < 4096) throw new Error('Remote snapshot is unexpectedly small');
    try {
      fs.renameSync(temporary, target);
    } catch (error) {
      if (!fs.existsSync(target)) throw error;
      const old = target + '.old';
      try { fs.rmSync(old, { force: true }); } catch {}
      fs.renameSync(target, old);
      try { fs.renameSync(temporary, target); }
      catch (replaceError) { fs.renameSync(old, target); throw replaceError; }
      fs.rmSync(old, { force: true });
    }
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  return { signature: meta.signature, records: meta.records, lastUpdated: meta.last_updated, changed: true };
}