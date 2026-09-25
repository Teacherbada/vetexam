# Account learning

Base: verified GitHub main 2a82dd3. Branch: feat/account-learning. Original worktree changes are preserved.

## Phase 1
- practice_attempts stores general/exam attempts; user + event UUID deduplicates retries.
- Existing diagnostic_items / diagnostic_sessions remain the only coach/custom attempt store.
- question_answer_stats retains its existing per-user/question first-answer constraint.
- question_review_state stores favorites, wrong-book dismissals and notes.
- GET /api/learning reads the authenticated account. POST actions: answers, review, import. All mutations verify session identity, expected owner and origin.
- learning_imports preserves legacy progress, dailyProgress, favorites and wrongQuestions. Legacy aggregate counts cannot recover per-question correctness or timestamps, so they are archived separately, not injected into measured attempts or global statistics.
- Legacy browser data is claimed by the first migrating account on that device. Other accounts do not import it again. Original localStorage keys are never deleted.
- Offline commands are stored per account; a switched session cannot submit another account's queue.

## Deployment and rollback
Apply migrations/20260925_account_learning.sql before deploying. This additive migration has NOT been applied to production. Existing database columns were inspected read-only. Rollback application code without dropping new data or deleting browser archives.

## Phase 1 verification
Real PostgreSQL tests use only temporary tables inside a transaction and ROLLBACK. Tested retries, repeated attempts, cross-mode first answers, visibility and cross-account reads. Existing stats/custom/daily unit tests pass. Full lint has existing errors in unrelated legacy code; no new errors in the new learning modules.
