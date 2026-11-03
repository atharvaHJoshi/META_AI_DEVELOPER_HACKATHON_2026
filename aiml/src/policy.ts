import type {
  PolicyOutcome,
  TicketAnalysis,
} from "@miraiwerk/schemas";
import type { AnalysisContext } from "./types.js";

const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;

function lowerPriority(priority: PolicyOutcome["finalPriority"]): PolicyOutcome["finalPriority"] {
  if (priority === "P0") return "P1";
  if (priority === "P1") return "P2";
  if (priority === "P2") return "P3";
  return "P3";
}

function atLeast(
  priority: PolicyOutcome["finalPriority"],
  floor: PolicyOutcome["finalPriority"],
): PolicyOutcome["finalPriority"] {
  return PRIORITY_ORDER[priority] <= PRIORITY_ORDER[floor] ? priority : floor;
}

export function applyPolicy(
  analysis: TicketAnalysis,
  context: AnalysisContext,
): { classification: TicketAnalysis["classification"]; policy: PolicyOutcome } {
  const policyConfig = context.project.constraints.policy;
  const modelPriority = analysis.classification.priority;
  let finalPriority = modelPriority;
  const rulesApplied: string[] = [];

  const text = `${context.ticket.title} ${context.ticket.description} ${context.ticket.affectedComponent} ${context.ticket.reportedImpact}`.toLowerCase();
  const component = context.ticket.affectedComponent.toLowerCase();
  const escalationComponents = policyConfig?.escalationComponents ?? [];
  const escalatedComponent =
    escalationComponents.some((item) => component.includes(item.toLowerCase())) ||
    escalationComponents.some((item) => text.includes(item.toLowerCase()));

  if (escalatedComponent) {
    finalPriority = atLeast(finalPriority, "P1");
    rulesApplied.push("Escalation component matched: priority floor P1.");
  }

  if (
    analysis.classification.ticketType === "incident" &&
    context.ticket.environment.toLowerCase() === "production"
  ) {
    finalPriority = atLeast(finalPriority, "P1");
    rulesApplied.push("Production incident: priority floor P1.");
  }

  if (context.ticket.severityReported === "critical" && analysis.classification.ticketType !== "feature_request") {
    finalPriority = atLeast(finalPriority, "P1");
    rulesApplied.push("Reporter marked severity critical: priority floor P1.");
  }

  if (policyConfig?.requireEvidenceForP0 && finalPriority === "P0") {
    const hasEvidence =
      context.ticket.evidence.trim().length >= 20 &&
      context.ticket.reportedImpact.trim().length >= 10 &&
      Boolean(context.ticket.environment.trim());
    if (!hasEvidence) {
      finalPriority = lowerPriority(finalPriority);
      rulesApplied.push(
        "P0 requires concrete impact, environment and evidence: downgraded pending clarification.",
      );
    }
  }

  if (
    finalPriority === "P0" &&
    !["incident", "bug"].includes(analysis.classification.ticketType)
  ) {
    finalPriority = lowerPriority(finalPriority);
    rulesApplied.push("Non-defect ticket cannot hold P0 under the configured policy.");
  }

  if (rulesApplied.length === 0) {
    rulesApplied.push("Model priority accepted; no escalation rule matched.");
  }

  const criticalHours = policyConfig?.criticalResponseHours ?? 24;
  const highDays = policyConfig?.highResponseDays ?? 3;
  const normalDays = policyConfig?.normalResponseDays ?? 10;
  const responseWindowHours =
    finalPriority === "P0"
      ? criticalHours
      : finalPriority === "P1"
        ? highDays * 24
        : finalPriority === "P2"
          ? normalDays * 24
          : normalDays * 24 * 2;
  const responseWindowLabel =
    finalPriority === "P0"
      ? `Respond within ${criticalHours} hour(s)`
      : finalPriority === "P1"
        ? `Respond within ${highDays} working day(s)`
        : finalPriority === "P2"
          ? `Triage within ${normalDays} working day(s)`
          : "Backlog — no active response window";

  return {
    classification: { ...analysis.classification, priority: finalPriority },
    policy: {
      modelPriority,
      finalPriority,
      responseWindowHours,
      responseWindowLabel,
      rulesApplied,
      escalated: PRIORITY_ORDER[finalPriority] < PRIORITY_ORDER[modelPriority],
    },
  };
}
