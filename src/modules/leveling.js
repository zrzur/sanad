import { SlashCommandBuilder } from "@zrzur/sdk/bot";
import { BRAND, mentionUser, userId } from "../brand.js";
import { t } from "../core/i18n.js";
import { getGuild, getLevel, leaderboard, setLevel } from "../db/store.js";
import { baseEmbed, brandFooter, levelFromXp, progressBar, xpForLevel } from "../util/format.js";
import { guildT } from "../util/locale.js";
import { userAvatarUrl } from "../util/media.js";

export function levelingCommands() {
  return [
    new SlashCommandBuilder("rank", t("en", "commands.rank.description"))
      .describe({ en: t("en", "commands.rank.description"), ar: t("ar", "commands.rank.description") })
      .user("user", t("en", "commands.rank.options.user"), {
        descriptions: { ar: t("ar", "commands.rank.options.user") },
      }),
    new SlashCommandBuilder("leaderboard", t("en", "commands.leaderboard.description")).describe({
      en: t("en", "commands.leaderboard.description"),
      ar: t("ar", "commands.leaderboard.description"),
    }),
  ];
}

export function registerLeveling(client) {
  client.command("rank", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const target = i.option("user") ?? userId(i.user);
    const data = getLevel(i.serverId, target);
    data.level = levelFromXp(data.xp);
    const level = data.level;
    setLevel(i.serverId, target, data);
    const current = data.xp - xpForLevel(level);
    const need = xpForLevel(level + 1) - xpForLevel(level);

    let displayName = mentionUser(target);
    let avatar = null;
    try {
      const user = await client.rest.get(`/users/${target}`);
      displayName = user.display_name || user.username || displayName;
      avatar = await userAvatarUrl(client, user);
    } catch {
      /* keep mention */
    }

    const embed = baseEmbed(BRAND.colour.level, brandFooter(tr))
      .title(tr("commands.rank.title", { user: displayName }))
      .field(tr("commands.rank.level"), String(level), true)
      .field(tr("commands.rank.xp"), String(data.xp), true)
      .field(tr("commands.rank.progress"), `${progressBar(current, need)} ${current}/${need}`, false);
    if (avatar) embed.icon(avatar);

    await i.reply({ embeds: [embed] });
  });

  client.command("leaderboard", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const top = leaderboard(i.serverId, 10).map((row) => {
      const level = levelFromXp(row.xp);
      if (level !== row.level) setLevel(i.serverId, row.userId, { ...row, level });
      return { ...row, level };
    });
    if (!top.length) return i.reply({ content: tr("commands.leaderboard.empty") });
    const lines = top.map((row, n) => `**${n + 1}.** <@${row.userId}> — Lv **${row.level}** · ${row.xp} XP`);
    const embed = baseEmbed(BRAND.colour.level, brandFooter(tr))
      .title(tr("commands.leaderboard.title"))
      .description(lines.join("\n"));
    await i.reply({ embeds: [embed] });
  });
}

function isNonHumanAuthor(client, message) {
  const uid = message?.author;
  if (!uid || uid === "00000000000000000000000000") return true;
  const self = client.user?.id || client.user?._id;
  if (self && uid === self) return true;
  const u = message.user;
  if (u?.bot || u?.official_bot || u?.official) return true;
  return false;
}

export async function handleLevelMessage(client, message) {
  if (isNonHumanAuthor(client, message)) return;

  let sid = message.server;
  if (!sid) {
    try {
      const ch = await client.rest.get(`/channels/${message.channel}`);
      sid = ch.server;
    } catch {
      return;
    }
  }
  if (!sid) return;

  const cfg = getGuild(sid);
  if (!cfg.leveling.enabled) return;
  if (cfg.leveling.ignoredChannels.includes(message.channel)) return;

  const uid = message.author;
  const data = getLevel(sid, uid);
  const now = Date.now();
  if (now - (data.lastXpAt || 0) < cfg.leveling.cooldownSec * 1000) return;

  const gain =
    cfg.leveling.xpMin + Math.floor(Math.random() * (cfg.leveling.xpMax - cfg.leveling.xpMin + 1));
  const prevLevel = data.level;
  data.xp += gain;
  data.level = levelFromXp(data.xp);
  data.lastXpAt = now;
  setLevel(sid, uid, data);

  if (data.level > prevLevel) {
    const { t: tr } = guildT(sid);
    const text = (cfg.leveling.levelUpMessage || tr("leveling.levelUp"))
      .replaceAll("{user}", mentionUser(uid))
      .replaceAll("{level}", String(data.level));
    const channelId = cfg.leveling.levelUpChannelId || message.channel;
    try {
      await client.send(channelId, text);
    } catch (error) {
      console.warn("[sanad:levelup]", error?.message || error);
    }

    for (const reward of cfg.leveling.rewards) {
      if (reward.level === data.level) {
        await client.members.addRole(sid, uid, reward.roleId).catch((error) => {
          console.warn("[sanad:level-reward]", error?.message || error);
        });
      }
    }
  }
}
