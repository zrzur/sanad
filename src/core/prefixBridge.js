import { Permissions } from "@zrzur/sdk/bot";
import { addCase, nextCase } from "../db/store.js";
import { explain } from "../util/errors.js";
import { formatDuration, parseDuration } from "../util/format.js";
import { mentionUser } from "./context.js";
import { registry } from "./registry.js";

function parseUserArg(arg) {
  if (!arg) return null;
  const m =
    String(arg).match(/^<@!?([0-9A-HJKMNP-TV-Z]{26})>$/i) ||
    String(arg).match(/^([0-9A-HJKMNP-TV-Z]{26})$/i);
  return m ? m[1] : null;
}

/** Prefix-only bridges for core moderation/utility (slash stays in modules/). */
export function registerPrefixBridges() {
  registry.register({
    name: "ban",
    slash: false,
    aliases: ["حظر"],
    permission: Permissions.BanMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      const reason = ctx.args.slice(1).join(" ") || "";
      if (!target) return ctx.reply(ctx.t("common.error"));
      try {
        await ctx.client.members.ban(ctx.serverId, target, { reason });
        const id = nextCase(ctx.serverId);
        addCase(ctx.serverId, {
          id,
          type: "ban",
          targetId: target,
          moderatorId: ctx.userId,
          reason: reason || "—",
          at: new Date().toISOString(),
        });
        return ctx.reply(ctx.t("commands.ban.done", { user: mentionUser(target), case: id }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "kick",
    slash: false,
    aliases: ["طرد"],
    permission: Permissions.KickMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      const reason = ctx.args.slice(1).join(" ") || "";
      if (!target) return ctx.reply(ctx.t("common.error"));
      try {
        await ctx.client.members.kick(ctx.serverId, target);
        const id = nextCase(ctx.serverId);
        addCase(ctx.serverId, {
          id,
          type: "kick",
          targetId: target,
          moderatorId: ctx.userId,
          reason,
          at: new Date().toISOString(),
        });
        return ctx.reply(ctx.t("commands.kick.done", { user: mentionUser(target), case: id }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "timeout",
    slash: false,
    aliases: ["كتم", "mute"],
    permission: Permissions.TimeoutMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      const seconds = parseDuration(ctx.args[1]);
      const reason = ctx.args.slice(2).join(" ") || "";
      if (!target || !seconds) return ctx.reply(ctx.t("common.invalidDuration"));
      try {
        await ctx.client.members.timeout(ctx.serverId, target, seconds);
        const id = nextCase(ctx.serverId);
        addCase(ctx.serverId, {
          id,
          type: "timeout",
          targetId: target,
          moderatorId: ctx.userId,
          reason,
          at: new Date().toISOString(),
          duration: formatDuration(seconds),
        });
        return ctx.reply(
          ctx.t("commands.timeout.done", {
            user: mentionUser(target),
            duration: formatDuration(seconds),
            case: id,
          }),
        );
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "ping",
    slash: false,
    aliases: ["بنج"],
    async execute(ctx) {
      const t0 = Date.now();
      const sent = await ctx.reply("…");
      const ms = Date.now() - t0;
      const id = sent?.id ?? sent?._id;
      const pong = ctx.t("commands.ping.pong", { ms });
      if (id) {
        try {
          await ctx.client.editMessage(ctx.channelId, id, pong);
        } catch (error) {
          console.warn("[sanad:ping] edit:", error?.message || error);
          await ctx.reply(pong);
        }
      } else {
        await ctx.reply(pong);
      }
    },
  });

  registry.register({
    name: "setup",
    slash: false,
    aliases: ["إعداد"],
    permission: Permissions.ManageServer,
    async execute(ctx) {
      return ctx.reply(ctx.t("commands.setup.useSlash"));
    },
  });

  registry.register({
    name: "dashboard",
    slash: false,
    aliases: ["لوحةتحكم", "dash", "admin"],
    permission: Permissions.ManageServer,
    async execute(ctx) {
      const { buildDashboardEmbed, dashboardButtons } = await import("../modules/dashboard.js");
      const { getGuild } = await import("../db/store.js");
      const cfg = getGuild(ctx.serverId);
      const embed = await buildDashboardEmbed(ctx.client, ctx.serverId, ctx.t);
      return ctx.reply({
        embeds: [embed],
        components: dashboardButtons(ctx.t, cfg),
      });
    },
  });

  registry.register({
    name: "panel",
    slash: false,
    aliases: ["لوحة"],
    permission: Permissions.ManageServer,
    async execute(ctx) {
      const sub = String(ctx.args[0] || "post").toLowerCase();
      if (sub === "set") {
        return ctx.reply(ctx.t("commands.panel.useSlashSet"));
      }
      const { postPanel } = await import("../modules/panel.js");
      const { getGuild } = await import("../db/store.js");
      await postPanel(ctx.client, ctx.channelId, getGuild(ctx.serverId), ctx.t);
      return ctx.reply(ctx.t("commands.panel.posted"));
    },
  });

  registry.register({
    name: "rank",
    slash: false,
    aliases: ["مستوى", "lvl"],
    async execute(ctx) {
      const { getLevel } = await import("../db/store.js");
      const { levelFromXp, progressBar, xpForLevel, baseEmbed } = await import("../util/format.js");
      const { BRAND } = await import("../brand.js");
      const target = parseUserArg(ctx.args[0]) || ctx.userId;
      const data = getLevel(ctx.serverId, target);
      data.level = levelFromXp(data.xp);
      const current = data.xp - xpForLevel(data.level);
      const need = xpForLevel(data.level + 1) - xpForLevel(data.level);
      return ctx.reply({
        embeds: [
          baseEmbed(BRAND.colour.level)
            .title(ctx.t("commands.rank.title", { user: mentionUser(target) }))
            .field(ctx.t("commands.rank.level"), String(data.level), true)
            .field(ctx.t("commands.rank.xp"), String(data.xp), true)
            .field(
              ctx.t("commands.rank.progress"),
              `${progressBar(current, need)} ${current}/${need}`,
              false,
            ),
        ],
      });
    },
  });

  registry.register({
    name: "warn",
    slash: false,
    aliases: ["تحذير"],
    permission: Permissions.KickMembers,
    async execute(ctx) {
      const { addWarn } = await import("../db/store.js");
      const target = parseUserArg(ctx.args[0]);
      const reason = ctx.args.slice(1).join(" ") || ctx.t("common.none");
      if (!target) return ctx.reply(ctx.t("common.error"));
      const warn = {
        id: Date.now().toString(36),
        reason,
        moderatorId: ctx.userId,
        at: new Date().toISOString(),
      };
      const list = addWarn(ctx.serverId, target, warn);
      const id = nextCase(ctx.serverId);
      addCase(ctx.serverId, {
        id,
        type: "warn",
        targetId: target,
        moderatorId: ctx.userId,
        reason,
        at: warn.at,
      });
      await ctx.client.users.sendDM(target, ctx.t("commands.warn.dm", { reason })).catch(() => {});
      return ctx.reply(
        ctx.t("commands.warn.done", {
          user: mentionUser(target),
          count: list.length,
          case: id,
          reason,
        }),
      );
    },
  });

  registry.register({
    name: "purge",
    slash: false,
    aliases: ["مسح", "clear"],
    permission: Permissions.ManageMessages,
    async execute(ctx) {
      const amount = Math.min(100, Math.max(1, Number(ctx.args[0]) || 0));
      if (!amount) return ctx.reply(ctx.t("common.error"));
      try {
        const msgs = await ctx.client.messages.fetchMany(ctx.channelId, { limit: amount });
        const list = Array.isArray(msgs) ? msgs : msgs?.messages || [];
        const ids = list.map((m) => m.id || m._id).filter(Boolean);
        if (!ids.length) return ctx.reply(ctx.t("commands.purge.empty"));
        if (typeof ctx.client.messages.bulkDelete === "function") {
          await ctx.client.messages.bulkDelete(ctx.channelId, ids);
        } else {
          for (const mid of ids) {
            await ctx.client.messages.delete(ctx.channelId, mid).catch(() => {});
          }
        }
        return ctx.reply(ctx.t("commands.purge.done", { count: ids.length }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "lock",
    slash: false,
    aliases: ["قفل"],
    permission: Permissions.ManageChannel,
    async execute(ctx) {
      try {
        await ctx.client.channels.setPermissions(ctx.channelId, "default", 0, Permissions.SendMessage);
        return ctx.reply(ctx.t("commands.lock.done"));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "unlock",
    slash: false,
    aliases: ["فتح"],
    permission: Permissions.ManageChannel,
    async execute(ctx) {
      try {
        await ctx.client.channels.setPermissions(ctx.channelId, "default", Permissions.SendMessage, 0);
        return ctx.reply(ctx.t("commands.unlock.done"));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "leaderboard",
    slash: false,
    aliases: ["المتصدرين", "lb", "top"],
    async execute(ctx) {
      const { leaderboard } = await import("../db/store.js");
      const { baseEmbed } = await import("../util/format.js");
      const { BRAND } = await import("../brand.js");
      const top = leaderboard(ctx.serverId, 10).map((row, idx) => {
        return `**${idx + 1}.** ${mentionUser(row.userId)} — Lv **${row.level}** · ${row.xp} XP`;
      });
      if (!top.length) return ctx.reply(ctx.t("commands.leaderboard.empty"));
      return ctx.reply({
        embeds: [
          baseEmbed(BRAND.colour.level)
            .title(ctx.t("commands.leaderboard.title"))
            .description(top.join("\n")),
        ],
      });
    },
  });
}
