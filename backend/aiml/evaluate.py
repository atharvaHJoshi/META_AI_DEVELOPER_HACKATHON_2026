"""Ticket-intelligence benchmark for the Python analyzer.

The 40 hand-labelled cases are ported from the original TypeScript AIML
package. The runner executes them through the same deterministic analyzer and
policy layer the API uses, then writes ``report.md`` and ``report.json`` next
to the dataset.

The benchmark deliberately bypasses the API's reference sanitisation: it should
show what the analyser returned, not a cleaned-up version. The deterministic
provider is labelled ``deterministic-demo`` / ``miraiwerk-rules-v1`` and is
never presented as a model result.
"""

from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from aiml.analyzer import demo_analyze_ticket
from aiml.config import DETERMINISTIC_MODEL, has_gemini_key
from aiml.policy import apply_policy
from aiml.templates import commerce_plan

EVALUATIONS_DIR = Path(__file__).resolve().parent / "evaluations"
DATASET_PATH = EVALUATIONS_DIR / "tickets.json"
REPORT_PATH = EVALUATIONS_DIR / "report.md"
JSON_PATH = EVALUATIONS_DIR / "report.json"

SPLIT_TYPES = {"incident", "feature_request", "technical_debt"}
METRIC_WEIGHTS = {
    "ticketTypeAccuracy": 0.20,
    "priorityAccuracy": 0.20,
    "recommendationAccuracy": 0.30,
    "evidenceDiscipline": 0.15,
    "proposalCompleteness": 0.15,
}


def load_dataset(path: Path | str | None = None) -> dict[str, Any]:
    with open(path or DATASET_PATH, encoding="utf-8") as handle:
        return json.load(handle)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def build_context(dataset: dict[str, Any], case: dict[str, Any]) -> dict[str, Any]:
    """Build the same analysis context shape the API uses."""
    plan = dataset["plan"]
    draft = commerce_plan(
        {
            "name": plan["name"],
            "goal": plan["goal"],
            "description": plan["description"],
            "startDate": plan["startDate"],
            "targetDate": plan.get("targetDate"),
        }
    )

    downstream: dict[str, list[str]] = {}
    upstream: dict[str, list[str]] = {}
    for task in draft["tasks"]:
        upstream[task["tempId"]] = list(task["dependencies"])
        for dependency in task["dependencies"]:
            downstream.setdefault(dependency, []).append(task["tempId"])

    milestone_titles = {
        milestone["tempId"]: milestone["title"] for milestone in draft["milestones"]
    }

    constraints = {
        **plan.get("constraints", {}),
        "policy": plan.get("policy", {}),
    }

    return {
        "project": {
            "id": "eval-project",
            "name": draft["name"],
            "description": draft["description"],
            "goal": draft["goal"],
            "startDate": draft["startDate"],
            "targetDate": draft["targetDate"],
            "planVersion": 1,
            "constraints": constraints,
            "currentPlanAssumptions": draft["assumptions"],
        },
        "requirements": [
            {
                "id": requirement["tempId"],
                "title": requirement["title"],
                "description": requirement["description"],
                "acceptanceCriteria": requirement["acceptanceCriteria"],
            }
            for requirement in draft["requirements"]
        ],
        "milestones": [
            {
                "id": milestone["tempId"],
                "title": milestone["title"],
                "targetDate": milestone["targetDate"],
                "releaseGate": milestone.get("releaseGate", False),
            }
            for milestone in draft["milestones"]
        ],
        "tasks": [
            {
                "id": task["tempId"],
                "title": task["title"],
                "description": task["description"],
                "status": "planned",
                "priority": task["priority"],
                "estimateDays": task["estimateDays"],
                "requirementId": task.get("requirementTempId"),
                "milestoneId": task.get("milestoneTempId"),
                "milestoneTitle": (
                    milestone_titles.get(task.get("milestoneTempId"))
                    if task.get("milestoneTempId")
                    else None
                ),
                "plannedStart": None,
                "plannedFinish": None,
                "downstreamTaskIds": downstream.get(task["tempId"], []),
                "upstreamTaskIds": upstream.get(task["tempId"], []),
            }
            for task in draft["tasks"]
        ],
        "relatedTickets": [
            {
                "id": f"ctx-{index + 1:02d}",
                "title": ticket["title"],
                "description": ticket["description"],
                "ticketType": ticket["ticketType"],
                "status": ticket["status"],
                "createdAt": ticket["createdAt"],
            }
            for index, ticket in enumerate(dataset.get("contextTickets", []))
        ],
        "ticket": {
            "id": f"eval-{case['id']}",
            "title": case["title"],
            "description": case["description"],
            "source": "evaluation",
            "affectedComponent": case["affectedComponent"],
            "reportedImpact": case["reportedImpact"],
            "evidence": case["evidence"],
            "reporter": "Evaluation fixture",
            "environment": case["environment"],
            "severityReported": case["severityReported"],
            "createdAt": _iso_now(),
        },
    }


def _analyse(provider: str, context: dict[str, Any]) -> dict[str, Any]:
    if provider == "deterministic":
        return demo_analyze_ticket(context)
    if provider == "gemini":
        if not has_gemini_key():
            raise RuntimeError(
                "Gemini mode requires GEMINI_API_KEY. The deterministic benchmark needs no key."
            )
        from aiml.gemini import analyze_ticket

        return analyze_ticket(context)
    raise ValueError(f"Unknown provider {provider!r}. Use deterministic or gemini.")


def _ratio(numerator: int, denominator: int) -> float:
    return 0.0 if denominator == 0 else numerator / denominator


def _round(value: float, digits: int = 3) -> float:
    factor = 10**digits
    return round(value * factor) / factor


def _pct(value: float) -> str:
    return f"{value * 100:.1f}%"


def _escape_cell(value: str) -> str:
    return value.replace("|", "\\|")


def _truncate(value: str, maximum: int = 58) -> str:
    clean = " ".join(value.split())
    return clean if len(clean) <= maximum else f"{clean[: maximum - 1]}…"


def evaluate(
    dataset: dict[str, Any] | None = None,
    *,
    provider: str = "deterministic",
) -> dict[str, Any]:
    dataset = dataset or load_dataset()
    results: list[dict[str, Any]] = []
    model = DETERMINISTIC_MODEL
    total_started = time.perf_counter()

    for case in dataset["cases"]:
        context = build_context(dataset, case)
        started = time.perf_counter()
        result = _analyse(provider, context)
        analysis = {**result["analysis"], **apply_policy(result["analysis"], context)}
        latency_ms = result.get("latencyMs")
        if latency_ms is None:
            latency_ms = max(1, round((time.perf_counter() - started) * 1000))
        model = result.get("model", model)

        expected = case["expected"]
        classification = analysis["classification"]
        accept = analysis.get("proposedChanges", {}).get("accept")
        split = analysis.get("proposedChanges", {}).get("split")
        accept_tasks = (accept or {}).get("tasksToAdd", [])
        duplicate_detected = bool(analysis.get("duplicateCandidates"))
        expected_split = expected["ticketType"] in SPLIT_TYPES
        split_available = bool(split)
        matches = {
            "ticketType": classification["ticketType"] == expected["ticketType"],
            "priority": classification["priority"] == expected["priority"],
            "recommendation": analysis["recommendedOption"] == expected["recommendation"],
            "duplicate": (
                None
                if expected.get("duplicate") is None
                else duplicate_detected == expected["duplicate"]
            ),
            "evidence": (
                len(analysis.get("unknowns", [])) >= expected["minUnknowns"]
                and (
                    len(analysis.get("clarifyingQuestions", [])) > 0
                    if expected["recommendation"] == "clarify"
                    else len(analysis.get("clarifyingQuestions", [])) == 0
                )
            ),
            "completeness": (
                bool(accept_tasks)
                and all(
                    task.get("estimateDays", 0) > 0 and bool(task.get("title"))
                    for task in accept_tasks
                )
                and split_available == expected_split
            ),
        }

        passed = all(
            matches[key]
            for key in ("ticketType", "priority", "recommendation", "evidence", "completeness")
        ) and matches["duplicate"] is not False

        results.append(
            {
                "id": case["id"],
                "title": case["title"],
                "note": case.get("note", ""),
                "expected": expected,
                "actual": {
                    "ticketType": classification["ticketType"],
                    "priority": classification["priority"],
                    "recommendation": analysis["recommendedOption"],
                    "duplicate": duplicate_detected,
                    "duplicateCount": len(analysis.get("duplicateCandidates", [])),
                    "unknowns": len(analysis.get("unknowns", [])),
                    "clarifyingQuestions": len(analysis.get("clarifyingQuestions", [])),
                    "evidenceItems": len(analysis.get("evidence", [])),
                    "hasAcceptChange": bool(accept),
                    "hasSplitChange": split_available,
                    "acceptTasks": len(accept_tasks),
                    "splitTasks": len((split or {}).get("tasksToAdd", [])),
                },
                "matches": matches,
                "pass": passed,
                "latencyMs": latency_ms,
            }
        )

    total = len(results)
    metrics = {
        "ticketTypeAccuracy": _ratio(sum(r["matches"]["ticketType"] for r in results), total),
        "priorityAccuracy": _ratio(sum(r["matches"]["priority"] for r in results), total),
        "recommendationAccuracy": _ratio(
            sum(r["matches"]["recommendation"] for r in results), total
        ),
        "evidenceDiscipline": _ratio(sum(r["matches"]["evidence"] for r in results), total),
        "proposalCompleteness": _ratio(
            sum(r["matches"]["completeness"] for r in results), total
        ),
    }

    duplicate_cases = [r for r in results if r["matches"]["duplicate"] is not None]
    true_positive = sum(
        1 for r in duplicate_cases if r["expected"].get("duplicate") is True and r["actual"]["duplicate"]
    )
    false_positive = sum(
        1 for r in duplicate_cases if r["expected"].get("duplicate") is False and r["actual"]["duplicate"]
    )
    false_negative = sum(
        1 for r in duplicate_cases if r["expected"].get("duplicate") is True and not r["actual"]["duplicate"]
    )
    true_negative = sum(
        1 for r in duplicate_cases if r["expected"].get("duplicate") is False and not r["actual"]["duplicate"]
    )
    precision = _ratio(true_positive, true_positive + false_positive)
    recall = _ratio(true_positive, true_positive + false_negative)
    f1 = 0.0 if precision + recall == 0 else 2 * precision * recall / (precision + recall)
    duplicate_accuracy = _ratio(true_positive + true_negative, len(duplicate_cases))
    overall = sum(metrics[key] * weight for key, weight in METRIC_WEIGHTS.items())

    confusion: dict[str, dict[str, int]] = {}
    for result in results:
        row = confusion.setdefault(result["expected"]["ticketType"], {})
        predicted = result["actual"]["ticketType"]
        row[predicted] = row.get(predicted, 0) + 1

    average_latency = sum(r["latencyMs"] for r in results) / total if total else 0
    mismatches = [r for r in results if not r["pass"]]

    return {
        "provider": "deterministic-demo" if provider == "deterministic" else provider,
        "model": model,
        "datasetVersion": dataset.get("version"),
        "datasetName": dataset.get("name"),
        "generatedAt": _iso_now(),
        "totals": {
            "cases": total,
            "passed": total - len(mismatches),
            "mismatched": len(mismatches),
            "averageLatencyMs": _round(average_latency, 1),
            "wallClockMs": _round((time.perf_counter() - total_started) * 1000, 1),
        },
        "metrics": {
            **{key: _round(value) for key, value in metrics.items()},
            "duplicate": {
                "probes": len(duplicate_cases),
                "accuracy": _round(duplicate_accuracy),
                "precision": _round(precision),
                "recall": _round(recall),
                "f1": _round(f1),
                "truePositive": true_positive,
                "falsePositive": false_positive,
                "falseNegative": false_negative,
                "trueNegative": true_negative,
            },
            "overall": _round(overall),
        },
        "confusion": confusion,
        "cases": results,
    }


def render_markdown(summary: dict[str, Any]) -> str:
    metrics = summary["metrics"]
    duplicate = metrics["duplicate"]
    results = summary["cases"]
    total = summary["totals"]["cases"]
    labelled_duplicate = duplicate["probes"]
    mismatches = [result for result in results if not result["pass"]]

    predicted_types = sorted({result["actual"]["ticketType"] for result in results})
    type_rows = []
    for expected in sorted(summary["confusion"]):
        row = summary["confusion"][expected]
        cells = [str(row.get(predicted, 0)) for predicted in predicted_types]
        type_rows.append(f"| {expected} | {' | '.join(cells)} |")

    case_rows = []
    for result in results:
        expected = result["expected"]
        actual = result["actual"]
        duplicate_cell = (
            "—"
            if result["matches"]["duplicate"] is None
            else "✓"
            if result["matches"]["duplicate"]
            else "✗"
        )
        case_rows.append(
            "| {id} | {title} | {etype} · {epriority} · {erec} | {atype} · {apriority} · {arec} | {duplicate} | {evidence} | {verdict} |".format(
                id=result["id"],
                title=_escape_cell(_truncate(result["title"])),
                etype=expected["ticketType"],
                epriority=expected["priority"],
                erec=expected["recommendation"],
                atype=actual["ticketType"],
                apriority=actual["priority"],
                arec=actual["recommendation"],
                duplicate=duplicate_cell,
                evidence="✓" if result["matches"]["evidence"] else "✗",
                verdict="PASS" if result["pass"] else "CHECK",
            )
        )

    if mismatches:
        mismatch_lines = []
        for result in mismatches:
            failed = ", ".join(
                key for key, value in result["matches"].items() if value is False
            )
            expected = result["expected"]
            actual = result["actual"]
            expected_duplicate = (
                ""
                if expected.get("duplicate") is None
                else f" / duplicate={expected['duplicate']}"
            )
            actual_duplicate = (
                ""
                if result["matches"]["duplicate"] is None
                else f" / duplicate={actual['duplicate']}"
            )
            mismatch_lines.append(
                f"- **{result['id']} — {_truncate(result['title'], 80)}** ({failed})\n"
                f"  - Expected: {expected['ticketType']} / {expected['priority']} / "
                f"{expected['recommendation']}{expected_duplicate}\n"
                f"  - Actual: {actual['ticketType']} / {actual['priority']} / "
                f"{actual['recommendation']}{actual_duplicate}\n"
                f"  - Why it matters: {result['note']}"
            )
        mismatch_text = "\n".join(mismatch_lines)
    else:
        mismatch_text = "No label mismatches."

    if summary["provider"] == "deterministic-demo":
        provider_note = (
            "Deterministic demo rules (`miraiwerk-rules-v1`). These are labelled rules, "
            "not a model output. No network model was called."
        )
        honesty = (
            "The benchmark labels describe intended product behaviour, not model output. "
            "A high score on deterministic rules shows that the fallback is calibrated to "
            "the benchmark; it is not evidence of Gemini or Meta model quality."
        )
    else:
        provider_note = (
            f"Gemini (`{summary['model']}`). Model output is scored with the same policy "
            "layer as the API; this harness does not apply API reference sanitisation."
        )
        honesty = (
            "The benchmark labels describe intended product behaviour, not a model's own "
            "quality. Latency and accuracy depend on the configured provider and network."
        )

    return f"""# MIRAIWERK ticket-intelligence evaluation

Generated: {summary['generatedAt']}  
Mode: **{provider_note}**  
Benchmark: **{summary['datasetName']}** · {total} hand-labelled cases

> **Honesty note.** {honesty}

## Summary

| Metric | Result |
| --- | ---: |
| Overall weighted score | **{_pct(metrics['overall'])}** |
| Ticket-type accuracy | {_pct(metrics['ticketTypeAccuracy'])} |
| Policy-priority accuracy | {_pct(metrics['priorityAccuracy'])} |
| Recommendation accuracy | {_pct(metrics['recommendationAccuracy'])} |
| Evidence discipline | {_pct(metrics['evidenceDiscipline'])} |
| Proposal completeness | {_pct(metrics['proposalCompleteness'])} |
| Duplicate-probe accuracy ({labelled_duplicate} cases) | {_pct(duplicate['accuracy'])} |
| Duplicate precision / recall / F1 | {_pct(duplicate['precision'])} / {_pct(duplicate['recall'])} / {_pct(duplicate['f1'])} |
| Cases passing every check | {summary['totals']['passed']} / {total} |
| Average analysis latency | {summary['totals']['averageLatencyMs']} ms |

Weights: type 20%, priority 20%, recommendation 30%, evidence discipline 15%, proposal completeness 15%. Duplicate detection is reported separately because {labelled_duplicate} cases carry an expected duplicate label, and most of those labels are negatives.

### Duplicate confusion

| | Predicted duplicate | Predicted distinct |
| --- | ---: | ---: |
| Actually duplicate | {duplicate['truePositive']} | {duplicate['falseNegative']} |
| Actually distinct | {duplicate['falsePositive']} | {duplicate['trueNegative']} |

## Ticket-type confusion

| Expected \\ Actual | {' | '.join(predicted_types)} |
| --- | {' | '.join('---:' for _ in predicted_types)} |
{chr(10).join(type_rows)}

## Cases

| ID | Ticket | Expected (type · priority · recommendation) | Actual | Duplicate | Evidence | Result |
| --- | --- | --- | --- | :---: | :---: | :---: |
{chr(10).join(case_rows)}

## Checks that did not match

{mismatch_text}

## What this benchmark does not prove

- It does not measure whether a model is better than the deterministic fallback.
- It does not validate real-world ticket prevalence. The cases are deliberately weighted toward ambiguous and safety-critical reports.
- It does not test plan-generation quality; use the plan-generation review flow and the RippleMap unit tests for that.
- Duplicate candidates use lexical overlap, not semantic embeddings. Paraphrased duplicates can be missed, and tickets in the same feature area can be flagged as candidates; the UI presents them as advisory links that an approver must confirm.
- A correct label does not make an estimate a commitment. Proposed durations remain planning estimates, and the app marks unknowns rather than inventing capacity or deadlines.
"""


def write_reports(
    summary: dict[str, Any],
    *,
    report_path: Path | str | None = None,
    json_path: Path | str | None = None,
) -> tuple[Path, Path]:
    report_target = Path(report_path or REPORT_PATH)
    json_target = Path(json_path or JSON_PATH)
    report_target.parent.mkdir(parents=True, exist_ok=True)
    json_target.parent.mkdir(parents=True, exist_ok=True)
    json_target.write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    report_target.write_text(render_markdown(summary), encoding="utf-8")
    return report_target, json_target


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the MIRAIWERK ticket-intelligence benchmark.")
    parser.add_argument(
        "--provider",
        default="deterministic",
        choices=("deterministic", "gemini"),
        help="Analyzer path to measure (default: deterministic).",
    )
    parser.add_argument("--dataset", default=str(DATASET_PATH), help="Dataset JSON path.")
    parser.add_argument("--report", default=str(REPORT_PATH), help="Markdown report path.")
    parser.add_argument("--json", default=str(JSON_PATH), help="Machine-readable report path.")
    args = parser.parse_args(argv)

    dataset = load_dataset(args.dataset)
    summary = evaluate(dataset, provider=args.provider)
    report_path, json_path = write_reports(summary, report_path=args.report, json_path=args.json)

    metrics = summary["metrics"]
    print(f"MIRAIWERK evaluation — {summary['provider']} ({summary['model']})")
    print(f"  cases:                 {summary['totals']['cases']}")
    print(f"  type accuracy:         {_pct(metrics['ticketTypeAccuracy'])}")
    print(f"  priority accuracy:     {_pct(metrics['priorityAccuracy'])}")
    print(f"  recommendation:        {_pct(metrics['recommendationAccuracy'])}")
    print(f"  evidence discipline:   {_pct(metrics['evidenceDiscipline'])}")
    print(f"  proposal completeness: {_pct(metrics['proposalCompleteness'])}")
    print(
        f"  duplicate accuracy:    {_pct(metrics['duplicate']['accuracy'])} "
        f"({metrics['duplicate']['probes']} probes)"
    )
    print(f"  overall:               {_pct(metrics['overall'])}")
    print(
        "  mismatches:            "
        f"{summary['totals']['mismatched']} "
        f"({', '.join(r['id'] for r in summary['cases'] if not r['pass']) or 'none'})"
    )
    print(f"  report:                {report_path}")
    print(f"  json:                  {json_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
