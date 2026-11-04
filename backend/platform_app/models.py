"""Django models mirroring the MIRAIWERK relational schema.

The original Express service used raw SQL. This is a faithful ORM translation:
table names, column names and JSON payloads match the documented contract while
Django now owns migrations, constraints and the admin surface.
"""

from __future__ import annotations

import hashlib

from django.db import models
from django.utils import timezone as dj_timezone


class User(models.Model):
    USERNAME_FIELD = "email"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    id = models.CharField(primary_key=True, max_length=64)
    name = models.CharField(max_length=200)
    email = models.CharField(max_length=320, unique=True)
    title = models.CharField(max_length=200, blank=True, default="")
    avatar_color = models.CharField(max_length=16, default="#5B6CFF")
    avatar_url = models.TextField(null=True, blank=True)
    password_hash = models.TextField(null=True, blank=True)
    status = models.CharField(max_length=20, default="active")
    is_platform_admin = models.BooleanField(default=False)
    is_staff = models.BooleanField(default=False)
    locale = models.CharField(max_length=20, default="en")
    timezone = models.CharField(max_length=80, default="UTC")
    last_login_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "users"
        ordering = ["name"]

    # -- Django admin compatibility -------------------------------------
    @property
    def is_authenticated(self) -> bool:
        return True

    @property
    def is_anonymous(self) -> bool:
        return False

    @property
    def is_active(self) -> bool:
        return self.status == "active"

    @property
    def is_superuser(self) -> bool:
        """Let the Django admin treat platform admins as superusers."""
        return self.is_platform_admin

    def get_session_auth_hash(self) -> str:
        """Bind admin sessions to the current product password hash."""
        return hashlib.sha256((self.password_hash or "").encode("utf-8")).hexdigest()

    def get_full_name(self) -> str:
        return self.name

    def get_short_name(self) -> str:
        return self.name.split(" ")[0] if self.name else self.email

    def has_perm(self, perm: str, obj=None) -> bool:
        return bool(self.is_staff and self.status == "active")

    def has_module_perms(self, app_label: str) -> bool:
        return bool(self.is_staff and self.status == "active")

    def get_all_permissions(self, obj=None):
        return set() if not self.is_staff else {"admin.full"}

    def get_username(self) -> str:
        return self.email

    def __str__(self) -> str:
        return self.name


class Organization(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    name = models.CharField(max_length=200)
    slug = models.CharField(max_length=80, unique=True)
    description = models.TextField(blank=True, default="")
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "organizations"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class OrganizationMember(models.Model):
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, db_column="organization_id"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    role = models.CharField(max_length=20, default="member")
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "organization_members"
        unique_together = [("organization", "user")]


class Workspace(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    organization = models.ForeignKey(
        Organization, on_delete=models.CASCADE, db_column="organization_id"
    )
    name = models.CharField(max_length=200)
    slug = models.CharField(max_length=80, unique=True)
    description = models.TextField(blank=True, default="")
    onboarding_stage = models.IntegerField(default=1)
    onboarding_json = models.JSONField(default=dict)
    ai_context_json = models.JSONField(default=dict)
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "workspaces"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class WorkspaceMember(models.Model):
    workspace = models.ForeignKey(
        Workspace, on_delete=models.CASCADE, db_column="workspace_id"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    role = models.CharField(max_length=20, default="member")
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "workspace_members"
        unique_together = [("workspace", "user")]


class Session(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    family_id = models.CharField(max_length=64)
    token_hash = models.CharField(max_length=128, unique=True)
    rotated_to = models.CharField(max_length=64, null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    ip_address = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    last_used_at = models.DateTimeField(default=dj_timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=80, null=True, blank=True)

    class Meta:
        db_table = "sessions"


class OAuthAccount(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    provider = models.CharField(max_length=20)
    provider_user_id = models.CharField(max_length=200)
    email_at_provider = models.CharField(max_length=320, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    last_login_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "oauth_accounts"
        unique_together = [("provider", "provider_user_id")]


class OneTimeToken(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    purpose = models.CharField(max_length=40)
    token_hash = models.CharField(max_length=128)
    expires_at = models.DateTimeField()
    consumed_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "one_time_tokens"
        unique_together = [("purpose", "token_hash")]


class SecurityAudit(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    user = models.ForeignKey(
        User, on_delete=models.SET_NULL, db_column="user_id", null=True, blank=True
    )
    action = models.CharField(max_length=120)
    outcome = models.CharField(max_length=20)
    ip_address = models.CharField(max_length=64, null=True, blank=True)
    user_agent = models.TextField(blank=True, default="")
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "security_audit"


class Project(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    organization = models.ForeignKey(
        Organization, on_delete=models.SET_NULL, db_column="organization_id", null=True, blank=True
    )
    workspace = models.ForeignKey(
        Workspace, on_delete=models.SET_NULL, db_column="workspace_id", null=True, blank=True
    )
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    goal = models.TextField(blank=True, default="")
    start_date = models.DateField()
    target_date = models.DateField(null=True, blank=True)
    status = models.CharField(max_length=40, default="active")
    constraints_json = models.JSONField(default=dict)
    current_plan_version = models.IntegerField(default=1)
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "projects"
        ordering = ["-updated_at", "-created_at"]

    def __str__(self) -> str:
        return self.name


class ProjectMember(models.Model):
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, db_column="project_id"
    )
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")
    role = models.CharField(max_length=20, default="member")

    class Meta:
        db_table = "project_members"
        unique_together = [("project", "user")]


class PlanVersion(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    version_number = models.IntegerField()
    parent_version = models.CharField(
        max_length=64, null=True, blank=True, db_column="parent_version_id"
    )
    snapshot_json = models.JSONField(default=dict)
    change_summary = models.TextField(blank=True, default="")
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "plan_versions"
        unique_together = [("project", "version_number")]
        ordering = ["-version_number"]


class Requirement(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True, default="")
    acceptance_criteria = models.JSONField(default=list)
    source = models.CharField(max_length=40, default="generated")
    status = models.CharField(max_length=40, default="confirmed")
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "requirements"
        ordering = ["created_at", "title"]


class Milestone(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    target_date = models.DateField(null=True, blank=True)
    release_gate = models.BooleanField(default=False)
    status = models.CharField(max_length=40, default="planned")
    position = models.IntegerField(default=0)

    class Meta:
        db_table = "milestones"
        ordering = ["position", "target_date", "title"]


class Task(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    requirement = models.ForeignKey(
        Requirement, on_delete=models.SET_NULL, db_column="requirement_id", null=True, blank=True
    )
    milestone = models.ForeignKey(
        Milestone, on_delete=models.SET_NULL, db_column="milestone_id", null=True, blank=True
    )
    title = models.CharField(max_length=240)
    description = models.TextField(blank=True, default="")
    status = models.CharField(max_length=40, default="planned")
    estimate_days = models.DecimalField(max_digits=6, decimal_places=1)
    priority = models.CharField(max_length=4, default="P2")
    owner_role = models.CharField(max_length=120, default="Engineering")
    assignee = models.ForeignKey(
        User, on_delete=models.SET_NULL, db_column="assignee_id", null=True, blank=True
    )
    team = models.ForeignKey(
        "Team", on_delete=models.SET_NULL, db_column="team_id", null=True, blank=True
    )
    labels_json = models.JSONField(default=list)
    planned_start = models.DateField(null=True, blank=True)
    planned_finish = models.DateField(null=True, blank=True)
    source_ticket_id = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "tasks"


class TaskDependency(models.Model):
    predecessor = models.ForeignKey(
        Task, on_delete=models.CASCADE, related_name="successor_links", db_column="predecessor_task_id"
    )
    successor = models.ForeignKey(
        Task, on_delete=models.CASCADE, related_name="predecessor_links", db_column="successor_task_id"
    )
    dependency_type = models.CharField(max_length=40, default="finishes_to_start")

    class Meta:
        db_table = "task_dependencies"
        unique_together = [("predecessor", "successor")]


class Ticket(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    title = models.CharField(max_length=300)
    description = models.TextField(blank=True, default="")
    source = models.CharField(max_length=80, default="manual")
    ticket_type = models.CharField(max_length=40, null=True, blank=True)
    affected_component = models.TextField(blank=True, default="")
    reported_impact = models.TextField(blank=True, default="")
    evidence = models.TextField(blank=True, default="")
    reporter = models.TextField(blank=True, default="")
    environment = models.CharField(max_length=160, blank=True, default="")
    severity_reported = models.CharField(max_length=40, default="unspecified")
    status = models.CharField(max_length=40, default="new")
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    analyzed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "tickets"
        ordering = ["-created_at"]


class TicketLink(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, db_column="ticket_id")
    entity_type = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=64)
    relationship_type = models.CharField(max_length=40)
    evidence_state = models.CharField(max_length=20, default="inferred")
    rationale = models.TextField(blank=True, default="")
    confirmed = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "ticket_links"


class DecisionProposal(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, db_column="ticket_id")
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    base_plan_version = models.IntegerField()
    recommendation = models.CharField(max_length=20)
    summary = models.TextField(blank=True, default="")
    classification_json = models.JSONField(default=dict)
    policy_json = models.JSONField(default=dict)
    evidence_json = models.JSONField(default=list)
    unknowns_json = models.JSONField(default=list)
    clarifying_questions_json = models.JSONField(default=list)
    related_records_json = models.JSONField(default=list)
    duplicate_candidates_json = models.JSONField(default=list)
    proposed_changes_json = models.JSONField(default=dict)
    recommendation_rationale = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, default="pending")
    model_provider = models.CharField(max_length=40, default="deterministic-demo")
    model_name = models.CharField(max_length=120, blank=True, default="")
    model_meta_json = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "decision_proposals"
        ordering = ["-created_at"]


class ScenarioRun(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    proposal = models.ForeignKey(
        DecisionProposal, on_delete=models.CASCADE, db_column="proposal_id"
    )
    option = models.CharField(max_length=20)
    label = models.CharField(max_length=200, blank=True, default="")
    input_hash = models.CharField(max_length=64)
    output_json = models.JSONField(default=dict)
    valid = models.BooleanField(default=False)
    validation_errors_json = models.JSONField(default=list)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "scenario_runs"
        ordering = ["created_at"]


class DecisionAudit(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    decision = models.ForeignKey(
        DecisionProposal, on_delete=models.CASCADE, db_column="decision_id"
    )
    actor = models.ForeignKey(
        User, on_delete=models.SET_NULL, db_column="actor_id", null=True, blank=True
    )
    action = models.CharField(max_length=80)
    reason = models.TextField(blank=True, default="")
    before_json = models.JSONField(null=True, blank=True)
    after_json = models.JSONField(null=True, blank=True)
    timestamp = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "decision_audit"
        ordering = ["timestamp"]


class AuditEvent(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(Project, on_delete=models.CASCADE, db_column="project_id")
    actor = models.ForeignKey(
        User, on_delete=models.SET_NULL, db_column="actor_id", null=True, blank=True
    )
    action = models.CharField(max_length=80)
    entity_type = models.CharField(max_length=40)
    entity_id = models.CharField(max_length=64)
    before_json = models.JSONField(null=True, blank=True)
    after_json = models.JSONField(null=True, blank=True)
    summary = models.TextField(blank=True, default="")
    timestamp = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "audit_events"
        ordering = ["-timestamp"]


class AiCall(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    project = models.ForeignKey(
        Project, on_delete=models.SET_NULL, db_column="project_id", null=True, blank=True
    )
    organization_id = models.CharField(max_length=64, null=True, blank=True)
    workspace_id = models.CharField(max_length=64, null=True, blank=True)
    workflow = models.CharField(max_length=40)
    provider = models.CharField(max_length=40)
    model = models.CharField(max_length=120, blank=True, default="")
    duration_ms = models.IntegerField(default=0)
    success = models.BooleanField(default=False)
    degraded = models.BooleanField(default=False)
    error = models.TextField(null=True, blank=True)
    usage_json = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "ai_calls"
        ordering = ["-created_at"]


class Team(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column="workspace_id")
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    lead = models.ForeignKey(
        User, on_delete=models.SET_NULL, db_column="lead_id", null=True, blank=True
    )
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "teams"
        ordering = ["name"]


class TeamMember(models.Model):
    team = models.ForeignKey(Team, on_delete=models.CASCADE, db_column="team_id")
    user = models.ForeignKey(User, on_delete=models.CASCADE, db_column="user_id")

    class Meta:
        db_table = "team_members"
        unique_together = [("team", "user")]


class Document(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column="workspace_id")
    project = models.ForeignKey(
        Project, on_delete=models.CASCADE, db_column="project_id", null=True, blank=True
    )
    title = models.CharField(max_length=240)
    doc_type = models.CharField(max_length=20, default="markdown")
    content = models.TextField(blank=True, default="")
    status = models.CharField(max_length=40, default="draft")
    created_by = models.CharField(max_length=64, null=True, blank=True)
    updated_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "documents"
        ordering = ["-updated_at"]


class Meeting(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column="workspace_id")
    project = models.ForeignKey(
        Project, on_delete=models.SET_NULL, db_column="project_id", null=True, blank=True
    )
    title = models.CharField(max_length=240)
    agenda = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    scheduled_at = models.DateTimeField(null=True, blank=True)
    duration_minutes = models.IntegerField(default=30)
    status = models.CharField(max_length=20, default="scheduled")
    summary = models.TextField(blank=True, default="")
    action_items_json = models.JSONField(default=list)
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "meetings"
        ordering = ["-scheduled_at", "-created_at"]


class ForumThread(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, db_column="workspace_id")
    project = models.ForeignKey(
        Project, on_delete=models.SET_NULL, db_column="project_id", null=True, blank=True
    )
    title = models.CharField(max_length=300)
    body = models.TextField(blank=True, default="")
    category = models.CharField(max_length=60, default="general")
    solved = models.BooleanField(default=False)
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)
    updated_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "forum_threads"
        ordering = ["solved", "-updated_at"]


class ForumReply(models.Model):
    id = models.CharField(primary_key=True, max_length=64)
    thread = models.ForeignKey(ForumThread, on_delete=models.CASCADE, db_column="thread_id")
    body = models.TextField()
    created_by = models.CharField(max_length=64, null=True, blank=True)
    created_at = models.DateTimeField(default=dj_timezone.now)

    class Meta:
        db_table = "forum_replies"
        ordering = ["created_at"]
