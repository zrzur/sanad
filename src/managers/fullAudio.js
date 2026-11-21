/**
 * Full-length audio for Spotify catalog tracks.
 * Spotify API has no full stream for bots — we match title+artist via yt-dlp
 * (search only; user YouTube URLs stay rejected in music.js).
 *
 * Called from: src/managers/music.js → ensurePlayableTrack() / startNext()
 * No existing module resolves full streams (spotify.js is catalog + 30s preview only).
 * Reads: track { name, artists, title, duration }. Writes: none (returns url/duration).
 * User: "تمام حاول تتعامل مع هذا الشي حاول إنك تشغلها بالكامل غني الكاملة يعني."
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const YTDLP = path.join(ROOT, "tools", "yt-dlp.exe");
const YTDLP_UNIX = path.join(ROOT, "tools", "yt-dlp");

function ytdlpBin() {
  if (process.platform === "win32" && fs.existsSync(YTDLP)) return YTDLP;
  if (fs.existsSync(YTDLP_UNIX)) return YTDLP_UNIX;
  return "yt-dlp";
}

function run(bin, args, timeoutMs = 45_000) {
  return new Promise((resolve, reject) => {
    const proc = spawn(bin, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("FULL_AUDIO_TIMEOUT"));
    }, timeoutMs);
    proc.stdout.on("data", (d) => {
      out += d.toString();
    });
    proc.stderr.on("data", (d) => {
      err += d.toString();
      if (err.length > 800) err = err.slice(-800);
    });
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(`yt-dlp exit ${code}: ${err.slice(0, 160) || "fail"}`));
        return;
      }
      resolve(out);
    });
  });
}

function searchQuery(track) {
  const name = String(track?.name || track?.title || "").trim();
  const artist = String(track?.artists || "")
    .split(",")[0]
    ?.trim();
  if (!name) return null;
  return artist ? `${name} ${artist}` : name;
}

/**
 * @returns {Promise<{ url: string, duration: number|null, title: string|null } | null>}
 */
export async function resolveFullAudio(track) {
  const q = searchQuery(track);
  if (!q) return null;

  const bin = ytdlpBin();
  const args = [
    "-j",
    "--no-playlist",
    "--no-warnings",
    "-f",
    "bestaudio/best",
    "--skip-download",
    `ytsearch1:${q}`,
  ];

  let raw;
  try {
    raw = await run(bin, args);
  } catch (error) {
    console.warn("[sanad:fullAudio]", error?.message || error);
    return null;
  }

  const line = raw
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.startsWith("{"));
  if (!line) return null;

  let info;
  try {
    info = JSON.parse(line);
  } catch {
    return null;
  }

  const url =
    info.url ||
    info.requested_formats?.find((f) => f.url && f.vcodec === "none")?.url ||
    info.formats?.find(
      (f) => f.url && f.acodec && f.acodec !== "none" && (!f.vcodec || f.vcodec === "none"),
    )?.url ||
    info.formats?.find((f) => f.url)?.url;

  if (!url) return null;

  const duration =
    Number.isFinite(info.duration) && info.duration > 0
      ? Math.round(info.duration)
      : track.duration || null;

  return {
    url,
    duration,
    title: info.title || null,
  };
}
