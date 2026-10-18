import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from './store.mjs';
import {importHistory,importSeed} from './legacy.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const [kind,file]=process.argv.slice(2);
if(!['--history','--seed'].includes(kind)||!file)throw Error('Usage: node migrate.mjs --history old/monitor.sqlite | --seed old/seed');
const s=new Store(root,{databases:[],logDirectories:[],defaultModel:'all'});
try{if(kind==='--history')console.log('Imported; source backup:',importHistory(s,path.resolve(file)));else importSeed(s,path.resolve(file));console.log('Integrity:',s.db.prepare('PRAGMA integrity_check').get());}finally{s.db.close();}
