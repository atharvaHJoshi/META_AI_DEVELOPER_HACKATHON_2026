"""Decision queue: list, detail, simulate, approve, reject, clarify."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Request

from api.deps import current_user, require_workspace_id, workspace_id
from api.schemas import (
    ApproveDecisionInput,
    ClarifyDecisionInput,
    RejectDecisionInput,
    SimulationRequestInput,
)
from core.errors import ApiError
from services import decision_service, simulation_service, ticket_service

router = APIRouter(prefix="/decisions", tags=["decisions"])


@router.get("")
def list_decisions(
    request: Request,
    status: str = Query(default="pending"),
    user: dict = Depends(current_user),
):
    workspace = workspace_id(request)
    if not workspace:
        raise ApiError(400, "WORKSPACE_REQUIRED", "Select a workspace first.")
    normalized = "all" if status == "all" else "pending"
    return {"decisions": decision_service.list_decision_queue(user["id"], workspace, normalized)}


@router.get("/{decision_id}")
def get_decision(decision_id: str, user: dict = Depends(current_user)):
    return ticket_service.get_decision_proposal(user["id"], decision_id)


@router.post("/{decision_id}/simulate")
def simulate(
    decision_id: str,
    payload: SimulationRequestInput,
    user: dict = Depends(current_user),
):
    return simulation_service.simulate_decision(
        user["id"], decision_id, payload.option, payload.baselineVersion
    )


@router.post("/{decision_id}/approve")
def approve(
    decision_id: str,
    payload: ApproveDecisionInput,
    user: dict = Depends(current_user),
):
    return decision_service.approve_decision(
        user["id"], decision_id, payload.option, payload.reason
    )


@router.post("/{decision_id}/reject")
def reject(
    decision_id: str,
    payload: RejectDecisionInput,
    user: dict = Depends(current_user),
):
    return decision_service.reject_decision(user["id"], decision_id, payload.reason)


@router.post("/{decision_id}/clarify")
def clarify(
    decision_id: str,
    payload: ClarifyDecisionInput,
    user: dict = Depends(current_user),
):
    return decision_service.clarify_decision(
        user["id"], decision_id, payload.model_dump()
    )
