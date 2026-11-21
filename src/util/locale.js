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
