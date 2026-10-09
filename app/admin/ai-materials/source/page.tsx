import {requireAdminPage} from '@/lib/admin-page';
import {uuid} from '@/lib/ai-question-input';
import MaterialSource from './MaterialSource';
export default async function MaterialSourcePage({searchParams}:{searchParams:Promise<{material?:string}>}){
  await requireAdminPage();const {material}=await searchParams;
  if(!uuid(material))return <p>教材識別碼無效</p>;
  return <MaterialSource id={material}/>;
}
