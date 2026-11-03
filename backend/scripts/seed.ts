import "dotenv/config";
import { commercePlan, DETERMINISTIC_MODEL } from "@miraiwerk/aiml";
import { addWorkingDays, formatIsoDate, parseIsoDate } from "@miraiwerk/ripplemap";
import { ProjectPolicySchema } from "@miraiwerk/schemas";
import { closePool, query, withTransaction } from "../src/db/pool.js";
import { hashPassword } from "../src/security/password.js";
import {
  analyzeTicket,
  createTicket,
  getTicketDetail,
} from "../src/services/ticketService.js";
import { approveDecision } from "../src/services/decisionService.js";
import { createProject, getProjectPlan } from "../src/services/projectService.js";

const MAYA = "usr_maya";
const ARJUN = "usr_arjun";
const LENA = "usr_lena";
const PRIYA = "usr_priya";
const ORG = "org_miraiwerk";
const WORKSPACE = "ws_platform";
const WORKSPACE_CX = "ws_experience";
const DEMO_PASSWORD = "Miraiwerk!2026";

function isoToday(): string {
  return formatIsoDate(parseIsoDate(new Date().toISOString().slice(0, 10)));
}

function plusWorkingDays(start: string, days: number): string {
  return formatIsoDate(addWorkingDays(parseIsoDate(start), days));
}

async function seedUsers(): Promise<void> {
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  await query(
    `INSERT INTO users (id, name, email, title, avatar_color, password_hash, status, is_platform_admin)
     VALUES
       ($1,'Maya Chen','maya.chen@miraiwerk.demo','Director of Product','#496A91',$5,'active',true),
       ($2,'Arjun Patel','arjun.patel@miraiwerk.demo','Engineering Manager','#5C7F6F',$5,'active',false),
       ($3,'Lena Ortiz','lena.ortiz@miraiwerk.demo','Staff Engineer','#A7793F',$5,'active',false),
       ($4,'Priya Shah','priya.shah@miraiwerk.demo','Finance Partner','#7B6A8F',$5,'active',false)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, email = EXCLUDED.email, title = EXCLUDED.title,
           avatar_color = EXCLUDED.avatar_color, password_hash = EXCLUDED.password_hash,
           status = 'active'`,
    [MAYA, ARJUN, LENA, PRIYA, passwordHash],
  );
}

async function seedTenant(): Promise<void> {
  await query(
    `INSERT INTO organizations (id, name, slug, description, created_by)
     VALUES ($1,'Miraiwerk','miraiwerk','Product and platform delivery organization.',$2)
     ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description`,
    [ORG, MAYA],
  );
  await query(
    `INSERT INTO workspaces
       (id, organization_id, name, slug, description, onboarding_stage, onboarding_json, ai_context_json, created_by)
     VALUES
       ($1,$3,'Platform Delivery','platform-delivery',
        'Commerce relaunch, payments reliability and platform operations.',8,
        '{"completed":true}'::jsonb,
        '{"tone":"concise","releasePolicy":"Every release needs a rollback plan and a named on-call owner.","capacityUnit":"person-days"}'::jsonb,$4),
       ($2,$3,'Customer Experience','customer-experience',
        'Discovery, support and customer-facing improvements.',8,
        '{"completed":true}'::jsonb,
        '{"tone":"customer-first","releasePolicy":"Customer-impacting changes need a support brief."}'::jsonb,$4)
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, description = EXCLUDED.description,
           ai_context_json = EXCLUDED.ai_context_json`,
    [WORKSPACE, WORKSPACE_CX, ORG, MAYA],
  );
  await query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1,$2,'owner'),($1,$3,'manager'),($1,$4,'member'),($1,$5,'viewer')
     ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [ORG, MAYA, ARJUN, LENA, PRIYA],
  );
  await query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES
       ($1,$3,'owner'),($1,$4,'manager'),($1,$5,'member'),($1,$6,'viewer'),
       ($2,$3,'owner'),($2,$4,'manager'),($2,$5,'member')
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [WORKSPACE, WORKSPACE_CX, MAYA, ARJUN, LENA, PRIYA],
  );
  await query(
    `INSERT INTO teams (id, workspace_id, name, description, lead_id)
     VALUES
       ($1,$4,'Payments','Checkout, payment capture and reconciliation.',$2),
       ($3,$4,'Platform','Search, identity and release engineering.',$2)
     ON CONFLICT (id) DO NOTHING`,
    ["team_payments", ARJUN, "team_platform", WORKSPACE],
  );
  await query(
    `INSERT INTO team_members (team_id, user_id)
     VALUES ('team_payments',$1),('team_payments',$2),('team_platform',$2),('team_platform',$3)
     ON CONFLICT DO NOTHING`,
    [ARJUN, LENA, MAYA],
  );
}

async function main() {
  console.log("Resetting MIRAIWERK demo data…");
  await withTransaction(async (client) => {
    await client.query(`
      TRUNCATE ai_calls, audit_events, decision_audit, scenario_runs,
        decision_proposals, ticket_links, tickets, task_dependencies, tasks,
        milestones, requirements, plan_versions, project_members, projects,
        documents, meetings, forum_replies, forum_threads, team_members, teams,
        workspace_members, workspaces, organization_members, organizations,
        sessions, oauth_accounts, one_time_tokens, security_audit, users
      CASCADE;
    `);
  });
  await seedUsers();
  await seedTenant();

  const startDate = plusWorkingDays(isoToday(), 1);
  const targetDate = plusWorkingDays(startDate, 42);
  const draft = commercePlan({
    name: "Commerce Platform Relaunch",
    goal: "Launch a reliable checkout experience without duplicate charges or broken order state.",
    description:
      "Relaunch of the direct-to-consumer storefront. The team is rebuilding authentication, product discovery, checkout, payment retries, order lifecycle and release observability on a React + Node.js + PostgreSQL stack. The payments release gate must be passed before any production launch work proceeds.",
    startDate,
    targetDate,
    constraints: {
      team: "2 backend, 1 frontend, 1 QA, shared DevOps",
      capacityPersonDays: 260,
      technology: "React, TypeScript, Node.js, PostgreSQL, payment processor",
      nonNegotiables:
        "No duplicate payment capture. Every release needs a rollback plan and named on-call owner.",
    },
  });

  const project = await createProject(
    MAYA,
    {
      draft,
      generation: {
        provider: "deterministic-demo",
        model: DETERMINISTIC_MODEL,
        degraded: false,
      },
      constraints: {
        team: "2 backend, 1 frontend, 1 QA, shared DevOps",
        capacityPersonDays: 260,
        technology: "React, TypeScript, Node.js, PostgreSQL, payment processor",
        nonNegotiables:
          "No duplicate payment capture. Every release needs a rollback plan and named on-call owner.",
        policy: ProjectPolicySchema.parse({
          criticalResponseHours: 4,
          highResponseDays: 2,
          normalResponseDays: 7,
          requireEvidenceForP0: true,
          escalationComponents: ["payments", "checkout", "auth"],
          releaseFreezeDays: 3,
        }),
      },
    },
    {
      provider: "deterministic-demo",
      model: DETERMINISTIC_MODEL,
      degraded: false,
    },
    { workspaceId: WORKSPACE },
  );
  console.log(`Project created: ${project.project.name} (${project.project.id}) — plan v1`);

  // -------------------------------------------------------------------------
  // Approved history: a search regression is accepted, creating plan version 2.
  // -------------------------------------------------------------------------
  const searchTicket = await createTicket(LENA, {
    projectId: project.project.id,
    title: "Search filters reset when returning from a product page",
    description:
      "Steps to reproduce: open Product discovery, apply a category and a price filter, open a product, then press Back. The filter chips disappear and the result list resets. Expected: filters persist in the URL and remain applied. Actual: state is lost on back navigation. This is a regression from last week's release.",
    source: "manual",
    ticketType: "bug",
    affectedComponent: "Product discovery / search",
    reportedImpact:
      "Customers lose their filtered result set and must repeat the search. Roughly one in five sessions uses filters, and we have three related reports this week.",
    evidence:
      "Reproduced four times in Chrome and Safari. The URL query parameters are absent after back navigation; session recording shows the full page reload.",
    reporter: "Lena Ortiz",
    environment: "production",
    severityReported: "medium",
  });
  const analyzedSearch = await analyzeTicket(MAYA, searchTicket.ticket.id);
  if (!analyzedSearch.proposal) {
    throw new Error("Seed search ticket produced no proposal.");
  }
  const approved = await approveDecision(
    MAYA,
    analyzedSearch.proposal.id,
    "accept",
    "Accept the regression fix and its verification task before the search release review.",
  );
  console.log(
    `Approved search regression as ${approved.proposal.id}; plan version ${approved.planVersionNumber} created.`,
  );

  // -------------------------------------------------------------------------
  // Pending decisions: incident, feature request, vague report and a
  // duplicate-looking ticket with a different root cause.
  // -------------------------------------------------------------------------
  const incidentTicket = await createTicket(ARJUN, {
    projectId: project.project.id,
    title: "Customers charged twice after checkout retry",
    description:
      "Production incident: when the payment confirmation request times out, the client retries automatically after five seconds. Some customers receive two captures for one order. We have 14 confirmed duplicate captures since 09:10 UTC. Automatic retries are still enabled.",
    source: "manual",
    ticketType: "incident",
    affectedComponent: "Payments / checkout retry",
    reportedImpact:
      "14 customers charged twice; support has refunded 6 so far. The payments release gate is scheduled this week, so exposure is still increasing.",
    evidence:
      "Transactions pi_8841 and pi_8842 share idempotency key idem_5521 and produced two capture.succeeded webhooks. Sample order ORD-5521. Application logs show the confirmation retry does not reuse the original idempotency key.",
    reporter: "Arjun Patel",
    environment: "production",
    severityReported: "critical",
  });
  const incident = await analyzeTicket(MAYA, incidentTicket.ticket.id);
  console.log(
    `Incident proposal ${incident.proposal?.id}: recommendation=${incident.proposal?.recommendation}, priority=${incident.proposal?.classification.priority}`,
  );

  const featureTicket = await createTicket(MAYA, {
    projectId: project.project.id,
    title: "Add saved payment methods for returning customers",
    description:
      "Returning customers should be able to save a payment method and reuse it at checkout. The request comes from the customer success team after repeated feedback from repeat buyers. No success metric or scope boundary has been agreed yet.",
    source: "manual",
    ticketType: "feature_request",
    affectedComponent: "Checkout / payments",
    reportedImpact:
      "Repeat buyers re-enter payment details every time. Conversion impact is not measured.",
    evidence:
      "Eight customer interview notes mention saved payment methods; no funnel metric is attached.",
    reporter: "Maya Chen",
    environment: "production",
    severityReported: "low",
  });
  const feature = await analyzeTicket(MAYA, featureTicket.ticket.id);
  console.log(
    `Feature request proposal ${feature.proposal?.id}: recommendation=${feature.proposal?.recommendation}`,
  );

  const vagueTicket = await createTicket(LENA, {
    projectId: project.project.id,
    title: "Something about checkout seems off on some devices",
    description:
      "The checkout experience seems off on some devices. We do not have a reproducible example, logs, affected-user details, or a clear description of the expected outcome yet.",
    source: "manual",
    ticketType: null,
    affectedComponent: "",
    reportedImpact: "",
    evidence: "",
    reporter: "Lena Ortiz",
    environment: "",
    severityReported: "unspecified",
  });
  const vague = await analyzeTicket(MAYA, vagueTicket.ticket.id);
  console.log(
    `Vague report proposal ${vague.proposal?.id}: recommendation=${vague.proposal?.recommendation}`,
  );

  const duplicateLikeTicket = await createTicket(MAYA, {
    projectId: project.project.id,
    title: "Duplicate charge reported after checkout retry",
    description:
      "A customer reports a duplicate charge after a checkout retry. Finance confirms this is an invoice export duplicate, not a payment capture. The monthly invoice CSV lists the same charge line twice after a plan upgrade with proration.",
    source: "manual",
    ticketType: "bug",
    affectedComponent: "Finance / invoice export",
    reportedImpact:
      "Finance manually corrects affected invoices before month-end close. No customer has been overcharged by the payment processor.",
    evidence:
      "Two invoice CSV rows share invoice_id INV-2031 and line_item_id li_908. The payment processor export contains one capture for the same period; no duplicate capture.succeeded webhook exists.",
    reporter: "Maya Chen",
    environment: "production",
    severityReported: "medium",
  });
  const duplicateLike = await analyzeTicket(MAYA, duplicateLikeTicket.ticket.id);
  console.log(
    `Duplicate-looking proposal ${duplicateLike.proposal?.id}: recommendation=${duplicateLike.proposal?.recommendation}, candidates=${duplicateLike.proposal?.duplicateCandidates.length}`,
  );

  // Touch the detail endpoint once so the seeded records are validated end to end.
  await getTicketDetail(MAYA, incidentTicket.ticket.id);
  const plan = await getProjectPlan(MAYA, project.project.id);

  // Assign delivery work so workload is populated with real task estimates.
  await query(
    `UPDATE tasks
     SET assignee_id = CASE
           WHEN owner_role IN ('Frontend', 'QA') THEN $2
           WHEN owner_role IN ('Backend', 'Full-stack', 'Engineering') THEN $3
           ELSE $3
         END,
         team_id = CASE
           WHEN owner_role IN ('Frontend', 'QA') THEN 'team_platform'
           ELSE 'team_payments'
         END
     WHERE project_id = $1`,
    [project.project.id, LENA, ARJUN],
  );

  // Seed the collaboration modules with honest, reviewable content so every
  // destination has a real record without invoking live AI providers.
  await query(
    `INSERT INTO documents
      (id, workspace_id, project_id, title, doc_type, content, status, created_by, updated_by, created_at, updated_at)
     VALUES
      ($1,$3,$5,'Payments launch decision record','markdown',
       '# Payments launch decision record\n\n## Context\n\nThe payments release gate is scheduled for this week. The checkout retry incident shows duplicate captures after a timeout.\n\n## Decision\n\nDo not open the production release gate until the idempotency fix and regression coverage are accepted.\n\n## Evidence\n\n- 14 confirmed duplicate captures since 09:10 UTC.\n- Two capture.succeeded webhooks share one idempotency key.\n- The client retries after five seconds without reusing the original key.\n\n## Consequences\n\nThe launch moves behind the payments release gate. Support receives a refund runbook; no plan change is committed until RippleMap is approved by an owner or PM.',
       'published',$4,$4,now() - interval '3 hours', now() - interval '2 hours'),
      ($2,$3,$5,'Checkout dependency diagram','diagram',
       'graph TD\n  ticket[Ticket evidence] --> proposal[Decision proposal]\n  proposal --> ripple[RippleMap simulation]\n  ripple --> approval{Human approval}\n  approval -->|accept| version[Immutable plan version]\n  approval -->|clarify| evidence[More evidence requested]\n  version --> tasks[Delivery tasks]\n  tasks --> release[Payments release gate]',
       'draft',$4,$4,now() - interval '2 hours', now() - interval '90 minutes'),
      ('doc_platform_operating_notes',$3,NULL,'Platform delivery operating notes','markdown',
       '# Platform delivery operating notes\n\n- Every release needs a named on-call owner and a rollback plan.\n- Critical incidents require four-hour response and human review before a plan change.\n- RippleMap simulations are deterministic; AI explains and drafts, but never approves.\n- Decision records are kept in this workspace and linked to the project plan they affect.',
       'published',$4,$4,now() - interval '1 day', now() - interval '1 day')
     ON CONFLICT (id) DO NOTHING`,
    ["doc_payments_decision", "doc_checkout_diagram", WORKSPACE, MAYA, project.project.id],
  );

  await query(
    `INSERT INTO meetings
      (id, workspace_id, project_id, title, agenda, notes, scheduled_at, duration_minutes, status, summary, action_items_json, created_by)
     VALUES
      ($1,$5,$6,'Payments release readiness review',
       'Confirm duplicate-capture containment, rollback owner and release-gate evidence.',
       'Support confirmed the refund runbook is ready. The idempotency fix is still waiting for regression coverage. The team agreed not to open the release gate until the plan change is approved.',
       now() + interval '2 days', 45, 'scheduled', '', '[]'::jsonb, $3),
      ($2,$5,$6,'RippleMap design review',
       'Review the deterministic simulation boundary and the stale-proposal behaviour.',
       'The team reviewed the approved-plan snapshot and the proposal state. Human approval remains mandatory. No automated approval path was accepted.',
       now() - interval '1 day', 60, 'completed',
       'The design review confirmed that RippleMap must continue to simulate against an approved plan snapshot. Approval remains an explicit human decision, and stale proposals must be rejected or re-analysed rather than silently replayed.',
       '[{"title":"Add stale-proposal regression coverage","owner":"Arjun Patel","dueDate":null,"taskId":null},{"title":"Document rollback ownership for the payments gate","owner":"Maya Chen","dueDate":null,"taskId":null}]'::jsonb, $4)
     ON CONFLICT (id) DO NOTHING`,
    ["mtg_release_review", "mtg_design_review", MAYA, ARJUN, WORKSPACE, project.project.id],
  );

  await query(
    `INSERT INTO forum_threads
      (id, workspace_id, project_id, title, body, category, solved, created_by, created_at, updated_at)
     VALUES
      ($1,$4,$6,'Should the payments release gate move?','The retry incident has a clear containment path, but the idempotency fix still needs regression coverage. Should the gate move this week or wait for the accepted plan change?','decision',false,$3,now() - interval '3 hours', now() - interval '1 hour'),
      ($2,$4,$6,'Duplicate-looking invoice rows are not duplicate captures','Finance found two invoice CSV rows with the same line item after a prorated upgrade. The processor export has one capture. We should document the distinction before the next finance review.','risk',true,$5,now() - interval '1 day', now() - interval '4 hours')
     ON CONFLICT (id) DO NOTHING`,
    ["thr_release_gate", "thr_invoice_duplicate", ARJUN, WORKSPACE, LENA, project.project.id],
  );
  await query(
    `INSERT INTO forum_replies (id, thread_id, body, created_by, created_at)
     VALUES
      ($1,'thr_release_gate','Recommendation: keep the gate closed until the regression task is accepted and linked to the idempotency fix.',$3,now() - interval '2 hours'),
      ($2,'thr_release_gate','Agreed. I will not simulate an approval against a plan that does not contain the fix. The proposal must be re-analysed if evidence changes.',$4,now() - interval '1 hour')
     ON CONFLICT (id) DO NOTHING`,
    ["rep_release_gate_1", "rep_release_gate_2", ARJUN, MAYA],
  );

  await query(
    `INSERT INTO security_audit (id, user_id, action, outcome, ip_address, user_agent, metadata, created_at)
     VALUES
      ('sa_seed_workspace_provisioned',$1,'workspace.provisioned','success','127.0.0.1','MIRAIWERK seed script',$3::jsonb,now() - interval '1 day'),
      ('sa_seed_role_updated',$1,'workspace.member_role_changed','success','127.0.0.1','MIRAIWERK seed script','{"workspaceId":"ws_platform","member":"Lena Ortiz","role":"member"}'::jsonb,now() - interval '20 hours'),
      ('sa_seed_release_review',$2,'project.reviewed','success','127.0.0.1','MIRAIWERK seed script',$4::jsonb,now() - interval '2 hours')
     ON CONFLICT (id) DO NOTHING`,
    [
      MAYA,
      ARJUN,
      JSON.stringify({ workspaceId: WORKSPACE, projectId: project.project.id }),
      JSON.stringify({ workspaceId: WORKSPACE, projectId: project.project.id, decision: "split" }),
    ],
  );

  console.log("\nDemo seed complete.");
  console.log(`  project:  ${plan.project.id}  (plan v${plan.version})`);
  console.log(`  tasks:    ${plan.tasks.length}`);
  console.log(`  tickets:  5 (1 approved, 4 pending)`);
  console.log(`  open decisions: incident, feature, vague report, duplicate-looking`);
  console.log(`  sign in as: maya.chen@miraiwerk.demo / ${DEMO_PASSWORD} (owner)`);
  console.log(`  also: arjun.patel@… (manager), lena.ortiz@… (member), priya.shah@… (viewer)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
