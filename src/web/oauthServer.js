/**
 * Sanad web dashboard + Zrzur OAuth2 PKCE.
 * Run: npm run oauth → http://localhost:8787
 * Callers: package.json script "oauth". Shares data/guilds.json with the bot via syncUpdateGuild.
 * User: Zrzur-style dashboard to control the bot fully after OAuth login.
 */
import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { extname, join, dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { URL } from "node:url";
import {
  buildWebhookUrl,
  deleteWebhookSecret,
  getGuild,
  getWebhookSecret,
  listKnownGuildIds,
  listSavedWebhooks,
  saveWebhookSecret,
  syncUpdateGuild,
} from "../db/store.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(join(__dirname, "public"));

const CLIENT_ID = String(process.env.ZRZUR_OAUTH_CLIENT_ID || "").trim();
const CLIENT_SECRET = String(process.env.ZRZUR_OAUTH_CLIENT_SECRET || "").trim();
const PORT = Number(process.env.SANAD_OAUTH_PORT || 8787);
const HOST = process.env.SANAD_OAUTH_HOST || "127.0.0.1";
const REDIRECT_URI = String(
  process.env.SANAD_OAUTH_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
).trim();
const API = (process.env.ZRZUR_API_URL || "https://api.zrzur.com").replace(/\/$/, "");
const APP = (process.env.ZRZUR_APP_URL || "https://app.zrzur.com").replace(/\/$/, "");
const SCOPES = (process.env.SANAD_OAUTH_SCOPES || "identify servers.read").trim();
const INVITE =
  process.env.SANAD_BOT_INVITE ||
  `https://zrzur.cc/b/${CLIENT_ID}?permissions=91226112`;
const BOT_TOKEN = String(process.env.ZRZUR_BOT_TOKEN || "").trim();
const OWNERS = new Set(
  String(process.env.SANAD_OWNER_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);
const PERM = {
  ManageServer: 2n,
  SendMessage: 4194304n,
  ManageWebhooks: 16777216n,
  Administrator: 70368744177664n,
};

const pending = new Map();
const sessions = new Map();
const COOKIE_PENDING = "sanad_oauth";
const COOKIE_SESSION = "sanad_session";
const PENDING_TTL = 10 * 60_000;
const SESSION_TTL = 7 * 24 * 60 * 60_000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}
function pkcePair() {
  const verifier = b64url(randomBytes(32));
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}
function randomId(bytes = 24) {
  return b64url(randomBytes(bytes));
}
function parseCookies(header = "") {
  const out = {};
  for (const part of String(header).split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
function setCookie(res, name, value, { maxAge, httpOnly = true, path = "/" } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (maxAge != null) parts.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  const prev = res.getHeader("Set-Cookie");
  const list = prev ? (Array.isArray(prev) ? prev : [prev]) : [];
  list.push(parts.join("; "));
  res.setHeader("Set-Cookie", list);
}
function clearCookie(res, name) {
  setCookie(res, name, "", { maxAge: 0 });
}
function gc() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.created > PENDING_TTL) pending.delete(k);
  for (const [k, v] of sessions) if (now - v.created > SESSION_TTL) sessions.delete(k);
}
function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  if (Buffer.isBuffer(body) || typeof body === "string") {
    res.end(body);
    return;
  }
  res.end(JSON.stringify(body));
}
function redirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}
async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  return JSON.parse(raw);
}
function sessionFrom(req) {
  const cookies = parseCookies(req.headers.cookie);
  const sid = cookies[COOKIE_SESSION];
  return sid ? sessions.get(sid) || null : null;
}
function userCanAccessServer(session, serverId) {
  if (!session?.servers?.length) return false;
  return session.servers.some((s) => (s._id || s.id) === serverId);
}

const serverCache = new Map();

function asBits(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  if (value && typeof value === "object") return asBits(value.a ?? value.allow ?? 0);
  return 0n;
}

function ownerIdOf(server) {
  const owner = server?.owner;
  if (typeof owner === "string" || typeof owner === "number") return String(owner);
  return owner?._id || owner?.id || "";
}

async function botRest(method, path, body) {
  if (!BOT_TOKEN) {
    const err = new Error("missing_bot_token");
    err.status = 500;
    throw err;
  }
  const cacheable = method === "GET" && /^\/servers\/[^/]+$/.test(path);
  if (cacheable) {
    const hit = serverCache.get(path);
    if (hit && hit.until > Date.now()) return hit.data;
  }
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`${API}${path}`, {
      method,
      headers: {
        "x-bot-token": BOT_TOKEN,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (r.ok) {
      if (cacheable) serverCache.set(path, { data, until: Date.now() + 8000 });
      return data;
    }
    last = new Error(data.type || data.error || data.message || `bot_${r.status}`);
    last.status = r.status;
    last.code = data.type || data.error || "";
    last.permission = data.permission == null ? "" : String(data.permission);
    if (r.status !== 429 || attempt === 2) throw last;
    const wait = Number(r.headers?.get?.("retry-after") || r.headers?.get?.("x-ratelimit-reset-after") || 1);
    await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(wait, 0.2), 2) * 1000));
  }
  throw last;
}

function guardServer(res, session, serverId) {
  if (!session) {
    send(res, 401, { error: "unauthorized" });
    return false;
  }
  if (!userCanAccessServer(session, serverId)) {
    send(res, 403, { error: "forbidden" });
    return false;
  }
  return true;
}

async function channelInServer(channelId, serverId) {
  const ch = await botRest("GET", `/channels/${channelId}`);
  const sid = ch.server || ch.server_id;
  if (sid && sid !== serverId) {
    const err = new Error("channel_not_in_server");
    err.status = 403;
    throw err;
  }
  return ch;
}

function sessionUserId(session) {
  const user = session?.user || {};
  return user._id || user.id || user.user?._id || user.user?.id || "";
}

function hasManage(bits) {
  return (bits & PERM.Administrator) === PERM.Administrator || (bits & PERM.ManageServer) === PERM.ManageServer;
}

async function memberBits(serverId, userId, serverData) {
  const server = serverData || await botRest("GET", `/servers/${serverId}`);
  const uid = String(userId || "");
  if (uid && ownerIdOf(server) === uid) return ~0n;
  const me = await botRest("GET", `/servers/${serverId}/members/${userId}`);
  const member = me?.member ?? me;
  const roleMap = server?.roles && typeof server.roles === "object" ? server.roles : {};
  const mine = new Set(Array.isArray(member?.roles) ? member.roles.map(String) : []);
  const roles = Object.entries(roleMap)
    .filter(([roleId, role]) => mine.has(roleId) || mine.has(String(role?._id || "")) || mine.has(String(role?.id || "")))
    .sort((a, b) => (Number(a[1]?.rank) || 0) - (Number(b[1]?.rank) || 0));
  let bits = asBits(server?.default_permissions || 0);
  for (const [, role] of roles) {
    const raw = role?.permissions;
    const allow = raw && typeof raw === "object" ? asBits(raw.a ?? raw.allow ?? 0) : asBits(raw);
    const deny = raw && typeof raw === "object" ? asBits(raw.d ?? raw.deny ?? 0) : 0n;
    bits = (bits | allow) & ~deny;
  }
  if ((bits & PERM.Administrator) === PERM.Administrator) return ~0n;
  return bits;
}

async function assertManage(res, session, serverId) {
  if (!guardServer(res, session, serverId)) return false;
  const uid = sessionUserId(session);
  try {
    // A dashboard administrator still needs the bot to belong to this server.
    const server = await botRest("GET", `/servers/${serverId}`);
    if (uid && OWNERS.has(uid)) return true;
    const bits = uid ? await memberBits(serverId, uid, server) : 0n;
    if (hasManage(bits)) return true;
  } catch (error) {
    const missing = error.status === 404;
    const denied = error.status === 403;
    const limited = error.status === 429;
    send(res, missing || denied ? 403 : limited ? 429 : 502, {
      error: missing ? "bot_not_in_server" : denied ? "bot_access_denied" : limited ? "rate_limited" : error.message || "perm_check_failed",
    });
    return false;
  }
  send(res, 403, { error: "need_manage_server" });
  return false;
}

/** OAuth servers.read only proves membership. Control requires owner, Administrator, or Manage Server. */
async function manageableServers(session) {
  const list = Array.isArray(session?.servers) ? session.servers : [];
  const uid = sessionUserId(session);
  if (!uid) return [];
  const checks = await Promise.all(
    list.map(async (server) => {
      const id = server?._id || server?.id;
      if (!id) return null;
      try {
        const botServer = await botRest("GET", `/servers/${id}`);
        const bits = OWNERS.has(uid) ? ~0n : await memberBits(id, uid, botServer);
        return hasManage(bits) ? { ...server, botPresent: true } : null;
      } catch (error) {
        // Only OAuth owners (or configured dashboard owners) see invitation entries.
        // Plain OAuth membership never grants configuration access.
        if (server.owner === uid || OWNERS.has(uid)) {
          const absent = error.status === 404;
          return { ...server, botPresent: absent ? false : null };
        }
        // Membership stays visible when the bot cannot be verified. assertManage still blocks changes.
        return { ...server, botPresent: null };
      }
    }),
  );
  return checks.filter(Boolean);
}

function botError(res, error) {
  const code = error.code || error.message || "bot_error";
  if (code === "MissingPermission") return send(res, 403, { error: code, permission: error.permission || null });
  if (error.status === 429) return send(res, 429, { error: "rate_limited" });
  const status = error.status >= 400 && error.status < 500 ? 400 : 502;
  return send(res, status, { error: code, permission: error.permission || null });
}

let cachedBotId = "";
async function botUserId() {
  if (cachedBotId) return cachedBotId;
  const me = await botRest("GET", "/users/@me");
  cachedBotId = me._id || me.id || "";
  return cachedBotId;
}

async function botCapabilities(serverId) {
  try {
    const bits = await memberBits(serverId, await botUserId());
    const allowed = (bit) => (bits & bit) === bit || (bits & PERM.Administrator) === PERM.Administrator;
    return { webhooks: allowed(PERM.ManageWebhooks), send: allowed(PERM.SendMessage) };
  } catch {
    return { webhooks: false, send: false };
  }
}

function clip(value, max) {
  const text = String(value || "").trim();
  return text ? text.slice(0, max) : "";
}

function parseColour(raw) {
  const s = String(raw || "").trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(s)) return Number.parseInt(s, 16);
  return null;
}

async function listTextChannels(serverId) {
  const server = await botRest("GET", `/servers/${serverId}`);
  const ids = Array.isArray(server.channels) ? server.channels : [];
  const categoryOf = new Map();
  for (const cat of server.categories || []) {
    for (const cid of cat.channels || []) categoryOf.set(cid, cat.title || cat.name || "");
  }
  const rows = [];
  const queue = ids.slice(0, 100);
  let cursor = 0;
  async function nextChannel() {
    while (cursor < queue.length) {
      const cid = queue[cursor++];
      try {
        const ch = await botRest("GET", `/channels/${cid}`);
        if (ch.channel_type && ch.channel_type !== "TextChannel") {
          rows.push(null);
          continue;
        }
        rows.push({
          id: ch._id || cid,
          name: ch.name || cid,
          category: categoryOf.get(cid) || "",
        });
      } catch {
        rows.push(null);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, queue.length) }, nextChannel));
  return rows.filter(Boolean);
}

function listRoles(server) {
  const roles = server?.roles && typeof server.roles === "object" ? server.roles : {};
  return Object.entries(roles)
    .map(([key, role]) => ({
      id: role?._id || role?.id || key,
      name: role?.name || key,
      rank: Number(role?.rank) || 0,
    }))
    .sort((a, b) => b.rank - a.rank);
}

async function listHooks(serverId) {
  const data = await botRest("GET", `/servers/${serverId}/webhooks`);
  const hooks = Array.isArray(data) ? data : data?.webhooks || [];
  const saved = new Map(listSavedWebhooks(serverId).map((row) => [row.id, row]));
  return hooks.map((hook) => {
    const id = hook.id || hook._id;
    const row = saved.get(id);
    return {
      id,
      name: hook.name || row?.name || "",
      channelId: hook.channel_id || hook.channelId || row?.channelId || "",
      hasToken: Boolean(row?.token || getWebhookSecret(id)),
    };
  });
}

async function hookInServer(serverId, hookId) {
  const hooks = await listHooks(serverId);
  const hit = hooks.find((hook) => hook.id === hookId);
  if (!hit) {
    const err = new Error("webhook_not_in_server");
    err.status = 404;
    throw err;
  }
  return hit;
}

async function exchangeCode(code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  if (CLIENT_SECRET) body.set("client_secret", CLIENT_SECRET);
  const r = await fetch(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error_description || data.error || `token_http_${r.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

async function oauthGet(path, accessToken) {
  const r = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const err = new Error(data.error_description || data.error || `api_${r.status}`);
    err.payload = data;
    throw err;
  }
  return data;
}

function setByPath(obj, path, value) {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    if (!cur[p] || typeof cur[p] !== "object") cur[p] = {};
    cur = cur[p];
  }
  cur[parts[parts.length - 1]] = value;
}

function getByPath(obj, path) {
  return path.split(".").reduce((a, k) => (a == null ? undefined : a[k]), obj);
}

function togglePath(cfg, path) {
  const cur = getByPath(cfg, path);
  if (typeof cur !== "boolean") throw new Error("not_boolean");
  setByPath(cfg, path, !cur);
  if (path === "automod.escalate" && !cur) setByPath(cfg, "automod.action", "escalate");
  if (path === "automod.escalate" && cur && cfg.automod?.action === "escalate") {
    setByPath(cfg, "automod.action", "delete");
  }
}

function serveStatic(res, pathname) {
  let rel = pathname;
  if (rel === "/" || rel === "/app" || rel === "/dashboard") rel = "/index.html";
  if (rel.startsWith("/assets/")) rel = "/" + rel.slice("/assets/".length);
  const file = resolve(PUBLIC, rel.replace(/^\/+/, "").replaceAll("/", sep));
  const rootWithSep = PUBLIC.endsWith(sep) ? PUBLIC : PUBLIC + sep;
  if (file !== PUBLIC && !file.startsWith(rootWithSep)) return false;
  if (!existsSync(file)) return false;
  const type = MIME[extname(file).toLowerCase()] || "application/octet-stream";
  const asText =
    type.startsWith("text/") ||
    type.includes("javascript") ||
    type.includes("json") ||
    type.includes("svg") ||
    type.includes("xml");
  const body = asText ? readFileSync(file, "utf8") : readFileSync(file);
  send(res, 200, body, type);
  return true;
}

async function handle(req, res) {
  gc();
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  const cookies = parseCookies(req.headers.cookie);
  const session = sessionFrom(req);

  if (url.pathname === "/health") {
    return send(res, 200, { ok: true, clientConfigured: Boolean(CLIENT_ID) });
  }

  if (url.pathname === "/api/boot") {
    const all = session?.servers || [];
    const servers = session ? await manageableServers(session) : [];
    return send(res, 200, {
      invite: INVITE,
      user: session?.user || null,
      servers,
      hidden: session ? Math.max(0, all.length - servers.length) : 0,
    });
  }

  if (url.pathname.startsWith("/api/servers/") && req.method === "GET" && url.pathname.endsWith("/config")) {
    const serverId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!(await assertManage(res, session, serverId))) return;
    const cfg = getGuild(serverId);
    return send(res, 200, cfg);
  }

  if (url.pathname.startsWith("/api/servers/") && req.method === "PATCH" && url.pathname.endsWith("/config")) {
    const serverId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!(await assertManage(res, session, serverId))) return;
    const body = await readJson(req);
    const allowedPaths = new Set([
      "locale",
      "prefix",
      "staffRoleId",
      "modLogChannelId",
      "logChannelId",
      "welcome.channelId",
      "welcome.message",
      "goodbye.channelId",
      "goodbye.message",
      "automod.action",
      "automod.maxMentions",
      "automod.timeoutSeconds",
      "automod.spamCount",
      "automod.maxEmojis",
      "automod.maxNewlines",
      "automod.maxAttachments",
      "automod.strikeWarnAt",
      "automod.strikeTimeoutAt",
      "automod.badWords",
      "automod.allowDomains",
      "antiraid.joinThreshold",
      "antiraid.joinWindowSec",
      "antiraid.lockSeconds",
      "antiraid.action",
      "leveling.xpMin",
      "leveling.xpMax",
      "leveling.cooldownSec",
      "leveling.levelUpChannelId",
      "leveling.levelUpMessage",
      "muteRoleId",
      "welcome.dm",
      "tickets.categoryId",
      "tickets.staffRoleId",
      "tickets.logChannelId",
      "suggest.channelId",
      "starboard.channelId",
      "starboard.emoji",
      "starboard.threshold",
      "autorole.roleIds",
      "automod.ignoreChannels",
    ]);
    const cfg = syncUpdateGuild(serverId, (c) => {
      if (body.path != null) {
        const path = String(body.path);
        if (!allowedPaths.has(path)) throw new Error("bad_path");
        let value = body.value;
        if (path === "locale") value = value === "ar" ? "ar" : "en";
        if (path === "prefix") value = String(value || "!").slice(0, 5) || "!";
        if (path === "automod.badWords" || path === "automod.allowDomains") {
          value = String(value || "")
            .split(/[,\n]/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean)
            .slice(0, 80);
        }
        if (path === "autorole.roleIds" || path === "automod.ignoreChannels") {
          value = String(value || "")
            .split(/[,\n]/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 40);
        }
        if (path === "starboard.emoji") value = String(value || "⭐").slice(0, 16) || "⭐";
        if (path === "starboard.threshold") value = Math.max(1, Math.min(50, Number(value) || 3));
        if (
          [
            "automod.maxMentions",
            "automod.timeoutSeconds",
            "automod.spamCount",
            "automod.maxEmojis",
            "automod.maxNewlines",
            "automod.maxAttachments",
            "automod.strikeWarnAt",
            "automod.strikeTimeoutAt",
            "antiraid.joinThreshold",
            "antiraid.joinWindowSec",
            "antiraid.lockSeconds",
            "leveling.xpMin",
            "leveling.xpMax",
            "leveling.cooldownSec",
          ].includes(path)
        ) {
          value = Math.max(0, Math.min(86400, Number(value) || 0));
        }
        setByPath(c, path, value);
        if (path === "automod.action") {
          c.automod.escalate = value === "escalate";
        }
        return;
      }
      if (body.locale) c.locale = body.locale === "ar" ? "ar" : "en";
      if (body.prefix != null) c.prefix = String(body.prefix).slice(0, 5) || "!";
    });
    return send(res, 200, cfg);
  }

  if (url.pathname.startsWith("/api/servers/") && req.method === "POST" && url.pathname.endsWith("/toggle")) {
    const serverId = decodeURIComponent(url.pathname.split("/")[3] || "");
    if (!(await assertManage(res, session, serverId))) return;
    const body = await readJson(req);
    const path = String(body.path || "");
    const allowed = new Set([
      "welcome.enabled",
      "goodbye.enabled",
      "leveling.enabled",
      "automod.enabled",
      "tickets.enabled",
      "antiraid.enabled",
      "starboard.enabled",
      "automod.antiSpam",
      "automod.antiDuplicate",
      "automod.antiInvites",
      "automod.antiLinks",
      "automod.antiMassMention",
      "automod.antiEmojiSpam",
      "automod.antiNewlines",
      "automod.antiZalgo",
      "automod.antiAttachments",
      "automod.escalate",
      "automod.quietAlerts",
      "automod.bypassMods",
    ]);
    if (!allowed.has(path)) return send(res, 400, { error: "bad_path" });
    try {
      const cfg = syncUpdateGuild(serverId, (c) => togglePath(c, path));
      return send(res, 200, cfg);
    } catch (e) {
      return send(res, 400, { error: e.message || "toggle_failed" });
    }
  }

  const live = url.pathname.match(/^\/api\/servers\/([^/]+)\/(channels|roles|messages|webhooks)(?:\/([^/]+))?(?:\/(send|token))?$/);
  if (live) {
    const serverId = decodeURIComponent(live[1]);
    const kind = live[2];
    const hookId = live[3] ? decodeURIComponent(live[3]) : "";
    const action = live[4] || "";
    if (!(await assertManage(res, session, serverId))) return;
    try {
      if (kind === "channels" && req.method === "GET") {
        return send(res, 200, { channels: await listTextChannels(serverId), bot: await botCapabilities(serverId) });
      }
      if (kind === "roles" && req.method === "GET") {
        const server = await botRest("GET", `/servers/${serverId}`);
        return send(res, 200, { roles: listRoles(server) });
      }
      if (kind === "messages" && req.method === "POST") {
        const body = await readJson(req);
        const channelId = clip(body.channelId, 32);
        const content = clip(body.content, 2000);
        const title = clip(body.title, 256);
        const description = clip(body.description, 2000);
        if (!channelId) return send(res, 400, { error: "missing_channel" });
        if (!content && !title && !description) return send(res, 400, { error: "empty_payload" });
        await channelInServer(channelId, serverId);
        const payload = {};
        if (content) payload.content = content;
        if (title || description) {
          const embed = {};
          if (title) embed.title = title;
          if (description) embed.description = description;
          const colour = parseColour(body.colour);
          if (colour != null) embed.colour = `#${colour.toString(16).padStart(6, "0")}`;
          payload.embeds = [embed];
        }
        const sent = await botRest("POST", `/channels/${channelId}/messages`, payload);
        return send(res, 200, { id: sent._id || sent.id || null });
      }
      if (kind === "webhooks" && req.method === "GET" && !hookId) {
        return send(res, 200, { webhooks: await listHooks(serverId) });
      }
      if (kind === "webhooks" && req.method === "POST" && !hookId) {
        const body = await readJson(req);
        const name = clip(body.name, 80);
        const channelId = clip(body.channelId, 32);
        if (!name || !channelId) return send(res, 400, { error: "missing_fields" });
        await channelInServer(channelId, serverId);
        const created = await botRest("POST", `/channels/${channelId}/webhooks`, { name });
        const id = created.id || created._id;
        const token = created.token;
        if (id && token) {
          saveWebhookSecret(id, {
            token,
            name: created.name || name,
            channelId: created.channel_id || channelId,
            serverId,
            url: created.url || buildWebhookUrl(id, token),
          });
        }
        return send(res, 200, {
          id,
          name: created.name || name,
          channelId: created.channel_id || channelId,
          hasToken: Boolean(token),
        });
      }
      if (kind === "webhooks" && hookId && req.method === "DELETE") {
        await hookInServer(serverId, hookId);
        await botRest("DELETE", `/webhooks/${hookId}`);
        deleteWebhookSecret(hookId);
        return send(res, 200, { ok: true });
      }
      if (kind === "webhooks" && hookId && action === "send" && req.method === "POST") {
        await hookInServer(serverId, hookId);
        const body = await readJson(req);
        const token = getWebhookSecret(hookId);
        if (!token) return send(res, 400, { error: "need_token" });
        const content = clip(body.content, 2000);
        const username = clip(body.username, 80);
        const title = clip(body.title, 256);
        const description = clip(body.description, 2000);
        if (!content && !title && !description) return send(res, 400, { error: "empty_payload" });
        const payload = {};
        if (content) payload.content = content;
        if (username) payload.username = username;
        if (title || description) {
          const embed = {};
          if (title) embed.title = title;
          if (description) embed.description = description;
          const colour = parseColour(body.colour);
          if (colour != null) embed.color = colour;
          payload.embeds = [embed];
        }
        await botRest("POST", `/webhooks/${hookId}/${token}?wait=true`, payload);
        return send(res, 200, { ok: true });
      }
      if (kind === "webhooks" && hookId && action === "token" && req.method === "POST") {
        const hit = await hookInServer(serverId, hookId);
        const body = await readJson(req);
        if (body.regenerate) {
          const result = await botRest("POST", `/webhooks/${hookId}/token`);
          const token = result.token;
          if (!token) return send(res, 502, { error: "bot_error" });
          saveWebhookSecret(hookId, {
            token,
            name: hit.name,
            channelId: hit.channelId,
            serverId,
            url: buildWebhookUrl(hookId, token),
          });
          return send(res, 200, { hasToken: true });
        }
        const token = clip(body.token, 200);
        if (!/^[A-Za-z0-9._~-]{8,200}$/.test(token)) return send(res, 400, { error: "need_token" });
        saveWebhookSecret(hookId, {
          token,
          name: hit.name,
          channelId: hit.channelId,
          serverId,
          url: buildWebhookUrl(hookId, token),
        });
        return send(res, 200, { hasToken: true });
      }
      if (kind === "webhooks" && hookId && req.method === "PATCH" && !action) {
        const hit = await hookInServer(serverId, hookId);
        const body = await readJson(req);
        const name = clip(body.name, 80);
        if (!name) return send(res, 400, { error: "missing_fields" });
        await botRest("PATCH", `/webhooks/${hookId}`, { name });
        const token = getWebhookSecret(hookId);
        if (token) {
          saveWebhookSecret(hookId, { token, name, channelId: hit.channelId, serverId });
        }
        return send(res, 200, { id: hookId, name, hasToken: Boolean(token) });
      }
    } catch (error) {
      return botError(res, error);
    }
    return send(res, 404, { error: "not_found" });
  }

  if (url.pathname === "/api/known-guilds") {
    if (!session) return send(res, 401, { error: "unauthorized" });
    const allowed = new Set((await manageableServers(session)).map((server) => server._id || server.id));
    return send(res, 200, { ids: listKnownGuildIds().filter((id) => allowed.has(id)) });
  }

  if (url.pathname === "/logout") {
    const sid = cookies[COOKIE_SESSION];
    if (sid) sessions.delete(sid);
    clearCookie(res, COOKIE_SESSION);
    return redirect(res, "/");
  }

  if (url.pathname === "/auth/login") {
    // Keep PKCE cookies on the callback origin (localhost and 127.0.0.1 differ).
    const callbackOrigin = new URL(REDIRECT_URI).origin;
    const callbackHost = new URL(callbackOrigin).host;
    if (req.headers.host !== callbackHost) return redirect(res, `${callbackOrigin}/auth/login`);
    if (!CLIENT_ID) return send(res, 500, { error: "missing_client_id" });
    const state = randomId(24);
    const { verifier, challenge } = pkcePair();
    pending.set(state, { verifier, created: Date.now() });
    setCookie(res, COOKIE_PENDING, state, { maxAge: PENDING_TTL });
    const auth = new URL(`${APP}/oauth2/authorize`);
    auth.searchParams.set("client_id", CLIENT_ID);
    auth.searchParams.set("redirect_uri", REDIRECT_URI);
    auth.searchParams.set("response_type", "code");
    auth.searchParams.set("scope", SCOPES);
    auth.searchParams.set("state", state);
    auth.searchParams.set("code_challenge", challenge);
    auth.searchParams.set("code_challenge_method", "S256");
    return redirect(res, auth.toString());
  }

  if (url.pathname === "/auth/callback") {
    const err = url.searchParams.get("error");
    const errDesc = url.searchParams.get("error_description");
    if (err) {
      clearCookie(res, COOKIE_PENDING);
      return redirect(res, `/?error=${encodeURIComponent(errDesc || err)}`);
    }
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = cookies[COOKIE_PENDING];
    const pendingEntry = state ? pending.get(state) : null;
    if (!code || !state || !pendingEntry || state !== cookieState) {
      clearCookie(res, COOKIE_PENDING);
      return redirect(res, `/?error=${encodeURIComponent("invalid_state")}`);
    }
    pending.delete(state);
    clearCookie(res, COOKIE_PENDING);
    try {
      const token = await exchangeCode(code, pendingEntry.verifier);
      const accessToken = token.access_token;
      if (!accessToken) throw new Error("missing_access_token");
      const user = await oauthGet("/oauth2/@me", accessToken);
      let servers = [];
      try {
        if (String(token.scope || SCOPES).includes("servers.read")) {
          const raw = await oauthGet("/oauth2/@me/servers", accessToken);
          servers = Array.isArray(raw) ? raw : raw?.servers || raw?.data || [];
        }
      } catch {
        servers = [];
      }
      const sessionId = randomId(24);
      sessions.set(sessionId, {
        accessToken,
        refreshToken: token.refresh_token,
        user,
        servers,
        created: Date.now(),
      });
      setCookie(res, COOKIE_SESSION, sessionId, { maxAge: SESSION_TTL });
      return redirect(res, "/");
    } catch (e) {
      console.error("[sanad:oauth] callback", e?.payload || e?.message || e);
      return redirect(res, `/?error=${encodeURIComponent(e?.message || "token_exchange_failed")}`);
    }
  }

  if (serveStatic(res, url.pathname)) return;
  return send(res, 404, { error: "not_found" });
}

const server = createServer((req, res) => {
  handle(req, res).catch((error) => {
    console.error("[sanad:oauth]", error);
    send(res, 500, { error: error?.message || "error" });
  });
});

server.listen(PORT, HOST, () => {
  console.log(`[sanad:oauth] dashboard http://localhost:${PORT}`);
  console.log(`[sanad:oauth] public ${PUBLIC}`);
  console.log(`[sanad:oauth] redirect ${REDIRECT_URI}`);
  console.log(`[sanad:oauth] client ${CLIENT_ID ? CLIENT_ID.slice(0, 8) + "…" : "(missing)"}`);
  console.log(
    `[sanad:oauth] secret ${CLIENT_SECRET ? `loaded (${CLIENT_SECRET.length} chars)` : "missing — public PKCE only"}`,
  );
});
