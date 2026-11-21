import { SlashCommandBuilder, contextCommand } from "@zrzur/sdk/bot";
import { t } from "./i18n.js";

/**
 * Unified command registry: one definition → slash + prefix + handler.
 */
export class Registry {
  #commands = new Map();
  #prefixIndex = new Map();
  #cooldowns = new Map();

  register(def) {
    if (!def?.name || typeof def.execute !== "function") {
      throw new Error(`Invalid command: ${def?.name}`);
    }
    this.#commands.set(def.name, def);
    if (def.prefix !== false) {
      const aliases = [def.name, ...(def.aliases || [])].map((a) => a.toLowerCase());
      for (const alias of aliases) this.#prefixIndex.set(alias, def.name);
    }
    return this;
  }

  registerAll(list) {
    for (const def of list) this.register(def);
    return this;
  }

  get(name) {
    return this.#commands.get(name);
  }

  resolvePrefix(name) {
    const key = this.#prefixIndex.get(String(name).toLowerCase());
    return key ? this.#commands.get(key) : undefined;
  }

  list() {
    return [...this.#commands.values()];
  }

  toSlashPayload() {
    const out = [];
    for (const def of this.#commands.values()) {
      if (def.context) {
        out.push(
          contextCommand(def.context, def.contextName || def.name, {
            ar: t("ar", `commands.${def.name}.description`),
            en: t("en", `commands.${def.name}.description`),
          }),
        );
        continue;
      }
      if (def.slash === false) continue;

      const desc = t("en", `commands.${def.name}.description`) || def.name;
      let builder = new SlashCommandBuilder(def.name, desc).describe({
        ar: t("ar", `commands.${def.name}.description`),
        en: desc,
      });
      if (def.permission != null) builder = builder.permissions(def.permission);
      if (typeof def.build === "function") {
        builder = def.build(builder, (key) => t("en", key)) || builder;
      }
      out.push(builder);
    }
    return out;
  }

  checkCooldown(def, userId) {
    if (!def.cooldown) return null;
    const key = `${def.name}:${userId}`;
    const until = this.#cooldowns.get(key) || 0;
    const now = Date.now();
    if (until > now) return Math.ceil((until - now) / 1000);
    this.#cooldowns.set(key, now + def.cooldown * 1000);
    return null;
  }
}

export const registry = new Registry();
