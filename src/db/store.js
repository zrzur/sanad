import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data");
mkdirSync(root, { recursive: true });

function pathFor(name) {
  return join(root, `${name}.json`);
}

function read(name, fallback) {
  const file = pathFor(name);
  if (!existsSync(file)) return structuredClone(fallback);
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return structuredClone(fallback);
  }
}

function write(name, data) {
  const file = pathFor(name);
  const body = JSON.stringify(data, null, 2);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, body, "utf8");
  try {
    renameSync(tmp, file);
  } catch {
    // Windows often locks the target briefly; fall back to direct overwrite.
    writeFileSync(file, body, "utf8");
    try {
      if (existsSync(tmp)) writeFileSync(tmp, "");
    } catch {
      /* ignore */
    }
  }
}

export function defaultGuildConfig() {
  return {
    // New guilds follow SANAD_LOCALE; chat strings come from locales, not baked Arabic.
    locale: process.env.SANAD_LOCALE === "en" ? "en" : process.env.SANAD_LOCALE === "ar" ? "ar" : "en",
    prefix: "!",
    logChannelId: null,
    modLogChannelId: null,
    staffRoleId: null,
    muteRoleId: null,
    welcome: {
      enabled: false,
      channelId: null,
      // null → use locale string (welcome.default)
      message: null,
      dm: null,
    },
    goodbye: {
      enabled: false,
      channelId: null,
      // null → use locale string (welcome.goodbye)
      message: null,
    },
    autorole: { roleIds: [] },
    automod: {
      enabled: false,
      antiSpam: true,
      antiLinks: false,
      antiInvites: true,
      maxMentions: 5,
      maxCapsPercent: 70,
      minCapsLength: 12,
      badWords: [],
      ignoreRoles: [],
      ignoreChannels: [],
      action: "delete",
      timeoutSeconds: 300,
    },
    antiraid: {
      enabled: false,
      joinThreshold: 8,
      joinWindowSec: 10,
      action: "lock",
    },
    leveling: {
      enabled: true,
      xpMin: 15,
      xpMax: 25,
      cooldownSec: 60,
      levelUpChannelId: null,
      // null → use locale string (leveling.levelUp)
      levelUpMessage: null,
      rewards: [],
      ignoredChannels: [],
    },
    tickets: {
      enabled: true,
      categoryId: null,
      staffRoleId: null,
      logChannelId: null,
      counter: 0,
      // empty → locale-aware stock topics (en/ar)
      topics: [],
    },
    suggest: { channelId: null },
    starboard: {
      enabled: false,
      channelId: null,
      emoji: "⭐",
      threshold: 3,
    },
    autoresponders: [],
    reactionRoles: [],
    panel: {
      title: null,
      subtitle: null,
      about: null,
      rules: null,
      roles: null,
      services: null,
      order: null,
      info: null,
      bannerUrl: null,
      accent: null,
    },
  };
}

const guilds = read("guilds", {});
const levels = read("levels", {});
const casesDb = read("cases", {});
const ticketsDb = read("tickets", {});
const giveawaysDb = read("giveaways", {});
const warns = read("warns", {});
const starred = read("starboard", {});

/** Debounced disk writes — many servers/users must not hammer the filesystem. */
const dirty = new Map();
const DEBOUNCE_MS = 400;

function scheduleWrite(name, data) {
  dirty.set(name, data);
  const prev = scheduleWrite._timers?.get(name);
  if (prev) clearTimeout(prev);
  if (!scheduleWrite._timers) scheduleWrite._timers = new Map();
  const timer = setTimeout(() => {
    scheduleWrite._timers.delete(name);
    const payload = dirty.get(name);
    if (payload === undefined) return;
    dirty.delete(name);
    try {
      write(name, payload);
    } catch (error) {
      console.warn(`[sanad:db] write ${name}:`, error?.message || error);
    }
  }, DEBOUNCE_MS);
  if (typeof timer.unref === "function") timer.unref();
  scheduleWrite._timers.set(name, timer);
}

export function flushAllStores() {
  if (scheduleWrite._timers) {
    for (const t of scheduleWrite._timers.values()) clearTimeout(t);
    scheduleWrite._timers.clear();
  }
  for (const [name, data] of dirty) {
    try {
      write(name, data);
    } catch (error) {
      console.warn(`[sanad:db] flush ${name}:`, error?.message || error);
    }
  }
  dirty.clear();
}

function saveGuilds() {
  scheduleWrite("guilds", guilds);
}
function saveLevels() {
  scheduleWrite("levels", levels);
}
function saveCases() {
  scheduleWrite("cases", casesDb);
}
function saveTickets() {
  scheduleWrite("tickets", ticketsDb);
}
function saveGiveaways() {
  scheduleWrite("giveaways", giveawaysDb);
}
function saveWarns() {
  scheduleWrite("warns", warns);
}
function saveStarred() {
  scheduleWrite("starboard", starred);
}

export function getGuild(serverId) {
  if (!guilds[serverId]) {
    guilds[serverId] = defaultGuildConfig();
    saveGuilds();
  }
  return guilds[serverId];
}

export function updateGuild(serverId, mutator) {
  const cfg = getGuild(serverId);
  mutator(cfg);
  saveGuilds();
  return cfg;
}

export function getLevel(serverId, userId) {
  const key = `${serverId}:${userId}`;
  if (!levels[key]) levels[key] = { xp: 0, level: 0, lastXpAt: 0 };
  return levels[key];
}

export function setLevel(serverId, userId, data) {
  levels[`${serverId}:${userId}`] = data;
  saveLevels();
}

export function leaderboard(serverId, limit = 10) {
  return Object.entries(levels)
    .filter(([k]) => k.startsWith(`${serverId}:`))
    .map(([k, v]) => ({ userId: k.slice(serverId.length + 1), ...v }))
    .filter((row) => row.userId && row.userId !== "00000000000000000000000000")
    .sort((a, b) => b.xp - a.xp || b.level - a.level)
    .slice(0, limit);
}

/** Aggregate counters for the admin dashboard. */
export function guildCounters(serverId) {
  const ranked = Object.keys(levels).filter(
    (k) =>
      k.startsWith(`${serverId}:`) &&
      k.slice(serverId.length + 1) !== "00000000000000000000000000",
  ).length;
  const openTickets = Object.keys(getOpenTickets(serverId) || {}).length;
  const cases = casesDb[serverId]?.items?.length ?? 0;
  let warnCount = 0;
  for (const key of Object.keys(warns)) {
    if (!key.startsWith(`${serverId}:`)) continue;
    warnCount += (warns[key] || []).length;
  }
  const giveaways = Object.values(getGiveaways() || {}).filter((g) => g?.serverId === serverId).length;
  const autoresponders = getGuild(serverId).autoresponders?.length ?? 0;
  return { ranked, openTickets, cases, warnCount, giveaways, autoresponders };
}

/** Drop XP rows for system/bot authors (e.g. 000…0). */
export function purgeNonHumanLevels(serverId = null) {
  let changed = false;
  for (const key of Object.keys(levels)) {
    const userId = key.includes(":") ? key.slice(key.indexOf(":") + 1) : "";
    const sid = key.includes(":") ? key.slice(0, key.indexOf(":")) : "";
    if (serverId && sid !== serverId) continue;
    if (!userId || userId === "00000000000000000000000000") {
      delete levels[key];
      changed = true;
    }
  }
  if (changed) saveLevels();
  return changed;
}

export function nextCase(serverId) {
  if (!casesDb[serverId]) casesDb[serverId] = { next: 1, items: [] };
  const id = casesDb[serverId].next++;
  saveCases();
  return id;
}

export function addCase(serverId, entry) {
  if (!casesDb[serverId]) casesDb[serverId] = { next: 1, items: [] };
  casesDb[serverId].items.unshift(entry);
  if (casesDb[serverId].items.length > 500) casesDb[serverId].items.length = 500;
  saveCases();
}

export function listCases(serverId, userId, limit = 10) {
  const items = casesDb[serverId]?.items ?? [];
  return (userId ? items.filter((c) => c.targetId === userId) : items).slice(0, limit);
}

export function getWarns(serverId, userId) {
  const key = `${serverId}:${userId}`;
  return warns[key] ?? [];
}

export function addWarn(serverId, userId, warn) {
  const key = `${serverId}:${userId}`;
  if (!warns[key]) warns[key] = [];
  warns[key].push(warn);
  saveWarns();
  return warns[key];
}

export function clearWarns(serverId, userId) {
  delete warns[`${serverId}:${userId}`];
  saveWarns();
}

export function getOpenTickets(serverId) {
  if (!ticketsDb[serverId]) ticketsDb[serverId] = {};
  return ticketsDb[serverId];
}

export function saveOpenTickets(serverId, map) {
  ticketsDb[serverId] = map;
  saveTickets();
}

/** Find which server owns an open ticket channel (in-memory). */
export function findTicketServerByChannel(channelId) {
  for (const [serverId, map] of Object.entries(ticketsDb)) {
    if (map?.[channelId]) return serverId;
  }
  return null;
}

export function getGiveaways() {
  return giveawaysDb;
}

export function setGiveaway(id, data) {
  if (data == null) delete giveawaysDb[id];
  else giveawaysDb[id] = data;
  saveGiveaways();
}

export function getStarMap() {
  return starred;
}

export function setStarEntry(messageId, data) {
  if (data == null) delete starred[messageId];
  else starred[messageId] = data;
  saveStarred();
}

/* ─── Webhook token vault (Zrzur returns token only on create/regenerate) ─── */
const webhookTokens = read("webhook-tokens", {});

function saveWebhookTokens() {
  scheduleWrite("webhook-tokens", webhookTokens);
}

export function getWebhookSecret(id) {
  return webhookTokens[id]?.token || null;
}

export function saveWebhookSecret(id, { token, name, channelId, serverId, url } = {}) {
  const prev = webhookTokens[id] || {};
  webhookTokens[id] = {
    token: token ?? prev.token ?? null,
    name: name ?? prev.name ?? null,
    channelId: channelId ?? prev.channelId ?? null,
    serverId: serverId ?? prev.serverId ?? null,
    url: url ?? prev.url ?? null,
    savedAt: new Date().toISOString(),
  };
  saveWebhookTokens();
  return webhookTokens[id];
}

export function deleteWebhookSecret(id) {
  if (!webhookTokens[id]) return false;
  delete webhookTokens[id];
  saveWebhookTokens();
  return true;
}

export function listSavedWebhooks(serverId) {
  return Object.entries(webhookTokens)
    .filter(([, row]) => !serverId || row.serverId === serverId)
    .map(([id, row]) => ({ id, ...row }));
}

export function buildWebhookUrl(id, token) {
  const base = String(process.env.ZRZUR_API_URL || "https://api.zrzur.com").replace(/\/$/, "");
  return `${base}/webhooks/${id}/${token}`;
}

export function maskToken(token) {
  const t = String(token || "");
  if (t.length < 10) return "***";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

/** Parse id+token from a full URL or `id/token` / bare id. */
export function parseWebhookRef(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;
  const urlMatch = raw.match(/\/webhooks\/([0-9A-HJKMNP-TV-Z]{26})\/([^/\s?#]+)/i);
  if (urlMatch) return { id: urlMatch[1], token: urlMatch[2] };
  const slash = raw.match(/^([0-9A-HJKMNP-TV-Z]{26})\/(.+)$/i);
  if (slash) return { id: slash[1], token: slash[2] };
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(raw)) return { id: raw, token: null };
  return null;
}
