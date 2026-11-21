/**
 * Music: LiveKit + ffmpeg PCM + Spotify catalog + full-length matched audio.
 * One Now Playing message per guild (edit-in-place). Session tokens kill stale buttons.
 */
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Permissions,
} from "@zrzur/sdk/bot";
import { config } from "../config.js";
import { guildT } from "../util/locale.js";
import { mentionUser, userId } from "../brand.js";
import { getUserVoiceChannel } from "./voiceTracker.js";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const persistPath = join(root, "data", "music-sessions.json");
mkdirSync(join(root, "data"), { recursive: true });

const SAMPLE_RATE = 48_000;
const CHANNELS = 1;
const FRAME_SAMPLES = 480;
const FRAME_BYTES = FRAME_SAMPLES * CHANNELS * 2;
const PROGRESS_MS = 5_000;

const sessions = new Map();

function key(botId, serverId) {
  return `${botId}:${serverId}`;
}

function newControlId() {
  return randomBytes(4).toString("hex");
}

function getSession(botId, serverId) {
  const k = key(botId, serverId);
  if (!sessions.has(k)) {
    sessions.set(k, {
      botId,
      serverId,
      queue: [],
      current: null,
      channelId: null,
      room: null,
      audioSource: null,
      audioTrack: null,
      ffmpeg: null,
      textChannelId: null,
      playing: false,
      paused: false,
      abort: false,
      npMessageId: null,
      startedAt: 0,
      pausedAt: 0,
      pausedTotalMs: 0,
      controlId: newControlId(),
      loopMode: 0,
      shuffle: false,
      volume: 100,
      history: [],
      progressTimer: null,
    });
  }
  const s = sessions.get(k);
  if (s.volume == null) s.volume = 100;
  return s;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function elapsedMs(session) {
  if (!session.startedAt) return 0;
  return Math.max(
    0,
    Date.now() -
      session.startedAt -
      (session.pausedTotalMs || 0) -
      (session.paused && session.pausedAt ? Date.now() - session.pausedAt : 0),
  );
}

function progressBar(elapsed, duration, width = 14) {
  if (!duration || duration <= 0) return "▬".repeat(width);
  const ratio = Math.min(1, Math.max(0, elapsed / duration));
  const pos = Math.round(ratio * (width - 1));
  let out = "";
  for (let i = 0; i < width; i++) out += i === pos ? "●" : "▬";
  return out;
}

function trackLabel(track) {
  return track?.display || track?.title || track?.name || "—";
}

function loopLabel(session, tr) {
  if (session.loopMode === 1) return tr("commands.play.loopTrack");
  if (session.loopMode === 2) return tr("commands.play.loopQueue");
  return tr("commands.play.loopOff");
}

function queuePreview(session, tr) {
  if (!session.queue.length) return tr("commands.play.queueEmptyShort");
  return `\`${trackLabel(session.queue[0])}\``;
}

function playerEmbed(session, tr) {
  const track = session.current;
  const elapsed = elapsedMs(session) / 1000;
  const duration = Number(track?.duration) || 30;
  const status = session.paused ? tr("commands.play.paused") : tr("commands.play.playing");
  const bar = progressBar(elapsed, duration);
  const title = trackLabel(track);
  const artistLine = track?.artists ? `*${track.artists}*` : "";
  const albumLine = track?.album ? `${tr("commands.play.album")}: ${track.album}` : "";

  const description = [
    `**${title}**`,
    artistLine,
    albumLine,
    "",
    `\`${formatClock(elapsed)}\` ${bar} \`${formatClock(duration)}\``,
  ]
    .filter(Boolean)
    .join("\n");

  const embed = new EmbedBuilder()
    .title(tr("commands.np.title"))
    .description(description.slice(0, 4000))
    .field(tr("commands.play.status"), status, true)
    .field(tr("commands.play.queueLeft"), String(session.queue.length), true)
    .field(tr("commands.play.loop"), loopLabel(session, tr), true)
    .field(tr("commands.play.volume"), `${session.volume ?? 100}%`, true)
    .field(tr("commands.play.upNext"), queuePreview(session, tr), false)
    .colour(session.paused ? "#F59E0B" : config.brand.colour)
    .footer(tr("commands.play.controlsFooter"))
    .timestamp();

  if (track?.requestedBy) {
    embed.field(tr("commands.play.requestedBy"), mentionUser(track.requestedBy), true);
  }
  const link = track?.spotifyUrl || track?.url;
  if (link && /^https?:\/\//i.test(link)) embed.url(link);

  const json = embed.toJSON();
  // One cover only (thumbnail) — no large bottom image / title icon duplicate
  if (track?.artwork) {
    json.thumbnail_url = track.artwork;
  }
  return json;
}

function btn(id, label, style, emoji) {
  const b = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

function playerButtons(session, tr) {
  const id = session.controlId;
  const row1 = new ActionRowBuilder().addComponents(
    btn(
      `sanad:music:pause:${id}`,
      session.paused ? tr("commands.play.resumeBtn") : tr("commands.play.pauseBtn"),
      session.paused ? ButtonStyle.Success : ButtonStyle.Primary,
      session.paused ? "▶️" : "⏸️",
    ),
    btn(`sanad:music:skip:${id}`, tr("commands.play.skipBtn"), ButtonStyle.Secondary, "⏭️"),
    btn(`sanad:music:stop:${id}`, tr("commands.play.stopBtn"), ButtonStyle.Danger, "⏹️"),
    btn(
      `sanad:music:loop:${id}`,
      tr("commands.play.loopBtn"),
      session.loopMode ? ButtonStyle.Success : ButtonStyle.Secondary,
      session.loopMode === 2 ? "🔁" : session.loopMode === 1 ? "🔂" : "🔁",
    ),
    btn(
      `sanad:music:shuffle:${id}`,
      tr("commands.play.shuffleBtn"),
      session.shuffle ? ButtonStyle.Success : ButtonStyle.Secondary,
      "🔀",
    ),
  );
  const row2 = new ActionRowBuilder().addComponents(
    btn(`sanad:music:queue:${id}`, tr("commands.play.queueBtn"), ButtonStyle.Secondary, "📋"),
    btn(`sanad:music:refresh:${id}`, tr("commands.play.refreshBtn"), ButtonStyle.Secondary, "🔄"),
  );
  return [row1, row2];
}

function playerPayload(session, tr) {
  return {
    content: null,
    embeds: [playerEmbed(session, tr)],
    components: playerButtons(session, tr),
  };
}

function stopProgressTicker(session) {
  if (session.progressTimer) {
    clearInterval(session.progressTimer);
    session.progressTimer = null;
  }
}

function startProgressTicker(client, session) {
  stopProgressTicker(session);
  session.progressTimer = setInterval(() => {
    if (!session.playing || !session.current || session.paused) return;
    upsertNowPlaying(client, session).catch(() => {});
  }, PROGRESS_MS);
  if (typeof session.progressTimer.unref === "function") session.progressTimer.unref();
}

function persistSessions() {
  const out = {};
  for (const [k, s] of sessions) {
    if (!s.current && !s.queue.length) continue;
    out[k] = {
      serverId: s.serverId,
      botId: s.botId,
      channelId: s.channelId,
      textChannelId: s.textChannelId,
      npMessageId: s.npMessageId,
      controlId: s.controlId,
      loopMode: s.loopMode || 0,
      shuffle: Boolean(s.shuffle),
      current: s.current,
      queue: s.queue,
    };
  }
  try {
    writeFileSync(persistPath, JSON.stringify(out, null, 2), "utf8");
  } catch (error) {
    console.warn("[sanad:music] persist:", error?.message || error);
  }
}

function clearPersisted(sessionKey) {
  try {
    if (!existsSync(persistPath)) return;
    const data = JSON.parse(readFileSync(persistPath, "utf8") || "{}");
    if (sessionKey) delete data[sessionKey];
    else for (const k of Object.keys(data)) delete data[k];
    writeFileSync(persistPath, JSON.stringify(data, null, 2), "utf8");
  } catch {
    /* ignore */
  }
}

async function safeUpdate(i, payload) {
  try {
    if (i.deferred || i.replied) return await i.editReply(payload);
    return await i.update(payload);
  } catch (error) {
    if (error?.type === "InteractionAlreadyAcknowledged" || error?.status === 409) {
      try {
        return await i.editReply(payload);
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      return await i.reply({ ...payload, ephemeral: true });
    } catch {
      /* ignore */
    }
  }
}

async function safeEphemeral(i, content) {
  try {
    if (i.deferred || i.replied) return await i.followUp({ content, ephemeral: true });
    return await i.reply({ content, ephemeral: true });
  } catch (error) {
    console.warn("[sanad:music:ephemeral]", error?.message || error?.type || error);
  }
}

async function invalidateStale(i, tr) {
  await safeUpdate(i, {
    embeds: [
      new EmbedBuilder()
        .title(tr("commands.np.title"))
        .description(tr("commands.play.staleControls"))
        .colour("#64748B")
        .toJSON(),
    ],
    components: [],
  });
}

async function upsertNowPlaying(client, session) {
  if (!session.textChannelId || !session.current) return;
  const { t: tr } = guildT(session.serverId);
  const payload = playerPayload(session, tr);
  try {
    if (session.npMessageId) {
      await client.editMessage(session.textChannelId, session.npMessageId, payload);
      persistSessions();
      return;
    }
  } catch {
    session.npMessageId = null;
  }
  try {
    const msg = await client.send(session.textChannelId, payload);
    session.npMessageId = msg.id ?? msg._id;
    persistSessions();
  } catch (error) {
    console.warn("[sanad:music] np embed:", error?.message || error);
  }
}

export async function refreshNowPlaying(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  if (!session.current) return;
  await upsertNowPlaying(client, session);
}

async function clearNowPlaying(client, session, tr, text) {
  stopProgressTicker(session);
  if (!session.textChannelId || !session.npMessageId) {
    session.npMessageId = null;
    return;
  }
  try {
    await client.editMessage(session.textChannelId, session.npMessageId, {
      embeds: [
        new EmbedBuilder()
          .title(tr("commands.np.title"))
          .description(text || tr("commands.play.ended"))
          .colour("#64748B")
          .toJSON(),
      ],
      components: [],
    });
  } catch {
    /* ignore */
  }
  session.npMessageId = null;
}

export function buildNowPlayingPayload(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  if (!session.current) return null;
  const { t: tr } = guildT(serverId);
  return playerPayload(session, tr);
}

function rotateControls(session) {
  session.controlId = newControlId();
}

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function canControlMusic(client, i, session) {
  try {
    if (typeof i.has === "function" && i.has(Permissions.ManageMessages)) return true;
  } catch {
    /* ignore */
  }
  const uid = userId(i.user) || i.userId || i.user?.id || i.user?._id;
  if (!uid || !session?.channelId) return false;
  return getUserVoiceChannel(client, uid) === session.channelId;
}

export function registerMusicControls(client) {
  client.component("sanad:music:", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId || "").split(":");
    // sanad:music:action[:token]
    const action = parts[2];
    const token = parts[3];
    const session = getQueue(client, i.serverId);

    // Legacy buttons (no token) or wrong session → kill UI, do nothing else
    if (!token || token !== session.controlId || !session.playing || !session.current) {
      return invalidateStale(i, tr);
    }

    // Queue/refresh are informational; transport needs voice or Manage Messages
    if (!["queue", "refresh"].includes(action) && !canControlMusic(client, i, session)) {
      return safeEphemeral(i, tr("commands.play.needDj"));
    }

    if (action === "pause") {
      if (session.paused) {
        if (session.pausedAt) session.pausedTotalMs += Date.now() - session.pausedAt;
        session.pausedAt = 0;
        session.paused = false;
        try {
          session.ffmpeg?.proc?.stdout?.resume?.();
        } catch {
          /* ignore */
        }
        startProgressTicker(client, session);
      } else {
        session.paused = true;
        session.pausedAt = Date.now();
        try {
          session.ffmpeg?.proc?.stdout?.pause?.();
        } catch {
          /* ignore */
        }
        stopProgressTicker(session);
      }
      persistSessions();
      return safeUpdate(i, playerPayload(session, tr));
    }

    if (action === "skip") {
      const ok = skip(client, i.serverId);
      await safeUpdate(i, playerPayload(session, tr));
      if (!ok) await safeEphemeral(i, tr("commands.skip.empty"));
      return;
    }

    if (action === "stop") {
      await stop(client, i.serverId);
      return safeUpdate(i, {
        embeds: [
          new EmbedBuilder()
            .title(tr("commands.np.title"))
            .description(tr("commands.stop.done"))
            .colour("#64748B")
            .toJSON(),
        ],
        components: [],
      });
    }

    if (action === "loop") {
      session.loopMode = (session.loopMode + 1) % 3;
      persistSessions();
      return safeUpdate(i, playerPayload(session, tr));
    }

    if (action === "shuffle") {
      session.shuffle = !session.shuffle;
      if (session.shuffle && session.queue.length > 1) shuffleInPlace(session.queue);
      persistSessions();
      return safeUpdate(i, playerPayload(session, tr));
    }

    if (action === "queue") {
      const lines = [];
      if (session.current) lines.push(`▶ ${trackLabel(session.current)}`);
      session.queue.forEach((t, idx) => lines.push(`${idx + 1}. ${trackLabel(t)}`));
      await safeUpdate(i, playerPayload(session, tr));
      return safeEphemeral(
        i,
        lines.length
          ? `**${tr("commands.queue.title")}**\n${lines.join("\n").slice(0, 1800)}`
          : tr("commands.queue.empty"),
      );
    }

    if (action === "refresh") {
      return safeUpdate(i, playerPayload(session, tr));
    }

    return invalidateStale(i, tr);
  });
}

export function pause(client, serverId) {
  const session = getQueue(client, serverId);
  if (!session.current || session.controlId == null) return false;
  if (session.paused) {
    if (session.pausedAt) session.pausedTotalMs += Date.now() - session.pausedAt;
    session.pausedAt = 0;
    session.paused = false;
    try {
      session.ffmpeg?.proc?.stdout?.resume?.();
    } catch {
      /* ignore */
    }
    startProgressTicker(client, session);
  } else {
    session.paused = true;
    session.pausedAt = Date.now();
    try {
      session.ffmpeg?.proc?.stdout?.pause?.();
    } catch {
      /* ignore */
    }
    stopProgressTicker(session);
  }
  persistSessions();
  return true;
}

/** Cycle loop: off → track → queue → off. Returns new mode 0/1/2. */
export function cycleLoop(client, serverId) {
  const session = getQueue(client, serverId);
  if (!session.current) return null;
  session.loopMode = (session.loopMode + 1) % 3;
  persistSessions();
  return session.loopMode;
}

/** Toggle shuffle; shuffles queue when enabling. Returns new boolean or null. */
export function toggleShuffle(client, serverId) {
  const session = getQueue(client, serverId);
  if (!session.current && !session.queue.length) return null;
  session.shuffle = !session.shuffle;
  if (session.shuffle && session.queue.length > 1) shuffleInPlace(session.queue);
  persistSessions();
  return session.shuffle;
}

/** Remove queued track at 1-based index. Returns removed track or null. */
export function removeTrack(client, serverId, index1) {
  const session = getQueue(client, serverId);
  const i = Math.floor(Number(index1)) - 1;
  if (!Number.isFinite(i) || i < 0 || i >= session.queue.length) return null;
  const [removed] = session.queue.splice(i, 1);
  persistSessions();
  return removed;
}

/** Move queued track from → to (1-based). Returns true on success. */
export function moveTrack(client, serverId, from1, to1) {
  const session = getQueue(client, serverId);
  const from = Math.floor(Number(from1)) - 1;
  const to = Math.floor(Number(to1)) - 1;
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from < 0 ||
    to < 0 ||
    from >= session.queue.length ||
    to >= session.queue.length
  ) {
    return false;
  }
  const [item] = session.queue.splice(from, 1);
  session.queue.splice(to, 0, item);
  persistSessions();
  return true;
}

/**
 * Set playback volume 1–150 (%). Applies on next track (or immediately if seek-restart).
 * Returns new volume or null if idle.
 */
export function setVolume(client, serverId, level) {
  const session = getQueue(client, serverId);
  if (!session.current && !session.queue.length) return null;
  const n = Math.max(1, Math.min(150, Math.round(Number(level) || 100)));
  session.volume = n;
  persistSessions();
  return n;
}

export function getVolume(client, serverId) {
  return getQueue(client, serverId).volume ?? 100;
}

function ffmpegPath() {
  try {
    return require("ffmpeg-static");
  } catch {
    return "ffmpeg";
  }
}

function isYouTube(q) {
  return /youtu\.?be|youtube\.com/i.test(q);
}

function cleanError(error) {
  return String(error?.message || error)
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\s+/g, " ")
    .slice(0, 160);
}

/** Resolve query via Spotify catalog (full stream attached at play time). */
export async function resolveTracks(query) {
  const q = String(query || "").trim();
  if (!q) return [];

  if (isYouTube(q)) throw new Error("YOUTUBE_DISABLED");

  const { isSpotifyInput, resolveSpotify, spotifyConfigured } = await import("./spotify.js");
  if (!spotifyConfigured()) throw new Error("SPOTIFY_NOT_CONFIGURED");
  if (!isSpotifyInput(q)) throw new Error("SPOTIFY_ONLY");

  const rows = await resolveSpotify(q);
  if (!rows.length) throw new Error("SPOTIFY_EMPTY");

  return rows.map((row) => ({
    name: row.name,
    artists: row.artists,
    album: row.album,
    display: row.display || row.title,
    title: row.display || row.title,
    url: null,
    duration: row.duration || null,
    spotifyUrl: row.spotifyUrl,
    spotifyId: row.spotifyId || null,
    artwork: row.artwork || null,
    previewUrl: row.previewUrl || null,
    source: "spotify",
    needsFullAudio: true,
  }));
}

/** Attach a full-length stream URL (or preview fallback) before ffmpeg. */
export async function ensurePlayableTrack(track) {
  if (!track) throw new Error("NO_TRACK");
  if (track.url && !track.needsFullAudio) return track;

  const { resolveFullAudio } = await import("./fullAudio.js");
  const full = await resolveFullAudio(track);
  if (full?.url) {
    track.url = full.url;
    if (full.duration) track.duration = full.duration;
    track.needsFullAudio = false;
    track.previewOnly = false;
    track.streamVia = "match";
    return track;
  }

  const { attachPreview } = await import("./spotify.js");
  const preview = await attachPreview(track);
  if (preview?.url) {
    Object.assign(track, preview);
    track.needsFullAudio = false;
    return track;
  }

  throw new Error("NO_FULL_AUDIO");
}

export async function resolveTrack(query) {
  const tracks = await resolveTracks(query);
  return tracks[0] || null;
}

export async function enqueue(client, { serverId, voiceChannelId, textChannelId, track, requestedBy }) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  session.serverId = serverId;
  session.botId = botId;
  session.channelId = voiceChannelId;
  session.textChannelId = textChannelId;
  if (!session.playing) rotateControls(session);
  session.queue.push({ ...track, requestedBy });
  if (session.shuffle && session.queue.length > 1) {
    const last = session.queue.pop();
    const idx = Math.floor(Math.random() * (session.queue.length + 1));
    session.queue.splice(idx, 0, last);
  }
  const position = session.queue.length + (session.current ? 1 : 0);
  persistSessions();

  if (!session.playing) {
    startNext(client, serverId).catch((error) => {
      console.warn("[sanad:music] startNext:", error?.message || error);
      session.playing = false;
      session.current = null;
    });
  } else {
    await upsertNowPlaying(client, session).catch(() => {});
  }
  return { position, session };
}

async function connectVoice(client, channelId) {
  const ticket = await client.voice.join(channelId);
  const {
    Room,
    AudioSource,
    LocalAudioTrack,
    TrackPublishOptions,
    TrackSource,
  } = await import("@livekit/rtc-node");

  const room = new Room();
  await room.connect(ticket.url, ticket.token, { autoSubscribe: false, dynacast: true });

  const audioSource = new AudioSource(SAMPLE_RATE, CHANNELS, 1000);
  const audioTrack = LocalAudioTrack.createAudioTrack("sanad-music", audioSource);
  const options = new TrackPublishOptions();
  options.source = TrackSource.SOURCE_MICROPHONE;
  await room.localParticipant.publishTrack(audioTrack, options);

  return { room, audioSource, audioTrack, ticket };
}

async function ensureConnected(session, client) {
  if (session.room?.localParticipant && session.audioSource) return;
  await stopPlayback(session);
  const conn = await connectVoice(client, session.channelId);
  session.room = conn.room;
  session.audioSource = conn.audioSource;
  session.audioTrack = conn.audioTrack;
}

async function playChime(audioSource) {
  const { AudioFrame } = await import("@livekit/rtc-node");
  const seconds = 0.2;
  const total = Math.floor(SAMPLE_RATE * seconds);
  const data = new Int16Array(total);
  for (let i = 0; i < total; i++) {
    const t = i / SAMPLE_RATE;
    const env = Math.min(1, t * 16) * Math.max(0, 1 - t / seconds);
    data[i] = Math.max(
      -32767,
      Math.min(32767, Math.floor(Math.sin(2 * Math.PI * 523.25 * t) * 0.18 * env * 32767)),
    );
  }
  for (let off = 0; off + FRAME_SAMPLES <= total; off += FRAME_SAMPLES) {
    const slice = data.subarray(off, off + FRAME_SAMPLES);
    await audioSource.captureFrame(new AudioFrame(slice, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES));
  }
}

function frameFromPcm(buf) {
  const samples = new Int16Array(FRAME_SAMPLES * CHANNELS);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = buf.readInt16LE(i * 2);
  }
  return samples;
}

function spawnFfmpegPcm(inputPathOrUrl, volumePercent = 100) {
  const ff = ffmpegPath();
  const args = ["-hide_banner", "-loglevel", "error"];
  if (/googlevideo\.com|youtube\.com|ytimg/i.test(String(inputPathOrUrl))) {
    args.push(
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "5",
      "-user_agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    );
  }
  const vol = Math.max(0.01, Math.min(1.5, (Number(volumePercent) || 100) / 100));
  args.push(
    "-i",
    inputPathOrUrl,
    "-vn",
    "-af",
    `volume=${vol.toFixed(3)}`,
    "-acodec",
    "pcm_s16le",
    "-f",
    "s16le",
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    String(CHANNELS),
    "pipe:1",
  );
  const ffProc = spawn(ff, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  ffProc.stderr.on("data", (d) => {
    err += d.toString();
    if (err.length > 600) err = err.slice(-600);
  });
  ffProc._sanadErr = () => err;
  return { proc: ffProc };
}

async function pumpPcm(session, stream) {
  const { AudioFrame } = await import("@livekit/rtc-node");
  const source = session.audioSource;
  let pending = Buffer.alloc(0);
  let frames = 0;

  await new Promise((resolve, reject) => {
    let pumping = false;
    let settled = false;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(arg);
    };

    const pump = async () => {
      if (pumping || settled) return;
      pumping = true;
      try {
        while (pending.length >= FRAME_BYTES && !session.abort && !settled) {
          while (session.paused && !session.abort && !settled) {
            if (!stream.proc.stdout.isPaused()) stream.proc.stdout.pause();
            await sleep(120);
          }
          if (session.abort || settled) break;
          const frameBuf = pending.subarray(0, FRAME_BYTES);
          pending = pending.subarray(FRAME_BYTES);
          const samples = frameFromPcm(Buffer.from(frameBuf));
          await source.captureFrame(new AudioFrame(samples, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES));
          frames += 1;
        }
      } catch (error) {
        pumping = false;
        finish(reject, error);
        return;
      }
      pumping = false;
      if (!session.abort && !session.paused && stream.proc.stdout.isPaused()) {
        stream.proc.stdout.resume();
      }
    };

    const onData = (chunk) => {
      if (session.abort || settled) return;
      pending = Buffer.concat([pending, chunk]);
      if (session.paused || pending.length >= FRAME_BYTES * 8) stream.proc.stdout.pause();
      if (!session.paused) void pump();
    };

    const cleanup = () => {
      stream.proc.stdout.off("data", onData);
      stream.proc.off("close", onClose);
      stream.proc.off("error", onError);
    };

    const onClose = (code) => {
      void (async () => {
        try {
          while (pending.length >= FRAME_BYTES && !session.abort) {
            const frameBuf = pending.subarray(0, FRAME_BYTES);
            pending = pending.subarray(FRAME_BYTES);
            const samples = frameFromPcm(Buffer.from(frameBuf));
            await source.captureFrame(new AudioFrame(samples, SAMPLE_RATE, CHANNELS, FRAME_SAMPLES));
            frames += 1;
          }
        } catch {
          /* ignore */
        }
        if (session.abort) return finish(resolve);
        if (code && code !== 0) {
          return finish(
            reject,
            new Error(`decode failed (${code}) ${cleanError({ message: stream.proc._sanadErr?.() })}`),
          );
        }
        if (frames === 0) return finish(reject, new Error("No audio frames decoded"));
        finish(resolve);
      })();
    };

    const onError = (error) => finish(reject, error);

    stream.proc.stdout.on("data", onData);
    stream.proc.on("close", onClose);
    stream.proc.on("error", onError);
  });

  try {
    await source.waitForPlayout();
  } catch {
    /* ignore */
  }
}

function killStream(session) {
  session.abort = true;
  if (session.ffmpeg?.proc) {
    try {
      session.ffmpeg.proc.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
  session.ffmpeg = null;
}

async function stopPlayback(session) {
  killStream(session);
  try {
    if (session.audioTrack) await session.audioTrack.close();
  } catch {
    /* ignore */
  }
  session.audioTrack = null;
  session.audioSource = null;
  try {
    if (session.room && typeof session.room.disconnect === "function") await session.room.disconnect();
  } catch {
    /* ignore */
  }
  session.room = null;
  session.abort = false;
}

async function startNext(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  const { t: tr } = guildT(serverId);
  killStream(session);
  session.abort = false;
  session.paused = false;
  session.pausedAt = 0;
  session.pausedTotalMs = 0;

  const next = session.queue.shift();
  if (!next) {
    session.current = null;
    session.playing = false;
    stopProgressTicker(session);
    rotateControls(session);
    await clearNowPlaying(client, session, tr);
    clearPersisted(key(botId, serverId));
    await disconnect(serverId, botId);
    return;
  }

  session.serverId = serverId;
  session.botId = botId;
  session.playing = true;
  session.current = next;
  session.startedAt = Date.now();
  persistSessions();

  try {
    await ensureConnected(session, client);
    await playChime(session.audioSource).catch(() => {});

    await ensurePlayableTrack(next);
    if (!next.url) throw new Error("NO_FULL_AUDIO");

    session.startedAt = Date.now();
    session.pausedTotalMs = 0;
    await upsertNowPlaying(client, session);
    startProgressTicker(client, session);

    const stream = spawnFfmpegPcm(next.url, session.volume ?? 100);
    session.ffmpeg = stream;
    await pumpPcm(session, stream);
  } catch (error) {
    console.warn("[sanad:music] playback:", error?.message || error);
    stopProgressTicker(session);
    if (session.textChannelId) {
      const failTitle = session.current?.title || "?";
      await client
        .send(session.textChannelId, tr("commands.play.playbackFail", { title: failTitle }))
        .catch(() => {});
      if (session.npMessageId) await upsertNowPlaying(client, session).catch(() => {});
    }
  }

  // stop() already wiped session and rotated controlId
  if (!session.playing && !session.queue.length) {
    session.current = null;
    session.abort = false;
    session.paused = false;
    stopProgressTicker(session);
    return;
  }

  const finished = session.current;

  if (finished) {
    session.history.push(finished);
    if (session.history.length > 80) session.history.shift();
  }

  if (finished && session.loopMode === 1 && session.playing) {
    session.queue.unshift(finished);
  } else if (
    session.loopMode === 2 &&
    session.playing &&
    !session.queue.length &&
    session.history.length
  ) {
    session.queue.push(...session.history);
    session.history = [];
    if (session.shuffle) shuffleInPlace(session.queue);
  }

  session.current = null;
  session.abort = false;
  session.paused = false;
  stopProgressTicker(session);

  if (session.queue.length) {
    session.playing = true;
    startNext(client, serverId).catch((error) => {
      console.warn("[sanad:music] advance:", error?.message || error);
    });
    return;
  }

  session.playing = false;
  rotateControls(session);
  await clearNowPlaying(client, session, tr);
  clearPersisted(key(botId, serverId));
  await disconnect(serverId, botId);
}

export function skip(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  if (!session.current && !session.queue.length) return false;
  // skip disables one-track loop for this advance
  if (session.loopMode === 1) session.loopMode = 0;
  session.paused = false;
  killStream(session);
  return true;
}

export async function stop(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  const session = getSession(botId, serverId);
  const { t: tr } = guildT(serverId);
  session.queue = [];
  session.history = [];
  session.current = null;
  session.playing = false;
  session.paused = false;
  rotateControls(session);
  stopProgressTicker(session);
  await clearNowPlaying(client, session, tr, tr("commands.stop.done"));
  clearPersisted(key(botId, serverId));
  await disconnect(serverId, botId);
}

async function disconnect(serverId, botId) {
  const session = getSession(botId, serverId);
  await stopPlayback(session);
}

export function getQueue(client, serverId) {
  const botId = client.user?.id || client.user?._id || "main";
  return getSession(botId, serverId);
}

/** After login: restore saved queue and resume if voice channel known. */
export async function restoreMusicSessions(client) {
  if (!existsSync(persistPath)) return;
  let data;
  try {
    data = JSON.parse(readFileSync(persistPath, "utf8") || "{}");
  } catch {
    return;
  }
  const botId = client.user?.id || client.user?._id || "main";
  for (const [persistKey, saved] of Object.entries(data)) {
    if (!saved?.serverId || !saved.channelId) continue;
    // Only this bot instance resumes its own sessions (not every instance)
    if (saved.botId && saved.botId !== botId && !persistKey.startsWith(`${botId}:`)) continue;
    if (!saved.botId && persistKey.includes(":") && !persistKey.startsWith(`${botId}:`)) continue;
    const session = getSession(botId, saved.serverId);
    if (session.playing || session.current) continue;
    rotateControls(session);
    session.channelId = saved.channelId;
    session.textChannelId = saved.textChannelId || null;
    session.npMessageId = saved.npMessageId || null;
    session.loopMode = saved.loopMode || 0;
    session.shuffle = Boolean(saved.shuffle);
    session.queue = [];
    if (saved.current?.url) session.queue.push(saved.current);
    if (Array.isArray(saved.queue)) {
      for (const t of saved.queue) if (t?.url) session.queue.push(t);
    }
    if (!session.queue.length) continue;

    // Kill old message buttons from previous process
    if (session.textChannelId && session.npMessageId) {
      const { t: tr } = guildT(session.serverId);
      try {
        await client.editMessage(session.textChannelId, session.npMessageId, {
          embeds: [
            new EmbedBuilder()
              .title(tr("commands.np.title"))
              .description(tr("commands.play.restoring"))
              .colour(config.brand.colour)
              .toJSON(),
          ],
          components: [],
        });
      } catch {
        session.npMessageId = null;
      }
    }

    console.log(`[sanad:music] restoring ${session.queue.length} track(s) for ${saved.serverId}`);
    startNext(client, saved.serverId).catch((error) => {
      console.warn("[sanad:music] restore:", error?.message || error);
      session.playing = false;
      session.current = null;
    });
  }
}
