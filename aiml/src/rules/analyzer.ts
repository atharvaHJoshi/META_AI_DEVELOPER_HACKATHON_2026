import {
  ProposedChangeSchema,
  TicketAnalysisSchema,
  type DecisionOption,
  type EvidenceItem,
  type ProposedChange,
  type TicketAnalysis,
  type TicketType,
} from "@miraiwerk/schemas";
import type { AnalysisContext, TicketAnalysisResult, Usage } from "../types.js";
import { DETERMINISTIC_MODEL } from "../config.js";
import { excerpt, lexicalScore, sentenceExcerpt } from "../lib/text.js";

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function detectType(
  text: string,
  title: string,
  severity: string,
  environment: string,
): TicketType {
  const lower = text.toLowerCase();
  const titleLower = title.toLowerCase();
  const productionContext = /\bproduction\b/.test(lower);
  const incidentSignals =
    /(\bproduction\b|\boutage\b|\bincident\b|\bdown\b|\bunavailable\b|data loss|\bbreach\b|charged twice|double charge|duplicate charge|duplicated charge|duplicate capture|sev\s*[01]\b|\bp0\b)/.test(
      lower,
    );

  // A finance export that repeats a line is a reporting bug unless the ticket
  // also reports a production outage. "Duplicate charge" alone is ambiguous.
  const financeExport =
    /(invoice|export|csv)/.test(lower) && /(duplicate|duplicated|twice|same)/.test(lower);
  if (financeExport && !productionContext && !/\b(outage|incident)\b/.test(lower)) {
    return "bug";
  }

  if (
    incidentSignals &&
    (severity === "critical" ||
      /\bproduction\b|\boutage\b|\bincident\b|charged twice|double charge|duplicate charge|duplicate capture|data loss|\bbreach\b/.test(
        lower,
      ))
  ) {
    return "incident";
  }

  // Debt markers are an explicit intent signal. Reading them from the title
  // avoids treating incidental words such as "asset migration" as debt.
  const debtMarkers = /(refactor|technical debt|tech debt|upgrade|deprecated|rewrite|cleanup|flaky)/;
  if (debtMarkers.test(titleLower) || /(technical debt|tech debt)/.test(lower)) {
    return "technical_debt";
  }

  // Feature intent is also title-led. Otherwise phrases like "adds friction"
  // or "contacting support" turn ordinary bug reports into feature requests.
  const featureMarkers = /(add|support|allow|would like|feature|enable|new capability|request)/;
  if (
    featureMarkers.test(titleLower) ||
    /(would like|customer request|new capability)/.test(lower)
  ) {
    return "feature_request";
  }

  if (
    /(bug|error|fail|broken|crash|wrong|incorrect|cannot|can't|timeout|slow|regression|missing|stale)/.test(
      lower,
    )
  ) {
    return "bug";
  }
  if (environment === "production" && severity !== "low") return "incident";
  return "clarification";
}

function detectPriority(
  type: TicketType,
  text: string,
  severity: string,
): "P0" | "P1" | "P2" | "P3" {
  const lower = text.toLowerCase();
  const highStakes = /(payment|charge|checkout|auth|security|privacy|data loss|outage|production)/.test(
    lower,
  );
  if (type === "incident" && highStakes && severity !== "low" && severity !== "medium") {
    return "P0";
  }
  if (type === "incident" || (type === "bug" && highStakes)) return "P1";
  if (severity === "critical" || severity === "high") return "P1";
  if (type === "feature_request") return "P2";
  if (type === "technical_debt") return "P3";
  return "P2";
}

function optionRationale(type: TicketType, recommended: DecisionOption, hasEvidence: boolean): string {
  if (recommended === "clarify") {
    return `The ticket may be a ${type.replace("_", " ")}, but the ticket does not contain enough evidence to justify changing a release plan. Request the missing facts, preserve the ticket, and re-run RippleMap once they arrive.`;
  }
  if (recommended === "split") {
    return "The ticket has credible production evidence and touches a release gate. A time-bounded mitigation plus a permanent fix reduces exposure without pretending the full customer impact is known yet.";
  }
  if (recommended === "defer") {
    return "The request is not currently tied to a release gate or a confirmed defect. It can be scheduled behind the active release work, but the deferral risk should remain visible in the decision record.";
  }
  if (recommended === "duplicate") {
    return "A likely existing ticket was found. Confirm the root cause before linking, because semantic similarity alone is not proof of duplication.";
  }
  return hasEvidence
    ? "The ticket is grounded in the current plan and has enough evidence to size a scoped fix. Accepting it adds explicit work and dependencies rather than silently expanding scope."
    : "Accepting will add work to the plan, but the supporting evidence is limited. The proposal keeps assumptions and unknowns visible for the approver.";
}

function shortTitle(title: string, max = 72): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function selectRelated(context: AnalysisContext) {
  const query = `${context.ticket.title} ${context.ticket.description} ${context.ticket.affectedComponent} ${context.ticket.reportedImpact}`;
  const requirements = context.requirements
    .map((requirement) => ({
      requirement,
      score: round(
        lexicalScore(
          query,
          `${requirement.title} ${requirement.description} ${requirement.acceptanceCriteria.join(" ")}`,
        ),
      ),
    }))
    .filter((item) => item.score >= 0.035)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  const tasks = context.tasks
    .map((task) => ({
      task,
      score: round(
        lexicalScore(
          query,
          `${task.title} ${task.description} ${task.milestoneTitle ?? ""}`,
        ),
      ),
    }))
    .filter((item) => item.score >= 0.03)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return { requirements, tasks };
}

function findAnchor(
  context: AnalysisContext,
  relatedTasks: AnalysisContext["tasks"],
): AnalysisContext["tasks"][number] | null {
  const releaseGateMilestones = new Set(
    context.milestones.filter((milestone) => milestone.releaseGate).map((milestone) => milestone.id),
  );
  const gateTasks = relatedTasks.filter(
    (task) =>
      task.milestoneId &&
      releaseGateMilestones.has(task.milestoneId) &&
      (task.downstreamTaskIds.length > 0 ||
        /test|gate|acceptance|validation|release/i.test(task.title)),
  );
  if (gateTasks.length > 0) return gateTasks[0] ?? null;
  const withDownstream = relatedTasks.filter(
    (task) => task.downstreamTaskIds.length > 0,
  );
  if (withDownstream.length > 0) return withDownstream[0] ?? null;
  const allGateTasks = context.tasks.filter(
    (task) =>
      task.milestoneId &&
      releaseGateMilestones.has(task.milestoneId) &&
      /test|gate|acceptance|validation|release/i.test(task.title),
  );
  return relatedTasks[0] ?? allGateTasks[0] ?? null;
}

function targetMilestone(
  context: AnalysisContext,
  anchor: AnalysisContext["tasks"][number] | null,
  relatedTasks: AnalysisContext["tasks"],
): AnalysisContext["milestones"][number] | null {
  const ids = [
    anchor?.milestoneId,
    ...relatedTasks.map((task) => task.milestoneId),
  ].filter((id): id is string => Boolean(id));
  const scoped = context.milestones.filter((milestone) => ids.includes(milestone.id));
  const gate = scoped.find((milestone) => milestone.releaseGate);
  if (gate) return gate;
  if (scoped[0]) return scoped[0];
  const gates = context.milestones.filter((milestone) => milestone.releaseGate);
  return gates[gates.length - 1] ?? context.milestones[context.milestones.length - 1] ?? null;
}

function buildAcceptChange(
  context: AnalysisContext,
  type: TicketType,
  priority: string,
  requirementId: string | null,
  anchor: AnalysisContext["tasks"][number] | null,
  milestoneId: string | null,
): ProposedChange {
  const short = shortTitle(context.ticket.title);
  const isIncident = type === "incident";
  const isFeature = type === "feature_request";
  const isDebt = type === "technical_debt";
  const ticketRef = context.ticket.id;
  const fixId = `accept-fix-${ticketRef.slice(-6)}`;
  const testId = `accept-test-${ticketRef.slice(-6)}`;
  const fixDays = isIncident ? 3 : isFeature ? 5 : isDebt ? 4 : 2;

  const fixTitle = isIncident
    ? `Contain and fix: ${short}`
    : isFeature
      ? `Implement: ${short}`
      : isDebt
        ? `Address debt: ${short}`
        : `Fix: ${short}`;

  const dependenciesToAdd = [];
  if (anchor) {
    dependenciesToAdd.push({
      predecessorId: testId,
      successorId: anchor.id,
      dependencyType: "finishes_to_start",
    });
  }

  return ProposedChangeSchema.parse({
    option: "accept",
    tasksToAdd: [
      {
        tempId: fixId,
        title: fixTitle,
        description: `Proposed from ticket ${ticketRef}. ${
          isIncident
            ? "Contain the customer exposure, implement the permanent fix, and preserve evidence for reconciliation."
            : "Implement the requested change and preserve the acceptance criteria of the linked requirement."
        }`,
        requirementId,
        milestoneId,
        estimateDays: fixDays,
        priority: priority === "P0" ? "P0" : "P1",
        ownerRole: isDebt ? "Engineering" : "Backend",
        dependencies: [],
      },
      {
        tempId: testId,
        title: `Regression coverage: ${shortTitle(context.ticket.title, 56)}`,
        description:
          "Add a failing-first regression test and verify the release gate after the fix.",
        requirementId,
        milestoneId,
        estimateDays: 1,
        priority: priority === "P0" ? "P0" : "P1",
        ownerRole: "QA",
        dependencies: [fixId],
      },
    ],
    tasksToUpdate: [],
    tasksToRemove: [],
    dependenciesToAdd,
    assumptions: [
      "The estimate assumes one engineer familiar with the affected component.",
      "No additional headcount is assumed.",
      isIncident
        ? "The ticket evidence is sufficient to size containment work, but full customer impact remains unconfirmed."
        : "The linked requirement is the most likely scope owner; the relationship is inferred.",
    ],
    rationale: "Accepting adds an explicit fix and regression task to the current plan.",
  });
}

function buildSplitChange(
  context: AnalysisContext,
  type: TicketType,
  priority: string,
  requirementId: string | null,
  anchor: AnalysisContext["tasks"][number] | null,
  milestoneId: string | null,
): ProposedChange {
  const short = shortTitle(context.ticket.title);
  const ticketRef = context.ticket.id;
  const mitigationId = `split-mitigate-${ticketRef.slice(-6)}`;
  const fixId = `split-fix-${ticketRef.slice(-6)}`;
  const testId = `split-test-${ticketRef.slice(-6)}`;
  const paymentContext = /payment|charge|checkout|retry|capture/i.test(
    `${context.ticket.title} ${context.ticket.description} ${context.ticket.affectedComponent}`,
  );

  const mitigationTitle = paymentContext
    ? "Pause automatic payment retries behind a guarded feature flag"
    : `Apply temporary mitigation: ${shortTitle(context.ticket.title, 56)}`;

  const dependenciesToAdd = [];
  if (anchor) {
    dependenciesToAdd.push({
      predecessorId: testId,
      successorId: anchor.id,
      dependencyType: "finishes_to_start",
    });
  }

  return ProposedChangeSchema.parse({
    option: "split",
    tasksToAdd: [
      {
        tempId: mitigationId,
        title: mitigationTitle,
        description: paymentContext
          ? "Reduce duplicate-capture exposure while the permanent retry guard is implemented. Document how to reverse the flag."
          : "Reduce immediate exposure with a reversible, time-bounded mitigation.",
        requirementId,
        milestoneId,
        estimateDays: 1,
        priority: "P0",
        ownerRole: "Backend",
        dependencies: [],
      },
      {
        tempId: fixId,
        title: `Permanent fix: ${shortTitle(context.ticket.title, 60)}`,
        description:
          "Implement the durable correction, including idempotency or retry semantics where relevant.",
        requirementId,
        milestoneId,
        estimateDays: type === "feature_request" ? 4 : 3,
        priority: priority === "P0" ? "P0" : "P1",
        ownerRole: "Backend",
        dependencies: [mitigationId],
      },
      {
        tempId: testId,
        title: `Verify mitigation and fix: ${shortTitle(context.ticket.title, 48)}`,
        description:
          "Reproduce the original failure, verify the mitigation, then keep a regression test for the permanent fix.",
        requirementId,
        milestoneId,
        estimateDays: 1,
        priority: priority === "P0" ? "P0" : "P1",
        ownerRole: "QA",
        dependencies: [fixId],
      },
    ],
    tasksToUpdate: [],
    tasksToRemove: [],
    dependenciesToAdd,
    assumptions: [
      "The temporary mitigation can be reversed without a data migration.",
      "The permanent fix and regression verification are both required before the release gate can pass.",
      "No additional headcount is assumed.",
      "Full affected-customer impact is still being quantified.",
    ],
    rationale:
      "Split reduces immediate exposure while keeping the durable correction and verification visible.",
  });
}

export function demoAnalyzeTicket(context: AnalysisContext): TicketAnalysisResult {
  const started = Date.now();
  const text = `${context.ticket.title} ${context.ticket.description} ${context.ticket.affectedComponent} ${context.ticket.reportedImpact}`;
  const type = detectType(
    text,
    context.ticket.title,
    context.ticket.severityReported,
    context.ticket.environment,
  );
  const priority = detectPriority(type, text, context.ticket.severityReported);
  const related = selectRelated(context);
  const relatedTasks = related.tasks.map((item) => item.task);
  const anchor = findAnchor(context, relatedTasks);
  const milestone = targetMilestone(context, anchor, relatedTasks);
  const requirementId =
    related.requirements[0]?.requirement.id ??
    anchor?.requirementId ??
    context.requirements[0]?.id ??
    null;

  const hasEvidence =
    context.ticket.evidence.trim().length >= 20 &&
    context.ticket.reportedImpact.trim().length >= 10;
  const criticalEvidenceGap =
    type === "incident" &&
    (!context.ticket.environment ||
      context.ticket.evidence.trim().length < 20 ||
      context.ticket.reportedImpact.trim().length < 10);

  let recommendedOption: DecisionOption;
  if (type === "clarification" || criticalEvidenceGap) recommendedOption = "clarify";
  else if (type === "incident") recommendedOption = "split";
  else if (type === "feature_request" || type === "technical_debt") recommendedOption = "defer";
  else recommendedOption = "accept";

  const unknownCandidates: string[] = [];
  if (!context.ticket.environment) {
    unknownCandidates.push("The environment where the issue occurs is not stated.");
  }
  if (!context.ticket.reportedImpact) {
    unknownCandidates.push("Customer and business impact is not quantified in the ticket.");
  }
  if (type === "incident") {
    unknownCandidates.push(
      "The exact number of affected customers and transactions is not established.",
    );
    if (!/transaction|capture|request[- ]?id|trace|log|payload/i.test(context.ticket.evidence)) {
      unknownCandidates.push("A failing request trace or transaction reference is not provided.");
    }
    if (!/reproduc|steps|retry|trigger/i.test(`${context.ticket.description} ${context.ticket.evidence}`)) {
      unknownCandidates.push("Reproduction rate and steps for the retry path are not established.");
    }
    if (!/deploy|release|version|config/i.test(text)) {
      unknownCandidates.push(
        "Correlation with a recent deployment or configuration change is unknown.",
      );
    }
    unknownCandidates.push(
      "Whether retries can be paused safely without breaking active checkouts has not been verified.",
    );
  } else if (type === "bug") {
    unknownCandidates.push("A reliable reproduction environment and affected product version are not confirmed.");
    unknownCandidates.push("The scope of affected users is not quantified.");
  } else if (type === "feature_request") {
    unknownCandidates.push("The success metric and target user segment are not defined.");
    unknownCandidates.push("The requested scope boundary is not confirmed.");
  } else if (type === "technical_debt") {
    unknownCandidates.push("The size and risk of the affected code surface are not confirmed.");
  } else {
    unknownCandidates.push("The expected outcome and acceptance criteria are not clear.");
  }
  if (!context.ticket.evidence.trim()) {
    unknownCandidates.push("No concrete evidence (logs, reproduction steps or screenshots) was supplied.");
  }
  const unknowns = [...new Set(unknownCandidates)].slice(0, 8);

  const evidence: EvidenceItem[] = [
    {
      claim: `Ticket reports: ${shortTitle(context.ticket.title, 160)}`,
      state: "observed",
      sourceType: "ticket",
      sourceId: context.ticket.id,
      excerpt: excerpt(context.ticket.description),
    },
  ];
  if (context.ticket.reportedImpact) {
    evidence.push({
      claim: `Reported impact: ${excerpt(context.ticket.reportedImpact, 220)}`,
      state: "observed",
      sourceType: "ticket",
      sourceId: context.ticket.id,
      excerpt: excerpt(context.ticket.reportedImpact, 220),
    });
  }
  if (context.ticket.evidence) {
    evidence.push({
      claim: "The ticket contains supporting operational evidence.",
      state: "observed",
      sourceType: "ticket",
      sourceId: context.ticket.id,
      excerpt: excerpt(context.ticket.evidence, 260),
    });
  }
  if (context.ticket.environment) {
    evidence.push({
      claim: `Reported environment: ${context.ticket.environment}`,
      state: "observed",
      sourceType: "ticket",
      sourceId: context.ticket.id,
      excerpt: excerpt(context.ticket.environment),
    });
  }
  const relatedRecords = [];
  for (const item of related.requirements.slice(0, 2)) {
    relatedRecords.push({
      entityType: "requirement" as const,
      entityId: item.requirement.id,
      relationshipType: "relates_to" as const,
      evidenceState: "inferred" as const,
      rationale: `The ticket text shares ${Math.round(item.score * 100)}% lexical grounding with this requirement. Confirm the scope owner before treating the link as fact.`,
    });
    evidence.push({
      claim: `Likely related requirement: ${item.requirement.title}`,
      state: "inferred",
      sourceType: "project",
      sourceId: item.requirement.id,
      excerpt: item.requirement.title,
    });
  }
  for (const item of related.tasks.slice(0, 3)) {
    relatedRecords.push({
      entityType: "task" as const,
      entityId: item.task.id,
      relationshipType: "relates_to" as const,
      evidenceState: "inferred" as const,
      rationale: `Candidate work item based on lexical overlap with the ticket. ${
        item.task.downstreamTaskIds.length > 0
          ? `${item.task.downstreamTaskIds.length} stored task(s) depend on this task.`
          : "No downstream dependency is stored for this task."
      }`,
    });
  }
  if (milestone) {
    relatedRecords.push({
      entityType: "milestone" as const,
      entityId: milestone.id,
      relationshipType: "blocks" as const,
      evidenceState: "inferred" as const,
      rationale: `This ${milestone.releaseGate ? "release gate" : "milestone"} is the closest delivery boundary for the candidate work. The link is inferred until an approver confirms scope.`,
    });
  }

  const duplicateCandidates = context.relatedTickets
    .map((ticket) => {
      const titleScore = lexicalScore(context.ticket.title, ticket.title);
      const bodyScore = lexicalScore(text, `${ticket.title} ${ticket.description}`);
      return {
        ticket,
        score: titleScore * 0.65 + bodyScore * 0.35,
      };
    })
    .filter((item) => item.score >= 0.35)
    .sort((a, b) => b.score - a.score)
    .slice(0, 1)
    .map((item) => ({
      ticketId: item.ticket.id,
      rationale: `Related ticket has ${Math.round(item.score * 100)}% lexical overlap, weighted toward the title. Similar wording is not proof of the same root cause.`,
      evidenceState: "inferred" as const,
    }));

  const accept = buildAcceptChange(
    context,
    type,
    priority,
    requirementId,
    anchor,
    anchor?.milestoneId ?? milestone?.id ?? null,
  );
  const split =
    type === "incident" || type === "feature_request" || type === "technical_debt"
      ? buildSplitChange(
          context,
          type,
          priority,
          requirementId,
          anchor,
          anchor?.milestoneId ?? milestone?.id ?? null,
        )
      : null;

  const classificationLabel =
    type === "feature_request" ? "feature request" : type.replace("_", " ");
  const summary = `${criticalEvidenceGap ? "Potential " : ""}${classificationLabel} affecting ${
    context.ticket.affectedComponent || "an unspecified part of the project"
  }: ${shortTitle(context.ticket.title, 130)}`;
  const businessImpact = context.ticket.reportedImpact
    ? `Reported: ${excerpt(context.ticket.reportedImpact, 300)}`
    : "Impact is not quantified in the ticket. Treat severity as unverified until a reviewer supplies customer or transaction evidence.";

  const analysis: TicketAnalysis = TicketAnalysisSchema.parse({
    classification: {
      ticketType: type,
      priority,
      urgency:
        priority === "P0"
          ? "critical"
          : priority === "P1"
            ? "high"
            : priority === "P2"
              ? "medium"
              : "low",
      summary,
      businessImpact,
      customerImpact: context.ticket.reportedImpact
        ? sentenceExcerpt(context.ticket.reportedImpact, ["customer", "charge", "impact", "order", "blocked"], 220)
        : "Not established from the supplied ticket.",
    },
    relatedRecords,
    duplicateCandidates,
    evidence: evidence.slice(0, 18),
    unknowns,
    clarifyingQuestions:
      recommendedOption === "clarify"
        ? unknowns.slice(0, 5).map((unknown) => `Can you provide: ${unknown}`)
        : [],
    recommendedOption,
    recommendationRationale: optionRationale(type, recommendedOption, hasEvidence),
    proposedChanges: {
      accept,
      split,
    },
  });

  const usage: Usage = { inputTokens: null, outputTokens: null };
  return {
    analysis,
    provider: "deterministic-demo",
    model: DETERMINISTIC_MODEL,
    degraded: false,
    notice:
      "Deterministic demo analysis: no Meta API key is configured. The classification and links are rule-based and labelled as such.",
    latencyMs: Math.max(1, Date.now() - started),
    usage,
    toolCalls: [],
  };
}

export function demoRelatedTickets(ticketText: string, tickets: Array<{ title: string; description: string }>) {
  return tickets
    .map((ticket) => ({
      ...ticket,
      score: round(lexicalScore(ticketText, `${ticket.title} ${ticket.description}`)),
    }))
    .sort((a, b) => b.score - a.score);
}
