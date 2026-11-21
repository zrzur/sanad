/**
 * Admin control hub — one command for stats + toggles + quick actions.
 *
 * Callers: src/core/createBot.js → registerDashboard(client) +
 * dashboardCommands() in syncCommands (~line registerPanel).
 * No existing module combines counters + interactive management (setup is
 * text-only overview; panel.js is public guidelines).
 * Schema read: guilds/levels/cases/warns/tickets/giveaways via
 * getGuild + guildCounters; music session for now-playing.
 * User: "لوحة تحكم… العدادات للبوت… عن طريق الإنبد أو البانل… سهل الاستخدام"
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Permissions,
  SlashCommandBuilder,
} from "@zrzur/sdk/bot";
import { BRAND, mentionChannel, mentionRole } from "../brand.js";
import { getGuild, guildCounters, updateGuild } from "../db/store.js";
import { baseEmbed, brandFooter } from "../util/format.js";
import { guildT } from "../util/locale.js";
import { postPanel } from "./panel.js";

function onOff(tr, enabled) {
  return enabled ? tr("common.enabled") : tr("common.disabled");
}

function featureLine(tr, key, enabled) {
  const mark = enabled ? "✅" : "⬜";
  return `${mark} **${tr(key)}** · ${onOff(tr, enabled)}`;
}

async function musicLine(client, serverId, tr) {
  try {
    const { getQueue } = await import("../managers/music.js");
    const session = typeof getQueue === "function" ? getQueue(client, serverId) : null;
    if (!session?.playing || !session.current) return tr("commands.dashboard.musicIdle");
    const title = session.current.display || session.current.title || session.current.name || "—";
    const q = session.queue?.length ?? 0;
    return tr("commands.dashboard.musicPlaying", { title: String(title).slice(0, 80), queue: q });
  } catch {
    return tr("commands.dashboard.musicIdle");
  }
}

export async function buildDashboardEmbed(client, serverId, tr) {
  const cfg = getGuild(serverId);
  const c = guildCounters(serverId);
  const music = await musicLine(client, serverId, tr);

  return baseEmbed(BRAND.colour.primary, brandFooter(tr))
    .title(tr("commands.dashboard.title", { name: tr("brand.name") }))
    .description(tr("commands.dashboard.blurb"))
    .field(
      tr("commands.dashboard.stats"),
      [
        tr("commands.dashboard.statRanked", { n: c.ranked }),
        tr("commands.dashboard.statTickets", { n: c.openTickets }),
        tr("commands.dashboard.statCases", { n: c.cases }),
        tr("commands.dashboard.statWarns", { n: c.warnCount }),
        tr("commands.dashboard.statGiveaways", { n: c.giveaways }),
        tr("commands.dashboard.statAuto", { n: c.autoresponders }),
      ].join("\n"),
      true,
    )
    .field(
      tr("commands.dashboard.server"),
      [
        tr("commands.dashboard.locale", { locale: cfg.locale || "ar" }),
        tr("commands.dashboard.prefix", { prefix: cfg.prefix || "!" }),
        tr("commands.dashboard.staff", {
          role: cfg.staffRoleId ? mentionRole(cfg.staffRoleId) : tr("common.none"),
        }),
        tr("commands.dashboard.logs", {
          channel: cfg.modLogChannelId ? mentionChannel(cfg.modLogChannelId) : tr("common.none"),
        }),
      ].join("\n"),
      true,
    )
    .field(
      tr("commands.dashboard.features"),
      [
        featureLine(tr, "commands.setup.fields.welcome", cfg.welcome?.enabled),
        featureLine(tr, "commands.setup.fields.goodbye", cfg.goodbye?.enabled),
        featureLine(tr, "commands.setup.fields.leveling", cfg.leveling?.enabled),
        featureLine(tr, "commands.setup.fields.automod", cfg.automod?.enabled),
        featureLine(tr, "commands.setup.fields.tickets", cfg.tickets?.enabled),
        featureLine(tr, "commands.setup.fields.antiraid", cfg.antiraid?.enabled),
        featureLine(tr, "commands.setup.fields.starboard", cfg.starboard?.enabled),
      ].join("\n"),
      false,
    )
    .field(tr("commands.dashboard.music"), music, false);
}

export function dashboardButtons(tr, cfg) {
  const tog = (id, label, on) =>
    new ButtonBuilder()
      .setCustomId(id)
      .setLabel(label.slice(0, 80))
      .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);

  // Max 5 buttons per row — features then actions (End last)
  return [
    new ActionRowBuilder().addComponents(
      tog("sanad:dash:toggle:welcome", tr("commands.dashboard.btnWelcome"), cfg.welcome?.enabled),
      tog("sanad:dash:toggle:goodbye", tr("commands.dashboard.btnGoodbye"), cfg.goodbye?.enabled),
      tog("sanad:dash:toggle:leveling", tr("commands.dashboard.btnLeveling"), cfg.leveling?.enabled),
      tog("sanad:dash:toggle:automod", tr("commands.dashboard.btnAutomod"), cfg.automod?.enabled),
      tog("sanad:dash:toggle:tickets", tr("commands.dashboard.btnTickets"), cfg.tickets?.enabled),
    ),
    new ActionRowBuilder().addComponents(
      tog("sanad:dash:toggle:antiraid", tr("commands.dashboard.btnAntiraid"), cfg.antiraid?.enabled),
      tog("sanad:dash:toggle:starboard", tr("commands.dashboard.btnStarboard"), cfg.starboard?.enabled),
      new ButtonBuilder()
        .setCustomId("sanad:dash:refresh")
        .setLabel(tr("commands.dashboard.btnRefresh").slice(0, 80))
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("sanad:dash:post-panel")
        .setLabel(tr("commands.dashboard.btnPostPanel").slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("sanad:dash:post-ticket")
        .setLabel(tr("commands.dashboard.btnPostTicket").slice(0, 80))
        .setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("sanad:dash:end")
        .setLabel(tr("commands.dashboard.btnEnd").slice(0, 80))
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

async function renderDashboard(client, serverId, tr) {
  const cfg = getGuild(serverId);
  const embed = await buildDashboardEmbed(client, serverId, tr);
  return {
    embeds: [embed],
    components: dashboardButtons(tr, cfg),
  };
}

const TOGGLE_PATH = {
  welcome: (c) => {
    c.welcome.enabled = !c.welcome.enabled;
  },
  goodbye: (c) => {
    if (!c.goodbye) c.goodbye = { enabled: false, channelId: null, message: null };
    c.goodbye.enabled = !c.goodbye.enabled;
  },
  leveling: (c) => {
    c.leveling.enabled = !c.leveling.enabled;
  },
  automod: (c) => {
    c.automod.enabled = !c.automod.enabled;
  },
  tickets: (c) => {
    c.tickets.enabled = !c.tickets.enabled;
  },
  antiraid: (c) => {
    c.antiraid.enabled = !c.antiraid.enabled;
  },
  starboard: (c) => {
    c.starboard.enabled = !c.starboard.enabled;
  },
};

export function dashboardCommands() {
  return [
    new SlashCommandBuilder("dashboard", "Admin control panel with stats")
      .describe({
        en: "Admin control panel with stats",
        ar: "لوحة تحكم الإدارة مع الإحصائيات",
      })
      .permissions(Permissions.ManageServer),
  ];
}

export function registerDashboard(client) {
  client.command("dashboard", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });
    const payload = await renderDashboard(client, i.serverId, tr);
    await i.editReply(payload);
  });

  const refresh = async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    const payload = await renderDashboard(client, i.serverId, tr);
    try {
      if (i.deferred || i.replied) return i.editReply(payload);
      return i.update(payload);
    } catch {
      return i.reply({ ...payload, ephemeral: true });
    }
  };

  client.component("sanad:dash:refresh", refresh);

  client.component("sanad:dash:end", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    const payload = {
      embeds: [
        baseEmbed(BRAND.colour.mute, brandFooter(tr))
          .title(tr("commands.dashboard.title", { name: tr("brand.name") }))
          .description(tr("commands.dashboard.closed")),
      ],
      components: [],
    };
    try {
      if (i.deferred || i.replied) return i.editReply(payload);
      return i.update(payload);
    } catch {
      return i.reply({ ...payload, ephemeral: true });
    }
  });

  client.component("sanad:dash:toggle:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    const key = String(i.customId || "").replace("sanad:dash:toggle:", "");
    const fn = TOGGLE_PATH[key];
    if (!fn) return i.reply({ content: tr("common.error"), ephemeral: true });
    const before = getGuild(i.serverId);
    const turningOn =
      (key === "welcome" && !before.welcome?.enabled) ||
      (key === "goodbye" && !before.goodbye?.enabled) ||
      (key === "starboard" && !before.starboard?.enabled);
    updateGuild(i.serverId, fn);
    const after = getGuild(i.serverId);
    let warn = null;
    if (turningOn && key === "welcome" && after.welcome?.enabled && !after.welcome?.channelId) {
      warn = tr("commands.dashboard.warnWelcomeChannel");
    }
    if (turningOn && key === "goodbye" && after.goodbye?.enabled && !after.goodbye?.channelId) {
      warn = tr("commands.dashboard.warnGoodbyeChannel");
    }
    if (turningOn && key === "starboard" && after.starboard?.enabled && !after.starboard?.channelId) {
      warn = tr("commands.dashboard.warnStarboardChannel");
    }
    const payload = await renderDashboard(client, i.serverId, tr);
    if (warn) payload.content = warn;
    try {
      await i.update(payload);
    } catch {
      await i.reply({ ...payload, ephemeral: true });
    }
  });

  client.component("sanad:dash:post-panel", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });
    try {
      await postPanel(client, i.channelId, getGuild(i.serverId), tr);
      await i.editReply(tr("commands.panel.posted"));
    } catch (error) {
      console.warn("[sanad:dash:panel]", error?.message || error);
      await i.editReply(tr("commands.panel.fail"));
    }
  });

  client.component("sanad:dash:post-ticket", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!i.has(Permissions.ManageServer)) {
      return i.reply({ content: tr("common.noPermission"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });
    try {
      const { postTicketOpenPanel } = await import("./tickets.js");
      await postTicketOpenPanel(client, i.channelId, tr);
      await i.editReply(tr("commands.ticket.panelPosted"));
    } catch (error) {
      console.warn("[sanad:dash:ticket]", error?.message || error);
      await i.editReply(tr("common.error"));
    }
  });
}
