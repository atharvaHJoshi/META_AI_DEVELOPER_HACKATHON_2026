import DOMPurify from "dompurify";
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { cn } from "../lib/format";

marked.setOptions({ gfm: true, breaks: false });

/**
 * Renders internal documentation Markdown with GFM tables, task lists and
 * fenced code. Raw HTML is always sanitised before it reaches the DOM, and
 * external links open in a new tab without exposing the opener.
 */
export function MarkdownPreview({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const html = useMemo(() => {
    const rendered = marked.parse(content, { async: false }) as string;
    return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });
  }, [content]);

  useEffect(() => {
    container.current?.querySelectorAll("a[href]").forEach((anchor) => {
      anchor.setAttribute("target", "_blank");
      anchor.setAttribute("rel", "noreferrer noopener");
    });
  }, [html]);

  if (!content.trim()) {
    return (
      <div data-testid="markdown-preview" className={cn("prose-mirai", className)}>
        <p className="text-sm text-ink-faint">
          Nothing to preview yet. Start writing Markdown in the editor and the rendered document
          appears here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={container}
      data-testid="markdown-preview"
      className={cn("prose-mirai", className)}
      // The source is parsed locally and sanitised with DOMPurify above; raw
      // model or user HTML never reaches the page unfiltered.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
