export function makePDF(texts, visual = false) {
  const objects=['','<< /Type /Catalog /Pages 2 0 R >>','', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const ids=[];
  for (const text of texts) {
    const id=objects.length; ids.push(id);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id+1} 0 R >>`);
    const lines=text.match(/.{1,72}(?:\s|$)/g) || [''];
    const escaped=lines.map(line=>'('+line.trim().replace(/[\\()]/g,character=>'\\'+character)+') Tj').join(' T* ');
    const content=`BT /F1 12 Tf 16 TL 50 720 Td ${escaped} ET\n${visual?'20 20 100 50 re S':''}`;
    objects.push(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  }
  objects[2]=`<< /Type /Pages /Kids [${ids.map(id=>id+' 0 R').join(' ')}] /Count ${ids.length} >>`;
  let pdf='%PDF-1.4\n'; const offsets=[0];
  for(let i=1;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for(const offset of offsets.slice(1))pdf+=`${String(offset).padStart(10,'0')} 00000 n \n`;
  pdf+=`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}
export const sourceText='Teaching example: A survey includes 100 animals. Two animals meet the case definition. The proportion is 2 divided by 100, or 2 percent. This is a fictional arithmetic exercise, not clinical advice.';
