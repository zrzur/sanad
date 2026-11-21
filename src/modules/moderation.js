import { Permissions, SlashCommandBuilder, contextCommand } from "@zrzur/sdk/bot";
import { BRAND, mentionUser, userId } from "../brand.js";
import { addCase, addWarn, clearWarns, getWarns, listCases, nextCase } from "../db/store.js";
import { explain } from "../util/errors.js";
import { formatDuration, modEmbed, parseDuration } from "../util/format.js";
import { guildT } from "../util/locale.js";
import { sendLog } from "../util/logs.js";

/** Shared mod-case writer used by slash + prefix bridges. */
export async function recordModCase(client, ctx, { type, targetId, reason, extra, tr, moderatorId }) {
  const { t: translate, locale } = tr
    ? { t: tr, locale: ctx.locale ?? null }
    : guildT(ctx.serverId, ctx.locale);
  const caseId = nextCase(ctx.serverId);
  const modId = moderatorId || userId(ctx.user) || ctx.userId;
  const entry = {
    id: caseId,
    type,
    targetId,
    moderatorId: modId,
    reason: reason || translate("common.none"),
    at: new Date().toISOString(),
    ...extra,
  };
  addCase(ctx.serverId, entry);
  const embed = modEmbed({
    title: `${type} · #${caseId}`,
    targetId,
    moderatorId: entry.moderatorId,
    reason: entry.reason,
    caseId,
    duration: extra?.duration,
    tr: translate,
    colour:
      type === "ban" || type === "softban"
        ? BRAND.colour.danger
        : type === "kick"
          ? BRAND.colour.warning
          : BRAND.colour.info,
  });
  await sendLog(client, ctx.serverId, embed, "mod");
  return { caseId, locale };
}

async function record(client, i, opts) {
  return recordModCase(client, i, opts);
}

export function moderationCommands() {
  return [
    new SlashCommandBuilder("ban", "Ban a member")
      .describe({ en: "Ban a member", ar: "حظر عضو" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .string("reason", "Reason", { maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.BanMembers),
    new SlashCommandBuilder("unban", "Unban a member")
      .describe({ en: "Unban a member", ar: "فك حظر عضو" })
      .string("user_id", "User id", { required: true, descriptions: { ar: "معرّف العضو" } })
      .string("reason", "Reason", { maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.BanMembers),
    new SlashCommandBuilder("kick", "Kick a member")
      .describe({ en: "Kick a member", ar: "طرد عضو" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .string("reason", "Reason", { maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.KickMembers),
    new SlashCommandBuilder("timeout", "Timeout a member")
      .describe({ en: "Timeout a member", ar: "إيقاف مؤقت" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .string("duration", "Duration (10m / 1h)", { required: true, descriptions: { ar: "المدة" } })
      .string("reason", "Reason", { maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.TimeoutMembers),
    new SlashCommandBuilder("untimeout", "Remove a timeout")
      .describe({ en: "Remove a timeout", ar: "إنهاء الإيقاف المؤقت" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .permissions(Permissions.TimeoutMembers),
    new SlashCommandBuilder("warn", "Warn a member")
      .describe({ en: "Warn a member", ar: "تحذير عضو" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .string("reason", "Reason", { required: true, maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.KickMembers),
    new SlashCommandBuilder("warnings", "List warnings")
      .describe({ en: "List warnings", ar: "عرض تحذيرات عضو" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .permissions(Permissions.KickMembers),
    new SlashCommandBuilder("clearwarns", "Clear warnings")
      .describe({ en: "Clear warnings", ar: "مسح تحذيرات عضو" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .permissions(Permissions.BanMembers),
    new SlashCommandBuilder("purge", "Bulk delete messages")
      .describe({ en: "Bulk delete messages", ar: "حذف رسائل" })
      .integer("amount", "Count (1–100)", { required: true, min: 1, max: 100, descriptions: { ar: "العدد" } })
      .user("user", "Filter by member", { descriptions: { ar: "تصفية لعضو" } })
      .permissions(Permissions.ManageMessages),
    new SlashCommandBuilder("softban", "Softban a member")
      .describe({ en: "Ban then instantly unban", ar: "حظر ثم فك فوراً" })
      .user("user", "Member", { required: true, descriptions: { ar: "العضو" } })
      .string("reason", "Reason", { maxLength: 200, descriptions: { ar: "السبب" } })
      .permissions(Permissions.BanMembers),
    new SlashCommandBuilder("cases", "Moderation case log")
      .describe({ en: "Moderation case log", ar: "سجل العقوبات" })
      .user("user", "Filter by member", { descriptions: { ar: "تصفية لعضو" } })
      .permissions(Permissions.KickMembers),
    new SlashCommandBuilder("slowmode", "Channel slowmode")
      .describe({ en: "Channel slowmode", ar: "وضع البطء للقناة" })
      .integer("seconds", "Seconds (0 to clear)", { required: true, min: 0, max: 21600, descriptions: { ar: "الثواني" } })
      .permissions(Permissions.ManageChannel),
    new SlashCommandBuilder("lock", "Lock the channel")
      .describe({ en: "Lock the channel", ar: "قفل القناة" })
      .string("reason", "Reason", { descriptions: { ar: "السبب" } })
      .permissions(Permissions.ManageChannel),
    new SlashCommandBuilder("unlock", "Unlock the channel")
      .describe({ en: "Unlock the channel", ar: "فتح القناة" })
      .permissions(Permissions.ManageChannel),
    contextCommand("User", "Timeout 10m", { en: "Timeout 10m", ar: "إيقاف 10د" }),
    contextCommand("User", "Kick", { en: "Kick", ar: "طرد" }),
  ];
}

export function registerModeration(client) {
  client.command("ban", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    if (target === userId(i.user)) {
      return i.reply({ content: tr("common.selfAction"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });
    const reason = i.option("reason") ?? "";
    try {
      await client.members.ban(i.serverId, target, {
        reason: `${reason} (by ${i.user.username})`.trim().slice(0, 1024),
      });
      const { caseId } = await record(client, i, { type: "ban", targetId: target, reason, tr });
      await i.editReply(tr("commands.ban.done", { user: mentionUser(target), case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("unban", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    const target = String(i.option("user_id")).trim();
    const reason = i.option("reason") ?? "";
    try {
      await client.members.unban(i.serverId, target);
      const { caseId } = await record(client, i, { type: "unban", targetId: target, reason, tr });
      await i.editReply(tr("commands.unban.done", { user: mentionUser(target), case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("kick", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    await i.defer({ ephemeral: true });
    const reason = i.option("reason") ?? "";
    try {
      await client.members.kick(i.serverId, target);
      const { caseId } = await record(client, i, { type: "kick", targetId: target, reason, tr });
      await i.editReply(tr("commands.kick.done", { user: mentionUser(target), case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("timeout", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    const seconds = parseDuration(i.option("duration"));
    if (!seconds || seconds < 1) {
      return i.reply({ content: tr("common.invalidDuration"), ephemeral: true });
    }
    await i.defer({ ephemeral: true });
    const reason = i.option("reason") ?? "";
    const dur = formatDuration(seconds, locale);
    try {
      await client.members.timeout(i.serverId, target, seconds);
      const { caseId } = await record(client, i, {
        type: "timeout",
        targetId: target,
        reason,
        extra: { duration: dur },
        tr,
      });
      await i.editReply(tr("commands.timeout.done", { user: mentionUser(target), duration: dur, case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("Timeout 10m", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    const dur = formatDuration(600, locale);
    try {
      await client.members.timeout(i.serverId, i.targetId, 600);
      const { caseId } = await record(client, i, {
        type: "timeout",
        targetId: i.targetId,
        reason: "Timeout 10m (context)",
        extra: { duration: dur },
        tr,
      });
      await i.editReply(tr("commands.timeout.done", { user: mentionUser(i.targetId), duration: dur, case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("Kick", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    try {
      await client.members.kick(i.serverId, i.targetId);
      const { caseId } = await record(client, i, {
        type: "kick",
        targetId: i.targetId,
        reason: "Kick (context)",
        tr,
      });
      await i.editReply(tr("commands.kick.done", { user: mentionUser(i.targetId), case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("untimeout", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    await i.defer({ ephemeral: true });
    try {
      await client.members.timeout(i.serverId, target, 0);
      await i.editReply(tr("commands.untimeout.done", { user: mentionUser(target) }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("warn", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    const reason = i.option("reason");
    const warn = {
      id: Date.now().toString(36),
      reason,
      moderatorId: userId(i.user),
      at: new Date().toISOString(),
    };
    const list = addWarn(i.serverId, target, warn);
    const { caseId } = await record(client, i, { type: "warn", targetId: target, reason, tr });
    await i.reply({
      content: tr("commands.warn.done", {
        user: mentionUser(target),
        count: list.length,
        case: caseId,
        reason,
      }),
      ephemeral: true,
    });
    await client.users
      .sendDM(target, tr("commands.warn.dm", { reason }))
      .catch(() => {});
  });

  client.command("warnings", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    const list = getWarns(i.serverId, target);
    if (!list.length) return i.reply({ content: tr("commands.warnings.empty"), ephemeral: true });
    const lines = list
      .slice(-15)
      .map((w, n) => `${n + 1}. ${w.reason} — <@${w.moderatorId}> · ${w.at.slice(0, 10)}`)
      .join("\n");
    await i.reply({
      content: tr("commands.warnings.list", { user: mentionUser(target), lines }),
      ephemeral: true,
    });
  });

  client.command("clearwarns", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    clearWarns(i.serverId, target);
    await i.reply({
      content: tr("commands.clearwarns.done", { user: mentionUser(target) }),
      ephemeral: true,
    });
  });

  client.command("purge", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    const amount = i.option("amount");
    const onlyUser = i.option("user");
    try {
      const messages = await client.messages.fetchMany(i.channelId, { limit: Math.min(100, amount) });
      const ids = messages
        .filter((m) => !onlyUser || m.author === onlyUser)
        .slice(0, amount)
        .map((m) => m._id);
      if (!ids.length) return i.editReply(tr("commands.purge.empty"));
      await client.messages.bulkDelete(i.channelId, ids);
      await i.editReply(tr("commands.purge.done", { count: ids.length }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("softban", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    const reason = i.option("reason") ?? "softban";
    await i.defer({ ephemeral: true });
    try {
      await client.members.ban(i.serverId, target, { reason: `softban: ${reason}` });
      await client.members.unban(i.serverId, target);
      const { caseId } = await record(client, i, { type: "softban", targetId: target, reason, tr });
      await i.editReply(tr("commands.softban.done", { user: mentionUser(target), case: caseId }));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("cases", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user");
    const items = listCases(i.serverId, target, 12);
    if (!items.length) return i.reply({ content: tr("commands.cases.empty"), ephemeral: true });
    const lines = items
      .map((c) => `#${c.id} · **${c.type}** · <@${c.targetId}> · ${c.reason.slice(0, 60)}`)
      .join("\n");
    await i.reply({ content: lines, ephemeral: true });
  });

  client.command("slowmode", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const seconds = i.option("seconds");
    await i.defer({ ephemeral: true });
    try {
      await client.channels.edit(i.channelId, { slowmode: seconds || null });
      await i.editReply(
        seconds ? tr("commands.slowmode.on", { seconds }) : tr("commands.slowmode.off"),
      );
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("lock", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    try {
      await client.channels.setPermissions(i.channelId, "default", 0, Permissions.SendMessage);
      await i.editReply(tr("commands.lock.done"));
      await client.send(i.channelId, {
        embeds: [
          modEmbed({
            title: tr("commands.lock.done"),
            moderatorId: userId(i.user),
            reason: i.option("reason") || tr("common.none"),
            colour: BRAND.colour.warning,
            tr,
          }),
        ],
      });
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });

  client.command("unlock", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    await i.defer({ ephemeral: true });
    try {
      await client.channels.setPermissions(i.channelId, "default", Permissions.SendMessage, 0);
      await i.editReply(tr("commands.unlock.done"));
    } catch (error) {
      await i.editReply(explain(error, locale));
    }
  });
}
