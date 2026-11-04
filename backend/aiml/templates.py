"""Deterministic demo plan generation (no model output claimed)."""

from __future__ import annotations

import re
from typing import Any

from ripplemap.dates import add_working_days, format_iso_date, parse_iso_date

_COMMERCE_RE = re.compile(
    r"(e-?commerce|commerce|shop|store|checkout|payment|cart|order|customer)",
    re.IGNORECASE,
)


def _date_plus(start_date: str, working_days: int) -> str:
    return format_iso_date(add_working_days(parse_iso_date(start_date), max(1, working_days)))


def is_commerce_brief(input_data: dict) -> bool:
    return bool(
        _COMMERCE_RE.search(
            f"{input_data['name']} {input_data['goal']} {input_data['description']}"
        )
    )


def commerce_plan(input_data: dict) -> dict[str, Any]:
    start_date = input_data["startDate"]
    foundation_target = _date_plus(start_date, 10)
    payments_target = _date_plus(start_date, 24)
    target_date = input_data.get("targetDate")
    launch_target = target_date if target_date else _date_plus(start_date, 38)

    return {
        "name": input_data["name"],
        "goal": input_data["goal"],
        "description": input_data["description"],
        "startDate": input_data["startDate"],
        "targetDate": input_data.get("targetDate"),
        "requirements": [
            {
                "tempId": "req-auth",
                "title": "Customer authentication",
                "description": "Customers can create an account, sign in securely and maintain a session across the purchase journey.",
                "acceptanceCriteria": [
                    "A customer can sign up and sign in with a verified email.",
                    "Sessions expire safely and can be revoked.",
                    "Protected checkout routes reject unauthenticated requests.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-search",
                "title": "Product discovery and search",
                "description": "Customers can browse the catalog and find products through search, filters and category navigation.",
                "acceptanceCriteria": [
                    "Search returns relevant products for title and category queries.",
                    "Filters can be combined without breaking result counts.",
                    "An empty or failed search state is recoverable.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-checkout",
                "title": "Checkout and cart",
                "description": "Customers can build a cart, review totals and complete checkout with clear failure states.",
                "acceptanceCriteria": [
                    "Cart totals are recomputed server-side before payment.",
                    "A declined payment shows a recoverable error without losing the cart.",
                    "Checkout cannot be submitted twice from one session.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-payments",
                "title": "Payment processing and retry safety",
                "description": "Payment intents are created, confirmed and retried without duplicate captures. Payment events are observable.",
                "acceptanceCriteria": [
                    "A retried confirmation produces at most one capture per idempotency key.",
                    "Payment state is reconciled against the processor webhook.",
                    "Failed payments expose a safe retry path.",
                    "Duplicate-charge signals are visible in production telemetry.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-orders",
                "title": "Order lifecycle and tracking",
                "description": "Paid orders create an order record, move through fulfilment states and expose tracking to the customer.",
                "acceptanceCriteria": [
                    "A successful payment creates exactly one order.",
                    "Order state changes are idempotent.",
                    "Customers can see the current fulfilment state.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-observability",
                "title": "Release observability and rollback",
                "description": "The team can observe payment health, trace failures and roll back a release safely.",
                "acceptanceCriteria": [
                    "Payment success, retry and failure rates are dashboarded.",
                    "Alerts fire for duplicate captures and elevated payment errors.",
                    "A release can be rolled back without losing order state.",
                ],
                "source": "inferred",
                "status": "proposed",
            },
        ],
        "milestones": [
            {
                "tempId": "ms-foundation",
                "title": "Foundation usable",
                "description": "Identity, catalog and the first end-to-end checkout path are in place.",
                "targetDate": foundation_target,
                "releaseGate": False,
            },
            {
                "tempId": "ms-payments",
                "title": "Payments release gate",
                "description": "Payment correctness, retry safety and acceptance tests must pass before launch work proceeds.",
                "targetDate": payments_target,
                "releaseGate": True,
            },
            {
                "tempId": "ms-launch",
                "title": "Production launch",
                "description": "Order tracking, load validation and rollback readiness are complete.",
                "targetDate": launch_target,
                "releaseGate": True,
            },
        ],
        "tasks": [
            {
                "tempId": "task-domain-schema",
                "title": "Domain schema and migrations",
                "description": "Define customer, catalog, cart, payment and order entities.",
                "requirementTempId": "req-auth",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "Engineering",
                "dependencies": [],
            },
            {
                "tempId": "task-auth-api",
                "title": "Authentication API",
                "description": "Sign-up, sign-in, session verification and revocation.",
                "requirementTempId": "req-auth",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 4,
                "priority": "P1",
                "ownerRole": "Backend",
                "dependencies": ["task-domain-schema"],
            },
            {
                "tempId": "task-auth-ui",
                "title": "Sign-in and account UI",
                "description": "Customer-facing authentication states and error handling.",
                "requirementTempId": "req-auth",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Frontend",
                "dependencies": ["task-auth-api"],
            },
            {
                "tempId": "task-foundation-tests",
                "title": "Foundation acceptance tests",
                "description": "Cover authentication and protected-route behaviour.",
                "requirementTempId": "req-auth",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 2,
                "priority": "P2",
                "ownerRole": "QA",
                "dependencies": ["task-auth-ui"],
            },
            {
                "tempId": "task-catalog",
                "title": "Catalog model and seed data",
                "description": "Product, variant, inventory and category records.",
                "requirementTempId": "req-search",
                "milestoneTempId": "ms-payments",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Backend",
                "dependencies": ["task-domain-schema"],
            },
            {
                "tempId": "task-search",
                "title": "Search and filter API",
                "description": "Query, category, price and availability filtering.",
                "requirementTempId": "req-search",
                "milestoneTempId": "ms-payments",
                "estimateDays": 4,
                "priority": "P2",
                "ownerRole": "Backend",
                "dependencies": ["task-catalog"],
            },
            {
                "tempId": "task-search-ui",
                "title": "Search results interface",
                "description": "Results, empty states, filters and pagination.",
                "requirementTempId": "req-search",
                "milestoneTempId": "ms-payments",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Frontend",
                "dependencies": ["task-search"],
            },
            {
                "tempId": "task-cart",
                "title": "Cart and checkout flow",
                "description": "Server-calculated totals, review step and checkout submit guard.",
                "requirementTempId": "req-checkout",
                "milestoneTempId": "ms-payments",
                "estimateDays": 4,
                "priority": "P1",
                "ownerRole": "Full-stack",
                "dependencies": ["task-auth-api", "task-search"],
            },
            {
                "tempId": "task-payment-intent",
                "title": "Payment intent creation",
                "description": "Create processor intents from server-validated cart totals.",
                "requirementTempId": "req-payments",
                "milestoneTempId": "ms-payments",
                "estimateDays": 4,
                "priority": "P0",
                "ownerRole": "Backend",
                "dependencies": ["task-cart"],
            },
            {
                "tempId": "task-payment-idempotency",
                "title": "Retry and idempotency guard",
                "description": "Persist idempotency keys and reconcile confirmation retries against the processor.",
                "requirementTempId": "req-payments",
                "milestoneTempId": "ms-payments",
                "estimateDays": 3,
                "priority": "P0",
                "ownerRole": "Backend",
                "dependencies": ["task-payment-intent"],
            },
            {
                "tempId": "task-payment-tests",
                "title": "Payment acceptance and regression gate",
                "description": "Duplicate capture, retry, decline and webhook reconciliation tests. This is the release gate.",
                "requirementTempId": "req-payments",
                "milestoneTempId": "ms-payments",
                "estimateDays": 2,
                "priority": "P0",
                "ownerRole": "QA",
                "dependencies": ["task-payment-idempotency"],
            },
            {
                "tempId": "task-observability",
                "title": "Payment telemetry and alerts",
                "description": "Payment health dashboard, duplicate-capture alert and trace correlation.",
                "requirementTempId": "req-observability",
                "milestoneTempId": "ms-payments",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "DevOps",
                "dependencies": ["task-payment-tests"],
            },
            {
                "tempId": "task-refunds",
                "title": "Refund and reconciliation handling",
                "description": "Refund requests, partial captures and daily reconciliation report.",
                "requirementTempId": "req-payments",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Backend",
                "dependencies": ["task-payment-idempotency"],
            },
            {
                "tempId": "task-order-model",
                "title": "Order lifecycle model",
                "description": "Create exactly one order per successful payment and model state transitions.",
                "requirementTempId": "req-orders",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "Backend",
                "dependencies": ["task-payment-tests"],
            },
            {
                "tempId": "task-order-tracking",
                "title": "Order tracking UI",
                "description": "Customer-visible fulfilment state and recovery for missing orders.",
                "requirementTempId": "req-orders",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Frontend",
                "dependencies": ["task-order-model"],
            },
            {
                "tempId": "task-load-test",
                "title": "Load and failover validation",
                "description": "Checkout load test, processor outage drill and rollback rehearsal.",
                "requirementTempId": "req-observability",
                "milestoneTempId": "ms-launch",
                "estimateDays": 2,
                "priority": "P1",
                "ownerRole": "QA",
                "dependencies": ["task-order-tracking", "task-observability"],
            },
            {
                "tempId": "task-release-runbook",
                "title": "Release hardening and runbook",
                "description": "Launch checklist, rollback owner and on-call escalation path.",
                "requirementTempId": "req-observability",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "DevOps",
                "dependencies": ["task-load-test", "task-refunds"],
            },
        ],
        "assumptions": [
            "The brief describes a customer-facing commerce platform; supporting scope such as fraud review and tax calculation is not included.",
            "Effort estimates are planning estimates in working days, not delivery commitments.",
            "Milestone target dates shown here are planning estimates derived from the brief and start date unless the user supplied a target date.",
            "The plan assumes a cross-functional team is available; no named capacity or staffing level was invented.",
            "Payment processing is integrated through a third-party processor and is exercised in a sandbox before production.",
        ],
        "missingInformation": [
            "Committed launch deadline and any regulatory constraints.",
            "Actual team capacity and named owners.",
            "Payment processor, tax provider and fraud tooling choices.",
            "Expected launch traffic and availability target.",
            "Refund, chargeback and customer-support policy.",
        ],
        "risks": [
            {
                "title": "Duplicate payment capture under retry",
                "severity": "high",
                "mitigation": "Treat idempotency and reconciliation as a release gate with explicit regression tests.",
            },
            {
                "title": "Checkout depends on a third-party processor",
                "severity": "medium",
                "mitigation": "Add sandbox integration early and rehearse processor outage behaviour.",
            },
            {
                "title": "Capacity is not confirmed",
                "severity": "high",
                "mitigation": "Confirm staffing before treating the dependency-based schedule as a delivery commitment.",
            },
        ],
    }


def generic_plan(input_data: dict) -> dict[str, Any]:
    start_date = input_data["startDate"]
    foundation_target = _date_plus(start_date, 10)
    beta_target = _date_plus(start_date, 24)
    target_date = input_data.get("targetDate")
    launch_target = target_date if target_date else _date_plus(start_date, 36)
    subject = re.sub(r"^build\s+", "", input_data["name"], flags=re.IGNORECASE).rstrip(".")

    return {
        "name": input_data["name"],
        "goal": input_data["goal"],
        "description": input_data["description"],
        "startDate": input_data["startDate"],
        "targetDate": input_data.get("targetDate"),
        "requirements": [
            {
                "tempId": "req-core",
                "title": f"Core {subject} capability",
                "description": f"Deliver the primary capability described in the brief: {input_data['goal']}",
                "acceptanceCriteria": [
                    "The primary happy path works end to end for a real user.",
                    "Invalid input produces a clear, recoverable error.",
                    "The capability is covered by automated tests.",
                ],
                "source": "explicit",
                "status": "proposed",
            },
            {
                "tempId": "req-data",
                "title": "Data and integration layer",
                "description": "Persist the required state and connect external or downstream systems safely.",
                "acceptanceCriteria": [
                    "Data survives a service restart.",
                    "External calls have timeouts and bounded retries.",
                    "Failures do not leave partial state behind.",
                ],
                "source": "inferred",
                "status": "proposed",
            },
            {
                "tempId": "req-quality",
                "title": "Security, quality and operability",
                "description": "The release has a test strategy, access controls, telemetry and a rollback path.",
                "acceptanceCriteria": [
                    "Critical flows have automated regression coverage.",
                    "Access is checked on every mutation endpoint.",
                    "Operational alerts and a rollback procedure exist.",
                ],
                "source": "inferred",
                "status": "proposed",
            },
            {
                "tempId": "req-launch",
                "title": "Launch readiness",
                "description": "The team can deploy, verify and support the release without hidden dependencies.",
                "acceptanceCriteria": [
                    "A release checklist is completed.",
                    "A named owner can roll back the deployment.",
                    "Known limitations are documented for users and support.",
                ],
                "source": "inferred",
                "status": "proposed",
            },
        ],
        "milestones": [
            {
                "tempId": "ms-foundation",
                "title": "Foundation",
                "description": "Discovery, architecture and the first working vertical slice.",
                "targetDate": foundation_target,
                "releaseGate": False,
            },
            {
                "tempId": "ms-beta",
                "title": "Beta ready",
                "description": "Core capability and integrations are usable by a pilot group.",
                "targetDate": beta_target,
                "releaseGate": True,
            },
            {
                "tempId": "ms-launch",
                "title": "Launch",
                "description": "Quality, security and launch readiness are complete.",
                "targetDate": launch_target,
                "releaseGate": True,
            },
        ],
        "tasks": [
            {
                "tempId": "task-discovery",
                "title": "Scope and success criteria workshop",
                "description": "Resolve ambiguity in the brief and agree on measurable outcomes.",
                "requirementTempId": "req-core",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "Product",
                "dependencies": [],
            },
            {
                "tempId": "task-architecture",
                "title": "Architecture and delivery slice",
                "description": "Define components, interfaces and a walking skeleton.",
                "requirementTempId": "req-core",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "Engineering",
                "dependencies": ["task-discovery"],
            },
            {
                "tempId": "task-data-model",
                "title": "Data model and migrations",
                "description": "Model the core entities and persistence rules.",
                "requirementTempId": "req-data",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 4,
                "priority": "P1",
                "ownerRole": "Backend",
                "dependencies": ["task-architecture"],
            },
            {
                "tempId": "task-core-build-1",
                "title": "Core capability build",
                "description": "Implement the primary user journey from the brief.",
                "requirementTempId": "req-core",
                "milestoneTempId": "ms-foundation",
                "estimateDays": 6,
                "priority": "P1",
                "ownerRole": "Full-stack",
                "dependencies": ["task-architecture"],
            },
            {
                "tempId": "task-core-build-2",
                "title": "Core workflow completion",
                "description": "Complete the workflow, error states and edge cases.",
                "requirementTempId": "req-core",
                "milestoneTempId": "ms-beta",
                "estimateDays": 6,
                "priority": "P1",
                "ownerRole": "Full-stack",
                "dependencies": ["task-data-model", "task-core-build-1"],
            },
            {
                "tempId": "task-integrations",
                "title": "Integration layer",
                "description": "Connect external systems with timeouts, retries and observability.",
                "requirementTempId": "req-data",
                "milestoneTempId": "ms-beta",
                "estimateDays": 4,
                "priority": "P1",
                "ownerRole": "Backend",
                "dependencies": ["task-core-build-1"],
            },
            {
                "tempId": "task-interface",
                "title": "User interface and states",
                "description": "Ship the usable interface, including empty, loading and error states.",
                "requirementTempId": "req-core",
                "milestoneTempId": "ms-beta",
                "estimateDays": 5,
                "priority": "P2",
                "ownerRole": "Frontend",
                "dependencies": ["task-core-build-2"],
            },
            {
                "tempId": "task-security",
                "title": "Security and permission review",
                "description": "Review authorization, secrets, input validation and abuse paths.",
                "requirementTempId": "req-quality",
                "milestoneTempId": "ms-beta",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "Security",
                "dependencies": ["task-integrations", "task-interface"],
            },
            {
                "tempId": "task-testing",
                "title": "Automated regression suite",
                "description": "Cover the critical workflow and failure paths.",
                "requirementTempId": "req-quality",
                "milestoneTempId": "ms-launch",
                "estimateDays": 4,
                "priority": "P1",
                "ownerRole": "QA",
                "dependencies": ["task-interface", "task-security"],
            },
            {
                "tempId": "task-deploy",
                "title": "Deployment pipeline",
                "description": "Automated deploy, environment configuration and rollback rehearsal.",
                "requirementTempId": "req-quality",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P1",
                "ownerRole": "DevOps",
                "dependencies": ["task-testing"],
            },
            {
                "tempId": "task-uat",
                "title": "Pilot validation",
                "description": "Validate the workflow with representative users and fix blockers.",
                "requirementTempId": "req-launch",
                "milestoneTempId": "ms-launch",
                "estimateDays": 3,
                "priority": "P2",
                "ownerRole": "Product",
                "dependencies": ["task-deploy"],
            },
            {
                "tempId": "task-launch-readiness",
                "title": "Launch checklist and runbook",
                "description": "Confirm owners, known limitations, support path and rollback criteria.",
                "requirementTempId": "req-launch",
                "milestoneTempId": "ms-launch",
                "estimateDays": 2,
                "priority": "P1",
                "ownerRole": "Engineering",
                "dependencies": ["task-uat"],
            },
        ],
        "assumptions": [
            "The brief is the only source of truth; unstated scope is marked as inferred.",
            "Effort estimates are planning estimates in working days, not delivery commitments.",
            "Milestone dates are derived planning estimates; they are not invented team commitments.",
            "The plan assumes a cross-functional team is available but does not assume a specific headcount.",
        ],
        "missingInformation": [
            "Committed deadline and non-negotiable release constraints.",
            "Team capacity, named owners and availability.",
            "Technology constraints and existing system dependencies.",
            "Measurable success metrics for the primary capability.",
            "Security, privacy or regulatory requirements.",
        ],
        "risks": [
            {
                "title": "Unconfirmed scope",
                "severity": "high",
                "mitigation": "Use the discovery task to confirm in-scope behaviour and acceptance criteria before committing dates.",
            },
            {
                "title": "No confirmed capacity",
                "severity": "high",
                "mitigation": "Validate staffing before treating the dependency-based schedule as a delivery promise.",
            },
            {
                "title": "External integration uncertainty",
                "severity": "medium",
                "mitigation": "Prototype integration early and define failure and retry behaviour.",
            },
        ],
    }


def demo_plan(input_data: dict) -> dict[str, Any]:
    if is_commerce_brief(input_data):
        return commerce_plan(input_data)
    return generic_plan(input_data)
