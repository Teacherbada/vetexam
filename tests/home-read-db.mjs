// All fixtures are CTEs in SELECT statements inside a READ ONLY transaction.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import pg from 'pg';
function load(path){const exports={};new Function('require','exports',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(()=>({}),exports);return exports;}
const stats=load('lib/question-stats.ts'), service=load('lib/learning-service.ts');
const env=readFileSync(process.env.PROFILE_ENV_FILE||'../../.env.local','utf8');const connectionString=env.match(/^DATABASE_URL\s*=\s*["']?([^\r\n"']+)/m)?.[1];
const client=new pg.Client({connectionString,connectionTimeoutMillis:10000});
try {await client.connect();await client.query('BEGIN READ ONLY');await client.query("SET LOCAL statement_timeout='20s'");
 const fixture=`WITH question_sets(id,visibility,exam_year) AS (VALUES (1,'public',115),(2,'private',115)),
 questions(id,question_set_id,question_number,subject,question,answer,option_a,option_b,option_c,option_d,option_e) AS (
 VALUES (1,1,1,'獸醫病理學','valid E','E','a','b','','','e'),
 (2,2,2,'獸醫病理學','private','A','a','b','','',''),
 (3,1,3,'獸醫病理學','  ','A','a','b','','',''),
 (4,1,4,'獸醫病理學','invalid answer','F','a','b','','',''),
 (5,1,5,'獸醫病理學','missing option','E','a','b','','',''),
 (6,1,6,'獸醫病理學','only one option','A','a','','','','')) `;
 for(let i=0;i<4;i++){const rows=await stats.randomPublicChallenge(async(sql,v)=>(await client.query(fixture+sql,v)).rows);assert.equal(rows.length,1);assert.equal(rows[0].question_id,1);assert.equal(rows[0].wrong_attempts,undefined);}
 assert.equal((await stats.randomPublicChallenge(async(sql,v)=>(await client.query(fixture+sql.replace("WHERE qs.visibility='public'","WHERE q.id<>1 AND qs.visibility='public'"),v)).rows)).length,0);
 // weeklyMostMissed groups by the real table primary key; use a SELECT-only
 // fixture version with explicit dependent columns for the CTE's lack of PK.
 const weeklyFixture=`WITH question_sets(id,visibility,exam_year) AS (VALUES (1,'public',115)), questions(id,question_set_id,question_number,subject,question,answer) AS (VALUES (1,1,1,'獸醫病理學','weekly','A')),
 question_answer_stats(question_id,is_correct,created_at) AS (SELECT 1,false,CURRENT_TIMESTAMP FROM generate_series(1,$2::int)) `;
 for(const [n,expected] of [[9,0],[10,1],[12,1]]){const rows=await stats.weeklyMostMissed(async(sql,v)=>(await client.query(weeklyFixture+sql.replace('GROUP BY q.id, qs.exam_year','GROUP BY q.id, qs.exam_year, q.question_number, q.subject, q.question'),[...v,n])).rows);assert.equal(rows.length,expected);if(expected)assert.equal(rows[0].wrong_attempts,n);}
 const summaryFixture=`WITH boundary AS (SELECT DATE_TRUNC('day',CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Taipei') AT TIME ZONE 'Asia/Taipei' AS start),
 questions(id,subject,chapter) AS (VALUES (1,'subject',NULL::text)),
 question_answer_stats(question_id,user_id,is_correct) AS (VALUES (1,'alice',true),(1,'other',false)),
 practice_attempts(question_id,user_id,selected_answer,is_correct,answered_at,mode) AS (
 SELECT 1,'alice','A',true,start+delta,'practice' FROM boundary CROSS JOIN (VALUES(INTERVAL '0 seconds'),(INTERVAL '-1 millisecond'),(INTERVAL '1 day')) offsets(delta)),
 diagnostic_sessions(id,user_id,kind) AS (VALUES (1,'alice','initial'),(2,'other','initial')),
 diagnostic_items(session_id,source_question_id,subject,chapter,selected_answer,is_correct,answered_at) AS (
 SELECT id,1,'subject',NULL::text,'A',true,start+INTERVAL '1 hour' FROM diagnostic_sessions CROSS JOIN boundary), progress`;
 const boundarySummary=await service.readLearningSummary({query:(sql,v)=>client.query(sql.replace('WITH progress',summaryFixture),v)},'alice');assert.equal(boundarySummary.todayCompleted,2);assert.deepEqual(boundarySummary.progress,{subject:{completed:1,correct:1,wrong:0}});
 const users=await client.query('SELECT user_id FROM practice_attempts GROUP BY user_id ORDER BY COUNT(*) DESC LIMIT 1');if(users.rows[0]){const id=users.rows[0].user_id;const full=await service.readLearning(client,id),summary=await service.readLearningSummary(client,id);assert.deepEqual(summary.progress,Object.fromEntries(Object.entries(full.progress).map(([subject,r])=>[subject,{completed:r.answered.length,correct:r.correct,wrong:r.wrong}])));const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei'});assert.equal(summary.todayCompleted,full.history.filter(r=>date.format(new Date(r.answered_at))===summary.todayDate).length);}
 await client.query('ROLLBACK');console.log('PASS READ ONLY PostgreSQL: fallback privacy/blank/answer/missing option/options count/E/empty; weekly threshold; summary equals full progress and Taiwan daily count');
}finally{await client.end();}
