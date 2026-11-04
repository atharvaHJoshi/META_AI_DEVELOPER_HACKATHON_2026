"""Pydantic validation for AIML payloads (TicketAnalysis, ProposedChange).

These mirror the zod schemas in packages/schemas/src/ticket.ts so that a
malformed model response fails fast and can be sent to the labelled
deterministic fallback.
"""

from __future__ import annotations
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

TicketType = Literal["bug", "incident", "feature_request", "technical_debt", "clarification"]
Priority = Literal["P0", "P1", "P2", "P3"]
DecisionOption = Literal["accept", "defer", "split", "clarify", "duplicate"]
EvidenceState = Literal["observed", "inferred", "unknown"]
EntityType = Literal["requirement", "task", "milestone", "ticket"]
RelationshipType = Literal[
    "implements", "depends_on", "validates", "blocks", "relates_to", "duplicate_of",
]
Severity = Literal["critical", "high", "medium", "low"]


class ProposedTaskAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")
    tempId: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=3000)
    requirementId: str | None = None
    milestoneId: str | None = None
    estimateDays: float = Field(ge=0.5, le=60)
    priority: Priority = "P1"
    ownerRole: str = Field(min_length=2, max_length=80, default="Engineering")
    dependencies: list[str] = Field(default_factory=list)


class ProposedTaskUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    taskId: str = Field(min_length=1)
    estimateDays: float | None = Field(default=None, ge=0.5, le=60)
    priority: Priority | None = None
    milestoneId: str | None = None


class ProposedDependencyAdd(BaseModel):
    model_config = ConfigDict(extra="ignore")
    predecessorId: str = Field(min_length=1)
    successorId: str = Field(min_length=1)
    dependencyType: str = Field(default="finishes_to_start")


class ProposedChange(BaseModel):
    model_config = ConfigDict(extra="ignore")
    option: DecisionOption
    tasksToAdd: list[ProposedTaskAdd] = Field(default_factory=list, max_length=20)
    tasksToUpdate: list[ProposedTaskUpdate] = Field(default_factory=list, max_length=20)
    tasksToRemove: list[str] = Field(default_factory=list, max_length=10)
    dependenciesToAdd: list[ProposedDependencyAdd] = Field(default_factory=list, max_length=30)
    assumptions: list[str] = Field(default_factory=list, max_length=20)
    rationale: str = Field(default="", max_length=1200)


class ProposedChanges(BaseModel):
    model_config = ConfigDict(extra="ignore")
    accept: ProposedChange
    split: ProposedChange | None = None


class TicketClassification(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ticketType: TicketType
    priority: Priority
    urgency: Severity
    summary: str = Field(min_length=3, max_length=800)
    businessImpact: str = Field(min_length=3, max_length=1000)
    customerImpact: str = Field(default="", max_length=1000)


class RelatedRecord(BaseModel):
    model_config = ConfigDict(extra="ignore")
    entityType: EntityType
    entityId: str = Field(min_length=1)
    relationshipType: RelationshipType
    evidenceState: EvidenceState
    rationale: str = Field(min_length=3, max_length=800)


class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="ignore")
    claim: str = Field(min_length=3, max_length=800)
    state: EvidenceState
    sourceType: Literal["ticket", "project", "policy", "model"]
    sourceId: str | None = None
    excerpt: str | None = Field(default=None, max_length=800)


class DuplicateCandidate(BaseModel):
    model_config = ConfigDict(extra="ignore")
    ticketId: str = Field(min_length=1)
    rationale: str = Field(min_length=3, max_length=600)
    evidenceState: EvidenceState


class TicketAnalysis(BaseModel):
    model_config = ConfigDict(extra="ignore")
    classification: TicketClassification
    relatedRecords: list[RelatedRecord] = Field(default_factory=list, max_length=20)
    duplicateCandidates: list[DuplicateCandidate] = Field(default_factory=list, max_length=5)
    evidence: list[EvidenceItem] = Field(default_factory=list, max_length=20)
    unknowns: list[str] = Field(default_factory=list, max_length=15)
    clarifyingQuestions: list[str] = Field(default_factory=list, max_length=10)
    recommendedOption: DecisionOption
    recommendationRationale: str = Field(min_length=5, max_length=2000)
    proposedChanges: ProposedChanges


def validate_ticket_analysis(data: dict) -> TicketAnalysis:
    return TicketAnalysis.model_validate(data)


def validate_proposed_change(data: dict) -> ProposedChange:
    return ProposedChange.model_validate(data)


def validate_plan_draft(data: dict) -> dict:
    required = ["name", "goal", "description", "startDate", "requirements", "milestones", "tasks"]
    missing = [key for key in required if key not in data]
    if missing:
        raise ValueError(f"Plan draft is missing required keys: {', '.join(missing)}")
    for requirement in data.get("requirements", []):
        _require(requirement, ["tempId", "title", "source"])
    for milestone in data.get("milestones", []):
        _require(milestone, ["tempId", "title"])
    for task in data.get("tasks", []):
        _require(task, ["tempId", "title", "estimateDays"])
    return data


def _require(value: dict, keys: list[str]) -> None:
    if not isinstance(value, dict):
        raise ValueError("Plan draft entries must be objects.")
    missing = [key for key in keys if key not in value]
    if missing:
        raise ValueError(f"Plan entry missing keys: {', '.join(missing)}")
