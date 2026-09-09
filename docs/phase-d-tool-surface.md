# Phase D — Claude Tool Surface & Approval Policy

*Policy document (Phase C.2 §8–9). Nothing here is implemented yet; this is the
contract Phase D builds against.*

## Principles

1. **No SQL, ever.** Claude receives named tools only. Every read is a typed
   composite over `lib/db`; every write is one of the existing audited
   domain actions in `lib/actions/ops.ts`. Claude's access is exactly as wide
   as that file — no wider.
2. **Every mutation is audited as Claude's.** The domain layer's `record()`
   gains a `mechanism` parameter; tool-invoked writes log `mechanism: 'claude'`
   with old/new state, same as human writes log `human`. The audit log is the
   flight recorder.
3. **RLS stays the wall.** Tool calls execute under the signed-in user's
   session (Claude acts *for* Andrew, in Andrew's session), so row-level
   security — proven in C.1 — bounds every operation. No service-role writes
   from the tool path.
4. **Source systems are read-only.** No tool writes to Jobber or QuickBooks.
   Full stop. `run_jobber_sync` PULLS only.

## Read tools (no approval)

| Tool | Backed by | Returns |
|---|---|---|
| `get_today()` | Today-page loader | greeting context, schedule, open tasks, top attention, business status |
| `get_tasks(filter?)` | `getTasks` + `groupTasks` | tasks by bucket (overdue/today/upcoming/completed), optional entity filter |
| `get_calendar(range)` | `getCalendarEvents` + `buildCalendarItems` | unified schedule incl. locked Jobber items |
| `get_customer(idOrName)` | `getCustomers` + related filters | the relationship view: leads/quotes/jobs/invoices/AR/tasks/notes/activity |
| `get_customers()` | `getCustomers` + aggregates | customer list with open value + AR |
| `get_job(id)` | `getJob` + tasks/notes | job detail incl. internal tasks/notes |
| `get_quote(idOrNumber)` | `getQuotes` + reviews | quote + internal classification |
| `get_invoice(idOrNumber)` | `getInvoices` | invoice incl. balance and paid-mismatch flag |
| `get_attention()` | `computeAttention` | ranked attention items with states applied |
| `get_pipeline()` | `computeKpis` | raw / adjusted / awaiting-review / follow-up / written-off breakdown |
| `get_pulse()` | `computePulse` | the six business signals |
| `get_sync_health()` | `getSyncRuns` | last sync runs + freshness |
| `search_business_data(query)` | the ⌘K registry index | matching records across all entities (read-only by registry invariant) |

Read tools never require approval. They may be rate-limited per turn.

## Write tools (all via `lib/actions/ops.ts`)

| Tool | Domain action | Tier |
|---|---|---|
| `create_task(input)` | `createTask` | LOW-RISK |
| `complete_task(id)` | `completeTask` | LOW-RISK |
| `reopen_task(id)` | `reopenTask` | LOW-RISK |
| `reschedule_task(id, due)` | `updateTask` | LOW-RISK |
| `update_task(id, patch)` | `updateTask` | LOW-RISK (status='cancelled' → BUSINESS-STATE) |
| `create_event(input)` | `createEvent` | LOW-RISK |
| `reschedule_event(id, times)` | `rescheduleEvent` (internal-source only) | LOW-RISK |
| `add_note(entity, body)` | `addNote` | LOW-RISK |
| `classify_quote(id, class)` | `classifyQuote` | BUSINESS-STATE |
| `set_attention_state(key, state)` | `setAttentionState` | BUSINESS-STATE |
| `delete_event(id)` | `deleteEvent` | BUSINESS-STATE (destructive) |
| `run_jobber_sync()` | `runJobberSyncNow` | LOW-RISK (pull-only) |

## Approval tiers

**READ-ONLY — no approval.** Summaries, analysis, search, recommendations,
drafts. Claude may call these freely to answer questions.

**LOW-RISK INTERNAL WRITE — fast approval.** Create task, add note, create or
reschedule internal calendar items, complete/reopen a task, trigger a sync.
Reversible, internal-only, fully audited. UI: a one-tap inline confirm
("Claude wants to create task '…' — Approve / Skip"); a per-session
"auto-approve low-risk" toggle MAY be offered later, default OFF.

**BUSINESS-STATE CHANGE — explicit approval, every time.** Classify a quote
(changes the adjusted pipeline), resolve/acknowledge/snooze attention
(changes what the owner is shown), cancel a task, delete an event. The
approval prompt must show the before/after (e.g. "Q-261 → likely dead;
adjusted pipeline −$230,000"). Never batched silently: a multi-item plan lists
every item.

**EXTERNAL / SOURCE-SYSTEM WRITE — always require approval, and none exist
in Phase D.** Writing to Jobber, sending email/SMS, or touching financial
records is out of scope: no such tool will be registered. If a future phase
adds one, it inherits mandatory per-action approval with a full preview, and
this document gets amended first.

## Refusals the tool layer enforces (not the prompt)

- Unknown tool → error. Unknown entity id → "not found" (RLS-shaped).
- `reschedule_event` on a Jobber-sourced item → refused by the existing
  internal-source check.
- Any write while the DB is unreachable → the existing NOT_CONFIGURED /
  error path; Claude reports it, never fakes success.
- Personal items (`is_personal`) never appear in business summaries — enforced
  by the same computation layer the UI uses.
