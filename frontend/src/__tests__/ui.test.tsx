import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Modal, Button } from "../components/ui";

describe("accessible Modal primitive", () => {
  it("opens content, supports Escape to cancel, and focuses the close action", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { getByRole, getByText } = render(
      <Modal open onOpenChange={onOpenChange} title="Delete document" description="This removes the document.">
        <p>Choose a document to remove.</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => onOpenChange(false)}>Delete document</Button>
        </div>
      </Modal>,
    );

    expect(getByRole("dialog")).toHaveAccessibleName("Delete document");
    const close = getByRole("button", { name: "Close dialog" });
    expect(close).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders a labelled body and keeps actions inside the dialog", () => {
    render(
      <Modal open onOpenChange={() => undefined} title="Schedule meeting" description="Capture the agenda.">
        <p>Schedule the next release readiness review.</p>
        <Button variant="secondary">Close</Button>
      </Modal>,
    );

    expect(screen.getByRole("dialog")).toHaveAccessibleName("Schedule meeting");
    expect(screen.getByText("Capture the agenda.")).toBeInTheDocument();
    expect(screen.getByText("Schedule the next release readiness review.")).toBeInTheDocument();
  });
});
