import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync } from 'node:fs';
const base=process.env.TEST_BASE_URL;
if(!base || !/^http:\/\/(localhost|127\.0\.0\.1):/.test(base))throw Error('Explicit localhost base required');
const phase=process.argv[2], results=[];
for(const path of ['/api/auth/get-session','/api/learning','/api/learning/summary','/api/quiz?scope=public&settings=1&chapters=1','/api/stats/weekly-most-missed','/api/admin/status']){
 if(phase==='before'&&path.endsWith('/summary'))continue;
 for(let run=0;run<4;run++){const start=performance.now(),r=await fetch(base+path),headers=performance.now(),body=await r.text();assert.equal(r.status,path.endsWith('/admin/status')?401:200,path);results.push({path,run,status:r.status,ttfbMs:Math.round(headers-start),totalMs:Math.round(performance.now()-start),bytes:Buffer.byteLength(body)});}
}
mkdirSync('.tmp/home-read',{recursive:true});writeFileSync(`.tmp/home-read/${phase}-public-local.json`,JSON.stringify(results,null,2));console.log(results);
