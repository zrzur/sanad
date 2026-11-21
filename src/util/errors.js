import { ApiError } from "@zrzur/sdk/bot";
import { t } from "../core/i18n.js";

export function explain(error, locale = "ar") {
  if (!(error instanceof ApiError)) return t(locale, "common.unknownError");
  const keyed = t(locale, `errors.${error.type}`);
  if (keyed && keyed !== `errors.${error.type}`) return keyed;
  return t(locale, "errors.fallback", { type: error.type });
}

export async function safe(i, fn, locale = "ar") {
  try {
    return await fn();
  } catch (error) {
    const text = explain(error, locale);
    if (i.deferred || i.replied) await i.editReply({ content: text }).catch(() => {});
    else await i.reply({ content: text, ephemeral: true }).catch(() => {});
    return null;
  }
}
