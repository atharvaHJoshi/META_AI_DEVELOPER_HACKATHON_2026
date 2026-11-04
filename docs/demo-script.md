# Demo script

A seven-minute walkthrough for judges, reviewers, and anyone evaluating the product claim.

**MIRAIWERK AI — the intelligence engine for projects that move forward.**

The script uses the seeded commerce project so the decision loop is immediately visible. It does not require a model key. Every number quoted below comes from the deterministic seed; IDs and dates vary per seed run.

## Before the demo

```bash
npm install
npm run db:reset
npm run dev
```

- Frontend: <http://localhost:5173>
- Backend: <http://localhost:4000/api/health>
- Sign in as **Maya Chen** (`maya.chen@miraiwerk.demo`, workspace owner).

Preflight checks:

```bash
curl -s http://localhost:4000/api/health
# {"status":"ok","time":"...","ai":"deterministic-demo"}

curl -s http://localhost:4000/api/bootstrap -H 'x-user-id: usr_maya' \
  | jq '{projects:[.projects[]|{id,name,currentPlanVersion,pendingDecisionCount}],aiMode}'
```

`ai` reports `gemini` when a Gemini key is configured and `deterministic-demo` otherwise. Selecting `AI_PROVIDER=meta` also uses the labelled deterministic fallback in this build, because the Meta adapter has not been ported to Python.

Expected seed state:

- 1 project: **Commerce Platform Relaunch**, plan **v2**, 19 tasks, 3 milestones.
- 5 tickets: 1 approved (search-regression fix produced v2), 4 pending.
- Pending decisions: payment incident (recommended split), saved-payment feature (defer), vague checkout report (clarify), duplicate-looking charge report (accept with one candidate).
- One plan version transition already in history, so versioning and audit are immediately inspectable.

If a previous run changed the data:

```bash
npm run db:reset
```

It is destructive and restores this state.

---

## The seven-minute path

| Time | Beat | What the audience should understand |
| ---: | --- | --- |
| 0:00 | Workspace and honesty label | This is a decision system, not a chat wrapper |
| 0:45 | Generate a plan draft | The model proposes; the human commits |
| 1:35 | Inspect the committed plan | Scope, dependencies, gates, and estimates are visible |
| 2:10 | Open the payment incident | Evidence, policy, unknowns, and duplicate checks |
| 3:15 | Compare RippleMap options | The change is simulated deterministically, not described |
| 4:10 | Switch identity | Authorization is enforced server-side |
| 4:45 | Approve split | Human approval creates v3 and marks siblings stale |
| 5:40 | Re-analyse a stale proposal | Old evidence cannot be applied to a new baseline |
| 6:25 | History and audit | Versions, actors, reasons, and events are durable |
| 6:50 | Close | Tests, evaluation, and deliberate scope limits |

---

## 0:00 — Workspace

Open the workspace as Maya.

**Say:**

> Most tools record work after a decision is already made. MIRAIWERK treats every incoming ticket as a proposed disturbance to a versioned plan. It grounds the claim in stored records, shows what is unknown, simulates the dependency ripple in deterministic code, and asks a human to approve the change.

Point out:

- The four pending decisions in the queue.
- The project card showing **plan v2** and pending decisions.
- The provider badge: **Google Gemini · model** when a key is configured, or **Deterministic demo mode · no model key configured** otherwise.

**Say:**

> That badge is deliberate. There is no hidden model call. With a Gemini key configured, the same pipeline uses Gemini and labels the proposal accordingly. The Meta provider is configuration-only in the Python build and falls back to labelled deterministic rules. If a configured Gemini call fails, the fallback is marked `degraded`, not presented as a success.

## 0:45 — Generate a plan draft

Click **Build a plan** → **Use example** → **Generate plan draft**.

Wait for the review screen. Walk through the top of the draft:

- requirements, milestones, tasks, and dependencies
- explicit vs inferred scope
- assumptions and missing information
- estimates and scheduling

**Say:**

> Nothing is saved yet. The brief did not commit a target date, so the draft does not invent one. The team and capacity were supplied, so they are carried forward. Missing facts stay visible instead of becoming confident sentences.

Do **not** commit this draft. The demo uses the seeded project for the decision loop. Go back to the workspace.

If asked why not commit: the seeded project already demonstrates a committed baseline and a prior approved change. Creating a second project would only add setup time.

## 1:35 — Inspect the committed plan

Open **Commerce Platform Relaunch**.

Show:

- the Gantt with planned start/finish dates
- **Foundation usable**, **Payments release gate**, **Production launch**
- dependencies and the critical path
- plan version **v2**
- assumptions and missing information in the plan detail

**Say:**

> These dates are working-day planning estimates from the graph. The release gate target came from the brief. The scheduler did not add headcount or turn an unknown into a deadline.

Optionally open **History** briefly to show that v2 exists because a search-regression fix was approved earlier. Return to the project.

## 2:10 — Open the payment incident

Go to **Tickets** and open **Customers charged twice after checkout retry**.

Give the audience a moment to read the top of the decision card.

Point out:

1. **Recommendation: split.** Contain exposure first, then ship the durable fix.
2. **P0**, with response window **4 hours**. The project policy set the escalation floor.
3. **Policy rules applied** lists why the final priority is what it is. The model's original priority is preserved separately.
4. **Evidence ledger**:
   - `observed`: two capture IDs sharing one idempotency key, two `capture.succeeded` webhooks, production environment.
   - `inferred`: likely related requirements and tasks.
   - `unknown`: the exact number of exposed customers, and whether retries can be paused safely.
5. **No duplicate candidate** on this proposal. The duplicate-looking ticket is a separate report with a different root cause.
6. **Related records** are advisory links. They do not silently expand scope.

**Say:**

> The analysis produced a proposal, not a plan change. The plan is still v2. Nothing moves until a human approves a matching scenario.

## 3:15 — Compare RippleMap options

Scroll to **Compare the options**.

Select each option briefly:

- **Accept** — 2 added tasks (fix + regression coverage).
- **Split** — 3 added tasks (guarded mitigation, permanent fix, verification).
- **Defer** — no tasks, plan unchanged, risk remains visible.
- **Clarify** — no tasks; questions stay on the record.
- **Duplicate** — unavailable here because no candidate was identified.

Select **Split** and pause on the impact panel.

Expected split scenario from the seed:

| Signal | Value |
| --- | ---: |
| Added tasks | 3 |
| Added dependencies | 3 |
| Effort added | 5 person-days |
| Affected tasks | 18 |
| Release-gate schedule delta | 0 days |
| Milestones breached | 2 |

**Say:**

> The extra work fits inside the existing critical path, so the release date does not move. That is a computed result, not a claim that the incident is harmless. The simulation still shows 18 affected tasks, 5 added person-days, and two release gates already under target pressure.

> Every stored run has an input hash. Approval recomputes the scenario and refuses to apply a stored diff that no longer matches the current plan.

If the impact panel shows a different delta, read the values on screen rather than the table. The deterministic seed is stable, but dates and IDs move with the run.

## 4:10 — Switch identity

Open the account menu and sign out, then sign in from the demo identity list as **Lena Ortiz** (`lena.ortiz@miraiwerk.demo`, member). Identity switching uses the same real session flow as any user; it is not a client-side toggle.

Return to the incident or stay on the ticket:

- the approval panel shows **Your project role cannot approve**
- the approve/reject/clarify buttons are disabled
- Lena can still inspect and re-simulate

**Say:**

> The UI reflects the rule, but the server enforces it. The project-role check runs inside the API, not in the browser.

Optional API proof from a terminal:

```bash
API=http://localhost:4000/api
DECISION_ID=<the incident proposal id>

curl -s -o /tmp/approve.json -w '%{http_code}\n' \
  -X POST "$API/decisions/$DECISION_ID/approve" \
  -H 'content-type: application/json' \
  -H 'x-user-id: usr_lena' \
  -d '{"option":"split","reason":"Attempt from a member."}'

cat /tmp/approve.json | jq '.error'
# {"code":"FORBIDDEN","message":"This action requires one of these project roles: owner, pm."}
```

Sign out and sign back in as **Maya Chen**.

Optional: sign in as **Priya Shah** (`priya.shah@miraiwerk.demo`, viewer) to show a read-only project experience. The same server-side role gate applies to ticket creation and simulation.

## 4:45 — Approve split

With **Split** selected, enter a reason:

> Contain duplicate captures before the payments gate; keep the durable fix on the plan.

Click **Approve: split**.

Expected outcome:

- success message naming **plan version 3**
- proposal status **approved**
- ticket status **accepted**
- project plan now has **22 tasks** (19 + 3)
- the other three pending proposals become **stale**
- decision audit and project audit entries are written in the same transaction

Open the plan or return to the project card to confirm **v3**.

**Say:**

> Approval is transactional. It revalidated the scenario hash, applied the change, re-scheduled the graph, wrote a new plan snapshot and marked every sibling proposal stale. If the plan had moved first, this request would have returned 409 instead of applying a stale diff.

## 5:40 — Re-analyse a stale proposal

Go to **Tickets** and open **Add saved payment methods for returning customers** (or the duplicate-looking charge report).

The banner says:

> This proposal was computed against an older plan. Proposal base: plan v2. Current plan: v3. Approval is blocked until the ticket is re-analysed.

Click **Re-analyse**.

Expected:

- a new pending proposal against **v3**
- the stale proposal remains in the audit record
- approval becomes available again only after a matching scenario exists

**Say:**

> The system does not silently recompute an old proposal and pretend it was the same decision. Work computed against v2 must be re-grounded in v3. This is the difference between a versioned plan and a mutable task list.

Optional: open the duplicate-looking charge report first and show its one advisory duplicate candidate alongside evidence that the payment processor saw only one capture. It demonstrates that lexical similarity is a candidate, not a verdict.

## 6:25 — History and audit

Open **History**.

Show:

- version timeline **v3 → v2 → v1**, with parent links and change summaries
- the human actor and reason for each approved decision
- **decision.stale** / stale audit entries for siblings
- system events for ticket intake, analysis, proposal creation, approval, and versioning
- the change summary includes the scenario hash, schedule impact, and affected task count

**Say:**

> Plan versions are immutable snapshots. The audit is append-only at the application level. A reviewer can reconstruct what was proposed, what was simulated, who approved it, and why.

## 6:50 — Close

Return to the workspace.

**Say:**

> The core loop is complete: brief, generated draft, ticket intake, evidence-backed analysis, deterministic impact simulation, human approval, versioned plan, and audit. The model is optional and always labelled. The simulator is deterministic. The approval is human.

Mention the verification commands:

```bash
npm test          # backend pytest suite (RippleMap unit + API integration) and frontend tests
npm run build
```

Mention the honest limits:

- No code editor, coding agent, virtual meetings, universal ticketing, autonomous plan changes, multi-agent orchestration, or fine-tuning.
- Duplicate candidates are lexical and advisory.
- Estimates are planning estimates, not delivery commitments.
- Deterministic rules are labelled as such wherever they run.

Reset for the next run:

```bash
npm run db:reset
```

---

## Backup: API-only run

If the browser or projector fails, the whole loop can be demonstrated with `curl` and `jq`.

```bash
API=http://localhost:4000/api
MAYA=usr_maya
LENA=usr_lena

PROJECT=$(curl -s "$API/bootstrap" -H "x-user-id: $MAYA" | jq -r '.projects[0].id')

INCIDENT=$(curl -s "$API/projects/$PROJECT/tickets" -H "x-user-id: $MAYA" \
  | jq -r '.tickets[] | select(.title | startswith("Customers charged twice")) | .id')

DECISION=$(curl -s "$API/projects/$PROJECT/tickets" -H "x-user-id: $MAYA" \
  | jq -r '.tickets[] | select(.id == "'"$INCIDENT"'") | .latestDecisionId')

# 1. Proposal: P0, split, evidence, unknowns.
curl -s "$API/decisions/$DECISION" -H "x-user-id: $MAYA" \
  | jq '{recommendation,priority:.classification.priority,policy:.policy,unknowns,related:(.relatedRecords|length),candidates:(.duplicateCandidates|length)}'

# 2. Simulate split against v2.
curl -s -X POST "$API/decisions/$DECISION/simulate" \
  -H 'content-type: application/json' \
  -H "x-user-id: $MAYA" \
  -d '{"option":"split","baselineVersion":2}' \
  | jq '{valid,metrics,targetDelta:.diff.targetDeltaDays,hash:.inputHash}'

# 3. Member cannot approve.
curl -s -o /tmp/member.json -w '%{http_code}\n' \
  -X POST "$API/decisions/$DECISION/approve" \
  -H 'content-type: application/json' \
  -H "x-user-id: $LENA" \
  -d '{"option":"split","reason":"Member attempt."}'
cat /tmp/member.json | jq '.error.code'

# 4. Owner approves; plan becomes v3.
curl -s -X POST "$API/decisions/$DECISION/approve" \
  -H 'content-type: application/json' \
  -H "x-user-id: $MAYA" \
  -d '{"option":"split","reason":"Contain duplicate captures before the payments gate."}' \
  | jq '{planVersionNumber,message,status:.proposal.status}'

# 5. Siblings are stale.
curl -s "$API/projects/$PROJECT/tickets" -H "x-user-id: $MAYA" \
  | jq '[.tickets[] | {title,decision:.latestDecisionStatus}]'

# 6. Version history.
curl -s "$API/projects/$PROJECT/history" -H "x-user-id: $MAYA" \
  | jq '{versions:[.versions[]|{v:.versionNumber,summary:.changeSummary}],staleEvents:[.decisions[]|select(.action=="stale")]}'
```

Expected: `200` simulation, `403` from Lena, `planVersionNumber: 3`, three siblings `stale`, and a version timeline containing v3, v2, v1.

## Likely questions

**Is this using Meta?**

Not in the default configuration. The badge and proposal metadata say `deterministic-demo` / `miraiwerk-rules-v1` when no key is configured. Set `GEMINI_API_KEY` for the default Gemini adapter, or `AI_PROVIDER=meta` with `MODEL_API_KEY` for the Meta adapter. A failure is labelled `degraded`; it is never presented as provider output.

**Why didn't the release date move?**

Because the added mitigation is not on the long pole of the dependency graph in this seed. The simulation still reports added effort and affected tasks, and it surfaces gates that are already breaching their targets. The value is that the claim is computed, not narrated.

**What stops the model from inventing facts?**

Three boundaries: evidence states in the proposal, server-side sanitization of unknown record references, and the deterministic approval gate. The model cannot create a plan version by itself.

**Why is the proposal stale instead of recomputed?**

Because recomputing would silently attach old reasoning to a new plan. The product requires re-analysis so the evidence and simulation are re-grounded against the current baseline.

**What is still a demo shortcut?**

Identity is an `x-user-id` header with seeded users. Project creation adds every demo user as a member. These are deliberate hackathon shortcuts; the role checks themselves are server-side and would survive a real auth provider.

**What would you build next?**

Real authentication and invitations, richer evidence attachments, semantic duplicate candidates with human confirmation, and plan-version comparison. Those are deliberately outside this build.
