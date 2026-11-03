import { describe, expect, it } from "vitest";
import { hasRole, roleLabel, titleCase } from "../lib/format";

describe("frontend format helpers", () => {
  it("normalises human readable labels", () => {
    expect(titleCase("project_admin")).toBe("Project Admin");
    expect(titleCase("decision_proposal")).toBe("Decision Proposal");
  });

  it("maps workspace and project roles to readable labels", () => {
    expect(roleLabel("owner")).toBe("Owner");
    expect(roleLabel("pm")).toBe("Project manager");
    expect(roleLabel("member")).toBe("Member");
    expect(roleLabel("viewer")).toBe("Viewer");
    expect(roleLabel(null)).toBe("No access");
  });

  it("supports inclusive role checks across project roles", () => {
    expect(hasRole("viewer", "viewer")).toBe(true);
    expect(hasRole("viewer", "member")).toBe(false);
    expect(hasRole("member", "member")).toBe(true);
    expect(hasRole("manager", "pm")).toBe(true);
    expect(hasRole("owner", "owner")).toBe(true);
  });
});
