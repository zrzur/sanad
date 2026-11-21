import { Permissions } from "@zrzur/sdk/bot";
import { BRAND, mentionUser } from "../brand.js";
import { addWarn, getGuild } from "../db/store.js";
import { guildT } from "../util/locale.js";
import { logAction } from "../util/logs.js";

const recent = new Map(); // `${server}:${user}` -> timestamps[]
const joins = new Map(); // serverId -> timestamps[]

const INVITE_RE = /(zrzur\.com\/invite|discord\.gg\/|discord\.com\/invite)/i;
const URL_RE = /https?:\/\/\S+/i;

async function memberRoles(client, serverId, message) {
  const embedded = message?.member?.roles;
  if (Array.isArray(embedded) && embedded.length) return embedded;
  try {
    const me = await client.rest.get(`/servers/${serverId}/members/${message.author}`);
    const member = me?.member ?? me;
    return Array.isArray(member?.roles) ? member.roles : [];
  } catch {
    return [];
  }
}

export async function handleAutomod(client, message) {
  let serverId = message.server;
  if (!serverId) {
    try {
      const ch = await client.rest.get(`/channels/${message.channel}`);
      serverId = ch.server;
    } catch {
      return false;
    }
  }
  if (!serverId) return false;

  const cfg = getGuild(serverId);
  if (!cfg.automod.enabled) return false;
  if (cfg.automod.ignoreChannels.includes(message.channel)) return false;

  if (cfg.automod.ignoreRoles?.length) {
    const roles = await memberRoles(client, serverId, message);
    if (cfg.automod.ignoreRoles.some((r) => roles.includes(r))) return false;
  }

  const { t: tr } = guildT(serverId);
  const content = message.content || "";
  const author = message.author;
  const reasons = [];

  if (cfg.automod.antiSpam) {
    const key = `${serverId}:${author}`;
    const now = Date.now();
    const list = (recent.get(key) || []).filter((t) => now - t < 7000);
    list.push(now);
    recent.set(key, list);
    if (list.length >= 6) reasons.push(tr("automod.reasons.spam"));
  }

  if (cfg.automod.antiInvites && INVITE_RE.test(content)) reasons.push(tr("automod.reasons.invite"));
  if (cfg.automod.antiLinks && URL_RE.test(content)) reasons.push(tr("automod.reasons.link"));

  if (cfg.automod.maxMentions > 0) {
    const mentions = (content.match(/<@[0-9A-HJKMNP-TV-Z]{26}>/gi) || []).length;
    if (mentions > cfg.automod.maxMentions) reasons.push(tr("automod.reasons.mentions"));
  }

  if (content.length >= cfg.automod.minCapsLength) {
    const letters = content.replace(/[^a-zA-Z\u0600-\u06FF]/g, "");
    if (letters.length >= cfg.automod.minCapsLength) {
      const latin = letters.replace(/[^a-zA-Z]/g, "");
      if (latin.length >= cfg.automod.minCapsLength) {
        const upper = latin.replace(/[^A-Z]/g, "").length;
        if ((upper / latin.length) * 100 >= cfg.automod.maxCapsPercent) {
          reasons.push(tr("automod.reasons.caps"));
        }
      }
    }
  }

  const lower = content.toLowerCase();
  for (const word of cfg.automod.badWords) {
    if (word && lower.includes(word)) {
      reasons.push(tr("automod.reasons.badWord"));
      break;
    }
  }

  if (!reasons.length) return false;

  await client.messages.delete(message.channel, message._id).catch(() => {});

  const reasonText = reasons.join(tr("automod.reasonSep"));

  if (cfg.automod.action === "timeout") {
    await client.members.timeout(serverId, author, cfg.automod.timeoutSeconds).catch(() => {});
  } else if (cfg.automod.action === "warn") {
    addWarn(serverId, author, {
      id: Date.now().toString(36),
      reason: reasonText,
      moderatorId: client.user?.id || client.user?._id || "automod",
      at: new Date().toISOString(),
    });
    await client.users
      .sendDM(author, tr("automod.warnDm", { reason: reasonText }))
      .catch(() => {});
  }

  await client
    .send(message.channel, {
      content: tr("automod.hit", { user: mentionUser(author), reason: reasonText }),
    })
    .catch(() => {});

  await logAction(client, serverId, {
    title: tr("automod.logTitle"),
    description: tr("automod.logBody", { user: mentionUser(author), reason: reasonText }),
    colour: BRAND.colour.warning,
  });

  return true;
}

export function registerAntiRaid(client) {
  client.onMemberJoin(async ({ serverId, userId }) => {
    const cfg = getGuild(serverId);
    if (!cfg.antiraid.enabled) return;
    const { t: tr } = guildT(serverId);

    const now = Date.now();
    const windowMs = cfg.antiraid.joinWindowSec * 1000;
    const list = (joins.get(serverId) || []).filter((t) => now - t < windowMs);
    list.push(now);
    joins.set(serverId, list);

    if (list.length < cfg.antiraid.joinThreshold) return;

    await logAction(client, serverId, {
      title: tr("automod.raidTitle"),
      description: tr("automod.raidBody", {
        count: list.length,
        window: cfg.antiraid.joinWindowSec,
        action: cfg.antiraid.action,
      }),
      colour: BRAND.colour.danger,
    });

    if (cfg.antiraid.action === "kick") {
      await client.members.kick(serverId, userId).catch(() => {});
    } else if (cfg.antiraid.action === "ban") {
      await client.members.ban(serverId, userId, { reason: "anti-raid" }).catch(() => {});
    } else {
      try {
        const server = await client.rest.get(`/servers/${serverId}`);
        const ch = server.system_messages?.user_joined;
        if (ch) {
          await client.channels.setPermissions(ch, "default", 0, Permissions.SendMessage).catch(() => {});
        }
      } catch {
        /* ignore */
      }
    }

    joins.set(serverId, []);
  });
}
