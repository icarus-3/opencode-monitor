import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import {measurement} from './measurement.mjs';
test('frontend renders only current B measurements and escapes model/source text',async()=>{
 const nodes=new Map();const element=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',innerHTML:'',value:'',dataset:{},hidden:false,open:false,classList:{remove(){},toggle(){}},attrs:{},getAttribute(k){return this.attrs[k]},setAttribute(k,v){this.attrs[k]=v},addEventListener(){}});return nodes.get(id);};
 const epoch=new Date(1000).toISOString(),rows=[{id:'1',timestamp:new Date(2000).toISOString(),model:'p/A',decode_tps:1000},{id:'2',timestamp:new Date(3000).toISOString(),model:'p/B<script>',decode_tps:10,input_tokens:100,total_output_tokens:10,decode_duration:1,source:'<script>secret</script>',complete:true}];
 const data={measurement:measurement(rows,epoch),history_models:[{model:'p/A',records:1},{model:'p/B<script>',records:1}],updated:epoch,warnings:[]};
 const context={document:{getElementById:element},Intl,Date,Number,String,Math,Set,Promise,Error,encodeURIComponent,setInterval(){},fetch:async url=>({ok:true,json:async()=>url==='/api/update'?{current:'1.3.0-rc.2',available:false}:data})};
 vm.runInNewContext(fs.readFileSync('public/app.js','utf8'),context);await new Promise(r=>setTimeout(r,30));
 assert.equal(element('live-speed').textContent,'10.00');assert.ok(element('model-name').textContent.includes('p/B<script>'));assert.ok(!element('measurement-records').innerHTML.includes('<script>'));assert.ok(!element('measurement-records').innerHTML.includes('p/A'));assert.ok(element('measurement-records').innerHTML.includes('&lt;script&gt;'));assert.ok(element('record-count').textContent.includes('1'));
});
