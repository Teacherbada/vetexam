import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path, mocks = {}) {
  const exports={};
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('exports','require',code)(exports,name=>{if(name in mocks)return mocks[name];throw new Error('Unexpected import '+name)}); return exports;
}
const {parsePdfLayout,assessQuestion}=load('lib/pdf-layout.ts');
const {textLines,imageRegions}=load('lib/pdf-geometry.ts');
const line=(text,top)=>({text,top,bottom:top+12,x:40});
const page=(lines,images=[],number=1)=>({page:number,width:600,height:800,lines,images});
const body=(n=1,y=100,options=['A','B','C','D'],answer='A')=>[line(`${n}. 下列關於犬之敘述何者正確？`,y),...options.map((o,i)=>line(`${o}. 選項${o}`,y+30+i*24)),...(answer?[line(`答案：${answer}`,y+160)]:[])];
const image=(id,y,p=1,x=60)=>({id,page:p,x,y,width:100,height:50,source:'raster'});

test('single Chinese text question, A-D, explicit answer and confidence',()=>{
  const [q]=parsePdfLayout([page(body())]); assert.equal(q.questionNumber,1); assert.equal(q.options.length,4); assert.equal(q.answer,'A'); assert.equal(q.confidence,100); assert.match(q.question,/關於犬/);
});
test('multiple questions preserve order and do not attach same-page figures to all',()=>{
  const q=parsePdfLayout([page([...body(),...body(2,400)],[image('figure',300)])]);
  assert.equal(q.length,2);assert.equal(q[0].regions.length,1);assert.equal(q[1].regions.length,0);
});
test('question stem continues on next page until next legal question',()=>{
  const q=parsePdfLayout([page([line('1. 此題跨頁',700)]),page([line('接續題幹',90),...body().slice(1),...body(2,400)],[],2)]);
  assert.match(q[0].question,/接續題幹/); assert.equal(q[0].endPage,2);assert(q[0].warnings.includes('跨頁'));
});
test('C/D options and image at top of next page belong to previous question',()=>{
  const q=parsePdfLayout([page(body(1,600,['A','B'],null)),page([line('C. 第三選項',90),line('D. 第四選項',120),line('答案：C',160),...body(2,400)],[image('continued',200,2)],2)]);
  assert.equal(q[0].options[2],'第三選項');assert.equal(q[0].answer,'C');assert.equal(q[0].regions[0].page,2);assert.equal(q[1].regions.length,0);
});
test('image above first stem is retained with ambiguity for review',()=>{
  const [q]=parsePdfLayout([page(body(1,200),[image('above',120)])]);assert.equal(q.regions.length,1);assert(q.warnings.includes('圖片不確定'));
});
test('image below stem and two figures retain full bounding boxes and order',()=>{
  const [q]=parsePdfLayout([page(body(),[image('one',130),image('two',200)])]);assert.equal(q.regions.length,2);assert.equal(q.regions[0].width,100);assert.equal(q.regions[1].id,'two');
});
test('image between two questions goes to preceding span but near boundary is ambiguous',()=>{
  const q=parsePdfLayout([page([...body(),...body(2,400)],[image('between',340)])]);assert.equal(q[0].regions.length,1);assert(q[0].warnings.includes('圖片不確定'));assert.equal(q[1].regions.length,0);
});
test('repeated positional headers/footers and changing page numbers are removed',()=>{
  const pages=[1,2,3].map(n=>page([line('115 年獸醫師國家考試',20),...body(n),line('考試名稱及科目',740),line(`第 ${n} 頁 共 3 頁`,775)],[],n));
  const q=parsePdfLayout(pages);assert.equal(q.length,3);assert(q.every(q=>!/115 年|考試名稱|第.*頁/.test(q.rawText)));
});
test('A-E and fullwidth option labels retain E and its answer',()=>{
  const [q]=parsePdfLayout([page([line('（1）下列何者正確？',100),...['Ａ','Ｂ','Ｃ','Ｄ','Ｅ'].map((o,i)=>line(`（${o}）中文${o}`,140+i*25)),line('答案：Ｅ',300)])]);assert.equal(q.options.length,5);assert.equal(q.answer,'E');assert.equal(q.confidence,100);
});
test('missing option preserves its letter slot and does not shift answer',()=>{
  const [q]=parsePdfLayout([page(body(1,100,['A','C','D'],'D'))]);assert.equal(q.options[1],'');assert.equal(q.options[2],'選項C');assert(q.warnings.includes('缺選項'));assert(q.confidence<70);
});
test('missing/conflicting answers remain null; no guessing',()=>{
  assert.equal(parsePdfLayout([page(body(1,100,undefined,null))])[0].answer,null);
  assert.equal(parsePdfLayout([page([...body(),line('答案：B',290)])])[0].answer,null);
});
test('skipped/duplicate question numbers are flagged without losing either result',()=>{
  const q=parsePdfLayout([page([...body(),...body(3,350),...body(3,600)])]);assert.equal(q.length,3);assert.equal(new Set(q.map(q=>q.id)).size,3);assert(q[1].warnings.includes('題號不連續'));assert(q[2].warnings.includes('題號不連續'));
});
test('one malformed question does not discard successful neighbours',()=>{
  const q=parsePdfLayout([page([...body(),line('2. ',350),...body(3,450)])]);assert.equal(q.length,3);assert.equal(q[0].confidence,100);assert(q[1].confidence<70);assert.equal(q[2].confidence,100);
});
test('115 year header is not a question; inline A-E options work',()=>{
  const q=parsePdfLayout([page([line('115 年第二次獸醫師考試',20),line('1. 正確敘述？',100),line('(A) 甲 (B) 乙 (C) 丙 (D) 丁 (E) 戊',140),line('答案：E',180)])]);assert.equal(q.length,1);assert.equal(q[0].options[4],'戊');
});
test('page extraction warning affects review rather than dropping whole PDF',()=>{
  const q=parsePdfLayout([page(body()),{...page(body(2),[],2),warning:'圖片擷取失敗'}]);assert.equal(q.length,2);assert(q[1].warnings.includes('parser 警告'));
});
test('text geometry uses viewport transform and assembles split question numbers',()=>{
  const l=textLines([{str:'1',transform:[12,0,0,12,40,700],width:6},{str:'. 問題',transform:[12,0,0,12,46,700],width:60}],{transform:[1,0,0,-1,0,800]});assert.equal(l[0].text,'1. 問題');assert.equal(l[0].top,88);
});
test('image transform stack, typed repeat positions, masks and painted vectors',()=>{
  const ops={save:1,restore:2,transform:3,paintImageXObject:4,paintImageXObjectRepeat:5,paintImageMaskXObject:6,constructPath:7,stroke:8,endPath:9};
  const list={fnArray:[1,3,4,2,5,1,3,6,2,7,8],argsArray:[[],[100,0,0,50,50,600],['image'],[],['repeat',70,70,new Float32Array([200,400,300,400])],[],[60,0,0,60,50,300],['mask'],[],[[],[],[50,50,200,200]],[]]};
  const r=imageRegions(ops,list,{transform:[1,0,0,-1,0,800],width:600,height:800},1);assert.equal(r.length,5);assert.equal(r[0].y,150);assert(r.some(x=>x.source==='drawing'));assert(r.some(x=>x.x===300));
});
test('invalid answer is penalized; manual content repairs recompute deterministic score',()=>{
  assert(assessQuestion({questionNumber:1,question:'題幹',options:['甲','乙','丙','丁'],answer:'E',warnings:[]}).confidence<90);
  assert.equal(assessQuestion({questionNumber:1,question:'題幹',options:['甲','乙','丙','丁'],answer:'B',warnings:[]}).confidence,100);
});

// Small real PDF fixture exercises actual PDF.js parsing, raster operators and canvas rendering.
function fixturePdf() {
  const content='BT /F1 12 Tf 40 700 Td (1. Which figure?) Tj 0 -30 Td (A. one) Tj 0 -24 Td (B. two) Tj 0 -24 Td (C. three) Tj 0 -24 Td (D. four) Tj ET\nq 100 0 0 100 40 350 cm /Im1 Do Q\n0 0 1 RG 200 350 100 100 re S';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> /XObject << /Im1 6 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${content.length} >>\nstream\n${content}\nendstream`,'<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 7 >>\nstream\nFF0000>\nendstream'];
  let pdf='%PDF-1.4\n';const offsets=[0];objects.forEach((o,i)=>{offsets.push(pdf.length);pdf+=`${i+1} 0 obj\n${o}\nendobj\n`});const xref=pdf.length;pdf+=`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map(o=>String(o).padStart(10,'0')+' 00000 n \n').join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new Uint8Array(Buffer.from(pdf));
}
test('real PDF fixture: extract text/raster/drawing and render pixels with installed canvas',async()=>{
  const canvas=await import('@napi-rs/canvas');for(const key of ['DOMMatrix','Path2D','ImageData'])globalThis[key]??=canvas[key];
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const pdf=await pdfjs.getDocument({data:fixturePdf(),useSystemFonts:false,standardFontDataUrl:process.cwd()+"/node_modules/pdfjs-dist/standard_fonts/"}).promise;
  try {const p=await pdf.getPage(1),v=p.getViewport({scale:1});const images=imageRegions(pdfjs.OPS,await p.getOperatorList(),v,1);const [q]=parsePdfLayout([page(textLines((await p.getTextContent()).items,v),images)]);assert.equal(q.options.length,4);assert.equal(images.length,2);assert(q.regions.some(r=>r.source==='drawing'));const rendered=canvas.createCanvas(600,800);await p.render({canvasContext:rendered.getContext('2d'),viewport:v}).promise;const pixel=rendered.getContext('2d').getImageData(60,380,1,1).data;assert(pixel[0]>240&&pixel[1]<10);}
  finally{await pdf.destroy()}
});

test('actual PDF routes keep geometry consistent, return both figures and share concurrent page rendering',async()=>{
  const pdfjs=await import('pdfjs-dist/legacy/build/pdf.mjs');const {createHash}=await import('node:crypto');
  const common={'next/server':{NextResponse:{json:Response.json}},'@/lib/auth':{auth:{api:{getSession:async()=>({user:{id:'fixture'}})}}},crypto:{createHash},'node:crypto':{createHash}};
  const oldDatabase=process.env.DATABASE_URL,oldAdmin=process.env.ADMIN_USER_ID;
  process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:9/fixture';process.env.ADMIN_USER_ID='fixture';
  const form=()=>{const f=new FormData();f.append('file',new File([fixturePdf()],'fixture.pdf',{type:'application/pdf'}));f.append('examYear','2026');f.append('examSubject','獸醫病理學');return f};
  try {
    const parse=load('app/api/pdf/route.ts',{...common,'pdfjs-dist/legacy/build/pdf.mjs':pdfjs,'@neondatabase/serverless':{neon:()=>async()=>[]},'@/lib/pdf-layout':load('lib/pdf-layout.ts'),'@/lib/pdf-geometry':load('lib/pdf-geometry.ts')});
    const response=await parse.POST(new Request('http://localhost/api/pdf',{method:'POST',body:form()}));assert.equal(response.status,200);const data=await response.json();assert.equal(data.questions.length,1);assert.equal(data.questions[0].regions.length,2);assert.equal(data.questions[0].answer,null);assert.equal(data.fileHash,createHash('sha256').update(fixturePdf()).digest('hex'));
    let renders=0;const seen=new WeakSet();
    const measured={...pdfjs,getDocument:(...args)=>{const task=pdfjs.getDocument(...args);return {promise:task.promise.then(pdf=>{
      const getPage=pdf.getPage.bind(pdf);pdf.getPage=async n=>{const p=await getPage(n);if(!seen.has(p)){seen.add(p);const render=p.render.bind(p);p.render=(...args)=>{renders++;return render(...args)}}return p};return pdf;
    })}}};
    const images=load('app/api/pdf/images-v10/route.ts',{...common,'pdfjs-dist/legacy/build/pdf.mjs':measured});
    const request=()=>{const f=form();f.append('pageNumber','1');f.append('questionNumber','1');f.append('regions',JSON.stringify(data.questions[0].regions));return new Request('http://localhost/api/pdf/images-v10',{method:'POST',body:f})};
    const results=await Promise.all([images.POST(request()),images.POST(request())]);
    for(const r of results){assert.equal(r.status,200);const body=await r.json();assert.equal(body.imageCount,2);assert(body.imageDataUrls.every(url=>url.startsWith('data:image/png;base64,')))}
    assert.equal(renders,1,'same page rendered once across concurrent requests');
    const cached=await(await images.POST(request())).json();assert.equal(cached.debug.stage,'image-cache-hit');assert.equal(renders,1);
  } finally {if(oldDatabase===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDatabase;if(oldAdmin===undefined)delete process.env.ADMIN_USER_ID;else process.env.ADMIN_USER_ID=oldAdmin}
});
