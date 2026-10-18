import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {DatabaseSync} from 'node:sqlite';
const [kind='telemetry',destination]=process.argv.slice(2);
const table={history:'records',telemetry:'telemetry_v1',versions:'record_versions_v1',events:'events',baselines:'baselines'}[kind];
if(!table||!destination)throw Error('Usage: node export.mjs history|telemetry|versions|events|baselines output.jsonl');
const root=path.dirname(fileURLToPath(import.meta.url)),db=new DatabaseSync(path.join(root,'data','monitor.sqlite'),{readOnly:true});
const fd=fs.openSync(destination,'wx');
try{db.exec('BEGIN');for(const row of db.prepare('SELECT * FROM '+table).iterate())fs.writeSync(fd,JSON.stringify({...row,data:JSON.parse(row.data),export_schema:1})+'\n');db.exec('COMMIT');}finally{fs.closeSync(fd);db.close();}
