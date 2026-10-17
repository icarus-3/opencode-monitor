import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
export function discover(config, env=process.env, home=os.homedir()) {
  const roots=[env.XDG_DATA_HOME?path.join(env.XDG_DATA_HOME,'opencode'):null,path.join(home,'.local','share','opencode'),env.LOCALAPPDATA?path.join(env.LOCALAPPDATA,'opencode'):null,env.APPDATA?path.join(env.APPDATA,'opencode'):null,'D:/OpenCodeData/data/opencode'].filter(Boolean);
  const unique=xs=>[...new Map(xs.map(x=>[process.platform==='win32'?path.resolve(x).toLowerCase():path.resolve(x),path.resolve(x)])).values()];
  const configured=config.databases??['auto'];
  const databases=unique(configured.flatMap(x=>x==='auto'?roots.map(r=>path.join(r,'opencode.db')).filter(fs.existsSync):[x]));
  const logDirectories=unique((config.logDirectories??['auto']).flatMap(x=>x==='auto'?[...databases.map(d=>path.join(path.dirname(d),'log')),...roots.map(r=>path.join(r,'log'))].filter(fs.existsSync):[x]));
  return {...config,databases,logDirectories};
}
