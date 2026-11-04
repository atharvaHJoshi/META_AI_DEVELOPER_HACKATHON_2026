"""Deterministic ticket analysis rules (no model output claimed)."""

from __future__ import annotations

import re
import time
from typing import Any

from aiml.config import DETERMINISTIC_MODEL
from aiml.text import excerpt, lexical_score, sentence_excerpt

_INCIDENT_RE = re.compile(
    r"(\bproduction\b|\boutage\b|\bincident\b|\bdown\b|\bunavailable\b|data loss|\bbreach\b|charged twice|double charge|duplicate charge|duplicated charge|duplicate capture|sev\s*[01]\b|\bp0\b)",
    re.IGNORECASE,
)
_PRODUCTION_RE = re.compile(r"\bproduction\b", re.IGNORECASE)
_FINANCE_EXPORT_RE = re.compile(r"(invoice|export|csv)", re.IGNORECASE)
_FINANCE_DUP_RE = re.compile(r"(duplicate|duplicated|twice|same)", re.IGNORECASE)
_OUTAGE_RE = re.compile(r"\b(outage|incident)\b", re.IGNORECASE)
_DEBT_TITLE_RE = re.compile(
    r"(refactor|technical debt|tech debt|upgrade|deprecated|rewrite|cleanup|flaky)",
    re.IGNORECASE,
)
_DEBT_TEXT_RE = re.compile(r"(technical debt|tech debt)", re.IGNORECASE)
_FEATURE_TITLE_RE = re.compile(
    r"(add|support|allow|would like|feature|enable|new capability|request)",
    re.IGNORECASE,
)
_FEATURE_TEXT_RE = re.compile(
    r"(would like|customer request|new capability)", re.IGNORECASE
)
_BUG_RE = re.compile(
    r"(bug|error|fail|broken|crash|wrong|incorrect|cannot|can't|timeout|slow|regression|missing|stale)",
    re.IGNORECASE,
)
_HIGH_STAKES_RE = re.compile(
    r"(payment|charge|checkout|auth|security|privacy|data loss|outage|production)",
    re.IGNORECASE,
)
_TEST_GATE_RE = re.compile(r"test|gate|acceptance|validation|release", re.IGNORECASE)
_PAYMENT_CONTEXT_RE = re.compile(
    r"payment|charge|checkout|retry|capture", re.IGNORECASE
)
_TRACE_RE = re.compile(r"transaction|capture|request[- ]?id|trace|log|payload", re.IGNORECASE)
_REPRO_RE = re.compile(r"reproduc|steps|retry|trigger", re.IGNORECASE)
_DEPLOY_RE = re.compile(r"deploy|release|version|config", re.IGNORECASE)


def _round(value: float) -> float:
    return round(value * 1000) / 1000


def _detect_type(text: str, title: str, severity: str, environment: str) -> str:
    lower = text.lower()
    title_lower = title.lower()
    production_context = bool(_PRODUCTION_RE.search(lower))
    incident_signals = bool(_INCIDENT_RE.search(lower))

    finance_export = bool(_FINANCE_EXPORT_RE.search(lower)) and bool(_FINANCE_DUP_RE.search(lower))
    if finance_export and not production_context and not _OUTAGE_RE.search(lower):
        return "bug"

    incident_strong = re.compile(
        r"\bproduction\b|\boutage\b|\bincident\b|charged twice|double charge|duplicate charge|duplicate capture|data loss|\bbreach\b"
    )
    if incident_signals and (severity == "critical" or bool(incident_strong.search(lower))):
        return "incident"

    if _DEBT_TITLE_RE.search(title_lower) or _DEBT_TEXT_RE.search(lower):
        return "technical_debt"

    if _FEATURE_TITLE_RE.search(title_lower) or _FEATURE_TEXT_RE.search(lower):
        return "feature_request"

    if _BUG_RE.search(lower):
        return "bug"
    if environment == "production" and severity != "low":
        return "incident"
    return "clarification"


def _detect_priority(type_: str, text: str, severity: str) -> str:
    lower = text.lower()
    high_stakes = bool(_HIGH_STAKES_RE.search(lower))
    if type_ == "incident" and high_stakes and severity not in {"low", "medium"}:
        return "P0"
    if type_ == "incident" or (type_ == "bug" and high_stakes):
        return "P1"
    if severity in {"critical", "high"}:
        return "P1"
    if type_ == "feature_request":
        return "P2"
    if type_ == "technical_debt":
        return "P3"
    return "P2"


def _option_rationale(type_: str, recommended: str, has_evidence: bool) -> str:
    if recommended == "clarify":
        return (
            f"The ticket may be a {type_.replace('_', ' ')}, but the ticket does not contain enough "
            "evidence to justify changing a release plan. Request the missing facts, preserve the "
            "ticket, and re-run RippleMap once they arrive."
        )
    if recommended == "split":
        return (
            "The ticket has credible production evidence and touches a release gate. A time-bounded "
            "mitigation plus a permanent fix reduces exposure without pretending the full customer "
            "impact is known yet."
        )
    if recommended == "defer":
        return (
            "The request is not currently tied to a release gate or a confirmed defect. It can be "
            "scheduled behind the active release work, but the deferral risk should remain visible "
            "in the decision record."
        )
    if recommended == "duplicate":
        return (
            "A likely existing ticket was found. Confirm the root cause before linking, because "
            "semantic similarity alone is not proof of duplication."
        )
    if has_evidence:
        return (
            "The ticket is grounded in the current plan and has enough evidence to size a scoped "
            "fix. Accepting it adds explicit work and dependencies rather than silently expanding scope."
        )
    return (
        "Accepting will add work to the plan, but the supporting evidence is limited. The proposal "
        "keeps assumptions and unknowns visible for the approver."
    )


def _short_title(title: str, max_length: int = 72) -> str:
    clean = re.sub(r"\s+", " ", title).strip()
    return clean if len(clean) <= max_length else clean[: max_length - 1] + "…"


def _select_related(context: dict) -> dict:
    ticket = context["ticket"]
    query = (
        f"{ticket['title']} {ticket['description']} "
        f"{ticket['affectedComponent']} {ticket['reportedImpact']}"
    )
    requirements = []
    for requirement in context["requirements"]:
        score = _round(
            lexical_score(
                query,
                f"{requirement['title']} {requirement['description']} "
                f"{' '.join(requirement['acceptanceCriteria'])}",
            )
        )
        if score >= 0.035:
            requirements.append({"requirement": requirement, "score": score})
    requirements.sort(key=lambda item: item["score"], reverse=True)
    requirements = requirements[:3]

    tasks = []
    for task in context["tasks"]:
        score = _round(
            lexical_score(
                query,
                f"{task['title']} {task['description']} {task.get('milestoneTitle') or ''}",
            )
        )
        if score >= 0.03:
            tasks.append({"task": task, "score": score})
    tasks.sort(key=lambda item: item["score"], reverse=True)
    tasks = tasks[:5]

    return {"requirements": requirements, "tasks": tasks}


def _find_anchor(context: dict, related_tasks: list[dict]) -> dict | None:
    release_gate_milestones = {
        milestone["id"]
        for milestone in context["milestones"]
        if milestone.get("releaseGate")
    }

    def is_gate_like(task: dict) -> bool:
        return (
            task.get("milestoneId") in release_gate_milestones
            and (
                bool(task.get("downstreamTaskIds"))
                or bool(_TEST_GATE_RE.search(task["title"]))
            )
        )

    gate_tasks = [task for task in related_tasks if is_gate_like(task)]
    if gate_tasks:
        return gate_tasks[0]
    with_downstream = [task for task in related_tasks if task.get("downstreamTaskIds")]
    if with_downstream:
        return with_downstream[0]
    all_gate_tasks = [
        task
        for task in context["tasks"]
        if task.get("milestoneId") in release_gate_milestones
        and bool(_TEST_GATE_RE.search(task["title"]))
    ]
    return (related_tasks[0] if related_tasks else None) or (all_gate_tasks[0] if all_gate_tasks else None)


def _target_milestone(context: dict, anchor: dict | None, related_tasks: list[dict]) -> dict | None:
    ids = [
        *([anchor["milestoneId"]] if anchor and anchor.get("milestoneId") else []),
        *[task.get("milestoneId") for task in related_tasks if task.get("milestoneId")],
    ]
    scoped = [milestone for milestone in context["milestones"] if milestone["id"] in ids]
    gate = next((m for m in scoped if m.get("releaseGate")), None)
    if gate:
        return gate
    if scoped:
        return scoped[0]
    gates = [m for m in context["milestones"] if m.get("releaseGate")]
    if gates:
        return gates[-1]
    return context["milestones"][-1] if context["milestones"] else None


def _priority_for_proposal(priority: str) -> str:
    return "P0" if priority == "P0" else "P1"


def _build_accept_change(
    context: dict, type_: str, priority: str, requirement_id: str | None,
    anchor: dict | None, milestone_id: str | None,
) -> dict:
    ticket = context["ticket"]
    short = _short_title(ticket["title"])
    is_incident = type_ == "incident"
    is_feature = type_ == "feature_request"
    is_debt = type_ == "technical_debt"
    ticket_ref = ticket["id"]
    fix_id = f"accept-fix-{ticket_ref[-6:]}"
    test_id = f"accept-test-{ticket_ref[-6:]}"
    fix_days = 3 if is_incident else 5 if is_feature else 4 if is_debt else 2

    if is_incident:
        fix_title = f"Contain and fix: {short}"
    elif is_feature:
        fix_title = f"Implement: {short}"
    elif is_debt:
        fix_title = f"Address debt: {short}"
    else:
        fix_title = f"Fix: {short}"

    dependencies_to_add = []
    if anchor:
        dependencies_to_add.append(
            {
                "predecessorId": test_id,
                "successorId": anchor["id"],
                "dependencyType": "finishes_to_start",
            }
        )

    description = (
        f"Proposed from ticket {ticket_ref}. "
        + (
            "Contain the customer exposure, implement the permanent fix, and preserve evidence for reconciliation."
            if is_incident
            else "Implement the requested change and preserve the acceptance criteria of the linked requirement."
        )
    )

    return {
        "option": "accept",
        "tasksToAdd": [
            {
                "tempId": fix_id,
                "title": fix_title,
                "description": description,
                "requirementId": requirement_id,
                "milestoneId": milestone_id,
                "estimateDays": fix_days,
                "priority": _priority_for_proposal(priority),
                "ownerRole": "Engineering" if is_debt else "Backend",
                "dependencies": [],
            },
            {
                "tempId": test_id,
                "title": f"Regression coverage: {_short_title(ticket['title'], 56)}",
                "description": "Add a failing-first regression test and verify the release gate after the fix.",
                "requirementId": requirement_id,
                "milestoneId": milestone_id,
                "estimateDays": 1,
                "priority": _priority_for_proposal(priority),
                "ownerRole": "QA",
                "dependencies": [fix_id],
            },
        ],
        "tasksToUpdate": [],
        "tasksToRemove": [],
        "dependenciesToAdd": dependencies_to_add,
        "assumptions": [
            "The estimate assumes one engineer familiar with the affected component.",
            "No additional headcount is assumed.",
            "The ticket evidence is sufficient to size containment work, but full customer impact remains unconfirmed."
            if is_incident
            else "The linked requirement is the most likely scope owner; the relationship is inferred.",
        ],
        "rationale": "Accepting adds an explicit fix and regression task to the current plan.",
    }


def _build_split_change(
    context: dict, type_: str, priority: str, requirement_id: str | None,
    anchor: dict | None, milestone_id: str | None,
) -> dict:
    ticket = context["ticket"]
    short = _short_title(ticket["title"])
    ticket_ref = ticket["id"]
    mitigation_id = f"split-mitigate-{ticket_ref[-6:]}"
    fix_id = f"split-fix-{ticket_ref[-6:]}"
    test_id = f"split-test-{ticket_ref[-6:]}"
    payment_context = bool(
        _PAYMENT_CONTEXT_RE.search(
            f"{ticket['title']} {ticket['description']} {ticket['affectedComponent']}"
        )
    )

    mitigation_title = (
        "Pause automatic payment retries behind a guarded feature flag"
        if payment_context
        else f"Apply temporary mitigation: {_short_title(ticket['title'], 56)}"
    )
    mitigation_description = (
        "Reduce duplicate-capture exposure while the permanent retry guard is implemented. Document how to reverse the flag."
        if payment_context
        else "Reduce immediate exposure with a reversible, time-bounded mitigation."
    )

    dependencies_to_add = []
    if anchor:
        dependencies_to_add.append(
            {
                "predecessorId": test_id,
                "successorId": anchor["id"],
                "dependencyType": "finishes_to_start",
            }
        )

    fix_days = 4 if type_ == "feature_request" else 3

    return {
        "option": "split",
        "tasksToAdd": [
            {
                "tempId": mitigation_id,
                "title": mitigation_title,
                "description": mitigation_description,
                "requirementId": requirement_id,
                "milestoneId": milestone_id,
                "estimateDays": 1,
                "priority": "P0",
                "ownerRole": "Backend",
                "dependencies": [],
            },
            {
                "tempId": fix_id,
                "title": f"Permanent fix: {_short_title(ticket['title'], 60)}",
                "description": "Implement the durable correction, including idempotency or retry semantics where relevant.",
                "requirementId": requirement_id,
                "milestoneId": milestone_id,
                "estimateDays": fix_days,
                "priority": _priority_for_proposal(priority),
                "ownerRole": "Backend",
                "dependencies": [mitigation_id],
            },
            {
                "tempId": test_id,
                "title": f"Verify mitigation and fix: {_short_title(ticket['title'], 48)}",
                "description": "Reproduce the original failure, verify the mitigation, then keep a regression test for the permanent fix.",
                "requirementId": requirement_id,
                "milestoneId": milestone_id,
                "estimateDays": 1,
                "priority": _priority_for_proposal(priority),
                "ownerRole": "QA",
                "dependencies": [fix_id],
            },
        ],
        "tasksToUpdate": [],
        "tasksToRemove": [],
        "dependenciesToAdd": dependencies_to_add,
        "assumptions": [
            "The temporary mitigation can be reversed without a data migration.",
            "The permanent fix and regression verification are both required before the release gate can pass.",
            "No additional headcount is assumed.",
            "Full affected-customer impact is still being quantified.",
        ],
        "rationale": "Split reduces immediate exposure while keeping the durable correction and verification visible.",
    }


def demo_analyze_ticket(context: dict) -> dict[str, Any]:
    started = time.time()
    ticket = context["ticket"]
    text = (
        f"{ticket['title']} {ticket['description']} "
        f"{ticket['affectedComponent']} {ticket['reportedImpact']}"
    )
    type_ = _detect_type(
        text, ticket["title"], ticket["severityReported"], ticket["environment"]
    )
    priority = _detect_priority(type_, text, ticket["severityReported"])

    related = _select_related(context)
    related_tasks = [item["task"] for item in related["tasks"]]
    anchor = _find_anchor(context, related_tasks)
    milestone = _target_milestone(context, anchor, related_tasks)

    requirement_id = (
        related["requirements"][0]["requirement"]["id"]
        if related["requirements"]
        else (anchor or {}).get("requirementId")
        or (context["requirements"][0]["id"] if context["requirements"] else None)
    )

    has_evidence = (
        len(ticket["evidence"].strip()) >= 20 and len(ticket["reportedImpact"].strip()) >= 10
    )
    critical_evidence_gap = (
        type_ == "incident"
        and (
            not ticket["environment"]
            or len(ticket["evidence"].strip()) < 20
            or len(ticket["reportedImpact"].strip()) < 10
        )
    )

    if type_ == "clarification" or critical_evidence_gap:
        recommended_option = "clarify"
    elif type_ == "incident":
        recommended_option = "split"
    elif type_ in {"feature_request", "technical_debt"}:
        recommended_option = "defer"
    else:
        recommended_option = "accept"

    unknown_candidates: list[str] = []
    if not ticket["environment"]:
        unknown_candidates.append("The environment where the issue occurs is not stated.")
    if not ticket["reportedImpact"]:
        unknown_candidates.append("Customer and business impact is not quantified in the ticket.")

    if type_ == "incident":
        unknown_candidates.append(
            "The exact number of affected customers and transactions is not established."
        )
        if not _TRACE_RE.search(ticket["evidence"]):
            unknown_candidates.append(
                "A failing request trace or transaction reference is not provided."
            )
        if not _REPRO_RE.search(f"{ticket['description']} {ticket['evidence']}"):
            unknown_candidates.append(
                "Reproduction rate and steps for the retry path are not established."
            )
        if not _DEPLOY_RE.search(text):
            unknown_candidates.append(
                "Correlation with a recent deployment or configuration change is unknown."
            )
        unknown_candidates.append(
            "Whether retries can be paused safely without breaking active checkouts has not been verified."
        )
    elif type_ == "bug":
        unknown_candidates.append(
            "A reliable reproduction environment and affected product version are not confirmed."
        )
        unknown_candidates.append("The scope of affected users is not quantified.")
    elif type_ == "feature_request":
        unknown_candidates.append("The success metric and target user segment are not defined.")
        unknown_candidates.append("The requested scope boundary is not confirmed.")
    elif type_ == "technical_debt":
        unknown_candidates.append("The size and risk of the affected code surface are not confirmed.")
    else:
        unknown_candidates.append("The expected outcome and acceptance criteria are not clear.")

    if not ticket["evidence"].strip():
        unknown_candidates.append(
            "No concrete evidence (logs, reproduction steps or screenshots) was supplied."
        )
    unknowns = list(dict.fromkeys(unknown_candidates))[:8]

    evidence = [
        {
            "claim": f"Ticket reports: {_short_title(ticket['title'], 160)}",
            "state": "observed",
            "sourceType": "ticket",
            "sourceId": ticket["id"],
            "excerpt": excerpt(ticket["description"]),
        }
    ]
    if ticket["reportedImpact"]:
        evidence.append(
            {
                "claim": f"Reported impact: {excerpt(ticket['reportedImpact'], 220)}",
                "state": "observed",
                "sourceType": "ticket",
                "sourceId": ticket["id"],
                "excerpt": excerpt(ticket["reportedImpact"], 220),
            }
        )
    if ticket["evidence"]:
        evidence.append(
            {
                "claim": "The ticket contains supporting operational evidence.",
                "state": "observed",
                "sourceType": "ticket",
                "sourceId": ticket["id"],
                "excerpt": excerpt(ticket["evidence"], 260),
            }
        )
    if ticket["environment"]:
        evidence.append(
            {
                "claim": f"Reported environment: {ticket['environment']}",
                "state": "observed",
                "sourceType": "ticket",
                "sourceId": ticket["id"],
                "excerpt": excerpt(ticket["environment"]),
            }
        )

    related_records = []
    for item in related["requirements"][:2]:
        requirement = item["requirement"]
        related_records.append(
            {
                "entityType": "requirement",
                "entityId": requirement["id"],
                "relationshipType": "relates_to",
                "evidenceState": "inferred",
                "rationale": (
                    f"The ticket text shares {round(item['score'] * 100)}% lexical grounding "
                    "with this requirement. Confirm the scope owner before treating the link as fact."
                ),
            }
        )
        evidence.append(
            {
                "claim": f"Likely related requirement: {requirement['title']}",
                "state": "inferred",
                "sourceType": "project",
                "sourceId": requirement["id"],
                "excerpt": requirement["title"],
            }
        )
    for item in related["tasks"][:3]:
        related_task = item["task"]
        downstream = related_task.get("downstreamTaskIds") or []
        related_records.append(
            {
                "entityType": "task",
                "entityId": related_task["id"],
                "relationshipType": "relates_to",
                "evidenceState": "inferred",
                "rationale": (
                    "Candidate work item based on lexical overlap with the ticket. "
                    + (
                        f"{len(downstream)} stored task(s) depend on this task."
                        if downstream
                        else "No downstream dependency is stored for this task."
                    )
                ),
            }
        )
    if milestone:
        related_records.append(
            {
                "entityType": "milestone",
                "entityId": milestone["id"],
                "relationshipType": "blocks",
                "evidenceState": "inferred",
                "rationale": (
                    f"This {'release gate' if milestone.get('releaseGate') else 'milestone'} is the "
                    "closest delivery boundary for the candidate work. The link is inferred until an approver confirms scope."
                ),
            }
        )

    duplicate_candidates = []
    for other in context.get("relatedTickets", []):
        title_score = lexical_score(ticket["title"], other["title"])
        body_score = lexical_score(text, f"{other['title']} {other['description']}")
        duplicate_candidates.append(
            {
                "ticket": other,
                "score": title_score * 0.65 + body_score * 0.35,
            }
        )
    duplicate_candidates = [
        item for item in duplicate_candidates if item["score"] >= 0.35
    ]
    duplicate_candidates.sort(key=lambda item: item["score"], reverse=True)
    duplicate_candidates = [
        {
            "ticketId": item["ticket"]["id"],
            "rationale": (
                f"Related ticket has {round(item['score'] * 100)}% lexical overlap, weighted toward "
                "the title. Similar wording is not proof of the same root cause."
            ),
            "evidenceState": "inferred",
        }
        for item in duplicate_candidates[:1]
    ]

    anchor_milestone_id = (anchor or {}).get("milestoneId") or (milestone["id"] if milestone else None)
    accept = _build_accept_change(context, type_, priority, requirement_id, anchor, anchor_milestone_id)
    split = (
        _build_split_change(context, type_, priority, requirement_id, anchor, anchor_milestone_id)
        if type_ in {"incident", "feature_request", "technical_debt"}
        else None
    )

    classification_label = "feature request" if type_ == "feature_request" else type_.replace("_", " ")
    summary = (
        f"{'Potential ' if critical_evidence_gap else ''}{classification_label} affecting "
        f"{ticket['affectedComponent'] or 'an unspecified part of the project'}: "
        f"{_short_title(ticket['title'], 130)}"
    )
    business_impact = (
        f"Reported: {excerpt(ticket['reportedImpact'], 300)}"
        if ticket["reportedImpact"]
        else (
            "Impact is not quantified in the ticket. Treat severity as unverified until a "
            "reviewer supplies customer or transaction evidence."
        )
    )

    analysis = {
        "classification": {
            "ticketType": type_,
            "priority": priority,
            "urgency": (
                "critical" if priority == "P0"
                else "high" if priority == "P1"
                else "medium" if priority == "P2"
                else "low"
            ),
            "summary": summary,
            "businessImpact": business_impact,
            "customerImpact": (
                sentence_excerpt(
                    ticket["reportedImpact"],
                    ["customer", "charge", "impact", "order", "blocked"],
                    220,
                )
                if ticket["reportedImpact"]
                else "Not established from the supplied ticket."
            ),
        },
        "relatedRecords": related_records,
        "duplicateCandidates": duplicate_candidates,
        "evidence": evidence[:18],
        "unknowns": unknowns,
        "clarifyingQuestions": (
            [f"Can you provide: {unknown}" for unknown in unknowns[:5]]
            if recommended_option == "clarify"
            else []
        ),
        "recommendedOption": recommended_option,
        "recommendationRationale": _option_rationale(type_, recommended_option, has_evidence),
        "proposedChanges": {
            "accept": accept,
            "split": split,
        },
    }

    latency_ms = max(1, round((time.time() - started) * 1000))
    return {
        "analysis": analysis,
        "provider": "deterministic-demo",
        "model": DETERMINISTIC_MODEL,
        "degraded": False,
        "notice": (
            "Deterministic demo analysis: no AI provider is configured. "
            "The classification and links are rule-based and labelled as such."
        ),
        "latencyMs": latency_ms,
        "usage": {"inputTokens": None, "outputTokens": None},
        "toolCalls": [],
    }


def demo_related_tickets(ticket_text: str, tickets: list[dict]) -> list[dict]:
    scored = [
        {
            **ticket,
            "score": _round(lexical_score(ticket_text, f"{ticket['title']} {ticket['description']}")),
        }
        for ticket in tickets
    ]
    return sorted(scored, key=lambda item: item["score"], reverse=True)
