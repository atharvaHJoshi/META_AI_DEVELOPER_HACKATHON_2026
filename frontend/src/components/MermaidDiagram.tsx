import { Loader2, Network } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import {
  formatMermaidError,
  renderMermaid,
  resolveMermaidTheme,
  type MermaidTheme,
} from "../lib/mermaid";
import { cn } from "../lib/format";
import { Alert } from "./ui";

type RenderStatus = "empty" | "rendering" | "ready" | "error";

const DEBOUNCE_MS = 300;

/**
 * Live, lazy-loaded Mermaid preview.
 *
 * The diagram is rendered off-screen by Mermaid and only inserted after a
 * successful parse/render, so malformed source can never replace the editor
 * with a half-drawn diagram. Parse failures are surfaced inline and the
 * previous successful render is discarded rather than misrepresenting the
 * current source.
 */
export function MermaidDiagram({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  const reactId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [theme, setTheme] = useState<MermaidTheme>(() => resolveMermaidTheme());
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<RenderStatus>(source.trim() ? "rendering" : "empty");
  const requestId = useRef(0);

  // Follow the document palette so a light/dark theme switch re-renders the
  // diagram with matching colours instead of leaving a stale SVG behind.
  useEffect(() => {
    const refresh = () => {
      const next = resolveMermaidTheme();
      setTheme((previous) => (previous.key === next.key ? previous : next));
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
    const media = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    media?.addEventListener("change", refresh);
    return () => {
      observer.disconnect();
      media?.removeEventListener("change", refresh);
    };
  }, []);

  useEffect(() => {
    const trimmed = source.trim();
    const request = ++requestId.current;
    let cancelled = false;
    let timer: number | undefined;

    if (!trimmed) {
      setSvg("");
      setError(null);
      setStatus("empty");
      return () => {
        cancelled = true;
      };
    }

    setError(null);
    setStatus("rendering");
    timer = window.setTimeout(() => {
      const renderId = `mermaid-preview-${reactId}-${request}`;
      void renderMermaid(trimmed, renderId, theme)
        .then((nextSvg) => {
          if (cancelled || requestId.current !== request) return;
          setSvg(nextSvg);
          setStatus("ready");
        })
        .catch((cause: unknown) => {
          if (cancelled || requestId.current !== request) return;
          setError(formatMermaidError(cause));
          setStatus("error");
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [source, theme, reactId]);

  return (
    <div
      data-testid="mermaid-preview"
      data-state={status}
      role="region"
      aria-label="Diagram preview"
      aria-busy={status === "rendering"}
      className={cn(
        "relative flex min-h-[320px] flex-col overflow-auto rounded-md border border-line bg-surface-muted p-4",
        className,
      )}
    >
      {status === "empty" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <span className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface">
            <Network className="h-4 w-4 text-ink-faint" aria-hidden />
          </span>
          <p className="text-sm font-semibold text-ink">Nothing to preview yet</p>
          <p className="max-w-xs text-xs leading-5 text-ink-muted">
            Add Mermaid source in the editor and the rendered diagram appears here as you type.
          </p>
        </div>
      )}

      {status === "rendering" && !svg && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-ink-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Rendering diagram…
        </div>
      )}

      {svg && status !== "error" && (
        <div
          data-testid="mermaid-diagram"
          className={cn(
            "mermaid-diagram mx-auto w-full [&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full",
            status === "rendering" && "opacity-50",
          )}
          // Mermaid output is sanitised by the renderer in strict security
          // mode; only the SVG produced by `renderMermaid` is inserted here.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      )}

      {status === "rendering" && svg && (
        <div
          className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full border border-line bg-surface px-2.5 py-1 text-[10px] font-medium text-ink-muted shadow-card"
          role="status"
        >
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Updating
        </div>
      )}

      {status === "error" && error && (
        <Alert tone="danger" title="Diagram syntax error">
          <p>Fix the highlighted source to render a preview. The document can still be saved as-is.</p>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-danger-100 bg-surface px-2.5 py-2 font-mono text-[11px] leading-5 text-ink-soft">
            {error}
          </pre>
        </Alert>
      )}
    </div>
  );
}
