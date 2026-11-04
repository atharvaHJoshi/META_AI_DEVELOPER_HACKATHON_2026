"""Tickets: create, detail, AI-assisted analysis."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import current_user
from api.schemas import CreateTicketInput
from services import ticket_service

router = APIRouter(prefix="/tickets", tags=["tickets"])


@router.post("", status_code=201)
def create_ticket(payload: CreateTicketInput, user: dict = Depends(current_user)):
    return ticket_service.create_ticket(user["id"], payload.model_dump())


@router.get("/{ticket_id}")
def get_ticket(ticket_id: str, user: dict = Depends(current_user)):
    return ticket_service.get_ticket_detail(user["id"], ticket_id)


@router.post("/{ticket_id}/analyze")
def analyze_ticket(ticket_id: str, user: dict = Depends(current_user)):
    return ticket_service.analyze_ticket(user["id"], ticket_id)
