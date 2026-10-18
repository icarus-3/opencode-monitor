import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';import {stageLocalPackage,launchUpdate,compareVersions,verifyPackage} from './updater.mjs';
const packageRoot=path.dirname(fileURLToPath(import.meta.url)),installRoot=process.argv[2];if(!installRoot)throw Error('Usage: node update-local.mjs INSTALL_DIRECTORY');
const root=path.resolve(installRoot);if(root===packageRoot)throw Error('Extract update package outside the installation directory');
const version=verifyPackage(packageRoot).version,current=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
if(compareVersions(version,current)<=0)throw Error('Installed version is already equal or newer');
const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8').replace(/^\uFEFF/,''));
let health;try{health=await(await fetch('http://127.0.0.1:'+config.port+'/api/health')).json();}catch{}
if(health&&(health.app!=='opencode-monitor'||path.resolve(health.root).toLowerCase()!==root.toLowerCase()))throw Error('Port belongs to a different application');
const prepared=await stageLocalPackage(packageRoot,root);const result=await launchUpdate(root,prepared,config.port);
if(health){const token=fs.readFileSync(path.join(root,'data','control.token'),'utf8').trim();const r=await fetch('http://127.0.0.1:'+config.port+'/api/shutdown',{method:'POST',headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Could not stop Monitor safely');}
console.log('Updating to '+result.version+'; backup: '+result.backup);
