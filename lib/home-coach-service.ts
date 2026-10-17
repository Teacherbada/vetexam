import 'server-only';
import type {PoolClient} from 'pg';
import type {HomeCoachSummary} from './home-coach';
import type {CoachPlan} from './coach-daily';

// Read-only, no answer keys/text, no global/user-shared cache. A mode lookup is
// the only query for accounts that have not enabled coach.
export async function readHomeCoach(client:PoolClient,userId:string):Promise<HomeCoachSummary>{
 const {rows:[config]}=await client.query(`SELECT p.mode,p.daily_question_target target,
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text date,t.id,t.coach_plan
  FROM study_plans p LEFT JOIN daily_tasks t ON t.user_id=p.user_id AND t.local_date=(CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date
  WHERE p.user_id=$1`,[userId]);
 if(config?.mode!=='coach')return {owner:userId,enabled:false,task:null};
 const {rows:[result]}=await client.query(`WITH today AS (
  SELECT p.answered_at FROM practice_attempts p JOIN questions q ON q.id=p.question_id JOIN question_sets s ON s.id=q.question_set_id
   WHERE p.user_id=$1 AND q.kind='exam' AND s.visibility='public'
    AND p.answered_at>=($3::date::timestamp AT TIME ZONE 'Asia/Taipei') AND p.answered_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')
  UNION ALL
  SELECT i.answered_at FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id
   JOIN questions q ON q.id=i.question_id JOIN question_sets s ON s.id=q.question_set_id
   WHERE d.user_id=$1 AND q.kind='exam' AND s.visibility='public'
    AND i.answered_at>=($3::date::timestamp AT TIME ZONE 'Asia/Taipei') AND i.answered_at<(($3::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')
 ), items AS (
  SELECT l.position,l.source,i.selected_answer IS NOT NULL answered FROM daily_task_items l
   JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position WHERE l.task_id=$2::uuid AND l.user_id=$1
 ) SELECT (SELECT count(*)::int FROM today) total,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('position',position,'source',source,'answered',answered) ORDER BY position) FROM items),'[]'::jsonb) items`,[userId,config.id??null,config.date]);
 const base={owner:userId,enabled:true,date:config.date,target:config.target,todayTotal:result.total};
 if(!config.id)return {...base,task:null};
 const items=result.items as {position:number;source:string;answered:boolean}[],plan=config.coach_plan as CoachPlan|null;
 const count=(positions:number[])=>{const own=items.filter(i=>positions.includes(i.position));return {total:own.length,answered:own.filter(i=>i.answered).length};};
 const groups=(plan?.groups??[]).map(g=>{const n=count(g.positions);return {key:g.key,...n,remaining:n.total-n.answered};});
 const review=groups.find(g=>g.key==='review')??count(items.filter(i=>i.source==='follow_up').map(i=>i.position));
 const busy=plan?.busy?count(plan.busy.positions):null,answered=items.filter(i=>i.answered).length;
 return {...base,task:{total:items.length,answered,remaining:items.length-answered,completed:items.length>0&&answered===items.length,groups,review:{total:review.total,answered:review.answered},compact:busy?{...busy,enabled:plan!.busy!.enabled,completed:busy.total>0&&busy.answered===busy.total}:null}};
}
