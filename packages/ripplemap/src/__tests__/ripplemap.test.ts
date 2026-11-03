import { describe, expect, it } from "vitest";
import {
  addWorkingDays,
  formatIsoDate,
  parseIsoDate,
  validateGraph,
} from "../index.js";
import type { ProjectGraph, ProposedChange } from "@miraiwerk/schemas";
import { simulateScenario } from "../index.js";

const graph: ProjectGraph = {
  projectId: "p1",
  startDate: "2026-10-26", // Monday
  targetDate: "2026-11-20",
  tasks: [
    {
      id: "t1",
      title: "Foundation",
      description: "",
      requirementId: null,
      milestoneId: "m1",
      estimateDays: 2,
      priority: "P2",
      status: "planned",
      ownerRole: "Engineering",
      plannedStart: null,
      plannedFinish: null,
      sourceTicketId: null,
    },
    {
      id: "t2",
      title: "Payment API",
      description: "",
      requirementId: null,
      milestoneId: "m1",
      estimateDays: 3,
      priority: "P1",
      status: "planned",
      ownerRole: "Engineering",
      plannedStart: null,
      plannedFinish: null,
      sourceTicketId: null,
    },
    {
      id: "t3",
      title: "Checkout UI",
      description: "",
      requirementId: null,
      milestoneId: "m1",
      estimateDays: 2,
      priority: "P2",
      status: "planned",
      ownerRole: "Engineering",
      plannedStart: null,
      plannedFinish: null,
      sourceTicketId: null,
    },
  ],
  milestones: [
    { id: "m1", title: "Payments ready", targetDate: "2026-11-06", releaseGate: true },
  ],
  dependencies: [{ predecessorId: "t1", successorId: "t2", dependencyType: "finishes_to_start" }],
  constraints: { capacityPersonDays: 20 },
};

const acceptChange: ProposedChange = {
  option: "accept",
  tasksToAdd: [
    {
      tempId: "new-1",
      title: "Idempotency fix",
      description: "",
      requirementId: null,
      milestoneId: "m1",
      estimateDays: 3,
      priority: "P0",
      ownerRole: "Engineering",
      dependencies: ["t2"],
    },
    {
      tempId: "new-2",
      title: "Duplicate charge regression test",
      description: "",
      requirementId: null,
      milestoneId: "m1",
      estimateDays: 1,
      priority: "P0",
      ownerRole: "QA",
      dependencies: ["new-1"],
    },
  ],
  tasksToUpdate: [{ taskId: "t2", estimateDays: 4 }],
  tasksToRemove: [],
  dependenciesToAdd: [{ predecessorId: "new-2", successorId: "t3", dependencyType: "finishes_to_start" }],
  assumptions: ["The retry path can be reproduced in staging."],
  rationale: "Protect the release gate.",
};

describe("working-day helpers", () => {
  it("skips weekends", () => {
    const friday = parseIsoDate("2026-10-30");
    expect(formatIsoDate(addWorkingDays(friday, 1))).toBe("2026-11-02");
    expect(formatIsoDate(addWorkingDays(friday, 3))).toBe("2026-11-04");
  });
});

describe("graph validation", () => {
  it("rejects dependency cycles with the cycle path", () => {
    const cyclic: ProjectGraph = {
      ...graph,
      dependencies: [
        { predecessorId: "t1", successorId: "t2", dependencyType: "finishes_to_start" },
        { predecessorId: "t2", successorId: "t3", dependencyType: "finishes_to_start" },
        { predecessorId: "t3", successorId: "t1", dependencyType: "finishes_to_start" },
      ],
    };
    const result = validateGraph(cyclic);
    expect(result.valid).toBe(false);
    expect(result.cycles[0]).toEqual(["t1", "t2", "t3", "t1"]);
  });

  it("rejects dangling dependency endpoints", () => {
    const result = validateGraph({
      ...graph,
      dependencies: [{ predecessorId: "ghost", successorId: "t2", dependencyType: "finishes_to_start" }],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("does not exist");
  });
});

describe("RippleMap simulation", () => {
  it("computes the before/after schedule and milestone delta deterministically", () => {
    const result = simulateScenario(graph, {
      change: acceptChange,
      relatedTaskIds: ["t2"],
      ticketId: "ticket-1",
    });
    expect(result.valid).toBe(true);
    expect(result.diff.addedTasks).toHaveLength(2);
    expect(result.diff.changedTasks.map((task) => task.taskId)).toEqual(
      expect.arrayContaining(["t2", "t3"]),
    );
    expect(result.diff.addedDependencies.length).toBeGreaterThanOrEqual(3);
    expect(result.metrics.scheduleDeltaDays).toBeGreaterThan(0);
    expect(result.diff.targetMilestoneId).toBe("m1");
    expect(result.affectedTaskIds).toContain("t3");
    expect(result.inputHash).toHaveLength(16);

    const repeat = simulateScenario(graph, {
      change: acceptChange,
      relatedTaskIds: ["t2"],
      ticketId: "ticket-1",
    });
    expect(repeat.inputHash).toBe(result.inputHash);
    expect(repeat.diff.milestoneDeltas).toEqual(result.diff.milestoneDeltas);
  });

  it("returns an invalid scenario for a dependency cycle", () => {
    const cyclicChange: ProposedChange = {
      ...acceptChange,
      dependenciesToAdd: [{ predecessorId: "new-2", successorId: "t1", dependencyType: "finishes_to_start" }],
    };
    const result = simulateScenario(graph, { change: cyclicChange });
    expect(result.valid).toBe(false);
    expect(result.validationErrors.join(" ")).toMatch(/cycle/i);
    expect(result.metrics.tasksAdded).toBe(0);
  });

  it("leaves the plan unchanged for defer", () => {
    const result = simulateScenario(graph, {
      change: {
        option: "defer",
        tasksToAdd: [],
        tasksToUpdate: [],
        tasksToRemove: [],
        dependenciesToAdd: [],
        assumptions: [],
        rationale: "No capacity this sprint.",
      },
      relatedTaskIds: ["t2"],
    });
    expect(result.valid).toBe(true);
    expect(result.metrics.tasksAdded).toBe(0);
    expect(result.metrics.scheduleDeltaDays).toBe(0);
    expect(result.policyFindings.some((finding) => finding.code === "UNRESOLVED_DEFERRAL_RISK")).toBe(true);
  });
});
