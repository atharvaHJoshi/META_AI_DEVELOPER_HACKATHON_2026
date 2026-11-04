"""Plan bundle loading and snapshot persistence (Django ORM)."""

from __future__ import annotations

from typing import Any, Sequence

from django.db import transaction

from core.common import iso_date, iso_datetime, new_id, num
from platform_app import models


def constraints_of(project: models.Project) -> dict:
    constraints = project.constraints_json
    if not isinstance(constraints, dict):
        return {}
    # The original implementation reparsed through the constraint schema and
    # fell back to defaults on any validation error. We mirror that by keeping
    # only recognised keys with plausible types.
    out: dict[str, Any] = {}
    if isinstance(constraints.get("team"), str):
        out["team"] = constraints["team"]
    if isinstance(constraints.get("capacityPersonDays"), (int, float)) and constraints["capacityPersonDays"]:
        out["capacityPersonDays"] = constraints["capacityPersonDays"]
    if isinstance(constraints.get("workingDaysAvailable"), (int, float)) and constraints["workingDaysAvailable"]:
        out["workingDaysAvailable"] = constraints["workingDaysAvailable"]
    if isinstance(constraints.get("technology"), str):
        out["technology"] = constraints["technology"]
    if isinstance(constraints.get("nonNegotiables"), str):
        out["nonNegotiables"] = constraints["nonNegotiables"]
    policy = constraints.get("policy")
    if isinstance(policy, dict):
        out_policy = {}
        if isinstance(policy.get("criticalResponseHours"), (int, float)):
            out_policy["criticalResponseHours"] = policy["criticalResponseHours"]
        if isinstance(policy.get("highResponseDays"), (int, float)):
            out_policy["highResponseDays"] = policy["highResponseDays"]
        if isinstance(policy.get("normalResponseDays"), (int, float)):
            out_policy["normalResponseDays"] = policy["normalResponseDays"]
        if isinstance(policy.get("requireEvidenceForP0"), bool):
            out_policy["requireEvidenceForP0"] = policy["requireEvidenceForP0"]
        if isinstance(policy.get("escalationComponents"), list):
            out_policy["escalationComponents"] = [
                str(item) for item in policy["escalationComponents"]
            ]
        if isinstance(policy.get("releaseFreezeDays"), (int, float)):
            out_policy["releaseFreezeDays"] = policy["releaseFreezeDays"]
        if out_policy:
            out["policy"] = out_policy
    return out


def to_task(task: models.Task) -> dict:
    return {
        "id": task.id,
        "projectId": task.project_id,
        "requirementId": task.requirement_id,
        "milestoneId": task.milestone_id,
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "estimateDays": num(task.estimate_days),
        "priority": task.priority,
        "ownerRole": task.owner_role,
        "plannedStart": iso_date(task.planned_start),
        "plannedFinish": iso_date(task.planned_finish),
        "sourceTicketId": task.source_ticket_id,
    }


def to_milestone(milestone: models.Milestone) -> dict:
    return {
        "id": milestone.id,
        "projectId": milestone.project_id,
        "title": milestone.title,
        "description": milestone.description,
        "targetDate": iso_date(milestone.target_date),
        "releaseGate": milestone.release_gate,
        "status": milestone.status,
        "position": milestone.position,
    }


def to_requirement(requirement: models.Requirement) -> dict:
    return {
        "id": requirement.id,
        "projectId": requirement.project_id,
        "title": requirement.title,
        "description": requirement.description,
        "acceptanceCriteria": list(requirement.acceptance_criteria or []),
        "source": requirement.source,
        "status": requirement.status,
    }


def load_project_row(project_id: str) -> models.Project | None:
    return models.Project.objects.filter(pk=project_id).first()


def load_plan_bundle(project_id: str) -> dict | None:
    project = load_project_row(project_id)
    if project is None:
        return None

    requirements = list(
        models.Requirement.objects.filter(project_id=project_id).order_by("created_at", "title")
    )
    milestones = list(
        models.Milestone.objects.filter(project_id=project_id).order_by(
            "position", "target_date", "title"
        )
    )
    # Match ORDER BY planned_start NULLS LAST, title.
    from django.db.models import F

    tasks = list(
        models.Task.objects.filter(project_id=project_id)
        .order_by(F("planned_start").asc(nulls_last=True), "title")
    )
    project_task_ids = list(models.Task.objects.filter(project_id=project_id).values_list("id", flat=True))
    dependencies = list(
        models.TaskDependency.objects.filter(successor_id__in=project_task_ids)
        .order_by("predecessor_id", "successor_id")
        .values("predecessor_id", "successor_id", "dependency_type")
    )
    version = (
        models.PlanVersion.objects.filter(
            project_id=project_id, version_number=project.current_plan_version
        )
        .values_list("snapshot_json", flat=True)
        .first()
    )

    snapshot = version if isinstance(version, dict) else {}
    return {
        "project": project,
        "requirements": requirements,
        "milestones": milestones,
        "tasks": tasks,
        "dependencies": dependencies,
        "assumptions": snapshot.get("assumptions", []),
        "missingInformation": snapshot.get("missingInformation", []),
    }


def build_graph(bundle: dict) -> dict:
    project: models.Project = bundle["project"]
    return {
        "projectId": project.id,
        "startDate": iso_date(project.start_date),
        "targetDate": iso_date(project.target_date),
        "tasks": [
            {
                **{key: value for key, value in to_task(task).items() if key != "projectId"},
            }
            for task in bundle["tasks"]
        ],
        "milestones": [
            {
                "id": milestone.id,
                "title": milestone.title,
                "targetDate": iso_date(milestone.target_date),
                "releaseGate": milestone.release_gate,
            }
            for milestone in bundle["milestones"]
        ],
        "dependencies": [
            {
                "predecessorId": dep["predecessor_id"],
                "successorId": dep["successor_id"],
                "dependencyType": dep["dependency_type"],
            }
            for dep in bundle["dependencies"]
        ],
        "constraints": constraints_of(project),
    }


def build_snapshot(bundle: dict, version: int) -> dict:
    project: models.Project = bundle["project"]
    return {
        "version": version,
        "generatedAt": iso_datetime(_now()),
        "project": {
            "name": project.name,
            "goal": project.goal,
            "description": project.description,
            "startDate": iso_date(project.start_date),
            "targetDate": iso_date(project.target_date),
            "constraints": project.constraints_json or {},
        },
        "requirements": [
            {
                "id": requirement.id,
                "title": requirement.title,
                "description": requirement.description,
                "acceptanceCriteria": list(requirement.acceptance_criteria or []),
                "source": requirement.source,
                "status": requirement.status,
            }
            for requirement in bundle["requirements"]
        ],
        "milestones": [
            {
                "id": milestone.id,
                "title": milestone.title,
                "description": milestone.description,
                "targetDate": iso_date(milestone.target_date),
                "releaseGate": milestone.release_gate,
                "status": milestone.status,
                "position": milestone.position,
            }
            for milestone in bundle["milestones"]
        ],
        "tasks": [
            {
                "id": task.id,
                "requirementId": task.requirement_id,
                "milestoneId": task.milestone_id,
                "title": task.title,
                "description": task.description,
                "status": task.status,
                "estimateDays": num(task.estimate_days),
                "priority": task.priority,
                "ownerRole": task.owner_role,
                "plannedStart": iso_date(task.planned_start),
                "plannedFinish": iso_date(task.planned_finish),
                "sourceTicketId": task.source_ticket_id,
            }
            for task in bundle["tasks"]
        ],
        "dependencies": [
            {
                "predecessorId": dep["predecessor_id"],
                "successorId": dep["successor_id"],
                "dependencyType": dep["dependency_type"],
            }
            for dep in bundle["dependencies"]
        ],
        "assumptions": list(bundle.get("assumptions") or []),
        "missingInformation": list(bundle.get("missingInformation") or []),
    }


def _now():
    from django.utils import timezone

    return timezone.now()


def persist_snapshot(
    bundle: dict,
    version: int,
    *,
    id: str,
    parent_version_id: str | None,
    change_summary: str,
    created_by: str | None,
) -> None:
    models.PlanVersion.objects.create(
        id=id,
        project_id=bundle["project"].id,
        version_number=version,
        parent_version=parent_version_id,
        snapshot_json=build_snapshot(bundle, version),
        change_summary=change_summary,
        created_by=created_by,
    )


def transaction_atomic():
    return transaction.atomic
