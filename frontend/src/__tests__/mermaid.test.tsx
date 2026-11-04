import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MermaidDiagram } from "../components/MermaidDiagram";

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  parse: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMock }));

describe("MermaidDiagram", () => {
  it("renders parsed Mermaid source lazily into the preview", async () => {
    mermaidMock.parse.mockResolvedValue({ diagramType: "flowchart" });
    mermaidMock.render.mockResolvedValue({
      svg: '<svg data-testid="rendered-diagram" role="img"><title>Checkout flow</title></svg>',
    });

    render(<MermaidDiagram source={"graph TD\n  ticket --> approval"} />);

    expect(screen.getByTestId("mermaid-preview")).toHaveAttribute("data-state", "rendering");
    expect(await screen.findByTestId("rendered-diagram", {}, { timeout: 2_000 })).toBeVisible();
    expect(screen.getByTestId("mermaid-preview")).toHaveAttribute("data-state", "ready");
    expect(mermaidMock.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ theme: "base", securityLevel: "strict" }),
    );
  });

  it("surfaces a syntax error and does not render a stale diagram", async () => {
    mermaidMock.parse.mockRejectedValueOnce(new Error("Parse error on line 1:\nExpecting 'EOF', got '-->'."));

    render(<MermaidDiagram source={"graph TD\n  ticket -->"} />);

    expect(await screen.findByText("Diagram syntax error", {}, { timeout: 2_000 })).toBeVisible();
    expect(screen.getByTestId("mermaid-preview")).toHaveAttribute("data-state", "error");
    expect(screen.getByText(/Parse error on line 1/)).toBeVisible();
    expect(screen.queryByTestId("rendered-diagram")).not.toBeInTheDocument();
  });

  it("does not invoke the renderer for an empty source", () => {
    mermaidMock.parse.mockClear();
    mermaidMock.render.mockClear();

    render(<MermaidDiagram source="   " />);

    expect(screen.getByTestId("mermaid-preview")).toHaveAttribute("data-state", "empty");
    expect(screen.getByText("Nothing to preview yet")).toBeVisible();
    expect(mermaidMock.parse).not.toHaveBeenCalled();
    expect(mermaidMock.render).not.toHaveBeenCalled();
  });
});
