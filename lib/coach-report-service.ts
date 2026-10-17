import 'server-only';
import type {PoolClient} from 'pg';
import {planMode} from './diagnostic-service';
import {coachWeek,addDays,focusForWeek,dueReviews,comparableTrends,type CoachReport,type TrendRow} from './coach-personalization';
import {readCoachState} from './coach-personalization-service';
import {readCoachEvidence} from './coach-daily-service';
import {coachTargets} from './coach-daily';

export async function setCoachFocus(client:PoolClient,userId:string,subject:string|null) {
 await planMode(client,userId,true);
 const {rows:[clock]}=await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text date");
 const state=await readCoachState(client,userId);
 state.focus={week:coachWeek(clock.date),subject};
 await client.query('UPDATE study_plans SET coach_state=$2::jsonb WHERE user_id=$1',[userId,JSON.stringify(state)]);
 return {focus:subject,week:state.focus.week};
}
export async function readCoachReport(client:PoolClient,userId:string):Promise<CoachReport> {
 await planMode(client,userId,false);
 const {rows:[clock]}=await client.query("SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei')::date::text date");
 const date=clock.date as string,week=coachWeek(date),previous=addDays(week,-7);
 const state=await readCoachState(client,userId);
 const {rows:[stats]}=await client.query(`WITH linked AS (
  SELECT t.id,t.local_date,t.coach_plan,l.position,i.session_id,i.position item_position,i.selected_answer,i.is_correct,i.answered_at,
    (l.source='follow_up' OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(t.coach_plan->'groups','[]'::jsonb)) g
      WHERE g->>'key'='review' AND (g->'positions') @> to_jsonb(l.position))) review
  FROM daily_tasks t JOIN daily_task_items l ON l.task_id=t.id
  JOIN diagnostic_items i ON i.session_id=l.session_id AND i.position=l.item_position
  WHERE t.user_id=$1 AND t.local_date BETWEEN $2::date AND $3::date
 ), recent_answers AS (
  SELECT i.is_correct FROM diagnostic_items i
  WHERE i.answered_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Taipei')
   AND i.answered_at < (($3::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')
   AND EXISTS(SELECT 1 FROM daily_task_items l WHERE l.user_id=$1 AND l.session_id=i.session_id AND l.item_position=i.position)
 ), completed AS (
  SELECT local_date FROM linked WHERE local_date >= $2::date GROUP BY id,local_date,coach_plan
  HAVING bool_and(selected_answer IS NOT NULL) OR
   (count(*) FILTER(WHERE (coach_plan->'busy'->'positions') @> to_jsonb(position))>0 AND
    bool_and(selected_answer IS NOT NULL) FILTER(WHERE (coach_plan->'busy'->'positions') @> to_jsonb(position)))
 ) SELECT
  (SELECT count(*)::int FROM recent_answers) answered,
  (SELECT count(*)::int FROM recent_answers WHERE is_correct) correct,
  (SELECT count(DISTINCT local_date)::int FROM completed) AS "completedDays",
  count(DISTINCT(session_id,item_position)) FILTER(WHERE review AND local_date >= $2::date)::int "reviewTotal",
  count(DISTINCT(session_id,item_position)) FILTER(WHERE review AND local_date >= $2::date AND selected_answer IS NOT NULL)::int "reviewDone"
 FROM linked`,[userId,week,date]);
 // Compare the same question IDs in the same chapter, using the latest answer in
 // each equal-length week-to-date window. No all-history scan or inferred concept.
 const {rows}=await client.query(`WITH bounded AS (
  SELECT i.source_question_id id,i.subject,i.chapter,i.is_correct correct,i.answered_at,
   md5(jsonb_build_array(i.question,i.options,i.answer_key)::text) fingerprint,
   CASE WHEN i.answered_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Taipei') THEN 'current' ELSE 'previous' END period
  FROM diagnostic_items i JOIN diagnostic_sessions d ON d.id=i.session_id
  JOIN questions q ON q.id=i.question_id JOIN question_sets s ON s.id=q.question_set_id
  WHERE d.user_id=$1 AND d.kind<>'custom' AND q.kind='exam' AND s.visibility='public'
   AND i.subject=q.subject AND i.chapter=q.chapter
   AND i.answered_at >= ($3::date::timestamp AT TIME ZONE 'Asia/Taipei')
   AND i.answered_at < (($4::date+1)::timestamp AT TIME ZONE 'Asia/Taipei')
   AND (i.answered_at >= ($2::date::timestamp AT TIME ZONE 'Asia/Taipei') OR i.answered_at < (($4::date-6)::timestamp AT TIME ZONE 'Asia/Taipei'))
 ) SELECT DISTINCT ON(id,period) id,subject,chapter,correct,period,fingerprint FROM bounded ORDER BY id,period,answered_at DESC,correct ASC`,[userId,week,previous,date]);
 const evidence=await readCoachEvidence(client,userId);
 return {date,week,focus:focusForWeek(state,date),due:dueReviews(state,date).map(({subject,chapter,due,failures,lapses})=>({subject,chapter,due,failures,lapses})),upcoming:Object.values(state.reviews).filter(r=>r.due>date).sort((a,b)=>a.due.localeCompare(b.due)).slice(0,5).map(({subject,chapter,due})=>({subject,chapter,due})),weekStats:stats,
  weak:coachTargets(evidence).filter(t=>t.chapter).slice(0,3),trends:comparableTrends(rows as TrendRow[])};
}
