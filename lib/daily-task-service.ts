import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { answerDiagnostic, createDiagnosticSession, diagnosticCandidates, DiagnosticError, planMode } from '@/lib/diagnostic-service';
import { answerFollowUp, startFollowUp } from '@/lib/follow-up-service';
import { readWeaknessAnalysis } from '@/lib/confirmation-service';
import { DEFAULT_DAILY_QUESTION_TARGET, DAILY_TASK_TIME_ZONE } from '@/lib/daily-task-config';
import { type DailySource, type DailyView } from '@/lib/daily-task';
import type { Candidate } from '@/lib/diagnostic';
import { dailyMemorySignals } from '@/lib/question-memory-service';
import {COACH_GROUPS,coachQuotas,coachNeedsDiagnostic,selectCoachQuestions,coachGroupViews,coachFeedback,type CoachPlan,type CoachGroup} from './coach-daily';
import {readCoachEvidence,coachReadiness} from './coach-daily-service';

type LinkItem = Candidate & { session_id: string; item_position: number; source: DailySource; follow_up_id: string | null; group?:CoachGroup };
type StoredItem = LinkItem & { position: number; question: string; options: string[]; image: string | null; answer_key: string; selected_answer: string | null; is_correct: boolean | null; explanation: string };
async function settings(client: PoolClient, userId: string) {
  const { rows } = await client.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE $2)::date::text AS date,
    COALESCE((SELECT daily_question_target FROM study_plans WHERE user_id=$1),$3)::int AS target`, [userId,DAILY_TASK_TIME_ZONE,DEFAULT_DAILY_QUESTION_TARGET]);
  return rows[0] as { date: string; target: number };
}
async function items(client: PoolClient, userId: string, taskId: string): Promise<StoredItem[]> {
  const { rows } = await client.query(`SELECT l.position,l.session_id,l.item_position,l.source,l.follow_up_id,
    i.source_question_id AS id,i.subject,i.chapter,i.question,i.options,i.image,i.answer_key,i.selected_answer,i.is_correct,
    CASE WHEN to_jsonb(q)->>'explanation_status'='published' THEN COALESCE(q.explanation,'') ELSE '' END AS explanation FROM daily_task_items l
    JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position
    LEFT JOIN questions q ON q.id=i.question_id AND EXISTS(SELECT 1 FROM question_sets qs WHERE qs.id=q.question_set_id AND qs.visibility='public') WHERE l.task_id=$1 AND l.user_id=$2 ORDER BY l.position`,[taskId,userId]);
  return rows;
}
async function syncCompletion(client: PoolClient, userId: string) {
  await client.query(`UPDATE daily_tasks t SET status='completed',completed_at=(SELECT MAX(i.answered_at) FROM daily_task_items l JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position WHERE l.task_id=t.id)
    WHERE t.user_id=$1 AND t.status='active' AND EXISTS(SELECT 1 FROM daily_task_items WHERE task_id=t.id)
    AND NOT EXISTS(SELECT 1 FROM daily_task_items l JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position WHERE l.task_id=t.id AND i.selected_answer IS NULL)`,[userId]);
}
export async function readDailyTask(client: PoolClient, userId: string): Promise<DailyView> {
  const mode = await planMode(client,userId,false);
  const config = await settings(client,userId);
  const activeTasks = await client.query("SELECT subject,chapter,status FROM reinforcement_tasks WHERE user_id=$1 AND status IN ('reviewing','reviewed','verifying','needs_work','deferred') LIMIT 1",[userId]);
  const active = activeTasks.rows[0] ?? null;
  const analysis = active ? null : await readWeaknessAnalysis(client,userId);
  const queued = active ? null : await client.query("SELECT id FROM reinforcement_tasks WHERE user_id=$1 AND status='queued' LIMIT 1",[userId]);
  const next: DailyView['next'] = active ? 'reinforcement' : analysis?.priorities.length || queued?.rows.length ? 'analysis' : 'done';
  const { rows: tasks } = await client.query('SELECT id,target_count,coach_plan FROM daily_tasks WHERE user_id=$1 AND local_date=$2::date',[userId,config.date]);
  const {rows:[week]}=await client.query(`SELECT count(DISTINCT (i.session_id,i.position))::int answered,
    count(DISTINCT (i.session_id,i.position)) FILTER(WHERE i.is_correct)::int correct,
    count(DISTINCT (i.answered_at AT TIME ZONE 'Asia/Taipei')::date)::int days FROM daily_tasks t JOIN daily_task_items l ON l.task_id=t.id
    JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position
    WHERE t.user_id=$1 AND i.selected_answer IS NOT NULL
    AND i.answered_at>=(date_trunc('week',$2::date)::timestamp AT TIME ZONE 'Asia/Taipei')
    AND i.answered_at<(($2::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')`,[userId,config.date]);
  const base = { mode, owner:userId, ...config, active, next, task:null, receipts:[] };
  if (!tasks[0]) {const initial=await coachReadiness(client,userId),evidence=initial.completed?[]:await readCoachEvidence(client,userId);
    return {...base,coach:{diagnostic:coachNeedsDiagnostic(evidence,initial.completed)?initial:null,groups:[],feedback:null,legacy:false,week}};}
  const rows = await items(client,userId,tasks[0].id);
  const current = rows.find(row => row.selected_answer === null);
  const completed = rows.length > 0 && !current;
  const receipts = rows.filter(row => row.selected_answer !== null).map(row => ({ eventId:`${row.session_id}:${row.item_position}`,position:row.position,id:row.id,subject:row.subject,question:row.question,options:row.options,image:row.image,answer:row.answer_key,explanation:row.explanation,userAnswer:row.selected_answer!,correct:row.is_correct === true }));
  let followUpsCompleted = 0;
  if (completed) {
    const done = await client.query("SELECT COUNT(DISTINCT f.id)::int AS count FROM daily_task_items l JOIN chapter_follow_ups f ON f.id=l.follow_up_id WHERE l.task_id=$1 AND f.status IN ('completed','failed')",[tasks[0].id]);
    followUpsCompleted = done.rows[0].count;
  }
  const plan=tasks[0].coach_plan as CoachPlan|null;
  return { ...base, receipts,coach:{diagnostic:null,groups:plan?.version===2?coachGroupViews(plan,rows):[],feedback:completed?coachFeedback(rows):null,legacy:!plan,week}, task:{ id:tasks[0].id,target:tasks[0].target_count,total:rows.length,answered:receipts.length,completed,
    correct:completed ? receipts.filter(row=>row.correct).length : null,
    current:current ? { position:current.position,question:current.question,options:current.options,image:current.image } : null,
    summary:completed ? (['normal','weakness','follow_up'] as const).map(source => ({ source,total:rows.filter(row=>row.source===source).length,correct:rows.filter(row=>row.source===source && row.is_correct).length })) : [],followUpsCompleted } };
}
export async function ensureDailyTask(client: PoolClient, userId: string): Promise<DailyView> {
  await planMode(client,userId,true);
  await syncCompletion(client,userId);
  const config = await settings(client,userId);
  await client.query("UPDATE daily_tasks SET status='expired' WHERE user_id=$1 AND local_date<$2::date AND status='active'",[userId,config.date]);
  const existing = await client.query('SELECT id FROM daily_tasks WHERE user_id=$1 AND local_date=$2::date',[userId,config.date]);
  if (existing.rows.length) return readDailyTask(client,userId);
  const evidence=await readCoachEvidence(client,userId),initial=await coachReadiness(client,userId);
  if(coachNeedsDiagnostic(evidence,initial.completed))return readDailyTask(client,userId);
  const streams: LinkItem[][] = [];
  const reserved: LinkItem[] = [];
  const quota = coachQuotas(config.target);
  const due = await client.query(`SELECT id FROM chapter_follow_ups WHERE user_id=$1 AND status='pending' AND due_at<=CURRENT_TIMESTAMP
    ORDER BY (session_id IS NOT NULL) DESC,due_at,id LIMIT $2`,[userId,quota.review]);
  for (const followUp of due.rows) {
    if (reserved.length >= quota.review) break;
    await client.query('SAVEPOINT daily_follow_up');
    try {
      const view = await startFollowUp(client,userId,followUp.id,true);
      const pending = await client.query(`SELECT source_question_id AS id,subject,chapter,session_id,position AS item_position FROM diagnostic_items WHERE session_id=$1 AND selected_answer IS NULL ORDER BY position`,[view.session?.id]);
      const links: LinkItem[] = pending.rows.map(row=>({...row,source:'follow_up',group:'review',follow_up_id:followUp.id,last_answered:null}));
      if (!links.length || reserved.length+links.length>quota.review || links.some(row=>reserved.some(old=>old.id===row.id))) {
        await client.query('ROLLBACK TO SAVEPOINT daily_follow_up');
      } else { reserved.push(...links); streams.push(links); }
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT daily_follow_up');
      if (!(error instanceof DiagnosticError && error.status===409)) throw error;
    } finally { await client.query('RELEASE SAVEPOINT daily_follow_up'); }
  }
  const candidates = await diagnosticCandidates(client,userId);
  const memory = await dailyMemorySignals(client,userId,candidates.map(row=>row.id));
  const history = await client.query(`SELECT i.source_question_id AS id,COUNT(*)::int AS appearances,MAX(COALESCE(i.answered_at,d.created_at))::text AS last_seen
    FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id WHERE d.user_id=$1 GROUP BY i.source_question_id`,[userId]);
  const selection = selectCoachQuestions(candidates.map(row=>{
    const past = history.rows.find(old=>old.id===row.id);
    const lastSeen = [past?.last_seen,row.last_answered].filter(Boolean).sort((a,b)=>Date.parse(b)-Date.parse(a))[0] ?? null;
    return {...row,last_seen:lastSeen,appearances:past?.appearances ?? 0};
  }),config.target,reserved.map(r=>r.id),evidence,Date.now(),memory);
  for(const group of COACH_GROUPS){
   const selected=selection.selected.filter(s=>s.group===group).map(s=>s.row);
   if (selected.length) {
    const sessionId = await createDiagnosticSession(client,userId,selected,'daily');
    const snapshots = await client.query('SELECT source_question_id AS id,subject,chapter,session_id,position AS item_position FROM diagnostic_items WHERE session_id=$1 ORDER BY position',[sessionId]);
    streams.push(snapshots.rows.map(row=>({...row,group,source:group==='weakness'?'weakness':'normal',follow_up_id:null,last_answered:null})));
   }
  }
  const ordered = COACH_GROUPS.flatMap(group=>streams.flat().filter(row=>row.group===group));
  if (!ordered.length) return readDailyTask(client,userId);
  const taskId = randomUUID();
  const plan:CoachPlan={version:2,asOf:config.date,evidenceCount:selection.evidenceCount,groups:COACH_GROUPS.map(group=>{
    const own=ordered.filter(r=>r.group===group);return {key:group,reason:selection.reasons[group],positions:ordered.flatMap((r,i)=>r.group===group?[i+1]:[]),
      focus:[...new Set(own.map(r=>r.subject+(r.chapter?'－'+r.chapter:'')))],repeated:own.filter(r=>evidence.some(e=>e.id===r.id)).length};})};
  await client.query('INSERT INTO daily_tasks(id,user_id,local_date,target_count,coach_plan) VALUES($1,$2,$3::date,$4,$5::jsonb)',[taskId,userId,config.date,config.target,JSON.stringify(plan)]);
  await client.query(`INSERT INTO daily_task_items(task_id,user_id,position,source,source_question_id,session_id,item_position,follow_up_id)
    SELECT $1,$2,position,source,id,session_id,item_position,follow_up_id FROM jsonb_to_recordset($3::jsonb)
    AS item(position integer,source text,id integer,session_id uuid,item_position integer,follow_up_id uuid)`,[taskId,userId,JSON.stringify(ordered.map((row,index)=>({...row,position:index+1})))]);
  return readDailyTask(client,userId);
}
export async function setDailyTarget(client: PoolClient, userId: string, target: number) {
  await planMode(client,userId,true);
  await client.query('UPDATE study_plans SET daily_question_target=$2 WHERE user_id=$1',[userId,target]);
  return readDailyTask(client,userId);
}
export async function answerDailyTask(client: PoolClient, userId: string, submission: { taskId: string; position: number; answer: string }) {
  await planMode(client,userId,true);
  const config = await settings(client,userId);
  const { rows: tasks } = await client.query('SELECT id,local_date::text,coach_plan FROM daily_tasks WHERE id=$1 AND user_id=$2 FOR UPDATE',[submission.taskId,userId]);
  if (!tasks[0]) throw new DiagnosticError(404,'找不到你的每日任務。');
  if (tasks[0].local_date!==config.date) throw new DiagnosticError(409,'已進入新的一天，請重新載入今日任務。昨天的紀錄已保留。');
  const rows = await items(client,userId,submission.taskId);
  const row = rows.find(item=>item.position===submission.position);
  if (!row) throw new DiagnosticError(400,'題目位置無效。');
  const plan=tasks[0].coach_plan as CoachPlan|null,group=plan?.groups.find(g=>g.positions.includes(submission.position));
  const pending=rows.find(item=>item.selected_answer===null&&(!plan||group?.positions.includes(item.position)));
  if (row.selected_answer === null && pending?.position!==submission.position) throw new DiagnosticError(409,'請先完成目前任務的題目。');
  const answer = { sessionId:row.session_id,position:row.item_position,answer:submission.answer };
  if (row.source==='follow_up') await answerFollowUp(client,userId,row.follow_up_id!,answer);
  else await answerDiagnostic(client,userId,answer,'daily');
  await syncCompletion(client,userId);
  return readDailyTask(client,userId);
}
