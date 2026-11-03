import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ProjectConstraintsSchema,
  type DecisionOption,
  type PlanDraft,
  type TicketAnalysis,
  type TicketType,
} from "@miraiwerk/schemas";
import {
  applyPolicy,
  commercePlan,
  demoAnalyzeTicket,
  DETERMINISTIC_MODEL,
  hasMetaKey,
  metaAnalyzeTicket,
  type AnalysisContext,
} from "../src/index.js";

const datasetPath = fileURLToPath(new URL("../evaluations/tickets.json", import.meta.url));
const reportPath = fileURLToPath(new URL("../evaluations/report.md", import.meta.url));
const jsonPath = fileURLToPath(new URL("../evaluations/report.json", import.meta.url));

interface Expected {
  ticketType: TicketType;
  priority: "P0" | "P1" | "P2" | "P3";
  recommendation: DecisionOption;
  duplicate?: boolean;
  minUnknowns: number;
}

interface EvaluationCase {
  id: string;
  title: string;
  description: string;
  ticketType: TicketType | null;
  affectedComponent: string;
  reportedImpact: string;
  evidence: string;
  environment: string;
  severityReported: "critical" | "high" | "medium" | "low" | "unspecified";
  expected: Expected;
  note: string;
}

interface Dataset {
  version: number;
  name: string;
  description: string;
  plan: {
    name: string;
    goal: string;
    description: string;
    startDate: string;
    targetDate: string;
    constraints: Record<string, unknown>;
    policy: Record<string, unknown>;
  };
  contextTickets: Array<{
    title: string;
    description: string;
    ticketType: string;
    status: string;
    createdAt: string;
  }>;
  cases: EvaluationCase[];
}

interface CaseResult {
  id: string;
  title: string;
  note: string;
  expected: Expected;
  actual: {
    ticketType: string;
    priority: string;
    recommendation: string;
    duplicate: boolean;
    duplicateCount: number;
    unknowns: number;
    clarifyingQuestions: number;
    evidenceItems: number;
    hasAcceptChange: boolean;
    hasSplitChange: boolean;
    acceptTasks: number;
    splitTasks: number;
  };
  matches: {
    ticketType: boolean;
    priority: boolean;
    recommendation: boolean;
    duplicate: boolean | null;
    evidence: boolean;
    completeness: boolean;
  };
  pass: boolean;
  latencyMs: number;
}

function parseProvider(): "deterministic" | "meta" {
  const raw = process.argv
    .find((argument) => argument.startsWith("--provider="))
    ?.split("=")[1];
  if (!raw || raw === "deterministic" || raw === "deterministic-demo") {
    return "deterministic";
  }
  if (raw === "meta") return "meta";
  console.error(`Unknown provider "${raw}". Use --provider=deterministic or --provider=meta.`);
  process.exit(1);
}

function buildContext(dataset: Dataset, ticket: EvaluationCase): AnalysisContext {
  const draft: PlanDraft = commercePlan({
    name: dataset.plan.name,
    goal: dataset.plan.goal,
    description: dataset.plan.description,
    startDate: dataset.plan.startDate,
    targetDate: dataset.plan.targetDate,
    constraints: {
      team: String(dataset.plan.constraints.team ?? ""),
      capacityPersonDays: Number(dataset.plan.constraints.capacityPersonDays ?? 0),
      technology: String(dataset.plan.constraints.technology ?? ""),
      nonNegotiables: String(dataset.plan.constraints.nonNegotiables ?? ""),
    },
  });

  const downstream = new Map<string, string[]>();
  const upstream = new Map<string, string[]>();
  for (const task of draft.tasks) {
    upstream.set(task.tempId, task.dependencies);
    for (const dependency of task.dependencies) {
      const list = downstream.get(dependency) ?? [];
      list.push(task.tempId);
      downstream.set(dependency, list);
    }
  }
  const milestoneTitle = new Map(
    draft.milestones.map((milestone) => [milestone.tempId, milestone.title]),
  );

  const constraints = ProjectConstraintsSchema.parse({
    ...dataset.plan.constraints,
    policy: dataset.plan.policy,
  });

  return {
    project: {
      id: "eval-project",
      name: draft.name,
      description: draft.description,
      goal: draft.goal,
      startDate: draft.startDate,
      targetDate: draft.targetDate,
      planVersion: 1,
      constraints,
      currentPlanAssumptions: draft.assumptions,
    },
    requirements: draft.requirements.map((requirement) => ({
      id: requirement.tempId,
      title: requirement.title,
      description: requirement.description,
      acceptanceCriteria: requirement.acceptanceCriteria,
    })),
    milestones: draft.milestones.map((milestone) => ({
      id: milestone.tempId,
      title: milestone.title,
      targetDate: milestone.targetDate,
      releaseGate: milestone.releaseGate,
    })),
    tasks: draft.tasks.map((task) => ({
      id: task.tempId,
      title: task.title,
      description: task.description,
      status: "planned",
      priority: task.priority,
      estimateDays: task.estimateDays,
      requirementId: task.requirementTempId,
      milestoneId: task.milestoneTempId,
      milestoneTitle: task.milestoneTempId
        ? (milestoneTitle.get(task.milestoneTempId) ?? null)
        : null,
      plannedStart: null,
      plannedFinish: null,
      downstreamTaskIds: downstream.get(task.tempId) ?? [],
      upstreamTaskIds: upstream.get(task.tempId) ?? [],
    })),
    relatedTickets: dataset.contextTickets.map((contextTicket, index) => ({
      id: `ctx-${String(index + 1).padStart(2, "0")}`,
      title: contextTicket.title,
      description: contextTicket.description,
      ticketType: contextTicket.ticketType,
      status: contextTicket.status,
      createdAt: contextTicket.createdAt,
    })),
    ticket: {
      id: `eval-${ticket.id}`,
      title: ticket.title,
      description: ticket.description,
      source: "evaluation",
      affectedComponent: ticket.affectedComponent,
      reportedImpact: ticket.reportedImpact,
      evidence: ticket.evidence,
      reporter: "Evaluation fixture",
      environment: ticket.environment,
      severityReported: ticket.severityReported,
      createdAt: new Date().toISOString(),
    },
  };
}

async function analyse(
  provider: "deterministic" | "meta",
  context: AnalysisContext,
): Promise<{ analysis: TicketAnalysis; latencyMs: number; model: string }> {
  if (provider === "deterministic") {
    const result = demoAnalyzeTicket(context);
    return {
      analysis: result.analysis,
      latencyMs: result.latencyMs,
      model: result.model,
    };
  }
  if (!hasMetaKey()) {
    console.error(
      "META MODE UNAVAILABLE: set MODEL_API_KEY (or META_API_KEY) before running --provider=meta.",
    );
    process.exit(1);
  }
  const result = await metaAnalyzeTicket(context);
  return {
    analysis: result.analysis,
    latencyMs: result.latencyMs,
    model: result.model,
  };
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function truncate(value: string, max = 58): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

async function main(): Promise<void> {
  const provider = parseProvider();
  const dataset = JSON.parse(readFileSync(datasetPath, "utf8")) as Dataset;
  const results: CaseResult[] = [];
  let model = DETERMINISTIC_MODEL;

  for (const evaluationCase of dataset.cases) {
    const context = buildContext(dataset, evaluationCase);
    const { analysis, latencyMs, model: usedModel } = await analyse(provider, context);
    model = usedModel;
    const policy = applyPolicy(analysis, context);
    const priority = policy.classification.priority;
    const recommendation = analysis.recommendedOption;
    const duplicateDetected = analysis.duplicateCandidates.length > 0;
    const expectedSplit = ["incident", "feature_request", "technical_debt"].includes(
      evaluationCase.expected.ticketType,
    );
    const splitAvailable = Boolean(analysis.proposedChanges.split);
    const acceptTasks = analysis.proposedChanges.accept?.tasksToAdd.length ?? 0;

    const matches = {
      ticketType: policy.classification.ticketType === evaluationCase.expected.ticketType,
      priority: priority === evaluationCase.expected.priority,
      recommendation: recommendation === evaluationCase.expected.recommendation,
      duplicate:
        evaluationCase.expected.duplicate === undefined
          ? null
          : duplicateDetected === evaluationCase.expected.duplicate,
      evidence:
        analysis.unknowns.length >= evaluationCase.expected.minUnknowns &&
        (evaluationCase.expected.recommendation === "clarify"
          ? analysis.clarifyingQuestions.length > 0
          : analysis.clarifyingQuestions.length === 0),
      completeness:
        acceptTasks > 0 &&
        (analysis.proposedChanges.accept?.tasksToAdd.every(
          (task) => task.estimateDays > 0 && task.title.length > 0,
        ) ??
          false) &&
        splitAvailable === expectedSplit,
    };

    results.push({
      id: evaluationCase.id,
      title: evaluationCase.title,
      note: evaluationCase.note,
      expected: evaluationCase.expected,
      actual: {
        ticketType: policy.classification.ticketType,
        priority,
        recommendation,
        duplicate: duplicateDetected,
        duplicateCount: analysis.duplicateCandidates.length,
        unknowns: analysis.unknowns.length,
        clarifyingQuestions: analysis.clarifyingQuestions.length,
        evidenceItems: analysis.evidence.length,
        hasAcceptChange: Boolean(analysis.proposedChanges.accept),
        hasSplitChange: splitAvailable,
        acceptTasks,
        splitTasks: analysis.proposedChanges.split?.tasksToAdd.length ?? 0,
      },
      matches,
      pass:
        matches.ticketType &&
        matches.priority &&
        matches.recommendation &&
        matches.evidence &&
        matches.completeness &&
        matches.duplicate !== false,
      latencyMs,
    });
  }

  const total = results.length;
  const typeAccuracy = ratio(
    results.filter((result) => result.matches.ticketType).length,
    total,
  );
  const priorityAccuracy = ratio(
    results.filter((result) => result.matches.priority).length,
    total,
  );
  const recommendationAccuracy = ratio(
    results.filter((result) => result.matches.recommendation).length,
    total,
  );
  const evidenceDiscipline = ratio(
    results.filter((result) => result.matches.evidence).length,
    total,
  );
  const proposalCompleteness = ratio(
    results.filter((result) => result.matches.completeness).length,
    total,
  );

  const duplicateCases = results.filter((result) => result.matches.duplicate !== null);
  const truePositive = duplicateCases.filter(
    (result) => result.expected.duplicate === true && result.actual.duplicate,
  ).length;
  const falsePositive = duplicateCases.filter(
    (result) => result.expected.duplicate === false && result.actual.duplicate,
  ).length;
  const falseNegative = duplicateCases.filter(
    (result) => result.expected.duplicate === true && !result.actual.duplicate,
  ).length;
  const trueNegative = duplicateCases.filter(
    (result) => result.expected.duplicate === false && !result.actual.duplicate,
  ).length;
  const duplicatePrecision = ratio(truePositive, truePositive + falsePositive);
  const duplicateRecall = ratio(truePositive, truePositive + falseNegative);
  const duplicateF1 =
    duplicatePrecision + duplicateRecall === 0
      ? 0
      : (2 * duplicatePrecision * duplicateRecall) / (duplicatePrecision + duplicateRecall);
  const duplicateAccuracy = ratio(truePositive + trueNegative, duplicateCases.length);

  const overall =
    typeAccuracy * 0.2 +
    priorityAccuracy * 0.2 +
    recommendationAccuracy * 0.3 +
    evidenceDiscipline * 0.15 +
    proposalCompleteness * 0.15;

  const confusion = new Map<string, Map<string, number>>();
  for (const result of results) {
    const row = confusion.get(result.expected.ticketType) ?? new Map<string, number>();
    row.set(result.actual.ticketType, (row.get(result.actual.ticketType) ?? 0) + 1);
    confusion.set(result.expected.ticketType, row);
  }
  const predictedTypes = [
    ...new Set(results.map((result) => result.actual.ticketType)),
  ].sort();

  const mismatches = results.filter((result) => !result.pass);
  const generatedAt = new Date().toISOString();
  const averageLatency = results.reduce((sum, result) => sum + result.latencyMs, 0) / total;

  const summary = {
    provider,
    model,
    datasetVersion: dataset.version,
    datasetName: dataset.name,
    generatedAt,
    totals: {
      cases: total,
      passed: results.filter((result) => result.pass).length,
      mismatched: mismatches.length,
      averageLatencyMs: round(averageLatency, 1),
    },
    metrics: {
      ticketTypeAccuracy: round(typeAccuracy),
      priorityAccuracy: round(priorityAccuracy),
      recommendationAccuracy: round(recommendationAccuracy),
      evidenceDiscipline: round(evidenceDiscipline),
      proposalCompleteness: round(proposalCompleteness),
      duplicate: {
        probes: duplicateCases.length,
        accuracy: round(duplicateAccuracy),
        precision: round(duplicatePrecision),
        recall: round(duplicateRecall),
        f1: round(duplicateF1),
        truePositive,
        falsePositive,
        falseNegative,
        trueNegative,
      },
      overall: round(overall),
    },
    confusion: Object.fromEntries(
      [...confusion.entries()].map(([expected, row]) => [
        expected,
        Object.fromEntries(row.entries()),
      ]),
    ),
    cases: results.map((result) => ({
      id: result.id,
      title: result.title,
      note: result.note,
      expected: result.expected,
      actual: result.actual,
      matches: result.matches,
      pass: result.pass,
      latencyMs: result.latencyMs,
    })),
  };

  writeFileSync(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

  const typeRows = [...confusion.keys()]
    .sort()
    .map((expected) => {
      const row = confusion.get(expected)!;
      const cells = predictedTypes.map((type) => String(row.get(type) ?? 0));
      return `| ${expected} | ${cells.join(" | ")} |`;
    })
    .join("\n");

  const caseRows = results
    .map((result) => {
      const expectedLabel = `${result.expected.ticketType} · ${result.expected.priority} · ${result.expected.recommendation}`;
      const actualLabel = `${result.actual.ticketType} · ${result.actual.priority} · ${result.actual.recommendation}`;
      const duplicateCell =
        result.matches.duplicate === null ? "—" : result.matches.duplicate ? "✓" : "✗";
      const evidenceCell = result.matches.evidence ? "✓" : "✗";
      return `| ${result.id} | ${escapeCell(truncate(result.title))} | ${expectedLabel} | ${actualLabel} | ${duplicateCell} | ${evidenceCell} | ${result.pass ? "PASS" : "CHECK"} |`;
    })
    .join("\n");

  const mismatchRows =
    mismatches.length === 0
      ? "No label mismatches."
      : mismatches
          .map((result) => {
            const failed = Object.entries(result.matches)
              .filter(([, value]) => value === false)
              .map(([key]) => key)
              .join(", ");
            return `- **${result.id} — ${truncate(result.title, 80)}** (${failed})\n  - Expected: ${result.expected.ticketType} / ${result.expected.priority} / ${result.expected.recommendation}${result.expected.duplicate === undefined ? "" : ` / duplicate=${result.expected.duplicate}`}\n  - Actual: ${result.actual.ticketType} / ${result.actual.priority} / ${result.actual.recommendation}${result.matches.duplicate === null ? "" : ` / duplicate=${result.actual.duplicate}`}\n  - Why it matters: ${result.note}`;
          })
          .join("\n");

  const providerNote =
    provider === "deterministic"
      ? "Deterministic demo rules (`miraiwerk-rules-v1`). These are labelled rules, not a Meta model output. No network model was called."
      : `Meta Model API (${model}). Output is raw model JSON with policy applied; it is not additionally sanitized in this harness.`;

  const report = `# MIRAIWERK ticket-intelligence evaluation

Generated: ${generatedAt}  
Mode: **${providerNote}**  
Benchmark: **${dataset.name}** · ${total} hand-labelled cases

> **Honesty note.** The benchmark labels describe intended product behaviour, not a model's own output. A high score on deterministic rules shows that the fallback is calibrated to the benchmark; it is not evidence of Meta model quality. Run \`npm run evaluate -w @miraiwerk/aiml -- --provider=meta\` with a configured key to measure the model path.

## Summary

| Metric | Result |
| --- | ---: |
| Overall weighted score | **${pct(overall)}** |
| Ticket-type accuracy | ${pct(typeAccuracy)} |
| Policy-priority accuracy | ${pct(priorityAccuracy)} |
| Recommendation accuracy | ${pct(recommendationAccuracy)} |
| Evidence discipline | ${pct(evidenceDiscipline)} |
| Proposal completeness | ${pct(proposalCompleteness)} |
| Duplicate-probe accuracy (${duplicateCases.length} cases) | ${pct(duplicateAccuracy)} |
| Duplicate precision / recall / F1 | ${pct(duplicatePrecision)} / ${pct(duplicateRecall)} / ${pct(duplicateF1)} |
| Cases passing every check | ${results.filter((result) => result.pass).length} / ${total} |
| Average analysis latency | ${averageLatency.toFixed(1)} ms |

Weights: type 20%, priority 20%, recommendation 30%, evidence discipline 15%, proposal completeness 15%. Duplicate detection is reported separately because ${duplicateCases.length} cases carry an expected duplicate label, and most of those labels are negatives.

### Duplicate confusion

| | Predicted duplicate | Predicted distinct |
| --- | ---: | ---: |
| Actually duplicate | ${truePositive} | ${falseNegative} |
| Actually distinct | ${falsePositive} | ${trueNegative} |

## Ticket-type confusion

| Expected \\ Actual | ${predictedTypes.join(" | ")} |
| --- | ${predictedTypes.map(() => "---:").join(" | ")} |
${typeRows}

## Cases

| ID | Ticket | Expected (type · priority · recommendation) | Actual | Duplicate | Evidence | Result |
| --- | --- | --- | --- | :---: | :---: | :---: |
${caseRows}

## Checks that did not match

${mismatchRows}

## What this benchmark does not prove

- It does not measure whether a Meta model is better than the deterministic fallback; use the \`--provider=meta\` mode for that comparison.
- It does not validate real-world ticket prevalence. The cases are deliberately weighted toward ambiguous and safety-critical reports.
- It does not test plan generation quality; use the plan-generation review flow and the RippleMap unit tests for that.
- Duplicate candidates use lexical overlap, not semantic embeddings. Paraphrased duplicates can be missed, and tickets in the same feature area can be flagged as candidates; the UI presents them as advisory links that an approver must confirm.
- A correct label does not make an estimate a commitment. Proposed durations remain planning estimates, and the app marks unknowns rather than inventing capacity or deadlines.
`;

  writeFileSync(reportPath, report, "utf8");

  console.log(`MIRAIWERK evaluation — ${provider} (${model})`);
  console.log(`  cases:                 ${total}`);
  console.log(`  type accuracy:         ${pct(typeAccuracy)}`);
  console.log(`  priority accuracy:     ${pct(priorityAccuracy)}`);
  console.log(`  recommendation:        ${pct(recommendationAccuracy)}`);
  console.log(`  evidence discipline:   ${pct(evidenceDiscipline)}`);
  console.log(`  proposal completeness: ${pct(proposalCompleteness)}`);
  console.log(`  duplicate accuracy:    ${pct(duplicateAccuracy)} (${duplicateCases.length} probes)`);
  console.log(`  overall:               ${pct(overall)}`);
  console.log(`  mismatches:            ${mismatches.length} (${mismatches.map((result) => result.id).join(", ") || "none"})`);
  console.log(`  report:                ${reportPath}`);
  console.log(`  json:                  ${jsonPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
