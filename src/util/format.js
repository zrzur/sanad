import { EmbedBuilder } from "@zrzur/sdk/bot";
import { BRAND, mentionUser } from "../brand.js";

export function xpForLevel(level) {
  return Math.floor(70 * level ** 1.65 + level * 40);
}

export function levelFromXp(xp) {
  let level = 0;
  while (xp >= xpForLevel(level + 1) && level < 200) level += 1;
  return level;
}

export function fillTemplate(template, vars) {
  return String(template ?? "").replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : `{${key}}`,
  );
}

export function parseDuration(input) {
  if (input == null) return null;
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, Math.floor(input));
  const raw = String(input).trim().toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw) * 60;
  const m = raw.match(/^(\d+)\s*(s|sec|secs|m|min|mins|h|hr|hrs|d|day|days|ث|د|س|ي)$/i);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  if (["s", "sec", "secs", "ث"].includes(u)) return n;
  if (["m", "min", "mins", "د"].includes(u)) return n * 60;
  if (["h", "hr", "hrs", "س"].includes(u)) return n * 3600;
  if (["d", "day", "days", "ي"].includes(u)) return n * 86400;
  return null;
}

/** Locale-aware duration: `ar` → ي/س/د/ث · else d/h/m/s */
export function formatDuration(seconds, locale = "en") {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const ar = String(locale || "").toLowerCase().startsWith("ar");
  const parts = [];
  if (d) parts.push(ar ? `${d}ي` : `${d}d`);
  if (h) parts.push(ar ? `${h}س` : `${h}h`);
  if (m) parts.push(ar ? `${m}د` : `${m}m`);
  if (r || !parts.length) parts.push(ar ? `${r}ث` : `${r}s`);
  return parts.join(" ");
}

export function baseEmbed(colour = BRAND.colour.primary, footerText = BRAND.nameEn || BRAND.name) {
  return new EmbedBuilder().colour(colour).footer(footerText).timestamp();
}

/** Embed footer brand name for the guild language */
export function brandFooter(tr) {
  return typeof tr === "function" ? tr("brand.name") : BRAND.nameEn || BRAND.name;
}

export function modEmbed({ title, targetId, moderatorId, reason, caseId, colour, duration, tr }) {
  const label = (key, fallback) => (typeof tr === "function" ? tr(key) : fallback);
  const e = baseEmbed(colour ?? BRAND.colour.danger, label("brand.name", BRAND.nameEn || BRAND.name)).title(
    title,
  );
  if (caseId != null) e.field(label("common.case", "Case"), `#${caseId}`, true);
  if (targetId) e.field(label("common.user", "Member"), mentionUser(targetId), true);
  if (moderatorId) e.field(label("common.moderator", "Moderator"), mentionUser(moderatorId), true);
  if (duration) e.field(label("common.duration", "Duration"), duration, true);
  if (reason) e.field(label("common.reason", "Reason"), reason.slice(0, 1024), false);
  return e;
}

export function progressBar(current, max, size = 10) {
  const ratio = max <= 0 ? 0 : Math.min(1, current / max);
  const filled = Math.round(ratio * size);
  return "█".repeat(filled) + "░".repeat(size - filled);
}
