import type { PdfLine, PdfRegion } from './pdf-layout';

type Matrix = number[];
const identity = [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
function box(matrix: Matrix, bounds: number[]) {
  const [l,t,r,b] = bounds;
  const points = [[l,t],[r,t],[l,b],[r,b]].map(([x,y]) => [matrix[0]*x+matrix[2]*y+matrix[4], matrix[1]*x+matrix[3]*y+matrix[5]]);
  const x = Math.min(...points.map(p=>p[0])), y = Math.min(...points.map(p=>p[1]));
  return { x, y, width: Math.max(...points.map(p=>p[0]))-x, height: Math.max(...points.map(p=>p[1]))-y };
}

export function textLines(items: { str?: string; transform?: number[]; width?: number; height?: number }[], viewport: { transform: number[] }): PdfLine[] {
  const lines: (PdfLine & { parts: { text: string; x: number; width: number }[] })[] = [];
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const m = multiply(viewport.transform, item.transform);
    const height = Math.hypot(m[2],m[3]) || item.height || 10;
    const top = m[5]-height, x = m[4];
    const line = lines.find(l=>Math.abs(l.top-top)<3);
    const part = { text: item.str, x, width: item.width ?? 0 };
    if (line) { line.parts.push(part); line.bottom = Math.max(line.bottom,m[5]); }
    else lines.push({text:'', x, top, bottom:m[5], parts:[part]});
  }
  return lines.sort((a,b)=>a.top-b.top).map(line=>{
    const parts = line.parts.sort((a,b)=>a.x-b.x);
    return { x:parts[0].x, top:line.top, bottom:line.bottom, text:parts.reduce((s,p,i)=>s+(i && p.x-(parts[i-1].x+parts[i-1].width)>2?' ':'')+p.text,'').trim() };
  });
}

/** Inspect operators only; rendering keeps PDF masks, clipping, labels and colours intact. */
export function imageRegions(ops: Record<string, number>, list: { fnArray: number[]; argsArray: unknown[][] }, viewport: { transform: number[]; width: number; height: number }, page: number): PdfRegion[] {
  let ctm = identity; const stack: Matrix[] = []; const regions: PdfRegion[] = [];
  let pendingPath: ReturnType<typeof box> | null = null;
  const add = (bounds: ReturnType<typeof box>, source: PdfRegion['source']) => {
    if (Object.values(bounds).some(v=>!Number.isFinite(v)) || bounds.width < 6 || bounds.height < 6) return;
    if (source === 'drawing' && (bounds.width < 28 || bounds.height < 28 || bounds.width*bounds.height > viewport.width*viewport.height*.7)) return;
    if (regions.some(r=>Math.abs(r.x-bounds.x)<1 && Math.abs(r.y-bounds.y)<1 && Math.abs(r.width-bounds.width)<1 && Math.abs(r.height-bounds.height)<1)) return;
    regions.push({ ...bounds, page, source, id:`p${page}-r${regions.length}` });
  };
  const local = (matrix: Matrix = identity) => box(multiply(viewport.transform,multiply(ctm,matrix)),[0,0,1,1]);
  for (let i=0;i<list.fnArray.length;i++) {
    const fn=list.fnArray[i], a=list.argsArray[i] ?? [];
    if (fn===ops.save || fn===ops.paintFormXObjectBegin) { stack.push([...ctm]); if (fn===ops.paintFormXObjectBegin && Array.isArray(a[0])) ctm=multiply(ctm,a[0]); }
    else if (fn===ops.restore || fn===ops.paintFormXObjectEnd) ctm=stack.pop() ?? identity;
    else if (fn===ops.transform) ctm=multiply(ctm,a as number[]);
    else if (fn===ops.constructPath && a[2]) pendingPath=box(multiply(viewport.transform,ctm),Array.from(a[2] as ArrayLike<number>));
    else if ([ops.stroke,ops.closeStroke,ops.fill,ops.eoFill,ops.fillStroke,ops.eoFillStroke,ops.closeFillStroke,ops.closeEOFillStroke].includes(fn)) { if (pendingPath) add(pendingPath,'drawing'); pendingPath=null; }
    else if (fn===ops.endPath) pendingPath=null;
    else if (fn===ops.paintImageXObjectRepeat || fn===ops.paintImageMaskXObjectRepeat) {
      const mask=fn===ops.paintImageMaskXObjectRepeat;
      const positions=Array.from((a[mask?5:3] ?? []) as ArrayLike<number>);
      for(let j=0;j+1<positions.length;j+=2) add(local(mask?[Number(a[1]),Number(a[2]),Number(a[3]),Number(a[4]),positions[j],positions[j+1]]:[Number(a[1]),0,0,Number(a[2]),positions[j],positions[j+1]]),'raster');
    } else if (fn===ops.paintImageMaskXObjectGroup) {
      for (const image of (a[0] ?? []) as {transform:number[]}[]) add(local(image.transform),'raster');
    } else if ([ops.paintImageXObject,ops.paintInlineImageXObject,ops.paintJpegXObject,ops.paintImageMaskXObject].includes(fn)) add(local(),'raster');
  }
  // Overlapping fragments are one visual region. Do not merge independent side-by-side figures.
  const groups: PdfRegion[] = [];
  for (const region of regions) {
    let merged = region;
    for (let i=groups.length-1;i>=0;i--) {
      const other=groups[i];
      const overlapX=Math.min(merged.x+merged.width,other.x+other.width)-Math.max(merged.x,other.x);
      const overlapY=Math.min(merged.y+merged.height,other.y+other.height)-Math.max(merged.y,other.y);
      const tiles=overlapX/Math.min(merged.width,other.width)>.9 && Math.abs(merged.width-other.width)<4 && overlapY>=-2;
      if (!(overlapX>0 && overlapY>0) && !tiles) continue;
      const x=Math.min(merged.x,other.x),y=Math.min(merged.y,other.y);
      merged={...merged,x,y,width:Math.max(merged.x+merged.width,other.x+other.width)-x,height:Math.max(merged.y+merged.height,other.y+other.height)-y,source:merged.source===other.source?merged.source:'rendered'};
      groups.splice(i,1);
    }
    groups.push(merged);
  }
  return groups.sort((a,b)=>a.y-b.y||a.x-b.x);
}
