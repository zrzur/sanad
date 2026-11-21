import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "locales");

const catalogs = {
  ar: JSON.parse(readFileSync(join(dir, "ar.json"), "utf8")),
  en: JSON.parse(readFileSync(join(dir, "en.json"), "utf8")),
};

export const locales = Object.keys(catalogs);

function dig(obj, path) {
  return path.split(".").reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

/** Translate `key` for `locale`. Vars: `{name}` placeholders. */
export function t(locale, key, vars = {}) {
  const lang = catalogs[locale] ? locale : config.defaultLocale;
  let text = dig(catalogs[lang], key);
  if (text == null) text = dig(catalogs.en, key);
  if (text == null) text = dig(catalogs.ar, key);
  if (text == null) return key;
  if (typeof text !== "string") return String(text);
  return text.replace(/\{(\w+)\}/g, (_, name) => (vars[name] != null ? String(vars[name]) : `{${name}}`));
}

export function makeT(locale) {
  return (key, vars) => t(locale, key, vars);
}

export function resolveLocale(guildLocale, userLocale) {
  const raw = (guildLocale || userLocale || config.defaultLocale || "ar").toLowerCase();
  if (raw.startsWith("ar")) return "ar";
  if (raw.startsWith("en")) return "en";
  return catalogs[raw] ? raw : config.defaultLocale;
}

export function commandLocalizations(path) {
  return {
    ar: dig(catalogs.ar, path),
    en: dig(catalogs.en, path),
  };
}
