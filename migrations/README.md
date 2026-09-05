# System errors

Apply `20260905_system_errors.sql` before deploying System Health:

```sh
node scripts/migrate-system-errors.mjs
```

The script loads the project's environment using `@next/env` and uses `DATABASE_URL`.
It only creates `system_errors` and its chronological index in one transaction.
It is safe to rerun and does not alter existing tables. Request handlers never run DDL.

Coverage is intentionally limited to unexpected failures in the existing Admin
dashboard, users, and reports GET handlers, and reports PATCH (including the legacy
feedback alias). Expected 400/403/404 responses are not logged. Health GET failures
are not logged to avoid generating records on every refresh.

Only a fixed event code, coarse error kind, generated ID, and database timestamp
are stored. No original error message, stack, URL parameters, request body,
credentials, or user information is persisted. The logger waits at most 1.5 seconds
for the database HTTP request and swallows recording failures. Database outages may
prevent recording, so these counts are not a global availability measurement.

The authenticated health endpoint reads rolling 24-hour/7-day counts and the latest
20 records from the last 7 days, using database time. A failed read returns 503 and
the UI displays unknown status, never fabricated zero counts. There is no automatic
deletion or retention job in this version. Disabling the instrumentation leaves the
table and its records intact.

Run focused tests with `node --test tests/system-health.test.mjs`.
