"""Classifier policy: normalise model priority under product rules."""

from __future__ import annotations

from typing import Any

_PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


def _lower_priority(priority: str) -> str:
    if priority == "P0":
        return "P1"
    if priority == "P1":
        return "P2"
    if priority == "P2":
        return "P3"
    return "P3"


def _at_least(priority: str, floor: str) -> str:
    return priority if _PRIORITY_ORDER[priority] <= _PRIORITY_ORDER[floor] else floor


def apply_policy(analysis: dict, context: dict) -> dict[str, Any]:
    policy_config = (context.get("project", {}).get("constraints") or {}).get("policy") or {}
    model_priority = analysis["classification"]["priority"]
    final_priority = model_priority
    rules_applied: list[str] = []

    classification = analysis["classification"]
    ticket = context["ticket"]
    text = (
        f"{ticket['title']} {ticket['description']} "
        f"{ticket['affectedComponent']} {ticket['reportedImpact']}"
    ).lower()
    component = ticket["affectedComponent"].lower()
    escalation_components = policy_config.get("escalationComponents") or []
    escalated_component = any(
        item.lower() in component for item in escalation_components
    ) or any(item.lower() in text for item in escalation_components)

    if escalated_component:
        final_priority = _at_least(final_priority, "P1")
        rules_applied.append("Escalation component matched: priority floor P1.")

    if (
        classification["ticketType"] == "incident"
        and ticket["environment"].lower() == "production"
    ):
        final_priority = _at_least(final_priority, "P1")
        rules_applied.append("Production incident: priority floor P1.")

    if (
        ticket["severityReported"] == "critical"
        and classification["ticketType"] != "feature_request"
    ):
        final_priority = _at_least(final_priority, "P1")
        rules_applied.append("Reporter marked severity critical: priority floor P1.")

    if bool(policy_config.get("requireEvidenceForP0")) and final_priority == "P0":
        has_evidence = (
            len(ticket["evidence"].strip()) >= 20
            and len(ticket["reportedImpact"].strip()) >= 10
            and bool(ticket["environment"].strip())
        )
        if not has_evidence:
            final_priority = _lower_priority(final_priority)
            rules_applied.append(
                "P0 requires concrete impact, environment and evidence: downgraded pending clarification."
            )

    if final_priority == "P0" and classification["ticketType"] not in {"incident", "bug"}:
        final_priority = _lower_priority(final_priority)
        rules_applied.append("Non-defect ticket cannot hold P0 under the configured policy.")

    if not rules_applied:
        rules_applied.append("Model priority accepted; no escalation rule matched.")

    critical_hours = policy_config.get("criticalResponseHours", 24)
    high_days = policy_config.get("highResponseDays", 3)
    normal_days = policy_config.get("normalResponseDays", 10)

    if final_priority == "P0":
        response_window_hours = critical_hours
    elif final_priority == "P1":
        response_window_hours = high_days * 24
    elif final_priority == "P2":
        response_window_hours = normal_days * 24
    else:
        response_window_hours = normal_days * 24 * 2

    if final_priority == "P0":
        response_window_label = f"Respond within {critical_hours} hour(s)"
    elif final_priority == "P1":
        response_window_label = f"Respond within {high_days} working day(s)"
    elif final_priority == "P2":
        response_window_label = f"Triage within {normal_days} working day(s)"
    else:
        response_window_label = "Backlog — no active response window"

    return {
        "classification": {**classification, "priority": final_priority},
        "policy": {
            "modelPriority": model_priority,
            "finalPriority": final_priority,
            "responseWindowHours": response_window_hours,
            "responseWindowLabel": response_window_label,
            "rulesApplied": rules_applied,
            "escalated": _PRIORITY_ORDER[final_priority] < _PRIORITY_ORDER[model_priority],
        },
    }
