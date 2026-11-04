import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownPreview } from "../components/MarkdownPreview";

describe("MarkdownPreview", () => {
  it("renders GFM headings, tables and emphasis", () => {
    render(
      <MarkdownPreview
        content={"# Release gate\n\n| Item | State |\n| --- | --- |\n| Evidence | **Accepted** |"}
      />,
    );

    expect(screen.getByRole("heading", { name: "Release gate" })).toBeVisible();
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("Accepted")).toBeVisible();
  });

  it("strips scripts and event handlers from raw HTML", () => {
    const { container } = render(
      <MarkdownPreview content={'<img src="x" onerror="alert(1)" /><script>alert(1)</script>'} />,
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")?.getAttribute("onerror")).toBeNull();
  });

  it("shows an empty state for blank content", () => {
    render(<MarkdownPreview content="   " />);

    expect(screen.getByText(/Nothing to preview yet/)).toBeVisible();
  });
});
