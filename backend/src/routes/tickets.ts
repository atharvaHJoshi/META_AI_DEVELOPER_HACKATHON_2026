import { Router } from "express";
import { CreateTicketInputSchema } from "@miraiwerk/schemas";
import { requireUser } from "../auth.js";
import { asyncHandler } from "../lib/http.js";
import {
  analyzeTicket,
  createTicket,
  getTicketDetail,
} from "../services/ticketService.js";

export const ticketsRouter = Router();

ticketsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    const input = CreateTicketInputSchema.parse(req.body);
    res.status(201).json(await createTicket(user.id, input));
  }),
);

ticketsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await getTicketDetail(user.id, req.params.id as string));
  }),
);

ticketsRouter.post(
  "/:id/analyze",
  asyncHandler(async (req, res) => {
    const user = requireUser(req);
    res.json(await analyzeTicket(user.id, req.params.id as string));
  }),
);
