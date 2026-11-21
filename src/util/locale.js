import { getGuild } from "../db/store.js";
import { makeT, resolveLocale } from "../core/i18n.js";

/**
 * Called from modules/* and managers/* (e.g. tickets.js, utility.js, music.js)
 * and from core/context.js for slash/prefix replies. Sole guild-locale helper.
 * Reads guilds.json via getGuild().locale. Writes: none.
 * User: "إذا كان لغة عربي يكون كل شي بالعربي، إذا إنجليزي إنجليزي" / server language.
 */
export function guildT(serverId, _interactionLocale) {
  const guild = serverId ? getGuild(serverId) : null;
  const locale = resolveLocale(guild?.locale || null, null);
  return { locale, t: makeT(locale) };
}

/** Old baked-in Arabic defaults — treat as unset so guild locale wins. */
const STOCK_TEMPLATES = new Set([
  "مبروك {user}! وصلت للمستوى **{level}**.",
  "أهلاً وسهلاً {user} في **{server}**! أنت العضو رقم **{count}**.",
  "وداعاً {user}… نتمنى لك التوفيق.",
  "Congrats {user}! You reached level **{level}**.",
  "Welcome {user} to **{server}**! You are member **#{count}**.",
  "Goodbye {user}.",
]);

/** Prefer custom template only when it is a real custom string; else locale key. */
export function localizedTemplate(custom, tr, key) {
  const raw = custom == null ? "" : String(custom).trim();
  if (!raw || STOCK_TEMPLATES.has(raw)) return tr(key);
  return raw;
}
