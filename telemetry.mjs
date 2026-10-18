// Performance metadata only. Never persist arbitrary source objects or log lines.
export const EXTRACTOR_VERSION = 5;
const fields = (obj, keys) => Object.fromEntries(keys.filter(k => typeof obj?.[k]==='number'&&Number.isFinite(obj[k])).map(k => [k, obj[k]]));
const identifiers=(obj,keys)=>Object.fromEntries(keys.filter(k=>typeof obj?.[k]==='string'&&/^[\w./:+-]{1,200}$/.test(obj[k])).map(k=>[k,obj[k]]));
export function projectMessage(m) {
  const r={...identifiers(m,['role','providerID','modelID','finish','agent']),...fields(m,['cost']),summary:!!m.summary};
  r.model=identifiers(m.model,['providerID','id','modelID']);
  r.time=fields(m.time,['created','completed']);
  r.tokens={...fields(m.tokens,['input','output','reasoning']),cache:fields(m.tokens?.cache,['read','write'])};
  if(m.error)r.error={...identifiers(m.error,['name']),data:fields(m.error.data,['statusCode'])};
  if(Array.isArray(m.content))r.content=m.content.map(projectPart);
  return r;
}
export function projectPart(p) {return {...identifiers(p,['type']),time:fields(p.time,['start','end','created','completed'])};}
