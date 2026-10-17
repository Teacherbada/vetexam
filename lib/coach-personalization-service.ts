import 'server-only';
import type {PoolClient} from 'pg';
import {emptyCoachState,reviewAfterAnswer,reviewKey,type CoachState} from './coach-personalization';

export async function readCoachState(client:PoolClient,userId:string):Promise<CoachState> {
 const {rows}=await client.query('SELECT coach_state FROM study_plans WHERE user_id=$1',[userId]);
 const state=rows[0]?.coach_state;
 if(state==null)return emptyCoachState();
 if(state.version!==1||!state.reviews||typeof state.reviews!=='object'||Array.isArray(state.reviews))throw Error('Unsupported coach state version');
 return state;
}
// Called only for newly persisted coach answers, inside the existing plan-row lock
// and transaction. Custom plans and ordinary practice never call this function.
export async function recordCoachReview(client:PoolClient,userId:string,item:{question_id:number|null;subject:string;chapter:string|null},correct:boolean) {
 if(!item.chapter||item.question_id===null)return;
 const {rows}=await client.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text date
 FROM questions q JOIN question_sets s ON s.id=q.question_set_id
 WHERE q.id=$1 AND q.kind='exam' AND s.visibility='public' AND q.subject=$2 AND q.chapter=$3`,[item.question_id,item.subject,item.chapter]);
 if(!rows[0])return;
 const state=await readCoachState(client,userId),key=reviewKey(item.subject,item.chapter);
 const next=reviewAfterAnswer(state.reviews[key],{subject:item.subject,chapter:item.chapter,questionId:item.question_id,correct,date:rows[0].date});
 if(!next||next===state.reviews[key])return;
 state.reviews[key]=next;
 await client.query('UPDATE study_plans SET coach_state=$2::jsonb WHERE user_id=$1',[userId,JSON.stringify(state)]);
}
