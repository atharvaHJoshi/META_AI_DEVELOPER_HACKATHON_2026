"""Plan generation and validation — ported from planService.ts."""

from __future__ import annotations

import json
import time

from django.db import connection

from aiml import DETERMINISTIC_MODEL, demo_plan, get_gemini_config
from aiml import gemini as gemini_provider
from core import config
from core.common import new_id
from core.errors import ApiError
from ripplemap import validate_graph


def build_project_graph_from_draft(draft: dict) -> dict:
    tasks = [
        {
            "id": task["tempId"],
            "title": task["title"],
            "description": task.get("description", ""),
            "requirementId": task.get("requirementTempId"),
            "milestoneId": task.get("milestoneTempId"),
            "estimateDays": task["estimateDays"],
            "priority": task.get("priority", "P2"),
            "status": "planned",
            "ownerRole": task.get("ownerRole", "Engineering"),
            "plannedStart": None,
            "plannedFinish": None,
            "sourceTicketId": None,
        }
        for task in draft.get("tasks", [])
    ]
    milestones = [
        {
            "id": milestone["tempId"],
            "title": milestone["title"],
            "targetDate": milestone.get("targetDate"),
            "releaseGate": milestone.get("releaseGate", False),
        }
        for milestone in draft.get("milestones", [])
    ]
    dependencies = [
        {
            "predecessorId": dependency,
            "successorId": task["tempId"],
            "dependencyType": "finishes_to_start",
        }
        for task in draft.get("tasks", [])
        for dependency in task.get("dependencies", [])
    ]
    return {
        "projectId": "draft",
        "startDate": draft.get("startDate"),
        "targetDate": draft.get("targetDate"),
        "tasks": tasks,
        "milestones": milestones,
        "dependencies": dependencies,
        "constraints": {},
    }


def _as_list(value) -> list:
    return list(value) if isinstance(value, list) else []


def validate_plan_draft(draft: dict) -> dict:
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(draft, dict):
        return {"valid": False, "errors": ["Plan draft is not a JSON object."], "warnings": [], "cycles": []}

    for key in ("name", "goal", "description", "startDate"):
        if not draft.get(key):
            errors.append(f"The plan draft is missing \"{key}\".")

    requirements = _as_list(draft.get("requirements"))
    milestones = _as_list(draft.get("milestones"))
    tasks = _as_list(draft.get("tasks"))
    if not requirements:
        errors.append("The plan draft must contain at least one requirement.")
    if not milestones:
        errors.append("The plan draft must contain at least one milestone.")
    if not tasks:
        errors.append("The plan draft must contain at least one task.")

    requirement_ids = {r.get("tempId") for r in requirements if isinstance(r, dict)}
    task_ids = [task.get("tempId") for task in tasks if isinstance(task, dict)]

    if len(set(task_ids)) != len(task_ids):
        errors.append("Task tempIds must be unique.")

    for task in tasks:
        if not isinstance(task, dict):
            errors.append("Each task must be an object.")
            continue
        title = task.get("title", "?")
        requirement_temp_id = task.get("requirementTempId")
        if requirement_temp_id and requirement_temp_id not in requirement_ids:
            errors.append(f'Task "{title}" references an unknown requirement.')
        for dependency in _as_list(task.get("dependencies")):
            if dependency not in task_ids:
                errors.append(f'Task "{title}" depends on unknown task "{dependency}".')

    start_date = draft.get("startDate")
    target_date = draft.get("targetDate")
    if target_date and start_date and start_date > target_date:
        errors.append("The project start date must be before the target date.")

    for milestone in milestones:
        if not isinstance(milestone, dict):
            continue
        milestone_target = milestone.get("targetDate")
        if milestone_target and start_date and milestone_target < start_date:
            warnings.append(
                f'Milestone "{milestone.get("title", "?")}" has a target date before the project start.'
            )
        if milestone_target and target_date and milestone_target > target_date:
            warnings.append(
                f'Milestone "{milestone.get("title", "?")}" is targeted after the project target date.'
            )

    graph = build_project_graph_from_draft(draft) if tasks else {"tasks": [], "milestones": [], "dependencies": []}
    cycles: list[list[str]] = []
    if graph.get("tasks"):
        graph_validation = validate_graph(graph)
        errors.extend(graph_validation.errors)
        warnings.extend(graph_validation.warnings)
        cycles = graph_validation.cycles

    if not any(_as_list(task.get("dependencies")) for task in tasks if isinstance(task, dict)) and len(tasks) > 2:
        warnings.append(
            "No task has a dependency; the generated plan cannot show ripple effects."
        )

    return {
        "valid": not errors,
        "errors": list(dict.fromkeys(errors)),
        "warnings": list(dict.fromkeys(warnings)),
        "cycles": cycles,
    }


def record_ai_call(input_data: dict) -> None:
    try:
        usage = input_data.get("usage")
        with connection.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO ai_calls
                  (id, project_id, workspace_id, organization_id, workflow, provider, model,
                   duration_ms, success, degraded, error, usage_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    new_id("ai"),
                    input_data.get("projectId"),
                    input_data.get("workspaceId"),
                    input_data.get("organizationId"),
                    input_data["workflow"],
                    input_data["provider"],
                    input_data["model"],
                    input_data["durationMs"],
                    bool(input_data.get("success")),
                    bool(input_data.get("degraded")),
                    input_data.get("error"),
                    json.dumps(usage) if usage else None,
                ],
            )
    except Exception:  # noqa: BLE001 - telemetry must not break the request
        import logging

        logging.getLogger("miraiwerk.ai").exception("Failed to record AI call telemetry")


def _plan_input(input_data: dict) -> dict:
    return {
        "name": input_data["name"],
        "goal": input_data["goal"],
        "description": input_data["description"],
        "startDate": input_data["startDate"],
        "targetDate": input_data.get("targetDate"),
        "constraints": input_data.get("constraints") or {},
    }


def _deterministic_result(
    plan_input: dict, *, degraded: bool, notice: str | None, latency_ms: int
) -> dict:
    draft = demo_plan(plan_input)
    validation = validate_plan_draft(draft)
    if not validation["valid"]:
        raise ApiError(
            500,
            "DEMO_PLAN_INVALID",
            "The deterministic fallback generated an invalid plan.",
            validation,
        )
    return {
        "draft": draft,
        "provider": "deterministic-demo",
        "model": DETERMINISTIC_MODEL,
        "degraded": degraded,
        "notice": notice,
        "latencyMs": latency_ms,
        "usage": None,
    }


def _record_plan_call(
    project_id: str | None, result: dict, *, success: bool, degraded: bool,
    error: str | None, usage,
) -> None:
    record_ai_call(
        {
            "projectId": project_id,
            "workflow": "plan_generation",
            "provider": result["provider"],
            "model": result["model"],
            "durationMs": result["latencyMs"],
            "success": success,
            "degraded": degraded,
            "error": error,
            "usage": usage,
        }
    )


def generate_plan(input_data: dict, project_id: str | None) -> dict:
    plan_input = _plan_input(input_data)
    started = time.time()
    ai = config.ai_mode()
    provider = ai["provider"]

    if provider == "deterministic-demo":
        result = _deterministic_result(
            plan_input,
            degraded=False,
            notice=(
                "No Gemini or Meta key is configured. MIRAIWERK used its labelled deterministic "
                "planning rules — not a model output."
            ),
            latency_ms=max(1, int((time.time() - started) * 1000)),
        )
        _record_plan_call(project_id, result, success=True, degraded=False, error=None, usage=None)
        return result

    provider_label = "Gemini" if provider == "gemini" else "Meta Model API"
    if provider != "gemini":
        # The Python backend ships the Gemini provider only; Meta is reported
        # honestly and the labelled deterministic fallback is used instead.
        fallback = _deterministic_result(
            plan_input,
            degraded=True,
            notice=(
                f"Meta Model API is not configured in the Python backend. MIRAIWERK used "
                f"labelled deterministic rules; no Meta output is claimed."
            ),
            latency_ms=max(1, int((time.time() - started) * 1000)),
        )
        _record_plan_call(
            project_id, fallback, success=True, degraded=True,
            error="Meta provider unavailable in Python backend", usage=None,
        )
        return fallback

    try:
        result = gemini_provider.generate_plan(plan_input)
        validation = validate_plan_draft(result["draft"])
        if not validation["valid"]:
            retry = gemini_provider.generate_plan(plan_input, "\n".join(validation["errors"]))
            retry_validation = validate_plan_draft(retry["draft"])
            if not retry_validation["valid"]:
                _record_plan_call(
                    project_id, retry, success=False, degraded=False,
                    error=" | ".join(retry_validation["errors"]), usage=retry["usage"],
                )
                raise ApiError(
                    422,
                    "INVALID_GENERATED_PLAN",
                    f"The {provider_label}-generated plan did not pass schema and dependency validation after one correction attempt.",
                    retry_validation,
                )
            result, validation = retry, retry_validation

        _record_plan_call(
            project_id, result, success=True, degraded=False, error=None, usage=result["usage"]
        )
        return result
    except ApiError:
        raise
    except Exception as exc:  # noqa: BLE001 - provider failures must degrade gracefully
        message = str(exc)[:500]
        if config.AI_FALLBACK_ON_ERROR:
            fallback = _deterministic_result(
                plan_input,
                degraded=True,
                notice=(
                    f"{provider_label} generation failed ({message[:220]}). MIRAIWERK used labelled "
                    f"deterministic rules; no {provider_label} output is claimed."
                ),
                latency_ms=max(1, int((time.time() - started) * 1000)),
            )
            _record_plan_call(
                project_id, fallback, success=True, degraded=True, error=message, usage=None
            )
            return fallback
        _record_plan_call(
            project_id,
            {"provider": provider, "model": ai["model"], "latencyMs": max(1, int((time.time() - started) * 1000))},
            success=False,
            degraded=False,
            error=message,
            usage=None,
        )
        raise ApiError(
            502,
            "MODEL_UNAVAILABLE",
            "The configured AI provider is unavailable and fallback is disabled.",
        ) from exc


def ai_status() -> dict:
    return config.ai_mode()
