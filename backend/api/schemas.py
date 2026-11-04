"""Pydantic request models mirroring the zod contracts in packages/schemas."""

from __future__ import annotations

import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

ISO_DATE = r"^\d{4}-\d{2}-\d{2}$"
HEX_COLOR = r"^#[0-9A-Fa-f]{6}$"
MAX_DESCRIPTION = 8000


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)


# ---------------------------------------------------------------- auth ----
class RegisterInput(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=10, max_length=200)
    fullName: str = Field(min_length=2, max_length=120)
    organizationName: str | None = Field(default=None, min_length=2, max_length=160)

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("Enter a valid email address.")
        return v


class LoginInput(StrictModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=1, max_length=200)


class DemoLoginInput(StrictModel):
    email: str = Field(min_length=3, max_length=320)


class ForgotPasswordInput(StrictModel):
    email: str = Field(min_length=3, max_length=320)


class ResetPasswordInput(StrictModel):
    token: str = Field(min_length=10, max_length=400)
    password: str = Field(min_length=10, max_length=200)


class ProfileInput(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    title: str | None = Field(default=None, max_length=120)
    avatarColor: str | None = Field(default=None, pattern=HEX_COLOR)
    timezone: str | None = Field(default=None, max_length=80)


# ------------------------------------------------------- organizations ----
class CreateOrganizationInput(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    workspaceName: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


WorkspaceRole = Literal["owner", "admin", "manager", "member", "viewer"]


class MemberInput(StrictModel):
    email: str | None = Field(default=None, max_length=320)
    userId: str | None = Field(default=None, min_length=1)
    role: WorkspaceRole = "member"


class UpdateMemberRoleInput(StrictModel):
    role: WorkspaceRole


class CreateWorkspaceInput(StrictModel):
    organizationId: str = Field(min_length=1)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


class UpdateWorkspaceInput(StrictModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    onboardingStage: int | None = Field(default=None, ge=1, le=8)
    aiContext: dict[str, Any] | None = None


class CreateTeamInput(StrictModel):
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)
    leadId: str | None = Field(default=None, min_length=1)


class AddTeamMemberInput(StrictModel):
    userId: str = Field(min_length=1)


class OnboardingInput(StrictModel):
    stage: int = Field(ge=1, le=8)
    aiContext: dict[str, Any] | None = None
    name: str | None = Field(default=None, min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=1000)


# ------------------------------------------------------------- projects ----
class ConstraintsInput(StrictModel):
    team: str | None = Field(default=None, max_length=300)
    capacityPersonDays: float | None = Field(default=None, ge=1, le=10000)
    technology: str | None = Field(default=None, max_length=1000)
    nonNegotiables: str | None = Field(default=None, max_length=2000)


class GeneratePlanInput(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    goal: str = Field(min_length=3, max_length=600)
    description: str = Field(min_length=10, max_length=8000)
    startDate: str = Field(pattern=ISO_DATE)
    targetDate: str | None = Field(default=None, pattern=ISO_DATE)
    constraints: ConstraintsInput = Field(default_factory=ConstraintsInput)


Priority = Literal["P0", "P1", "P2", "P3"]


class RequirementDraft(StrictModel):
    tempId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=1, max_length=3000)
    acceptanceCriteria: list[str] = Field(min_length=1, max_length=12)
    source: Literal["explicit", "inferred"]
    status: Literal["proposed", "confirmed"] = "proposed"

    @field_validator("acceptanceCriteria")
    @classmethod
    def _criteria(cls, v: list[str]) -> list[str]:
        if any(len(str(item).strip()) < 1 or len(str(item)) > 500 for item in v):
            raise ValueError("Each acceptance criterion must be 1-500 characters.")
        return [str(item) for item in v]


class MilestoneDraft(StrictModel):
    tempId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=2, max_length=160)
    description: str = Field(default="", max_length=1000)
    targetDate: str | None = Field(default=None, pattern=ISO_DATE)
    releaseGate: bool = False


class TaskDraft(StrictModel):
    tempId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=3, max_length=200)
    description: str = Field(default="", max_length=3000)
    requirementTempId: str | None = None
    milestoneTempId: str | None = None
    estimateDays: float = Field(ge=0.5, le=60)
    priority: Priority = "P2"
    ownerRole: str = Field(min_length=2, max_length=80, default="Engineering")
    dependencies: list[str] = Field(default_factory=list)


class RiskDraft(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    severity: Literal["high", "medium", "low"]
    mitigation: str = Field(min_length=3, max_length=600)


class PlanDraft(StrictModel):
    name: str = Field(min_length=2, max_length=160)
    goal: str = Field(min_length=3, max_length=600)
    description: str = Field(min_length=3, max_length=4000)
    startDate: str = Field(pattern=ISO_DATE)
    targetDate: str | None = Field(default=None, pattern=ISO_DATE)
    requirements: list[RequirementDraft] = Field(min_length=1, max_length=30)
    milestones: list[MilestoneDraft] = Field(min_length=1, max_length=12)
    tasks: list[TaskDraft] = Field(min_length=1, max_length=80)
    assumptions: list[str] = Field(default_factory=list, max_length=30)
    missingInformation: list[str] = Field(default_factory=list, max_length=30)
    risks: list[RiskDraft] = Field(default_factory=list, max_length=20)

    @field_validator("assumptions", "missingInformation")
    @classmethod
    def _strings(cls, v: list[str]) -> list[str]:
        out = []
        for item in v:
            item = str(item).strip()
            if not item or len(item) > 500:
                raise ValueError("Each entry must be 1-500 characters.")
            out.append(item)
        return out


class GenerationMeta(StrictModel):
    provider: Literal["gemini", "meta", "deterministic-demo"]
    model: str = Field(min_length=1, max_length=200)
    degraded: bool = False


class CreateProjectInput(StrictModel):
    draft: PlanDraft
    generation: GenerationMeta | None = None
    constraints: ConstraintsInput | None = None


# -------------------------------------------------------------- tickets ----
TicketType = Literal["bug", "incident", "feature_request", "technical_debt", "clarification"]
Severity = Literal["critical", "high", "medium", "low", "unspecified"]
DecisionOption = Literal["accept", "defer", "split", "clarify", "duplicate"]


class CreateTicketInput(StrictModel):
    projectId: str = Field(min_length=1, max_length=80)
    title: str = Field(min_length=4, max_length=240)
    description: str = Field(min_length=10, max_length=MAX_DESCRIPTION)
    source: str = Field(default="manual", min_length=2, max_length=80)
    ticketType: TicketType | None = None
    affectedComponent: str = Field(default="", max_length=200)
    reportedImpact: str = Field(default="", max_length=2000)
    evidence: str = Field(default="", max_length=5000)
    reporter: str = Field(default="", max_length=160)
    environment: str = Field(default="", max_length=120)
    severityReported: Severity = "unspecified"


# ------------------------------------------------------------ decisions ----
class SimulationRequestInput(StrictModel):
    option: DecisionOption
    baselineVersion: int | None = Field(default=None, ge=1)


class ApproveDecisionInput(StrictModel):
    option: DecisionOption
    reason: str = Field(default="", max_length=1000)


class RejectDecisionInput(StrictModel):
    reason: str = Field(min_length=3, max_length=1000)


class ClarifyDecisionInput(StrictModel):
    reason: str = Field(min_length=3, max_length=1000)
    questions: list[str] = Field(default_factory=list, max_length=10)

    @field_validator("questions")
    @classmethod
    def _questions(cls, v: list[str]) -> list[str]:
        out = []
        for item in v:
            item = str(item).strip()
            if not item or len(item) < 3 or len(item) > 500:
                raise ValueError("Each question must be 3-500 characters.")
            out.append(item)
        return out


# ---------------------------------------------------------------- tasks ----
TaskStatus = Literal["planned", "in_progress", "blocked", "done"]


class CreateTaskInput(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    status: TaskStatus | None = None
    priority: Priority | None = None
    estimateDays: float | None = Field(default=None, ge=0.5, le=60)
    ownerRole: str | None = Field(default=None, max_length=80)
    requirementId: str | None = None
    milestoneId: str | None = None
    assigneeId: str | None = None
    labels: list[str] | None = Field(default=None, max_length=20)
    plannedStart: str | None = Field(default=None, pattern=ISO_DATE)
    plannedFinish: str | None = Field(default=None, pattern=ISO_DATE)
    dependencyIds: list[str] | None = Field(default=None, max_length=50)
    sourceTicketId: str | None = None

    @field_validator("labels")
    @classmethod
    def _labels(cls, v):
        if v is None:
            return v
        if any(len(str(item)) > 40 for item in v):
            raise ValueError("Each label must be at most 40 characters.")
        return [str(item) for item in v]


class UpdateTaskInput(StrictModel):
    title: str | None = Field(default=None, min_length=3, max_length=200)
    description: str | None = Field(default=None, max_length=5000)
    status: TaskStatus | None = None
    priority: Priority | None = None
    estimateDays: float | None = Field(default=None, ge=0.5, le=60)
    ownerRole: str | None = Field(default=None, max_length=80)
    requirementId: str | None = None
    milestoneId: str | None = None
    assigneeId: str | None = None
    labels: list[str] | None = Field(default=None, max_length=20)
    plannedStart: str | None = Field(default=None, pattern=ISO_DATE)
    plannedFinish: str | None = Field(default=None, pattern=ISO_DATE)


class DependencyInput(StrictModel):
    predecessorId: str = Field(min_length=1)
    successorId: str = Field(min_length=1)


class CreateMilestoneInput(StrictModel):
    title: str = Field(min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    targetDate: str | None = Field(default=None, pattern=ISO_DATE)
    releaseGate: bool | None = None


class UpdateMilestoneInput(StrictModel):
    title: str | None = Field(default=None, min_length=2, max_length=160)
    description: str | None = Field(default=None, max_length=1000)
    targetDate: str | None = Field(default=None, pattern=ISO_DATE)
    releaseGate: bool | None = None
    status: str | None = Field(default=None, max_length=40)


# ---------------------------------------------------------------- collab ----
DocType = Literal["markdown", "diagram"]
MeetingStatus = Literal["scheduled", "in_progress", "completed", "cancelled"]


class CreateDocumentInput(StrictModel):
    title: str = Field(min_length=2, max_length=200)
    content: str | None = Field(default=None, max_length=200_000)
    docType: DocType | None = None
    projectId: str | None = None


class UpdateDocumentInput(StrictModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    content: str | None = Field(default=None, max_length=200_000)
    status: str | None = Field(default=None, max_length=40)
    docType: DocType | None = None


class CreateMeetingInput(StrictModel):
    title: str = Field(min_length=2, max_length=200)
    agenda: str | None = Field(default=None, max_length=10_000)
    projectId: str | None = None
    scheduledAt: str | None = None
    durationMinutes: int | None = Field(default=None, ge=5, le=480)


class MeetingActionItemInput(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    owner: str = Field(default="", max_length=120)
    dueDate: str | None = None
    taskId: str | None = None


class UpdateMeetingInput(StrictModel):
    title: str | None = Field(default=None, min_length=2, max_length=200)
    agenda: str | None = Field(default=None, max_length=10_000)
    notes: str | None = Field(default=None, max_length=50_000)
    scheduledAt: str | None = None
    durationMinutes: int | None = Field(default=None, ge=5, le=480)
    status: MeetingStatus | None = None
    summary: str | None = Field(default=None, max_length=20_000)
    actionItems: list[MeetingActionItemInput] | None = Field(default=None, max_length=50)


class MeetingActionsInput(StrictModel):
    projectId: str = Field(min_length=1)


class CreateThreadInput(StrictModel):
    title: str = Field(min_length=3, max_length=200)
    body: str = Field(min_length=3, max_length=20_000)
    category: str | None = Field(default=None, max_length=60)
    projectId: str | None = None


class ReplyInput(StrictModel):
    body: str = Field(min_length=1, max_length=20_000)


class SolvedInput(StrictModel):
    solved: bool


# -------------------------------------------------------- notifications ----
class NotificationPreferenceInput(StrictModel):
    category: str = Field(min_length=2, max_length=40)
    inApp: bool = True
    email: bool = True


class UpdateNotificationPreferencesInput(StrictModel):
    preferences: list[NotificationPreferenceInput] = Field(min_length=1, max_length=20)


# ------------------------------------------------------------------- ai ----
class DraftDocumentInput(StrictModel):
    workspaceId: str = Field(min_length=1)
    projectId: str | None = None
    title: str = Field(min_length=2, max_length=200)
    outline: str = Field(min_length=3, max_length=20_000)
    docType: Literal["markdown", "diagram"] = "markdown"


class ProjectQuestionInput(StrictModel):
    question: str = Field(min_length=3, max_length=1_000)
