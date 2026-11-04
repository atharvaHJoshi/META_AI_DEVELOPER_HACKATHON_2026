import type { MermaidConfig } from "mermaid";

/**
 * Mermaid is loaded lazily so its parser, layout engines and diagram
 * definitions never enter the initial application bundle. The renderer is
 * only imported the first time a diagram preview is actually shown.
 */
let mermaidModule: Promise<typeof import("mermaid").default> | null = null;
let initializedThemeKey: string | null = null;

type DiagramPalette = {
  mode: "light" | "dark";
  fontFamily: string;
  background: string;
  primary: string;
  primaryText: string;
  primaryBorder: string;
  line: string;
  secondary: string;
  secondaryText: string;
  secondaryBorder: string;
  tertiary: string;
  tertiaryText: string;
  tertiaryBorder: string;
  cluster: string;
  clusterBorder: string;
  note: string;
  noteText: string;
  noteBorder: string;
  error: string;
  errorText: string;
  mutedText: string;
  strongLine: string;
  accent: string;
  sequenceNumber: string;
  pie: [string, string, string, string, string, string, string, string];
  git: [string, string, string, string, string, string, string, string];
};

const LIGHT_PALETTE: DiagramPalette = {
  mode: "light",
  fontFamily: '"Manrope Variable", Manrope, Inter, system-ui, sans-serif',
  background: "#FFFFFF",
  primary: "#F1F5F9",
  primaryText: "#273444",
  primaryBorder: "#A3B8D0",
  line: "#496A91",
  secondary: "#E3EFE5",
  secondaryText: "#273444",
  secondaryBorder: "#5C7F6F",
  tertiary: "#F9FAFB",
  tertiaryText: "#445268",
  tertiaryBorder: "#E2E6EB",
  cluster: "#F9FAFB",
  clusterBorder: "#CDD4DC",
  note: "#FBF6EC",
  noteText: "#273444",
  noteBorder: "#A7793F",
  error: "#FBF1F0",
  errorText: "#8D4B46",
  mutedText: "#5F6D7E",
  strongLine: "#CDD4DC",
  accent: "#496A91",
  sequenceNumber: "#FFFFFF",
  pie: ["#496A91", "#5C7F6F", "#A7793F", "#A65B55", "#7E97B4", "#A3B8D0", "#4C6C5E", "#8F6633"],
  git: ["#496A91", "#5C7F6F", "#A7793F", "#A65B55", "#7E97B4", "#A3B8D0", "#4C6C5E", "#8F6633"],
};

const DARK_PALETTE: DiagramPalette = {
  mode: "dark",
  fontFamily: '"Manrope Variable", Manrope, Inter, system-ui, sans-serif',
  background: "#0B0E14",
  primary: "#1C2836",
  primaryText: "#E6EDF5",
  primaryBorder: "#496A91",
  line: "#7E97B4",
  secondary: "#1E2C26",
  secondaryText: "#E6EDF5",
  secondaryBorder: "#5C7F6F",
  tertiary: "#111722",
  tertiaryText: "#C7D1DC",
  tertiaryBorder: "#33404F",
  cluster: "#111722",
  clusterBorder: "#33404F",
  note: "#2C2417",
  noteText: "#F6EBD4",
  noteBorder: "#A7793F",
  error: "#321E1C",
  errorText: "#F6E1DF",
  mutedText: "#A7B3C2",
  strongLine: "#4A5868",
  accent: "#7E97B4",
  sequenceNumber: "#0B0E14",
  pie: ["#7E97B4", "#7FA38F", "#C7A26A", "#C7847D", "#A3B8D0", "#5C7F6F", "#A7793F", "#A65B55"],
  git: ["#7E97B4", "#7FA38F", "#C7A26A", "#C7847D", "#A3B8D0", "#5C7F6F", "#A7793F", "#A65B55"],
};

export type MermaidTheme = {
  key: string;
  config: MermaidConfig;
};

function readCssVariable(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/** Returns whether a CSS colour is dark enough that diagram text must invert. */
function isDarkColor(color: string): boolean {
  const match = color.match(/rgba?\(([^)]+)\)/i);
  if (!match?.[1]) return false;
  const [r, g, b, alpha = "1"] = match[1].split(/[\s,/]+/).map(Number);
  if ([r, g, b].some((channel) => channel === undefined || Number.isNaN(channel))) return false;
  if (Number(alpha) === 0) return false;
  const luminance = (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0)) / 255;
  return luminance < 0.45;
}

function currentPalette(): DiagramPalette {
  if (typeof window === "undefined") return LIGHT_PALETTE;
  const background = getComputedStyle(document.body).backgroundColor;
  const base = isDarkColor(background) ? DARK_PALETTE : LIGHT_PALETTE;
  return {
    ...base,
    background: readCssVariable("--surface", base.background),
    primaryText: readCssVariable("--ink", base.primaryText),
    line: readCssVariable("--primary", base.line),
    cluster: readCssVariable("--surface-muted", base.cluster),
    tertiary: readCssVariable("--surface-muted", base.tertiary),
    tertiaryBorder: readCssVariable("--line", base.tertiaryBorder),
    fontFamily: getComputedStyle(document.body).fontFamily || base.fontFamily,
  };
}

function themeVariables(palette: DiagramPalette): Record<string, string> {
  const shared = {
    background: palette.background,
    primaryColor: palette.primary,
    primaryTextColor: palette.primaryText,
    primaryBorderColor: palette.primaryBorder,
    secondaryColor: palette.secondary,
    secondaryTextColor: palette.secondaryText,
    secondaryBorderColor: palette.secondaryBorder,
    tertiaryColor: palette.tertiary,
    tertiaryTextColor: palette.tertiaryText,
    tertiaryBorderColor: palette.tertiaryBorder,
    lineColor: palette.line,
    textColor: palette.primaryText,
    mainBkg: palette.primary,
    nodeBorder: palette.primaryBorder,
    nodeTextColor: palette.primaryText,
    clusterBkg: palette.cluster,
    clusterBorder: palette.clusterBorder,
    titleColor: palette.primaryText,
    edgeLabelBackground: palette.background,
    noteBkgColor: palette.note,
    noteTextColor: palette.noteText,
    noteBorderColor: palette.noteBorder,
    errorBkgColor: palette.error,
    errorTextColor: palette.errorText,
    actorBkg: palette.primary,
    actorBorder: palette.primaryBorder,
    actorTextColor: palette.primaryText,
    actorLineColor: palette.mutedText,
    signalColor: palette.accent,
    signalTextColor: palette.primaryText,
    labelBoxBkgColor: palette.tertiary,
    labelBoxBorderColor: palette.strongLine,
    labelTextColor: palette.primaryText,
    loopTextColor: palette.primaryText,
    activationBorderColor: palette.primaryBorder,
    activationBkgColor: palette.primary,
    sequenceNumberColor: palette.sequenceNumber,
    classText: palette.primaryText,
    fillType0: palette.primary,
    fillType1: palette.secondary,
    fillType2: palette.tertiary,
    fillType3: palette.note,
    fillType4: palette.error,
    fillType5: palette.cluster,
    fillType6: palette.primary,
    fillType7: palette.secondary,
  };
  const colors: Record<string, string> = { ...shared };
  palette.pie.forEach((color, index) => {
    colors[`pie${index + 1}`] = color;
  });
  palette.git.forEach((color, index) => {
    colors[`git${index}`] = color;
    colors[`gitBranchLabel${index}`] = palette.sequenceNumber;
  });
  return colors;
}

/**
 * Derives a Mermaid theme from the live page palette. Reading computed CSS
 * variables means diagram colours follow the application theme (and any
 * future theme switch) rather than hard-coding a second design system.
 */
export function resolveMermaidTheme(): MermaidTheme {
  const palette = currentPalette();
  const key = [
    palette.mode,
    palette.background,
    palette.primaryText,
    palette.line,
    palette.fontFamily,
  ].join("|");
  const config: MermaidConfig = {
    startOnLoad: false,
    securityLevel: "strict",
    suppressErrorRendering: true,
    theme: "base",
    fontFamily: palette.fontFamily,
    themeVariables: {
      ...themeVariables(palette),
      fontFamily: palette.fontFamily,
      fontSize: "14px",
    },
    flowchart: {
      htmlLabels: true,
      curve: "basis",
      useMaxWidth: true,
    },
    sequence: {
      useMaxWidth: true,
      wrap: true,
      mirrorActors: false,
    },
    gantt: { useMaxWidth: true },
    journey: { useMaxWidth: true },
    timeline: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
    er: { useMaxWidth: true },
    pie: { useMaxWidth: true },
    quadrantChart: { useMaxWidth: true },
    requirement: { useMaxWidth: true },
    sankey: { useMaxWidth: true },
    xyChart: { useMaxWidth: true },
  };
  return { key, config };
}

async function loadMermaid(theme: MermaidTheme) {
  mermaidModule ??= import("mermaid").then((module) => module.default);
  const mermaid = await mermaidModule;
  if (initializedThemeKey !== theme.key) {
    mermaid.initialize(theme.config);
    initializedThemeKey = theme.key;
  }
  return mermaid;
}

/**
 * Parses and renders diagram source into an SVG string. Parse errors are
 * thrown before Mermaid touches the DOM, and `suppressErrorRendering` prevents
 * Mermaid's own error diagram from being inserted into the page. Strict
 * security mode sanitises labels and disables click handlers.
 */
export async function renderMermaid(
  source: string,
  renderId: string,
  theme: MermaidTheme = resolveMermaidTheme(),
): Promise<string> {
  const mermaid = await loadMermaid(theme);
  await mermaid.parse(source);
  try {
    const { svg } = await mermaid.render(renderId, source);
    return svg;
  } catch (error) {
    cleanupRenderArtifacts(renderId);
    throw error;
  }
}

function cleanupRenderArtifacts(renderId: string): void {
  if (typeof document === "undefined") return;
  document.getElementById(renderId)?.remove();
  document.getElementById(`d${renderId}`)?.remove();
  document.getElementById(`i${renderId}`)?.remove();
}

/** Human-readable parse errors without Mermaid's diagnostic preamble noise. */
export function formatMermaidError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  if (!trimmed) return "The diagram source could not be parsed.";
  return trimmed.length > 700 ? `${trimmed.slice(0, 697)}…` : trimmed;
}
