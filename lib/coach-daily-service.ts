import 'server-only';
import type {PoolClient} from 'pg';
import {COACH_RULES,type CoachEvidence} from './coach-daily';
// Aggregate per question once: repeat submissions already have unique event/session keys.
// First-answer summaries are only a fallback when no detailed attempt exists.
export async function readCoachEvidence(client:PoolClient,userId:string):Promise<CoachEvidence[]>{
 const {rows}=await client.query(`WITH events AS (
  SELECT i.source_question_id id,i.is_correct correct,i.answered_at at
  FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id
  WHERE d.user_id=$1 AND i.answered_at>=CURRENT_TIMESTAMP-($2::int*interval '1 day')
  UNION ALL SELECT question_id,is_correct,answered_at FROM practice_attempts
  WHERE user_id=$1 AND answered_at>=CURRENT_TIMESTAMP-($2::int*interval '1 day')
 ), evidence AS (
  SELECT * FROM events
  UNION ALL SELECT s.question_id,s.is_correct,s.created_at FROM question_answer_stats s
  WHERE s.user_id=$1 AND s.created_at>=CURRENT_TIMESTAMP-($2::int*interval '1 day')
   AND NOT EXISTS(SELECT 1 FROM events e WHERE e.id=s.question_id)
 ), summary AS (
  SELECT id,(array_agg(correct ORDER BY at DESC,correct ASC))[1] correct,
   count(*) FILTER(WHERE NOT correct)::int wrong_count,max(at)::text last_answered FROM evidence GROUP BY id
 ) SELECT s.*,q.subject,q.chapter,m.due::text,m.last_review::text
 FROM summary s JOIN questions q ON q.id=s.id JOIN question_sets qs ON qs.id=q.question_set_id
 LEFT JOIN question_memory_state m ON m.user_id=$1 AND m.question_id=q.id
 WHERE q.kind='exam' AND qs.visibility='public'`,[userId,COACH_RULES.recentDays]);
 // Older due cards come from the existing dailyMemorySignals query, separately from evidence.
 return rows;
}
export async function coachReadiness(client:PoolClient,userId:string){
 const {rows}=await client.query(`SELECT d.id,d.completed_at,(SELECT count(*)::int FROM diagnostic_items i WHERE i.session_id=d.id AND i.selected_answer IS NOT NULL) answered,
 (SELECT count(*)::int FROM diagnostic_items i WHERE i.session_id=d.id) total FROM diagnostic_sessions d WHERE user_id=$1 AND kind='initial' ORDER BY created_at DESC LIMIT 1`,[userId]);
 const r=rows[0];return {completed:Boolean(r?.completed_at),answered:Number(r?.answered??0),total:Number(r?.total??0)};
}
