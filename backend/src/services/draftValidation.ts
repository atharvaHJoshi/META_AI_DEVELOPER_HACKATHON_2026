import type { GeneratePlanInput, PlanDraft } from "@miraiwerk/schemas";
import {
  buildProjectGraphFromDraft,
  validatePlanDraft as validateDraftGraph,
} from "./planService.js";

export { buildProjectGraphFromDraft };

export interface DraftValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  cycles: string[][];
}

export function validatePlanDraft(draft: PlanDraft): DraftValidationResult {
  return validateDraftGraph(draft);
}

export function normaliseDraft(input: GeneratePlanInput, draft: PlanDraft): PlanDraft {
  return {
    ...draft,
    name: draft.name || input.name,
    goal: draft.goal || input.goal,
    startDate: input.startDate,
    targetDate: input.targetDate ?? null,
  };
}
