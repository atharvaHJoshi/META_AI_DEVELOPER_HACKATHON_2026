import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createApp } from "../app.js";
import { closePool, query } from "../db/pool.js";

/**
 * Integration tests against the local PostgreSQL database.
 *
 * They never depend on seeded demo records: each run creates its own users and
 * project, then removes everything it created. Run `npm run db:up` and
 * `npm run db:migrate` before executing this suite.
 */

const app = createApp();
const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
const ownerId = `usr_test_owner_${suffix}`;
const memberId = `usr_test_member_${suffix}`;
const viewerId = `usr_test_viewer_${suffix}`;
const testUserIds = [ownerId, memberId, viewerId];

let projectId = "";
let initialTaskCount = 0;
let firstTicketId = "";
let firstProposalId = "";
let secondProposalId = "";
let thirdTicketId = "";

function as(userId: string) {
  return { "x-user-id": userId };
}

const incidentTicket = {
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
  reporter: "Integration Test",
  environment: "production",
  severityReported: "critical",
};

const secondTicket = {
  title: "Payment retry sends duplicate webhook after timeout",
  description:
    "A second report of the same retry path: the confirmation request times out, the client retries, and the processor receives a second capture request with a fresh idempotency key.",
  source: "manual",
  ticketType: "incident",
  affectedComponent: "Payments / retry",
  reportedImpact: "Three additional duplicate captures reported by support.",
  evidence:
    "Capture webhook payload shows a distinct idempotency key on the retry. Request trace is attached to the incident bridge.",
  reporter: "Integration Test",
  environment: "production",
  severityReported: "high",
};

beforeAll(async () => {
  await query(
    `INSERT INTO users (id, name, email, title, avatar_color)
     VALUES
       ($1, 'Test Owner', $2, 'Product Lead', '#5B6CFF'),
       ($3, 'Test Member', $4, 'Staff Engineer', '#12B76A'),
       ($5, 'Test Viewer', $6, 'Executive Observer', '#F79009')`,
    [
      ownerId,
      `owner.${suffix}@miraiwerk.test`,
      memberId,
      `member.${suffix}@miraiwerk.test`,
      viewerId,
      `viewer.${suffix}@miraiwerk.test`,
    ],
  );

  await query(
    `INSERT INTO organizations (id, name, slug, created_by)
     VALUES ($1, 'Integration Organization', $2, $3)
     ON CONFLICT (id) DO NOTHING`,
    [`org_test_${suffix}`, `org-test-${suffix}`, ownerId],
  );
  await query(
    `INSERT INTO workspaces (id, organization_id, name, slug, created_by)
     VALUES ($1, $2, 'Integration Workspace', $3, $4)
     ON CONFLICT (id) DO NOTHING`,
    [`ws_test_${suffix}`, `org_test_${suffix}`, `ws-test-${suffix}`, ownerId],
  );
  await query(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'member'), ($1, $4, 'viewer')
     ON CONFLICT (organization_id, user_id) DO NOTHING`,
    [`org_test_${suffix}`, ownerId, memberId, viewerId],
  );
  await query(
    `INSERT INTO workspace_members (workspace_id, user_id, role)
     VALUES ($1, $2, 'owner'), ($1, $3, 'manager'), ($1, $4, 'viewer')
     ON CONFLICT (workspace_id, user_id) DO NOTHING`,
    [`ws_test_${suffix}`, ownerId, memberId, viewerId],
  );

  const generated = await request(app)
    .post("/api/projects/generate-plan")
    .set(as(ownerId))
    .send({
      name: `Integration Checkout ${suffix}`,
      goal: "Launch a reliable checkout without duplicate payment captures.",
      description:
        "An integration-test commerce launch covering authentication, product discovery, checkout, payment retries and release observability.",
      startDate: "2026-11-02",
      targetDate: "2026-12-18",
      constraints: {
        team: "2 backend, 1 frontend, 1 QA",
        capacityPersonDays: 120,
        technology: "React, Node.js, PostgreSQL",
        nonNegotiables: "No duplicate payment capture.",
      },
    });
  expect(generated.status).toBe(200);
  expect(generated.body.provider).toBe("deterministic-demo");
  expect(generated.body.draft.tasks.length).toBeGreaterThan(2);

  const created = await request(app)
    .post("/api/projects")
    .set(as(ownerId))
    .set("x-workspace-id", `ws_test_${suffix}`)
    .send({
      draft: generated.body.draft,
      generation: {
        provider: generated.body.provider,
        model: generated.body.model,
        degraded: generated.body.degraded,
      },
      constraints: {
        team: "2 backend, 1 frontend, 1 QA",
        capacityPersonDays: 120,
        technology: "React, Node.js, PostgreSQL",
        nonNegotiables: "No duplicate payment capture.",
      },
    });
  expect(created.status).toBe(201);
  projectId = created.body.project.id;
  initialTaskCount = created.body.tasks.length;
  expect(created.body.version).toBe(1);

  // createProject adds every database user so the demo can switch identities.
  // Promote the dedicated test member explicitly; the viewer keeps the default.
  await query(
    `UPDATE project_members SET role = 'member' WHERE project_id = $1 AND user_id = $2`,
    [projectId, memberId],
  );
});

afterAll(async () => {
  if (projectId) {
    await query(`DELETE FROM ai_calls WHERE project_id = $1`, [projectId]);
    await query(`DELETE FROM projects WHERE id = $1`, [projectId]);
  }
  await query(`DELETE FROM workspaces WHERE id = $1`, [`ws_test_${suffix}`]);
  await query(`DELETE FROM organizations WHERE id = $1`, [`org_test_${suffix}`]);
  await query(`DELETE FROM users WHERE id = ANY($1::text[])`, [testUserIds]);
  await closePool();
});

describe.sequential("MIRAIWERK API integration", () => {
  test("returns a labelled health response", async () => {
    const response = await request(app).get("/api/health");
    expect(response.status).toBe(200);
    expect(response.body.status).toBe("ok");
    expect(["meta", "deterministic-demo"]).toContain(response.body.ai);
  });

  test("lists the new project for its owner only", async () => {
    const ownerList = await request(app).get("/api/projects").set(as(ownerId));
    expect(ownerList.status).toBe(200);
    expect(
      ownerList.body.projects.find((project: { id: string }) => project.id === projectId),
    ).toMatchObject({ currentPlanVersion: 1, role: "owner" });

    const outsider = await request(app)
      .get(`/api/projects/${projectId}/plan`)
      .set(as(`usr_missing_${suffix}`));
    expect(outsider.status).toBe(401);
  });

  test("blocks viewers from creating tickets", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set(as(viewerId))
      .send({ ...incidentTicket, projectId });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe("FORBIDDEN");
  });

  test("creates and analyses a ticket into an evidence-backed proposal", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set(as(memberId))
      .send({ ...incidentTicket, projectId });
    expect(created.status).toBe(201);
    expect(created.body.ticket.status).toBe("new");
    firstTicketId = created.body.ticket.id;

    const analyzed = await request(app)
      .post(`/api/tickets/${firstTicketId}/analyze`)
      .set(as(ownerId));
    expect(analyzed.status).toBe(200);

    const proposal = analyzed.body.proposal;
    expect(proposal.status).toBe("pending");
    expect(proposal.basePlanVersion).toBe(1);
    expect(proposal.modelProvider).toBe("deterministic-demo");
    expect(proposal.classification.ticketType).toBe("incident");
    expect(proposal.evidence.length).toBeGreaterThan(0);
    expect(proposal.unknowns.length).toBeGreaterThan(0);
    expect(proposal.evidence.some((item: { state: string }) => item.state === "inferred"))
      .toBe(true);
    expect(proposal.proposedChanges.accept.tasksToAdd.length).toBe(2);
    expect(
      proposal.proposedChanges.accept.tasksToAdd.every(
        (task: { description: string }) => task.description.length > 0,
      ),
    ).toBe(true);
    firstProposalId = proposal.id;
  });

  test("simulates the accept option against the proposal baseline", async () => {
    const mismatch = await request(app)
      .post(`/api/decisions/${firstProposalId}/simulate`)
      .set(as(ownerId))
      .send({ option: "accept", baselineVersion: 99 });
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe("BASELINE_VERSION_MISMATCH");

    const response = await request(app)
      .post(`/api/decisions/${firstProposalId}/simulate`)
      .set(as(ownerId))
      .send({ option: "accept", baselineVersion: 1 });

    expect(response.status).toBe(200);
    expect(response.body.option).toBe("accept");
    expect(response.body.valid).toBe(true);
    expect(response.body.inputHash).toMatch(/^[a-f0-9]{16,}$/);
    expect(response.body.metrics.tasksAdded).toBe(2);
    expect(typeof response.body.metrics.scheduleDeltaDays).toBe("number");
    expect(response.body.diff.addedTasks).toHaveLength(2);
  });

  test("prepares a second proposal against the same baseline before approval", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set(as(memberId))
      .send({ ...secondTicket, projectId });
    expect(created.status).toBe(201);

    const analyzed = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/analyze`)
      .set(as(ownerId));
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.proposal.basePlanVersion).toBe(1);
    secondProposalId = analyzed.body.proposal.id;

    const simulated = await request(app)
      .post(`/api/decisions/${secondProposalId}/simulate`)
      .set(as(memberId))
      .send({ option: "accept", baselineVersion: 1 });
    expect(simulated.status).toBe(200);
    expect(simulated.body.valid).toBe(true);
  });

  test("forbids members and viewers from approving, even with a valid scenario", async () => {
    for (const userId of [memberId, viewerId]) {
      const response = await request(app)
        .post(`/api/decisions/${firstProposalId}/approve`)
        .set(as(userId))
        .send({ option: "accept", reason: "Attempted by a non-approver." });
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe("FORBIDDEN");
    }
  });

  test("approving accept creates plan version 2 and full audit history", async () => {
    const approved = await request(app)
      .post(`/api/decisions/${firstProposalId}/approve`)
      .set(as(ownerId))
      .send({
        option: "accept",
        reason: "Accept the containment fix and regression task before the payments gate.",
      });

    expect(approved.status).toBe(200);
    expect(approved.body.planVersionNumber).toBe(2);
    expect(approved.body.proposal.status).toBe("approved");
    expect(approved.body.audit.action).toBe("approved");
    expect(approved.body.audit.actorId).toBe(ownerId);

    const plan = await request(app)
      .get(`/api/projects/${projectId}/plan`)
      .set(as(ownerId));
    expect(plan.status).toBe(200);
    expect(plan.body.version).toBe(2);
    expect(plan.body.tasks.length).toBe(initialTaskCount + 2);
    expect(plan.body.tasks.some((task: { sourceTicketId: string | null }) => task.sourceTicketId === firstTicketId))
      .toBe(true);

    const history = await request(app)
      .get(`/api/projects/${projectId}/history`)
      .set(as(ownerId));
    expect(history.status).toBe(200);
    const versions = history.body.versions.map(
      (version: { versionNumber: number }) => version.versionNumber,
    );
    expect(versions).toEqual(expect.arrayContaining([2, 1]));
    expect(
      history.body.versions.find(
        (version: { versionNumber: number }) => version.versionNumber === 2,
      ),
    ).toMatchObject({ parentVersionId: expect.any(String) });
    expect(
      history.body.decisions.some(
        (decision: { action: string; actorId?: string }) =>
          decision.action === "approved",
      ),
    ).toBe(true);
    expect(
      history.body.auditEvents.some(
        (event: { action: string }) => event.action === "plan.versioned",
      ),
    ).toBe(true);
  });

  test("marks sibling proposals stale and refuses to revalidate or approve them", async () => {
    const detail = await request(app)
      .get(`/api/decisions/${secondProposalId}`)
      .set(as(ownerId));
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe("stale");

    const simulation = await request(app)
      .post(`/api/decisions/${secondProposalId}/simulate`)
      .set(as(ownerId))
      .send({ option: "accept", baselineVersion: 1 });
    expect(simulation.status).toBe(409);
    expect(simulation.body.error.code).toBe("DECISION_NOT_PENDING");

    const approval = await request(app)
      .post(`/api/decisions/${secondProposalId}/approve`)
      .set(as(ownerId))
      .send({ option: "accept", reason: "Should be rejected as stale." });
    expect(approval.status).toBe(409);
    expect(approval.body.error.code).toBe("DECISION_NOT_PENDING");
    expect(approval.body.error.message).toMatch(/stale/i);

    const history = await request(app)
      .get(`/api/projects/${projectId}/history`)
      .set(as(ownerId));
    expect(
      history.body.decisions.some(
        (decision: { decisionId: string; action: string }) =>
          decision.decisionId === secondProposalId && decision.action === "stale",
      ),
    ).toBe(true);
    expect(
      history.body.auditEvents.some(
        (event: { action: string }) => event.action === "decision.stale",
      ),
    ).toBe(true);
  });

  test("requires a stored, matching scenario before approval", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set(as(memberId))
      .send({ ...incidentTicket, title: "Checkout retry still duplicating captures", projectId });
    expect(created.status).toBe(201);
    thirdTicketId = created.body.ticket.id;

    const analyzed = await request(app)
      .post(`/api/tickets/${thirdTicketId}/analyze`)
      .set(as(ownerId));
    expect(analyzed.status).toBe(200);
    const proposalId = analyzed.body.proposal.id;
    expect(analyzed.body.proposal.basePlanVersion).toBe(2);
    expect(
      analyzed.body.proposal.scenarioRuns.map(
        (run: { option: string }) => run.option,
      ),
    ).toEqual(expect.arrayContaining(["accept"]));

    // Analysis pre-computes scenarios, but approval must still refuse when no
    // stored run exists for the requested option.
    await query(`DELETE FROM scenario_runs WHERE proposal_id = $1`, [proposalId]);
    const unsimulated = await request(app)
      .post(`/api/decisions/${proposalId}/approve`)
      .set(as(ownerId))
      .send({ option: "accept", reason: "Approve without a stored scenario." });
    expect(unsimulated.status).toBe(409);
    expect(unsimulated.body.error.code).toBe("SCENARIO_REQUIRED");

    const simulated = await request(app)
      .post(`/api/decisions/${proposalId}/simulate`)
      .set(as(ownerId))
      .send({ option: "accept", baselineVersion: 2 });
    expect(simulated.status).toBe(200);

    const approved = await request(app)
      .post(`/api/decisions/${proposalId}/approve`)
      .set(as(ownerId))
      .send({ option: "accept", reason: "Verified scenario before approval." });
    expect(approved.status).toBe(200);
    expect(approved.body.planVersionNumber).toBe(3);
  });

  test("defer records an audited decision without versioning the plan", async () => {
    const created = await request(app)
      .post("/api/tickets")
      .set(as(memberId))
      .send({
        ...incidentTicket,
        projectId,
        title: "Add saved payment methods for returning customers",
        description:
          "Returning customers should be able to save a payment method and reuse it at checkout. No success metric or scope boundary has been agreed yet.",
        ticketType: "feature_request",
        affectedComponent: "Checkout / payments",
        reportedImpact: "Repeat buyers re-enter payment details every time.",
        evidence: "Eight customer interview notes mention saved payment methods.",
        severityReported: "low",
      });
    expect(created.status).toBe(201);

    const analyzed = await request(app)
      .post(`/api/tickets/${created.body.ticket.id}/analyze`)
      .set(as(ownerId));
    expect(analyzed.status).toBe(200);
    expect(analyzed.body.proposal.recommendation).toBe("defer");
    const proposalId = analyzed.body.proposal.id;

    const simulation = await request(app)
      .post(`/api/decisions/${proposalId}/simulate`)
      .set(as(ownerId))
      .send({ option: "defer", baselineVersion: 3 });
    expect(simulation.status).toBe(200);
    expect(simulation.body.metrics.tasksAdded).toBe(0);

    const approved = await request(app)
      .post(`/api/decisions/${proposalId}/approve`)
      .set(as(ownerId))
      .send({ option: "defer", reason: "Park behind the active payments release." });
    expect(approved.status).toBe(200);
    expect(approved.body.planVersionNumber).toBeNull();
    expect(approved.body.proposal.status).toBe("approved");

    const plan = await request(app)
      .get(`/api/projects/${projectId}/plan`)
      .set(as(ownerId));
    expect(plan.body.version).toBe(3);
  });

  test("rejects malformed ticket input with a schema error", async () => {
    const response = await request(app)
      .post("/api/tickets")
      .set(as(ownerId))
      .send({ projectId, title: "x", description: "too short" });
    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });
});
