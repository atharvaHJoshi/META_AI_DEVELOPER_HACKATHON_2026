"""Django admin surface for MIRAIWERK operators.

Admin is for support/operations. Product API authorization remains in FastAPI;
this is an internal, staff-only console sharing the same database and password
hashes as the product.
"""

from __future__ import annotations

from django.contrib import admin

from . import models


@admin.register(models.User)
class UserAdmin(admin.ModelAdmin):
    list_display = (
        "email",
        "name",
        "title",
        "status",
        "is_staff",
        "is_platform_admin",
        "last_login_at",
        "created_at",
    )
    list_filter = ("status", "is_staff", "is_platform_admin", "locale")
    search_fields = ("email", "name", "title")
    ordering = ("name",)
    readonly_fields = ("created_at", "updated_at", "last_login_at", "password_hash")
    fieldsets = (
        ("Identity", {"fields": ("id", "name", "email", "title", "status")}),
        (
            "Profile",
            {
                "fields": (
                    "avatar_color",
                    "avatar_url",
                    "locale",
                    "timezone",
                )
            },
        ),
        (
            "Admin access",
            {
                "fields": (
                    "is_staff",
                    "is_platform_admin",
                    "password_hash",
                    "last_login_at",
                    "created_at",
                    "updated_at",
                )
            },
        ),
    )


@admin.register(models.Organization)
class OrganizationAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "created_by", "created_at")
    search_fields = ("name", "slug", "description")
    readonly_fields = ("created_at", "updated_at")


@admin.register(models.OrganizationMember)
class OrganizationMemberAdmin(admin.ModelAdmin):
    list_display = ("organization", "user", "role", "created_at")
    list_filter = ("role",)
    search_fields = ("organization__name", "user__email", "user__name")
    raw_id_fields = ("organization", "user")


@admin.register(models.Workspace)
class WorkspaceAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "organization", "onboarding_stage", "created_at")
    list_filter = ("onboarding_stage",)
    search_fields = ("name", "slug", "description")
    raw_id_fields = ("organization",)
    readonly_fields = ("created_at", "updated_at")


@admin.register(models.WorkspaceMember)
class WorkspaceMemberAdmin(admin.ModelAdmin):
    list_display = ("workspace", "user", "role", "created_at")
    list_filter = ("role",)
    search_fields = ("workspace__name", "user__email", "user__name")
    raw_id_fields = ("workspace", "user")


@admin.register(models.Session)
class SessionAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "family_id", "created_at", "expires_at", "revoked_at")
    list_filter = ("revoked_reason",)
    search_fields = ("id", "user__email", "family_id", "user_agent", "ip_address")
    raw_id_fields = ("user",)
    readonly_fields = ("created_at", "last_used_at", "token_hash")


@admin.register(models.OAuthAccount)
class OAuthAccountAdmin(admin.ModelAdmin):
    list_display = ("provider", "provider_user_id", "email_at_provider", "user", "last_login_at")
    list_filter = ("provider",)
    search_fields = ("provider_user_id", "email_at_provider", "user__email")
    raw_id_fields = ("user",)


@admin.register(models.OneTimeToken)
class OneTimeTokenAdmin(admin.ModelAdmin):
    list_display = ("purpose", "user", "expires_at", "consumed_at", "created_at")
    list_filter = ("purpose",)
    search_fields = ("user__email",)
    raw_id_fields = ("user",)
    readonly_fields = ("token_hash",)


@admin.register(models.SecurityAudit)
class SecurityAuditAdmin(admin.ModelAdmin):
    list_display = ("created_at", "action", "outcome", "user", "ip_address")
    list_filter = ("outcome", "action")
    search_fields = ("action", "user__email", "ip_address")
    raw_id_fields = ("user",)
    readonly_fields = ("created_at", "metadata")
    date_hierarchy = "created_at"


@admin.register(models.Project)
class ProjectAdmin(admin.ModelAdmin):
    list_display = ("name", "status", "workspace", "organization", "current_plan_version", "updated_at")
    list_filter = ("status",)
    search_fields = ("name", "goal", "description", "id")
    raw_id_fields = ("workspace", "organization")
    readonly_fields = ("created_at", "updated_at", "constraints_json")
    date_hierarchy = "updated_at"


@admin.register(models.ProjectMember)
class ProjectMemberAdmin(admin.ModelAdmin):
    list_display = ("project", "user", "role")
    list_filter = ("role",)
    search_fields = ("project__name", "user__email", "user__name")
    raw_id_fields = ("project", "user")


@admin.register(models.PlanVersion)
class PlanVersionAdmin(admin.ModelAdmin):
    list_display = ("project", "version_number", "change_summary", "created_by", "created_at")
    search_fields = ("project__name", "change_summary")
    raw_id_fields = ("project",)
    readonly_fields = ("created_at", "snapshot_json")


@admin.register(models.Requirement)
class RequirementAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "source", "status", "created_at")
    list_filter = ("source", "status")
    search_fields = ("title", "description", "project__name")
    raw_id_fields = ("project",)


@admin.register(models.Milestone)
class MilestoneAdmin(admin.ModelAdmin):
    list_display = ("title", "project", "target_date", "release_gate", "status", "position")
    list_filter = ("status", "release_gate")
    search_fields = ("title", "description", "project__name")
    raw_id_fields = ("project",)


@admin.register(models.Task)
class TaskAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "project",
        "status",
        "priority",
        "estimate_days",
        "assignee",
        "planned_start",
        "planned_finish",
    )
    list_filter = ("status", "priority", "owner_role")
    search_fields = ("title", "description", "project__name")
    raw_id_fields = ("project", "requirement", "milestone", "assignee", "team")
    readonly_fields = ("created_at", "updated_at", "labels_json")


@admin.register(models.TaskDependency)
class TaskDependencyAdmin(admin.ModelAdmin):
    list_display = ("predecessor", "successor", "dependency_type")
    list_filter = ("dependency_type",)
    search_fields = ("predecessor__title", "successor__title")
    raw_id_fields = ("predecessor", "successor")


@admin.register(models.Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = (
        "title",
        "project",
        "source",
        "ticket_type",
        "severity_reported",
        "status",
        "created_at",
    )
    list_filter = ("source", "ticket_type", "severity_reported", "status")
    search_fields = ("title", "description", "project__name", "affected_component")
    raw_id_fields = ("project",)
    readonly_fields = ("created_at", "analyzed_at")
    date_hierarchy = "created_at"


@admin.register(models.TicketLink)
class TicketLinkAdmin(admin.ModelAdmin):
    list_display = ("ticket", "entity_type", "entity_id", "relationship_type", "evidence_state", "confirmed")
    list_filter = ("entity_type", "relationship_type", "evidence_state", "confirmed")
    search_fields = ("ticket__title", "entity_id", "rationale")
    raw_id_fields = ("ticket",)


@admin.register(models.DecisionProposal)
class DecisionProposalAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "project",
        "ticket",
        "recommendation",
        "status",
        "base_plan_version",
        "model_provider",
        "created_at",
    )
    list_filter = ("status", "recommendation", "model_provider")
    search_fields = ("summary", "ticket__title", "project__name", "id")
    raw_id_fields = ("ticket", "project")
    readonly_fields = ("created_at", "classification_json", "policy_json", "evidence_json")
    date_hierarchy = "created_at"


@admin.register(models.ScenarioRun)
class ScenarioRunAdmin(admin.ModelAdmin):
    list_display = ("proposal", "option", "label", "valid", "created_at")
    list_filter = ("option", "valid")
    search_fields = ("proposal__id", "label", "input_hash")
    raw_id_fields = ("proposal",)
    readonly_fields = ("created_at", "output_json", "validation_errors_json")


@admin.register(models.DecisionAudit)
class DecisionAuditAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "decision", "action", "actor")
    list_filter = ("action",)
    search_fields = ("decision__id", "reason", "actor__email", "action")
    raw_id_fields = ("decision", "actor")
    readonly_fields = ("timestamp", "before_json", "after_json")
    date_hierarchy = "timestamp"


@admin.register(models.AuditEvent)
class AuditEventAdmin(admin.ModelAdmin):
    list_display = ("timestamp", "project", "action", "entity_type", "entity_id", "actor")
    list_filter = ("action", "entity_type")
    search_fields = ("project__name", "entity_id", "summary", "action")
    raw_id_fields = ("project", "actor")
    readonly_fields = ("timestamp", "before_json", "after_json")
    date_hierarchy = "timestamp"


@admin.register(models.AiCall)
class AiCallAdmin(admin.ModelAdmin):
    list_display = ("created_at", "workflow", "provider", "model", "success", "degraded", "duration_ms")
    list_filter = ("workflow", "provider", "success", "degraded")
    search_fields = ("model", "error")
    raw_id_fields = ("project",)
    readonly_fields = ("created_at", "usage_json")
    date_hierarchy = "created_at"


@admin.register(models.Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("name", "workspace", "lead", "created_at")
    search_fields = ("name", "description", "workspace__name")
    raw_id_fields = ("workspace", "lead")


@admin.register(models.TeamMember)
class TeamMemberAdmin(admin.ModelAdmin):
    list_display = ("team", "user")
    search_fields = ("team__name", "user__email", "user__name")
    raw_id_fields = ("team", "user")


@admin.register(models.Document)
class DocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "project", "doc_type", "status", "updated_at")
    list_filter = ("doc_type", "status")
    search_fields = ("title", "content", "workspace__name")
    raw_id_fields = ("workspace", "project")
    readonly_fields = ("created_at", "updated_at")


@admin.register(models.Meeting)
class MeetingAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "status", "scheduled_at", "duration_minutes", "updated_at")
    list_filter = ("status",)
    search_fields = ("title", "agenda", "notes", "workspace__name")
    raw_id_fields = ("workspace", "project")
    readonly_fields = ("created_at", "updated_at", "action_items_json")


@admin.register(models.ForumThread)
class ForumThreadAdmin(admin.ModelAdmin):
    list_display = ("title", "workspace", "category", "solved", "updated_at")
    list_filter = ("category", "solved")
    search_fields = ("title", "body", "workspace__name")
    raw_id_fields = ("workspace", "project")
    readonly_fields = ("created_at", "updated_at")


@admin.register(models.ForumReply)
class ForumReplyAdmin(admin.ModelAdmin):
    list_display = ("thread", "created_by", "created_at")
    search_fields = ("thread__title", "body")
    raw_id_fields = ("thread",)
    readonly_fields = ("created_at",)
