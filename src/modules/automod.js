/**
 * Professional AutoMod + Anti-Raid for Sanad.
 * Callers: createBot.js → handleAutomod / registerAntiRaid; setup.js configures guild.automod.
 * Replaces the prior lightweight automod.js in-place (same exports).
 * Reads: getGuild().automod / antiraid. Writes: addWarn, message delete, timeouts, channel locks.
 * In-memory only for spam/strike/join windows. No secrets.
 * User: develop automod to a very professional level.
 */
import { Permissions } from "@zrzur/sdk/bot";
import { BRAND, mentionUser } from "../brand.js";
import { addWarn, getGuild, updateGuild } from "../db/store.js";
import { guildT } from "../util/locale.js";
import { logAction } from "../util/logs.js";

/** @type {Map<string, number[]>} */
const recentMsgs = new Map();
/** @type {Map<string, { text: string, at: number }[]>} */
const recentBodies = new Map();
/** @type {Map<string, number[]>} */
const recentAttachments = new Map();
/** @type {Map<string, { n: number, at: number }>} */
const strikes = new Map();
/** @type {Map<string, number[]>} */
const joins = new Map();
/** @type {Map<string, { lockedAt: number, channelId: string|null }>} */
const raidLocks = new Map();
/** @type {Map<string, object[]>} recent hits for admin panel */
const activityLog = new Map();
const MAX_ACTIVITY = 30;

const INVITE_RE =
  /(zrzur\.com\/invite|discord(?:app)?\.(?:gg|com)\/(?:invite\/)?[a-z0-9-]+|discord\.gg\/[a-z0-9-]+)/i;
const URL_RE = /https?:\/\/[^\s<>\]]+/gi;
const MENTION_RE = /<@[0-9A-HJKMNP-TV-Z]{26}>/gi;
const MASS_MENTION_RE = /@(?:everyone|here|all)\b|<%?\s*(?:everyone|here)\s*>/i;
const EMOJI_RE = /<a?:\w+:\d+>|[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;
const ZALGO_RE = /[\u0300-\u036f\u0483-\u0489\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]{4,}/;

const DEFAULTS = {
  enabled: false,
  antiSpam: true,
  antiDuplicate: true,
  antiLinks: false,
  antiInvites: true,
  antiEmojiSpam: true,
  antiZalgo: true,
  antiNewlines: true,
  antiMassMention: true,
  antiAttachments: true,
  bypassMods: true,
  maxMentions: 5,
  maxCapsPercent: 70,
  minCapsLength: 12,
  maxEmojis: 12,
  maxNewlines: 12,
  maxAttachments: 6,
  attachmentWindowMs: 10000,
  spamCount: 6,
  spamWindowMs: 7000,
  duplicateCount: 4,
  duplicateWindowMs: 12000,
  badWords: [],
  allowDomains: [],
  ignoreRoles: [],
  ignoreChannels: [],
  action: "delete",
  timeoutSeconds: 300,
  escalate: true,
  strikeWindowMs: 10 * 60_000,
  strikeWarnAt: 2,
  strikeTimeoutAt: 3,
  alertDeleteMs: 8000,
  quietAlerts: true,
};

let lastGc = 0;
function gcMaps() {
  const now = Date.now();
  if (now - lastGc < 60_000) return;
  lastGc = now;
  const maxAge = 15 * 60_000;
  for (const [k, v] of strikes) {
    if (now - v.at > maxAge) strikes.delete(k);
  }
  for (const map of [recentMsgs, recentBodies, recentAttachments, joins]) {
    for (const [k, list] of map) {
      const kept = list.filter((t) => now - (typeof t === "number" ? t : t.at) < maxAge);
      if (!kept.length) map.delete(k);
      else map.set(k, kept);
    }
  }
}

const RAID_DEFAULTS = {
  enabled: false,
  joinThreshold: 8,
  joinWindowSec: 10,
  action: "lock",
  lockSeconds: 120,
};

function ensureAutomod(cfg) {
  if (!cfg.automod || typeof cfg.automod !== "object") cfg.automod = {};
  for (const [k, v] of Object.entries(DEFAULTS)) {
    if (cfg.automod[k] === undefined || cfg.automod[k] === null) {
      cfg.automod[k] = Array.isArray(v) ? [...v] : v;
    }
  }
  if (!Array.isArray(cfg.automod.badWords)) cfg.automod.badWords = [];
  if (!Array.isArray(cfg.automod.allowDomains)) cfg.automod.allowDomains = [];
  if (!Array.isArray(cfg.automod.ignoreRoles)) cfg.automod.ignoreRoles = [];
  if (!Array.isArray(cfg.automod.ignoreChannels)) cfg.automod.ignoreChannels = [];
  return cfg.automod;
}

function ensureRaid(cfg) {
  if (!cfg.antiraid || typeof cfg.antiraid !== "object") cfg.antiraid = {};
  for (const [k, v] of Object.entries(RAID_DEFAULTS)) {
    if (cfg.antiraid[k] === undefined || cfg.antiraid[k] === null) cfg.antiraid[k] = v;
  }
  return cfg.antiraid;
}

function isBotMessage(client, message) {
  const uid = message?.author;
  if (!uid || uid === "00000000000000000000000000") return true;
  const self = client.user?.id || client.user?._id;
  if (self && uid === self) return true;
  const u = message.user;
  if (u?.bot || u?.official_bot || u?.official) return true;
  return false;
}

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

function pushTimed(map, key, value, windowMs) {
  const now = Date.now();
  const list = (map.get(key) || []).filter((t) => now - (typeof t === "number" ? t : t.at) < windowMs);
  list.push(value);
  map.set(key, list);
  return list;
}

function addStrike(serverId, userId, windowMs) {
  const key = `${serverId}:${userId}`;
  const now = Date.now();
  const cur = strikes.get(key);
  if (!cur || now - cur.at > windowMs) {
    strikes.set(key, { n: 1, at: now });
    return 1;
  }
  cur.n += 1;
  cur.at = now;
  return cur.n;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function badWordHit(content, words) {
  if (!words?.length) return false;
  const lower = content.toLowerCase();
  for (const raw of words) {
    const w = String(raw || "")
      .trim()
      .toLowerCase();
    if (!w) continue;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escaped}(?:$|[^\\p{L}\\p{N}_])`, "iu");
    if (re.test(lower) || (w.length >= 4 && lower.includes(w))) return true;
  }
  return false;
}

function attachmentCount(message) {
  const a = message?.attachments ?? message?.files ?? message?.embeds;
  if (Array.isArray(a)) return a.length;
  if (a && typeof a === "object") return Object.keys(a).length;
  return 0;
}

function memberHasModPerm(message) {
  const raw = message?.member?.permissions ?? message?.permissions;
  if (raw == null || raw === "") return false;
  try {
    const p = BigInt(raw);
    const mm = BigInt(Permissions.ManageMessages ?? 0);
    const ms = BigInt(Permissions.ManageServer ?? 0);
    const kick = BigInt(Permissions.KickMembers ?? 0);
    return (mm && (p & mm) !== 0n) || (ms && (p & ms) !== 0n) || (kick && (p & kick) !== 0n);
  } catch {
    return false;
  }
}

function detect(am, content, serverId, author, message) {
  const hits = [];
  const key = `${serverId}:${author}`;
  const now = Date.now();
  gcMaps();

  if (am.antiSpam) {
    const list = pushTimed(recentMsgs, key, now, am.spamWindowMs);
    if (list.length >= am.spamCount) hits.push({ id: "spam", weight: 2 });
  }

  if (am.antiDuplicate && content.trim().length >= 2) {
    const norm = content.trim().toLowerCase();
    const bodies = pushTimed(recentBodies, key, { text: norm, at: now }, am.duplicateWindowMs);
    const same = bodies.filter((b) => b.text === norm).length;
    if (same >= am.duplicateCount) hits.push({ id: "duplicate", weight: 2 });
  }

  if (am.antiInvites && INVITE_RE.test(content)) hits.push({ id: "invite", weight: 3 });

  if (am.antiLinks) {
    const urls = content.match(URL_RE) || [];
    const allow = new Set((am.allowDomains || []).map((d) => String(d).toLowerCase()));
    for (const u of urls) {
      const host = domainOf(u);
      if (!host) continue;
      if (allow.size && [...allow].some((d) => host === d || host.endsWith(`.${d}`))) continue;
      if (INVITE_RE.test(u)) continue;
      hits.push({ id: "link", weight: 2 });
      break;
    }
  }

  if (am.antiMassMention && MASS_MENTION_RE.test(content)) {
    hits.push({ id: "massMention", weight: 3 });
  }

  if (am.maxMentions > 0) {
    const mentions = (content.match(MENTION_RE) || []).length;
    if (mentions > am.maxMentions) hits.push({ id: "mentions", weight: 2 });
  }

  if (content.length >= am.minCapsLength) {
    const latin = content.replace(/[^a-zA-Z]/g, "");
    if (latin.length >= am.minCapsLength) {
      const upper = latin.replace(/[^A-Z]/g, "").length;
      if ((upper / latin.length) * 100 >= am.maxCapsPercent) hits.push({ id: "caps", weight: 1 });
    }
  }

  if (am.antiEmojiSpam) {
    const emojis = content.match(EMOJI_RE) || [];
    if (emojis.length >= am.maxEmojis) hits.push({ id: "emoji", weight: 1 });
  }

  if (am.antiNewlines) {
    const lines = (content.match(/\n/g) || []).length;
    if (lines >= am.maxNewlines) hits.push({ id: "newlines", weight: 1 });
  }

  if (am.antiZalgo && ZALGO_RE.test(content)) hits.push({ id: "zalgo", weight: 2 });

  if (am.antiAttachments) {
    const n = attachmentCount(message);
    if (n > 0) {
      const list = pushTimed(recentAttachments, key, now, am.attachmentWindowMs);
      if (list.length >= am.maxAttachments) hits.push({ id: "attachments", weight: 2 });
    }
  }

  if (badWordHit(content, am.badWords)) hits.push({ id: "badWord", weight: 3 });

  return hits;
}

function resolveAction(am, strikeCount) {
  if (am.action === "escalate" || am.escalate) {
    if (strikeCount >= am.strikeTimeoutAt) return "timeout";
    if (strikeCount >= am.strikeWarnAt) return "warn";
    return "delete";
  }
  return am.action || "delete";
}

async function softChannelAlert(client, channelId, content, ms) {
  try {
    const msg = await client.send(channelId, { content });
    const id = msg?.id || msg?._id;
    if (!id || !ms || ms <= 0) return;
    setTimeout(() => {
      void client.messages.delete(channelId, id).catch(() => {});
    }, ms);
  } catch {
    /* ignore */
  }
}

export async function handleAutomod(client, message) {
  if (isBotMessage(client, message)) return false;

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
  const am = ensureAutomod(cfg);
  if (!am.enabled) return false;
  if (am.ignoreChannels.includes(message.channel)) return false;

  if (am.bypassMods !== false && memberHasModPerm(message)) return false;

  if (am.ignoreRoles.length) {
    const roles = await memberRoles(client, serverId, message);
    if (am.ignoreRoles.some((r) => roles.includes(r))) return false;
  }

  const { t: tr } = guildT(serverId);
  const content = String(message.content || message.body || "");
  const author = message.author;
  const hits = detect(am, content, serverId, author, message);
  if (!hits.length) return false;

  const uniq = [];
  const seen = new Set();
  for (const h of hits) {
    if (seen.has(h.id)) continue;
    seen.add(h.id);
    uniq.push(h);
  }

  const weight = uniq.reduce((s, h) => s + h.weight, 0);
  const strikeN = addStrike(serverId, author, am.strikeWindowMs);
  const action = resolveAction(am, strikeN + Math.max(0, weight - 2));

  await client.messages.delete(message.channel, message._id || message.id).catch(() => {});

  const reasonText = uniq.map((h) => tr(`automod.reasons.${h.id}`) || h.id).join(tr("automod.reasonSep"));

  if (action === "timeout") {
    await client.members.timeout(serverId, author, am.timeoutSeconds).catch(() => {});
  } else if (action === "warn") {
    addWarn(serverId, author, {
      id: Date.now().toString(36),
      reason: reasonText,
      moderatorId: client.user?.id || client.user?._id || "automod",
      at: new Date().toISOString(),
    });
    await client.users.sendDM(author, tr("automod.warnDm", { reason: reasonText })).catch(() => {});
  }

  const hitLine = tr("automod.hit", {
    user: mentionUser(author),
    reason: reasonText,
    action: tr(`automod.actions.${action}`),
    strikes: strikeN,
  });

  if (am.quietAlerts) {
    await softChannelAlert(client, message.channel, hitLine, am.alertDeleteMs);
  } else {
    await client.send(message.channel, { content: hitLine }).catch(() => {});
  }

  pushActivity(serverId, {
    at: Date.now(),
    userId: author,
    channelId: message.channel,
    reasons: uniq.map((h) => h.id),
    action,
    strikes: strikeN,
    weight,
  });

  await logAction(client, serverId, {
    title: tr("automod.logTitle"),
    description: tr("automod.logBody", {
      user: mentionUser(author),
      reason: reasonText,
      action: tr(`automod.actions.${action}`),
      strikes: strikeN,
    }),
    colour: action === "timeout" ? BRAND.colour.danger : BRAND.colour.warning,
    fields: [
      { name: tr("automod.fieldUser"), value: mentionUser(author), inline: true },
      { name: tr("automod.fieldAction"), value: tr(`automod.actions.${action}`), inline: true },
      { name: tr("automod.fieldStrikes"), value: String(strikeN), inline: true },
    ],
  });

  return true;
}

function pushActivity(serverId, entry) {
  const list = activityLog.get(serverId) || [];
  list.unshift(entry);
  if (list.length > MAX_ACTIVITY) list.length = MAX_ACTIVITY;
  activityLog.set(serverId, list);
}

export function getAutomodActivity(serverId) {
  return [...(activityLog.get(serverId) || [])];
}

export function clearAutomodActivity(serverId) {
  activityLog.delete(serverId);
}

export function clearAutomodStrikes(serverId) {
  const prefix = `${serverId}:`;
  for (const key of strikes.keys()) {
    if (key.startsWith(prefix)) strikes.delete(key);
  }
}

export function countActiveStrikes(serverId) {
  const prefix = `${serverId}:`;
  const now = Date.now();
  let n = 0;
  for (const [key, cur] of strikes) {
    if (!key.startsWith(prefix)) continue;
    if (now - cur.at > 15 * 60_000) continue;
    n += 1;
  }
  return n;
}

export function getRaidLock(serverId) {
  return raidLocks.get(serverId) || null;
}

export function snapshotAutomod(serverId) {
  const cfg = getGuild(serverId);
  return {
    automod: { ...ensureAutomod(cfg) },
    antiraid: { ...ensureRaid(cfg) },
    activity: getAutomodActivity(serverId),
    activeStrikes: countActiveStrikes(serverId),
    raidLock: getRaidLock(serverId),
  };
}

export function toggleAutomodKey(serverId, key) {
  const boolKeys = new Set([
    "enabled",
    "antiSpam",
    "antiDuplicate",
    "antiLinks",
    "antiInvites",
    "antiEmojiSpam",
    "antiZalgo",
    "antiNewlines",
    "antiMassMention",
    "antiAttachments",
    "bypassMods",
    "escalate",
    "quietAlerts",
  ]);
  if (!boolKeys.has(key)) return null;
  let next = false;
  updateGuild(serverId, (c) => {
    ensureAutomod(c);
    next = !c.automod[key];
    c.automod[key] = next;
    if (key === "escalate" && next) c.automod.action = "escalate";
    if (key === "escalate" && !next && c.automod.action === "escalate") c.automod.action = "delete";
  });
  return next;
}

export function setAutomodAction(serverId, action) {
  const allowed = new Set(["delete", "warn", "timeout", "escalate"]);
  if (!allowed.has(action)) return false;
  updateGuild(serverId, (c) => {
    ensureAutomod(c);
    c.automod.action = action;
    c.automod.escalate = action === "escalate";
  });
  return true;
}

export function toggleAntiraidEnabled(serverId) {
  let next = false;
  updateGuild(serverId, (c) => {
    ensureRaid(c);
    c.antiraid.enabled = !c.antiraid.enabled;
    next = c.antiraid.enabled;
  });
  return next;
}

async function unlockChannel(client, serverId, channelId) {
  if (!channelId) return;
  try {
    await client.channels.setPermissions(channelId, "default", Permissions.SendMessage, 0);
  } catch {
    /* ignore */
  }
  raidLocks.delete(serverId);
}

export function registerAntiRaid(client) {
  client.onMemberJoin(async ({ serverId, userId }) => {
    const cfg = getGuild(serverId);
    const raid = ensureRaid(cfg);
    if (!raid.enabled) return;
    const { t: tr } = guildT(serverId);

    const now = Date.now();
    const windowMs = raid.joinWindowSec * 1000;
    const list = (joins.get(serverId) || []).filter((t) => now - t < windowMs);
    list.push(now);
    joins.set(serverId, list);

    if (list.length < raid.joinThreshold) return;

    await logAction(client, serverId, {
      title: tr("automod.raidTitle"),
      description: tr("automod.raidBody", {
        count: list.length,
        window: raid.joinWindowSec,
        action: raid.action,
      }),
      colour: BRAND.colour.danger,
    });

    if (raid.action === "kick") {
      await client.members.kick(serverId, userId).catch(() => {});
    } else if (raid.action === "ban") {
      await client.members.ban(serverId, userId, { reason: "anti-raid" }).catch(() => {});
    } else {
      let channelId = null;
      try {
        const server = await client.rest.get(`/servers/${serverId}`);
        channelId = server.system_messages?.user_joined || null;
        if (channelId) {
          await client.channels
            .setPermissions(channelId, "default", 0, Permissions.SendMessage)
            .catch(() => {});
          raidLocks.set(serverId, { lockedAt: now, channelId });
          const unlockIn = Math.max(30, Number(raid.lockSeconds) || 120) * 1000;
          setTimeout(() => {
            void unlockChannel(client, serverId, channelId);
          }, unlockIn);
        }
      } catch {
        /* ignore */
      }
    }

    joins.set(serverId, []);
  });
}
