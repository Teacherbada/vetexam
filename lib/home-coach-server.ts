import 'server-only';
import {auth} from './auth';
import {questionTransaction} from './question-transaction';
import {readHomeCoach} from './home-coach-service';
import {noHomeCoach,type HomeCoachSummary} from './home-coach';

export async function initialHomeCoach(headers:Headers):Promise<HomeCoachSummary>{
 if(!headers.get('cookie'))return noHomeCoach;
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([
  (async()=>{const session=await auth.api.getSession({headers});return session?.user?.id?questionTransaction(client=>readHomeCoach(client,session.user.id)):noHomeCoach;})(),
  new Promise<HomeCoachSummary>(resolve=>{timer=setTimeout(()=>resolve(noHomeCoach),2500);}),
 ]);}catch{return noHomeCoach;}finally{clearTimeout(timer);}
}
