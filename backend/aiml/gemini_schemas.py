"""Hand-authored Gemini structured-output schemas.

Gemini only accepts a subset of JSON Schema (OpenAPI 3.0): no `default`,
`additionalProperties`, length/size constraints or `$ref`/`definitions`. The
root must be an object. Size limits are still enforced server-side by the
Pydantic models in ``aiml.schemas`` after the response arrives — Zod did the
same in the original TypeScript service.

Nullable fields use ``nullable: true`` rather than ``{"type": "null"}``.
"""

from __future__ import annotations

_PRIORITY = {"type": "string", "enum": ["P0", "P1", "P2", "P3"]}
_TICKET_TYPE = {
    "type": "string",
    "enum": ["bug", "incident", "feature_request", "technical_debt", "clarification"],
}
_SEVERITY = {"type": "string", "enum": ["critical", "high", "medium", "low"]}
_DECISION_OPTION = {"type": "string", "enum": ["accept", "defer", "split", "clarify", "duplicate"]}
_EVIDENCE_STATE = {"type": "string", "enum": ["observed", "inferred", "unknown"]}
_ENTITY_TYPE = {"type": "string", "enum": ["requirement", "task", "milestone", "ticket"]}
_RELATIONSHIP_TYPE = {
    "type": "string",
    "enum": ["implements", "depends_on", "validates", "blocks", "relates_to", "duplicate_of"],
}

_PROPOSED_TASK_ADD = {
    "type": "object",
    "properties": {
        "tempId": {"type": "string"},
        "title": {"type": "string"},
        "description": {"type": "string"},
        "requirementId": {"type": "string", "nullable": True},
        "milestoneId": {"type": "string", "nullable": True},
        "estimateDays": {"type": "number"},
        "priority": _PRIORITY,
        "ownerRole": {"type": "string"},
        "dependencies": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["tempId", "title", "estimateDays"],
}

_PROPOSED_TASK_UPDATE = {
    "type": "object",
    "properties": {
        "taskId": {"type": "string"},
        "estimateDays": {"type": "number"},
        "priority": _PRIORITY,
        "milestoneId": {"type": "string", "nullable": True},
    },
    "required": ["taskId"],
}

_PROPOSED_DEPENDENCY_ADD = {
    "type": "object",
    "properties": {
        "predecessorId": {"type": "string"},
        "successorId": {"type": "string"},
        "dependencyType": {"type": "string"},
    },
    "required": ["predecessorId", "successorId"],
}

_PROPOSED_CHANGE = {
    "type": "object",
    "properties": {
        "option": _DECISION_OPTION,
        "tasksToAdd": {"type": "array", "items": _PROPOSED_TASK_ADD},
        "tasksToUpdate": {"type": "array", "items": _PROPOSED_TASK_UPDATE},
        "tasksToRemove": {"type": "array", "items": {"type": "string"}},
        "dependenciesToAdd": {"type": "array", "items": _PROPOSED_DEPENDENCY_ADD},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "rationale": {"type": "string"},
    },
    "required": ["option"],
}


def _related_records() -> dict:
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "entityType": _ENTITY_TYPE,
                "entityId": {"type": "string"},
                "relationshipType": _RELATIONSHIP_TYPE,
                "evidenceState": _EVIDENCE_STATE,
                "rationale": {"type": "string"},
            },
            "required": [
                "entityType",
                "entityId",
                "relationshipType",
                "evidenceState",
                "rationale",
            ],
        },
    }


def _evidence() -> dict:
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "claim": {"type": "string"},
                "state": _EVIDENCE_STATE,
                "sourceType": {
                    "type": "string",
                    "enum": ["ticket", "project", "policy", "model"],
                },
                "sourceId": {"type": "string", "nullable": True},
                "excerpt": {"type": "string", "nullable": True},
            },
            "required": ["claim", "state", "sourceType"],
        },
    }


def _duplicate_candidates() -> dict:
    return {
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "ticketId": {"type": "string"},
                "rationale": {"type": "string"},
                "evidenceState": _EVIDENCE_STATE,
            },
            "required": ["ticketId", "rationale", "evidenceState"],
        },
    }


TICKET_ANALYSIS_GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "classification": {
            "type": "object",
            "properties": {
                "ticketType": _TICKET_TYPE,
                "priority": _PRIORITY,
                "urgency": _SEVERITY,
                "summary": {"type": "string"},
                "businessImpact": {"type": "string"},
                "customerImpact": {"type": "string"},
            },
            "required": [
                "ticketType",
                "priority",
                "urgency",
                "summary",
                "businessImpact",
                "customerImpact",
            ],
        },
        "relatedRecords": _related_records(),
        "duplicateCandidates": _duplicate_candidates(),
        "evidence": _evidence(),
        "unknowns": {"type": "array", "items": {"type": "string"}},
        "clarifyingQuestions": {"type": "array", "items": {"type": "string"}},
        "recommendedOption": _DECISION_OPTION,
        "recommendationRationale": {"type": "string"},
        "proposedChanges": {
            "type": "object",
            "properties": {
                "accept": _PROPOSED_CHANGE,
                "split": {**_PROPOSED_CHANGE, "nullable": True},
            },
            "required": ["accept"],
        },
    },
    "required": [
        "classification",
        "relatedRecords",
        "duplicateCandidates",
        "evidence",
        "unknowns",
        "clarifyingQuestions",
        "recommendedOption",
        "recommendationRationale",
        "proposedChanges",
    ],
}


def _requirement() -> dict:
    return {
        "type": "object",
        "properties": {
            "tempId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "acceptanceCriteria": {"type": "array", "items": {"type": "string"}},
            "source": {"type": "string", "enum": ["explicit", "inferred"]},
            "status": {"type": "string", "enum": ["proposed", "confirmed"]},
        },
        "required": [
            "tempId",
            "title",
            "description",
            "acceptanceCriteria",
            "source",
            "status",
        ],
    }


def _milestone() -> dict:
    return {
        "type": "object",
        "properties": {
            "tempId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "targetDate": {"type": "string", "nullable": True},
            "releaseGate": {"type": "boolean"},
        },
        "required": ["tempId", "title"],
    }


def _task() -> dict:
    return {
        "type": "object",
        "properties": {
            "tempId": {"type": "string"},
            "title": {"type": "string"},
            "description": {"type": "string"},
            "requirementTempId": {"type": "string", "nullable": True},
            "milestoneTempId": {"type": "string", "nullable": True},
            "estimateDays": {"type": "number"},
            "priority": _PRIORITY,
            "ownerRole": {"type": "string"},
            "dependencies": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["tempId", "title", "estimateDays"],
    }


def _risk() -> dict:
    return {
        "type": "object",
        "properties": {
            "title": {"type": "string"},
            "severity": {"type": "string", "enum": ["high", "medium", "low"]},
            "mitigation": {"type": "string"},
        },
        "required": ["title", "severity", "mitigation"],
    }


PLAN_DRAFT_GEMINI_SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "goal": {"type": "string"},
        "description": {"type": "string"},
        "startDate": {"type": "string"},
        "targetDate": {"type": "string", "nullable": True},
        "requirements": {"type": "array", "items": _requirement()},
        "milestones": {"type": "array", "items": _milestone()},
        "tasks": {"type": "array", "items": _task()},
        "assumptions": {"type": "array", "items": {"type": "string"}},
        "missingInformation": {"type": "array", "items": {"type": "string"}},
        "risks": {"type": "array", "items": _risk()},
    },
    "required": [
        "name",
        "goal",
        "description",
        "startDate",
        "requirements",
        "milestones",
        "tasks",
    ],
}
