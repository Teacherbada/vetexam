import {requireAdminPage} from '@/lib/admin-page';
import Proofreading from './Proofreading';
export default async function Page(){await requireAdminPage();return <Proofreading/>;}
