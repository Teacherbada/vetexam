// Local browser-test entry point only; never commit or deploy the generated route.
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync, readFileSync, existsSync } from 'node:fs';
const dir=new URL('../app/ui-phase2-fixture/',import.meta.url),file=new URL('page.tsx',dir);
if(process.argv.includes('--setup')){
 mkdirSync(dir,{recursive:true});
 writeFileSync(file,'import Dashboard from "@/app/admin/AdminDashboard"; import Questions from "@/app/admin/questions/QuestionsAdmin"; import Users from "@/app/admin/users/Users"; import Reports from "@/app/admin/reports/Reports"; export default async function Fixture({searchParams}:{searchParams:Promise<{screen?:string}>}){ const {screen}=await searchParams; return screen==="users"?<Users/>:screen==="reports"?<Reports/>:screen==="questions"?<Questions/>:<Dashboard/>; }');
}else if(process.argv.includes('--cleanup')){
 if(existsSync(file)){unlinkSync(file);rmdirSync(dir)}
 for(const path of ['.next/dev/types/app/ui-phase2-fixture/page.ts','.next/dev/types/validator.ts','.next/dev/types/routes.d.ts']){
  const generated=new URL('../'+path,import.meta.url);
  if(existsSync(generated)&&readFileSync(generated,'utf8').includes('ui-phase2-fixture'))unlinkSync(generated);
 }
}
else throw Error('Use --setup before local test build; --cleanup before final build.');
