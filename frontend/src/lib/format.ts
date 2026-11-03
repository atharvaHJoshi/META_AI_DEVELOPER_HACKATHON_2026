import clsx from "clsx";

export function cn(...values: Array<string | false | null | undefined>): string {
  return clsx(values);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts.at(-1)![0]}`.toUpperCase();
}

export function titleCase(value: string | null | undefined): string {
  if (!value) return "—";
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function formatDate(value: string | null | undefined, options?: Intl.DateTimeFormatOptions): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...options,
  }).format(date);
}

export function formatShortDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", { day: "numeric", month: "short" }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const ranges: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["week", 60 * 60 * 24 * 7],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
  ];
  for (const [unit, secondsInUnit] of ranges) {
    if (Math.abs(seconds) >= secondsInUnit) {
      return formatter.format(Math.round(seconds / secondsInUnit), unit);
    }
  }
  return "just now";
}

export function daysUntil(value: string | null | undefined): number | null {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return null;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return "No access";
  if (role === "pm") return "Project manager";
  return titleCase(role);
}

export const ROLE_RANK: Record<string, number> = {
  viewer: 0,
  member: 1,
  manager: 2,
  pm: 2,
  admin: 3,
  owner: 4,
};

export function hasRole(role: string | null | undefined, minimum: string): boolean {
  return (ROLE_RANK[role ?? ""] ?? -1) >= (ROLE_RANK[minimum] ?? 99);
}

export function canContribute(role: string | null | undefined): boolean {
  return hasRole(role, "member");
}

export function canManage(role: string | null | undefined): boolean {
  return hasRole(role, "manager");
}

export function truncate(value: string, length = 160): string {
  if (value.length <= length) return value;
  return `${value.slice(0, length - 1).trimEnd()}…`;
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function statusLabel(status: string | null | undefined): string {
  if (!status) return "—";
  if (status === "in_progress") return "In progress";
  if (status === "needs_clarification") return "Needs clarification";
  if (status === "analysis_failed") return "Analysis failed";
  return titleCase(status);
}

export function toneForStatus(status: string | null | undefined): "neutral" | "primary" | "sage" | "amber" | "danger" {
  switch (status) {
    case "done":
    case "approved":
    case "accepted":
    case "completed":
    case "active":
    case "solved":
      return "sage";
    case "in_progress":
    case "analyzing":
    case "pending":
    case "planned":
      return "primary";
    case "blocked":
    case "failed":
    case "analysis_failed":
    case "rejected":
    case "cancelled":
    case "breached":
      return "danger";
    case "needs_clarification":
    case "clarify":
    case "deferred":
    case "warning":
      return "amber";
    default:
      return "neutral";
  }
}

export function priorityTone(priority: string | null | undefined): "danger" | "amber" | "primary" | "neutral" {
  if (priority === "P0" || priority === "critical") return "danger";
  if (priority === "P1" || priority === "high") return "amber";
  if (priority === "P2") return "primary";
  return "neutral";
}
