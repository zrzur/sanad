import { Permissions, SlashCommandBuilder } from "@zrzur/sdk/bot";
import { BRAND, mentionChannel, mentionRole } from "../brand.js";
import { getGuild, updateGuild } from "../db/store.js";
import { baseEmbed, brandFooter } from "../util/format.js";
import { guildT } from "../util/locale.js";

export function setupCommands() {
  return [
    new SlashCommandBuilder("setup", "Configure Sanad")
      .describe({ en: "Configure Sanad", ar: "إعداد سند للسيرفر" })
      .subcommand("overview", "Show current settings")
      .subcommand("logs", "Mod-log channel", (s) =>
        s.channel("channel", "Channel", {
          required: true,
          descriptions: { en: "Channel", ar: "القناة" },
        }),
      )
      .subcommand("staff", "Staff role", (s) =>
        s.role("role", "Role", { required: true, descriptions: { en: "Role", ar: "الدور" } }),
      )
      .subcommand("locale", "Reply language", (s) =>
        s.string("lang", "Language", {
          required: true,
          descriptions: { en: "Language", ar: "اللغة" },
          choices: [
            { name: "العربية", value: "ar" },
            { name: "English", value: "en" },
          ],
        }),
      )
      .permissions(Permissions.ManageServer),
    new SlashCommandBuilder("config", "Configure server features")
      .describe({ en: "Configure server features", ar: "ضبط ميزات السيرفر" })
      .subcommand("welcome", "Welcome message", (s) =>
        s
          .boolean("enabled", "Enable?", { required: true, descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .channel("channel", "Welcome channel", { descriptions: { en: "Welcome channel", ar: "قناة الترحيب" } })
          .string("message", "Text ({user} {server} {count})", {
            maxLength: 500,
            descriptions: { en: "Text ({user} {server} {count})", ar: "النص ({user} {server} {count})" },
          })
          .string("dm", "Optional DM", {
            maxLength: 500,
            descriptions: { en: "Optional DM", ar: "رسالة خاصة اختيارية" },
          }),
      )
      .subcommand("goodbye", "Goodbye message", (s) =>
        s
          .boolean("enabled", "Enable?", { required: true, descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .channel("channel", "Channel", { descriptions: { en: "Channel", ar: "القناة" } })
          .string("message", "Text", { maxLength: 500, descriptions: { en: "Text", ar: "النص" } }),
      )
      .subcommand("autorole", "Auto-roles on join", (s) =>
        s
          .role("role", "Role to add", { required: true, descriptions: { en: "Role to add", ar: "دور يُضاف" } })
          .boolean("remove", "Remove instead", { descriptions: { en: "Remove instead", ar: "إزالة بدلاً من الإضافة" } }),
      )
      .subcommand("leveling", "Leveling system", (s) =>
        s
          .boolean("enabled", "Enable?", { descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .channel("levelup_channel", "Level-up channel", {
            descriptions: { en: "Level-up channel", ar: "قناة إعلان المستوى" },
          })
          .string("message", "Level-up message", {
            maxLength: 300,
            descriptions: { en: "Level-up message", ar: "رسالة الترقية" },
          })
          .integer("xp_min", "Min XP", { min: 1, max: 100, descriptions: { en: "Min XP", ar: "أقل XP" } })
          .integer("xp_max", "Max XP", { min: 1, max: 200, descriptions: { en: "Max XP", ar: "أعلى XP" } })
          .integer("cooldown", "Cooldown seconds", {
            min: 5,
            max: 600,
            descriptions: { en: "Cooldown seconds", ar: "تهدئة بالثواني" },
          }),
      )
      .subcommand("level-reward", "Level reward", (s) =>
        s
          .integer("level", "Level", {
            required: true,
            min: 1,
            max: 200,
            descriptions: { en: "Level", ar: "المستوى" },
          })
          .role("role", "Role", { required: true, descriptions: { en: "Role", ar: "الدور" } })
          .boolean("remove", "Remove reward", { descriptions: { en: "Remove reward", ar: "حذف المكافأة" } }),
      )
      .subcommand("automod", "Automod", (s) =>
        s
          .boolean("enabled", "Enable?", { required: true, descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .boolean("anti_spam", "Anti-spam", { descriptions: { en: "Anti-spam", ar: "مكافحة السبام" } })
          .boolean("anti_duplicate", "Anti-duplicate", {
            descriptions: { en: "Block repeated identical messages", ar: "حظر الرسائل المتكررة" },
          })
          .boolean("anti_links", "Block links", { descriptions: { en: "Block links", ar: "حظر الروابط" } })
          .boolean("anti_invites", "Block invites", { descriptions: { en: "Block invites", ar: "حظر الدعوات" } })
          .boolean("anti_emoji", "Anti emoji spam", {
            descriptions: { en: "Block emoji spam", ar: "حظر سبام الإيموجي" },
          })
          .boolean("anti_zalgo", "Anti zalgo", {
            descriptions: { en: "Block zalgo / spoof text", ar: "حظر النص المشوّه" },
          })
          .boolean("escalate", "Escalate strikes", {
            descriptions: { en: "Delete → warn → timeout by strikes", ar: "تصعيد: حذف → تحذير → إيقاف" },
          })
          .integer("max_mentions", "Max mentions", {
            min: 1,
            max: 20,
            descriptions: { en: "Max mentions", ar: "حد المنشنات" },
          })
          .role("ignore_role", "Ignore role", {
            descriptions: { en: "Role exempt from automod", ar: "رتبة مستثناة من الأوتومود" },
          })
          .integer("timeout_seconds", "Timeout seconds", {
            min: 60,
            max: 86400,
            descriptions: { en: "Timeout length when action is timeout", ar: "مدة الإيقاف عند اختيار timeout" },
          })
          .string("action", "Action", {
            descriptions: { en: "Action", ar: "الإجراء" },
            choices: [
              { name: "Delete", value: "delete" },
              { name: "Warn", value: "warn" },
              { name: "Timeout", value: "timeout" },
              { name: "Escalate", value: "escalate" },
            ],
          }),
      )
      .subcommand("automod-word", "Banned word", (s) =>
        s
          .string("word", "Word", { required: true, descriptions: { en: "Word", ar: "الكلمة" } })
          .boolean("remove", "Remove", { descriptions: { en: "Remove", ar: "إزالة" } }),
      )
      .subcommand("automod-domain", "Allow domain", (s) =>
        s
          .string("domain", "Domain", {
            required: true,
            descriptions: { en: "e.g. zrzur.com", ar: "مثال: zrzur.com" },
          })
          .boolean("remove", "Remove", { descriptions: { en: "Remove", ar: "إزالة" } }),
      )
      .subcommand("antiraid", "Anti-raid", (s) =>
        s
          .boolean("enabled", "Enable?", { required: true, descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .integer("joins", "Join count", {
            min: 3,
            max: 50,
            descriptions: { en: "Join count", ar: "عدد الانضمامات" },
          })
          .integer("window", "Window seconds", {
            min: 3,
            max: 60,
            descriptions: { en: "Window seconds", ar: "النافذة بالثواني" },
          })
          .integer("lock_seconds", "Lock duration", {
            min: 30,
            max: 3600,
            descriptions: { en: "Auto-unlock after lock (seconds)", ar: "فك القفل تلقائيًا بعد (ثواني)" },
          })
          .string("action", "Action", {
            descriptions: { en: "Action", ar: "الإجراء" },
            choices: [
              { name: "Lock", value: "lock" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" },
            ],
          }),
      )
      .subcommand("starboard", "Starboard", (s) =>
        s
          .boolean("enabled", "Enable?", { required: true, descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .channel("channel", "Channel", { descriptions: { en: "Channel", ar: "القناة" } })
          .integer("threshold", "Minimum stars", {
            min: 1,
            max: 25,
            descriptions: { en: "Minimum stars", ar: "الحد الأدنى" },
          })
          .string("emoji", "Emoji", { descriptions: { en: "Emoji", ar: "الإيموجي" } }),
      )
      .subcommand("suggest-channel", "Suggestions channel", (s) =>
        s.channel("channel", "Channel", {
          required: true,
          descriptions: { en: "Channel", ar: "القناة" },
        }),
      )
      .subcommand("tickets", "Ticket settings", (s) =>
        s
          .boolean("enabled", "Enable?", { descriptions: { en: "Enable?", ar: "تفعيل؟" } })
          .role("staff", "Staff role", { descriptions: { en: "Staff role", ar: "دور الطاقم" } })
          .channel("log", "Ticket log channel", {
            descriptions: { en: "Ticket log channel", ar: "قناة سجل التذاكر" },
          })
          .channel("category", "Tickets category", {
            descriptions: { en: "Tickets category", ar: "تصنيف التذاكر" },
          })
          .string("topics", "Comma-separated topics", {
            descriptions: { en: "Comma-separated topics", ar: "المواضيع مفصولة بفاصلة" },
          }),
      )
      .permissions(Permissions.ManageServer),
  ];
}

export function overviewEmbed(cfg, tr) {
  const on = (v) => (v ? tr("common.enabled") : tr("common.disabled"));
  const dash = tr("common.none");
  return baseEmbed(BRAND.colour.primary, brandFooter(tr))
    .title(tr("commands.setup.overviewTitle", { name: tr("brand.name") }))
    .description(tr("brand.tagline"))
    .field(
      tr("commands.setup.fields.logs"),
      cfg.modLogChannelId ? mentionChannel(cfg.modLogChannelId) : dash,
      true,
    )
    .field(tr("commands.setup.fields.staff"), cfg.staffRoleId ? mentionRole(cfg.staffRoleId) : dash, true)
    .field(tr("commands.setup.fields.welcome"), on(cfg.welcome.enabled), true)
    .field(tr("commands.setup.fields.goodbye"), on(cfg.goodbye?.enabled), true)
    .field(tr("commands.setup.fields.leveling"), on(cfg.leveling.enabled), true)
    .field(tr("commands.setup.fields.automod"), on(cfg.automod.enabled), true)
    .field(tr("commands.setup.fields.tickets"), on(cfg.tickets.enabled), true)
    .field(tr("commands.setup.fields.antiraid"), on(cfg.antiraid.enabled), true)
    .field(tr("commands.setup.fields.starboard"), on(cfg.starboard.enabled), true);
}

export function registerSetup(client) {
  client.command("setup", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const sub = i.subcommand;
    const cfg = getGuild(i.serverId);

    if (sub === "overview") {
      return i.reply({ embeds: [overviewEmbed(cfg, tr)], ephemeral: true });
    }

    if (sub === "logs") {
      updateGuild(i.serverId, (c) => {
        c.modLogChannelId = i.option("channel");
        c.logChannelId = i.option("channel");
      });
      return i.reply({
        content: tr("commands.setup.logsSet", { channel: mentionChannel(i.option("channel")) }),
        ephemeral: true,
      });
    }

    if (sub === "staff") {
      updateGuild(i.serverId, (c) => {
        c.staffRoleId = i.option("role");
        c.tickets.staffRoleId = i.option("role");
      });
      return i.reply({
        content: tr("commands.setup.staffSet", { role: mentionRole(i.option("role")) }),
        ephemeral: true,
      });
    }

    if (sub === "locale") {
      updateGuild(i.serverId, (c) => {
        c.locale = i.option("lang");
      });
      return i.reply({
        content: tr("commands.setup.localeSet", { locale: i.option("lang") }),
        ephemeral: true,
      });
    }
  });

  client.command("config", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const sub = i.subcommand;

    if (sub === "welcome") {
      updateGuild(i.serverId, (c) => {
        c.welcome.enabled = i.option("enabled");
        if (i.option("channel")) c.welcome.channelId = i.option("channel");
        if (i.option("message")) c.welcome.message = i.option("message");
        if (i.option("dm") != null) c.welcome.dm = i.option("dm");
      });
      return i.reply({ content: tr("commands.config.welcomeSaved"), ephemeral: true });
    }

    if (sub === "goodbye") {
      updateGuild(i.serverId, (c) => {
        c.goodbye.enabled = i.option("enabled");
        if (i.option("channel")) c.goodbye.channelId = i.option("channel");
        if (i.option("message")) c.goodbye.message = i.option("message");
      });
      return i.reply({ content: tr("commands.config.goodbyeSaved"), ephemeral: true });
    }

    if (sub === "autorole") {
      const role = i.option("role");
      const remove = i.option("remove");
      updateGuild(i.serverId, (c) => {
        if (remove) c.autorole.roleIds = c.autorole.roleIds.filter((r) => r !== role);
        else if (!c.autorole.roleIds.includes(role)) c.autorole.roleIds.push(role);
      });
      return i.reply({
        content: remove
          ? tr("commands.config.autoroleRemove", { role: mentionRole(role) })
          : tr("commands.config.autoroleAdd", { role: mentionRole(role) }),
        ephemeral: true,
      });
    }

    if (sub === "leveling") {
      updateGuild(i.serverId, (c) => {
        if (i.option("enabled") != null) c.leveling.enabled = i.option("enabled");
        if (i.option("levelup_channel")) c.leveling.levelUpChannelId = i.option("levelup_channel");
        if (i.option("message")) c.leveling.levelUpMessage = i.option("message");
        if (i.option("xp_min") != null) c.leveling.xpMin = i.option("xp_min");
        if (i.option("xp_max") != null) c.leveling.xpMax = Math.max(c.leveling.xpMin, i.option("xp_max"));
        if (i.option("cooldown") != null) c.leveling.cooldownSec = i.option("cooldown");
      });
      return i.reply({ content: tr("commands.config.levelingSaved"), ephemeral: true });
    }

    if (sub === "level-reward") {
      const level = i.option("level");
      const role = i.option("role");
      updateGuild(i.serverId, (c) => {
        c.leveling.rewards = c.leveling.rewards.filter((r) => r.level !== level);
        if (!i.option("remove")) c.leveling.rewards.push({ level, roleId: role });
        c.leveling.rewards.sort((a, b) => a.level - b.level);
      });
      return i.reply({
        content: i.option("remove")
          ? tr("commands.config.levelRewardClear", { level })
          : tr("commands.config.levelRewardSet", { level, role: mentionRole(role) }),
        ephemeral: true,
      });
    }

    if (sub === "automod") {
      updateGuild(i.serverId, (c) => {
        if (!c.automod) c.automod = {};
        c.automod.enabled = i.option("enabled");
        if (i.option("anti_spam") != null) c.automod.antiSpam = i.option("anti_spam");
        if (i.option("anti_duplicate") != null) c.automod.antiDuplicate = i.option("anti_duplicate");
        if (i.option("anti_links") != null) c.automod.antiLinks = i.option("anti_links");
        if (i.option("anti_invites") != null) c.automod.antiInvites = i.option("anti_invites");
        if (i.option("anti_emoji") != null) c.automod.antiEmojiSpam = i.option("anti_emoji");
        if (i.option("anti_zalgo") != null) c.automod.antiZalgo = i.option("anti_zalgo");
        if (i.option("escalate") != null) c.automod.escalate = i.option("escalate");
        if (i.option("max_mentions") != null) c.automod.maxMentions = i.option("max_mentions");
        if (i.option("action")) {
          c.automod.action = i.option("action");
          if (i.option("action") === "escalate") c.automod.escalate = true;
        }
        if (i.option("timeout_seconds") != null) c.automod.timeoutSeconds = i.option("timeout_seconds");
        const ignoreRole = i.option("ignore_role");
        if (ignoreRole) {
          if (!Array.isArray(c.automod.ignoreRoles)) c.automod.ignoreRoles = [];
          if (!c.automod.ignoreRoles.includes(ignoreRole)) c.automod.ignoreRoles.push(ignoreRole);
        }
      });
      return i.reply({ content: tr("commands.config.automodSaved"), ephemeral: true });
    }

    if (sub === "automod-word") {
      const word = String(i.option("word")).toLowerCase().trim();
      updateGuild(i.serverId, (c) => {
        if (!c.automod) c.automod = {};
        if (!Array.isArray(c.automod.badWords)) c.automod.badWords = [];
        if (i.option("remove")) c.automod.badWords = c.automod.badWords.filter((w) => w !== word);
        else if (!c.automod.badWords.includes(word)) c.automod.badWords.push(word);
      });
      return i.reply({ content: tr("commands.config.automodWords"), ephemeral: true });
    }

    if (sub === "automod-domain") {
      const domain = String(i.option("domain") || "")
        .toLowerCase()
        .trim()
        .replace(/^https?:\/\//, "")
        .replace(/\/.*$/, "")
        .replace(/^www\./, "");
      if (!domain || domain.includes(" ")) {
        return i.reply({ content: tr("commands.config.automodDomainInvalid"), ephemeral: true });
      }
      updateGuild(i.serverId, (c) => {
        if (!c.automod) c.automod = {};
        if (!Array.isArray(c.automod.allowDomains)) c.automod.allowDomains = [];
        if (i.option("remove")) {
          c.automod.allowDomains = c.automod.allowDomains.filter((d) => d !== domain);
        } else if (!c.automod.allowDomains.includes(domain)) {
          c.automod.allowDomains.push(domain);
        }
      });
      return i.reply({ content: tr("commands.config.automodDomain"), ephemeral: true });
    }

    if (sub === "antiraid") {
      updateGuild(i.serverId, (c) => {
        if (!c.antiraid) c.antiraid = {};
        c.antiraid.enabled = i.option("enabled");
        if (i.option("joins") != null) c.antiraid.joinThreshold = i.option("joins");
        if (i.option("window") != null) c.antiraid.joinWindowSec = i.option("window");
        if (i.option("lock_seconds") != null) c.antiraid.lockSeconds = i.option("lock_seconds");
        if (i.option("action")) c.antiraid.action = i.option("action");
      });
      return i.reply({ content: tr("commands.config.antiraidSaved"), ephemeral: true });
    }

    if (sub === "starboard") {
      updateGuild(i.serverId, (c) => {
        c.starboard.enabled = i.option("enabled");
        if (i.option("channel")) c.starboard.channelId = i.option("channel");
        if (i.option("threshold") != null) c.starboard.threshold = i.option("threshold");
        if (i.option("emoji")) c.starboard.emoji = i.option("emoji");
      });
      return i.reply({ content: tr("commands.config.starboardSaved"), ephemeral: true });
    }

    if (sub === "suggest-channel") {
      updateGuild(i.serverId, (c) => {
        c.suggest.channelId = i.option("channel");
      });
      return i.reply({
        content: tr("commands.config.suggestSet", { channel: mentionChannel(i.option("channel")) }),
        ephemeral: true,
      });
    }

    if (sub === "tickets") {
      updateGuild(i.serverId, (c) => {
        if (i.option("enabled") != null) c.tickets.enabled = i.option("enabled");
        if (i.option("staff")) {
          c.tickets.staffRoleId = i.option("staff");
          c.staffRoleId = i.option("staff");
        }
        if (i.option("log")) c.tickets.logChannelId = i.option("log");
        if (i.option("category")) c.tickets.categoryId = i.option("category");
        if (i.option("topics")) {
          c.tickets.topics = String(i.option("topics"))
            .split(/[,،]/)
            .map((topic) => topic.trim())
            .filter(Boolean)
            .slice(0, 25);
        }
      });
      return i.reply({ content: tr("commands.config.ticketsSaved"), ephemeral: true });
    }
  });
}
