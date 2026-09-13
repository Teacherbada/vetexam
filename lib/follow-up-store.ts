import 'server-only';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { FollowUp } from './follow-up';
import { FOLLOW_UP_INTERVALS_DAYS, MAX_DUE_FOLLOW_UPS_PER_SESSION } from './follow-up-config';

export async function scheduleFollowUp(client: PoolClient, taskId: string, stage = 1, intervals: readonly number[] = FOLLOW_UP_INTERVALS_DAYS, anchor?: string) {
  const days = intervals[stage - 1];
  if (!days) return;
  await client.query(`INSERT INTO chapter_follow_ups(id,user_id,subject,chapter,reinforcement_task_id,review_attempt,stage,due_at,intervals)
    SELECT $1,user_id,subject,chapter,id,review_count,$3,COALESCE($5::timestamptz,verification_completed_at) + ($4 * interval '24 hours'),$6::jsonb
    FROM reinforcement_tasks WHERE id=$2 AND status='short_term' AND verification_completed_at IS NOT NULL
    ON CONFLICT DO NOTHING`, [randomUUID(), taskId, stage, days, anchor ?? null, JSON.stringify(intervals)]);
}
export async function dueFollowUps(client: PoolClient, userId: string): Promise<FollowUp[]> {
  const { rows } = await client.query(`SELECT *, 'due' AS status FROM chapter_follow_ups WHERE user_id=$1 AND status='pending' AND due_at <= CURRENT_TIMESTAMP
    ORDER BY (session_id IS NOT NULL) DESC,due_at,id LIMIT $2`, [userId, MAX_DUE_FOLLOW_UPS_PER_SESSION]);
  return rows;
}
