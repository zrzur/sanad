import { Permissions } from "@zrzur/sdk/bot";
import { addWarn, clearWarns } from "../db/store.js";
import { explain } from "../util/errors.js";
import { formatDuration, parseDuration } from "../util/format.js";
import { recordModCase } from "../modules/moderation.js";
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
      if (target === ctx.userId) return ctx.reply(ctx.t("common.selfAction"));
      try {
        await ctx.client.members.ban(ctx.serverId, target, { reason });
        const { caseId } = await recordModCase(ctx.client, ctx, {
          type: "ban",
          targetId: target,
          reason,
          tr: ctx.t,
        });
        return ctx.reply(ctx.t("commands.ban.done", { user: mentionUser(target), case: caseId }));
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
      if (target === ctx.userId) return ctx.reply(ctx.t("common.selfAction"));
      try {
        await ctx.client.members.kick(ctx.serverId, target);
        const { caseId } = await recordModCase(ctx.client, ctx, {
          type: "kick",
          targetId: target,
          reason,
          tr: ctx.t,
        });
        return ctx.reply(ctx.t("commands.kick.done", { user: mentionUser(target), case: caseId }));
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
      if (target === ctx.userId) return ctx.reply(ctx.t("common.selfAction"));
      try {
        await ctx.client.members.timeout(ctx.serverId, target, seconds);
        const duration = formatDuration(seconds, ctx.locale);
        const { caseId } = await recordModCase(ctx.client, ctx, {
          type: "timeout",
          targetId: target,
          reason,
          extra: { duration },
          tr: ctx.t,
        });
        return ctx.reply(
          ctx.t("commands.timeout.done", {
            user: mentionUser(target),
            duration,
            case: caseId,
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
      const { overviewEmbed } = await import("../modules/setup.js");
      const { getGuild } = await import("../db/store.js");
      return ctx.reply({ embeds: [overviewEmbed(getGuild(ctx.serverId), ctx.t)] });
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
      const target = parseUserArg(ctx.args[0]);
      const reason = ctx.args.slice(1).join(" ") || ctx.t("common.none");
      if (!target) return ctx.reply(ctx.t("common.error"));
      if (target === ctx.userId) return ctx.reply(ctx.t("common.selfAction"));
      const warn = {
        id: Date.now().toString(36),
        reason,
        moderatorId: ctx.userId,
        at: new Date().toISOString(),
      };
      const list = addWarn(ctx.serverId, target, warn);
      const { caseId } = await recordModCase(ctx.client, ctx, {
        type: "warn",
        targetId: target,
        reason,
        tr: ctx.t,
      });
      await ctx.client.users.sendDM(target, ctx.t("commands.warn.dm", { reason })).catch(() => {});
      return ctx.reply(
        ctx.t("commands.warn.done", {
          user: mentionUser(target),
          count: list.length,
          case: caseId,
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
      const filterUser = parseUserArg(ctx.args[1]);
      try {
        const fetchLimit = filterUser ? Math.min(100, Math.max(amount * 3, amount)) : amount;
        const msgs = await ctx.client.messages.fetchMany(ctx.channelId, { limit: fetchLimit });
        let list = Array.isArray(msgs) ? msgs : msgs?.messages || [];
        if (filterUser) {
          list = list
            .filter((m) => String(m.author || m.author_id || "") === filterUser)
            .slice(0, amount);
        }
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

  registry.register({
    name: "unban",
    slash: false,
    aliases: ["فك"],
    permission: Permissions.BanMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]) || ctx.args[0];
      const reason = ctx.args.slice(1).join(" ") || "";
      if (!target) return ctx.reply(ctx.t("common.error"));
      try {
        await ctx.client.members.unban(ctx.serverId, target);
        const { caseId } = await recordModCase(ctx.client, ctx, {
          type: "unban",
          targetId: target,
          reason,
          tr: ctx.t,
        });
        return ctx.reply(ctx.t("commands.unban.done", { user: mentionUser(target), case: caseId }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "untimeout",
    slash: false,
    aliases: ["فككتم", "unmute"],
    permission: Permissions.TimeoutMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      if (!target) return ctx.reply(ctx.t("common.error"));
      try {
        await ctx.client.members.timeout(ctx.serverId, target, 0);
        return ctx.reply(ctx.t("commands.untimeout.done", { user: mentionUser(target) }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "warnings",
    slash: false,
    aliases: ["تحذيرات", "warns"],
    permission: Permissions.KickMembers,
    async execute(ctx) {
      const { getWarns } = await import("../db/store.js");
      const target = parseUserArg(ctx.args[0]) || ctx.userId;
      const list = getWarns(ctx.serverId, target);
      if (!list.length) return ctx.reply(ctx.t("commands.warnings.empty"));
      const lines = list
        .slice(-15)
        .map((w, n) => `${n + 1}. ${w.reason} — <@${w.moderatorId}> · ${String(w.at).slice(0, 10)}`)
        .join("\n");
      return ctx.reply(ctx.t("commands.warnings.list", { user: mentionUser(target), lines }));
    },
  });

  registry.register({
    name: "clearwarns",
    slash: false,
    aliases: ["مسحتحذير"],
    permission: Permissions.BanMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      if (!target) return ctx.reply(ctx.t("common.error"));
      clearWarns(ctx.serverId, target);
      return ctx.reply(ctx.t("commands.clearwarns.done", { user: mentionUser(target) }));
    },
  });

  registry.register({
    name: "cases",
    slash: false,
    aliases: ["قضايا"],
    permission: Permissions.KickMembers,
    async execute(ctx) {
      const { listCases } = await import("../db/store.js");
      const target = parseUserArg(ctx.args[0]);
      const items = listCases(ctx.serverId, target, 12);
      if (!items.length) return ctx.reply(ctx.t("commands.cases.empty"));
      const lines = items
        .map((c) => `#${c.id} · **${c.type}** · <@${c.targetId}> · ${String(c.reason || "").slice(0, 60)}`)
        .join("\n");
      return ctx.reply(lines);
    },
  });

  registry.register({
    name: "slowmode",
    slash: false,
    aliases: ["بطء"],
    permission: Permissions.ManageChannel,
    async execute(ctx) {
      const seconds = Math.max(0, Math.min(21600, Number(ctx.args[0]) || 0));
      try {
        await ctx.client.channels.edit(ctx.channelId, { slowmode: seconds || null });
        return ctx.reply(
          seconds ? ctx.t("commands.slowmode.on", { seconds }) : ctx.t("commands.slowmode.off"),
        );
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "softban",
    slash: false,
    aliases: ["حظرخفيف"],
    permission: Permissions.BanMembers,
    async execute(ctx) {
      const target = parseUserArg(ctx.args[0]);
      const reason = ctx.args.slice(1).join(" ") || "softban";
      if (!target) return ctx.reply(ctx.t("common.error"));
      if (target === ctx.userId) return ctx.reply(ctx.t("common.selfAction"));
      try {
        await ctx.client.members.ban(ctx.serverId, target, { reason: `softban: ${reason}` });
        await ctx.client.members.unban(ctx.serverId, target);
        const { caseId } = await recordModCase(ctx.client, ctx, {
          type: "softban",
          targetId: target,
          reason,
          tr: ctx.t,
        });
        return ctx.reply(ctx.t("commands.softban.done", { user: mentionUser(target), case: caseId }));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });

  registry.register({
    name: "serverinfo",
    slash: false,
    aliases: ["سيرفر", "si"],
    async execute(ctx) {
      const { baseEmbed } = await import("../util/format.js");
      const { BRAND } = await import("../brand.js");
      try {
        const server = await ctx.client.rest.get(`/servers/${ctx.serverId}`);
        return ctx.reply({
          embeds: [
            baseEmbed(BRAND.colour.info)
              .title(server.name)
              .field(ctx.t("commands.serverinfo.id"), server._id, true)
              .field(ctx.t("commands.serverinfo.owner"), mentionUser(server.owner), true)
              .field(
                ctx.t("commands.serverinfo.desc"),
                (server.description || ctx.t("common.none")).slice(0, 500),
                false,
              ),
          ],
        });
      } catch {
        return ctx.reply(ctx.t("common.error"));
      }
    },
  });

  registry.register({
    name: "userinfo",
    slash: false,
    aliases: ["عضو", "ui", "whois"],
    async execute(ctx) {
      const { baseEmbed } = await import("../util/format.js");
      const { BRAND } = await import("../brand.js");
      const { userAvatarUrl } = await import("../util/media.js");
      const target = parseUserArg(ctx.args[0]) || ctx.userId;
      try {
        const user = await ctx.client.rest.get(`/users/${target}`);
        const member = await ctx.client.rest
          .get(`/servers/${ctx.serverId}/members/${target}`)
          .catch(() => null);
        const avatar = await userAvatarUrl(ctx.client, user);
        const embed = baseEmbed(BRAND.colour.info)
          .title(user.display_name || user.username)
          .field(ctx.t("commands.userinfo.id"), user._id, true)
          .field(
            ctx.t("commands.userinfo.joined"),
            member?.joined_at?.slice(0, 19) || ctx.t("common.none"),
            true,
          )
          .field(ctx.t("commands.userinfo.roles"), String(member?.roles?.length ?? 0), true);
        if (avatar) embed.icon(avatar);
        return ctx.reply({ embeds: [embed] });
      } catch {
        return ctx.reply(ctx.t("common.error"));
      }
    },
  });

  registry.register({
    name: "avatar",
    slash: false,
    aliases: ["افتار", "av", "pfp"],
    async execute(ctx) {
      const { baseEmbed } = await import("../util/format.js");
      const { BRAND } = await import("../brand.js");
      const { userAvatarUrl } = await import("../util/media.js");
      const target = parseUserArg(ctx.args[0]) || ctx.userId;
      try {
        const user = await ctx.client.rest.get(`/users/${target}`);
        const avatar = await userAvatarUrl(ctx.client, user);
        if (!avatar) return ctx.reply(ctx.t("commands.avatar.none"));
        const embed = baseEmbed(BRAND.colour.info)
          .title(user.display_name || user.username)
          .toJSON();
        embed.image_url = avatar;
        return ctx.reply({ embeds: [embed] });
      } catch {
        return ctx.reply(ctx.t("common.error"));
      }
    },
  });

  registry.register({
    name: "say",
    slash: false,
    aliases: ["قل"],
    permission: Permissions.ManageMessages,
    async execute(ctx) {
      const text = ctx.args.join(" ").trim();
      if (!text) return ctx.reply(ctx.t("common.error"));
      try {
        if (ctx.message?.id) {
          await ctx.client.messages.delete(ctx.channelId, ctx.message.id).catch(() => {});
        }
        return ctx.client.send(ctx.channelId, text.slice(0, 2000));
      } catch (e) {
        return ctx.reply(explain(e, ctx.locale));
      }
    },
  });
}
