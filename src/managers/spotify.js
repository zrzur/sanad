/**
 * Spotify Web API (Client Credentials) — catalog only (links / search / playlists).
 * Full audio is resolved later in music.js via title+artist match (see fullAudio.js).
 * Optional Deezer/iTunes preview kept as last-resort fallback only.
 *
 * Called from: src/managers/music.js → resolveTracks()
 */
import { config } from "../config.js";

let cachedToken = null;
let tokenExpiresAt = 0;

export function spotifyConfigured() {
  return Boolean(config.spotify?.clientId && config.spotify?.clientSecret);
}

async function getToken() {
  if (!spotifyConfigured()) {
    throw new Error("SPOTIFY_NOT_CONFIGURED");
  }
  if (cachedToken && Date.now() < tokenExpiresAt - 30_000) return cachedToken;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: config.spotify.clientId,
    client_secret: config.spotify.clientSecret,
  });

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify auth failed (${res.status}) ${text.slice(0, 120)}`);
  }
  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
  return cachedToken;
}

const MARKET = process.env.SPOTIFY_MARKET || "US";

function withMarket(path) {
  if (/[?&]market=/i.test(path)) return path;
  return path.includes("?") ? `${path}&market=${MARKET}` : `${path}?market=${MARKET}`;
}

async function spotifyGet(path) {
  const token = await getToken();
  const res = await fetch(`https://api.spotify.com/v1${withMarket(path)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Spotify API ${res.status}: ${text.slice(0, 160)}`);
  }
  return res.json();
}

/** @returns {{ type: 'track'|'album'|'playlist'|'search', id?: string, query?: string } | null} */
export function parseSpotifyInput(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const uri = raw.match(/^spotify:(track|album|playlist):([a-zA-Z0-9]+)$/i);
  if (uri) return { type: uri[1].toLowerCase(), id: uri[2] };

  try {
    if (/open\.spotify\.com/i.test(raw) || /spotify\.link/i.test(raw)) {
      const u = new URL(raw);
      const parts = u.pathname.split("/").filter(Boolean);
      let type = null;
      let id = null;
      for (let i = 0; i < parts.length; i++) {
        if (["track", "album", "playlist"].includes(parts[i]) && parts[i + 1]) {
          type = parts[i];
          id = parts[i + 1].split("?")[0];
          break;
        }
      }
      if (type && id) return { type, id };
    }
  } catch {
    /* ignore */
  }

  if (/^sp[:\s]/i.test(raw) || /^spotify\s+/i.test(raw)) {
    return { type: "search", query: raw.replace(/^(sp[:\s]+|spotify\s+)/i, "").trim() };
  }

  if (/^https?:\/\//i.test(raw)) return null;

  return { type: "search", query: raw };
}

export function isSpotifyInput(input) {
  return Boolean(parseSpotifyInput(input));
}

function pickArtwork(item) {
  const images = item?.album?.images || item?.images || [];
  const best = images.find((img) => img?.url) || images[0];
  return best?.url || null;
}

function formatTrack(item, albumMeta = null) {
  if (!item?.name) return null;
  const artists = (item.artists || []).map((a) => a.name).filter(Boolean).join(", ");
  const display = artists ? `${item.name} — ${artists}` : item.name;
  const artwork = pickArtwork(item) || pickArtwork(albumMeta);
  const durationSec = Math.round(Number(item.duration_ms || 0) / 1000) || null;
  return {
    name: item.name,
    artists,
    album: item.album?.name || albumMeta?.name || null,
    display,
    title: display.slice(0, 200),
    duration: durationSec,
    spotifyUrl: item.external_urls?.spotify || null,
    spotifyId: item.id || null,
    artwork,
    previewUrl: item.preview_url || null,
    source: "spotify",
  };
}

async function deezerPreview(name, artists) {
  const q = encodeURIComponent(`${name} ${artists || ""}`.trim());
  const res = await fetch(`https://api.deezer.com/search?q=${q}&limit=8`);
  if (!res.ok) return null;
  const data = await res.json();
  const want = String(name || "").toLowerCase();
  const artistWant = String(artists || "")
    .toLowerCase()
    .split(",")[0]
    ?.trim();
  const rows = data.data || [];
  const hit =
    rows.find(
      (t) =>
        t.preview &&
        String(t.title || "").toLowerCase().includes(want.slice(0, 24)) &&
        (!artistWant || String(t.artist?.name || "").toLowerCase().includes(artistWant.slice(0, 18))),
    ) || rows.find((t) => t.preview);
  return hit?.preview || null;
}

async function itunesPreview(name, artists) {
  const q = encodeURIComponent(`${name} ${artists || ""}`.trim());
  const res = await fetch(
    `https://itunes.apple.com/search?term=${q}&media=music&entity=song&limit=5`,
  );
  if (!res.ok) return null;
  const data = await res.json();
  const hit = (data.results || []).find((t) => t.previewUrl);
  return hit?.previewUrl || null;
}

/** Last-resort 30s clip if full-audio resolve fails. */
export async function attachPreview(track) {
  if (!track) return null;
  if (track.previewUrl) {
    return { ...track, url: track.previewUrl, direct: true, previewOnly: true, duration: 30 };
  }
  let preview = null;
  try {
    preview = await deezerPreview(track.name, track.artists);
  } catch {
    /* ignore */
  }
  if (!preview) {
    try {
      preview = await itunesPreview(track.name, track.artists);
    } catch {
      /* ignore */
    }
  }
  if (!preview) return null;
  return {
    ...track,
    previewUrl: preview,
    url: preview,
    direct: true,
    previewOnly: true,
    duration: 30,
  };
}

/** Keep Spotify rows even without preview — full stream is resolved at play time. */
async function withCatalog(tracks) {
  return (tracks || []).filter(Boolean);
}

async function fetchPlaylistTracks(id, limit = 50) {
  const tracks = [];
  let url =
    `/playlists/${id}/tracks?limit=50&fields=items(track(name,artists,duration_ms,external_urls,id,preview_url,album(name,images))),next`;
  while (url && tracks.length < limit) {
    const path = url.startsWith("http") ? url.replace("https://api.spotify.com/v1", "") : url;
    const page = await spotifyGet(path);
    for (const row of page.items || []) {
      const t = formatTrack(row.track);
      if (t) tracks.push(t);
      if (tracks.length >= limit) break;
    }
    url = page.next || null;
  }
  return withCatalog(tracks);
}

async function fetchAlbumTracks(id) {
  const album = await spotifyGet(`/albums/${id}`);
  const tracks = [];
  for (const item of album.tracks?.items || []) {
    const enriched = {
      ...item,
      artists: item.artists?.length ? item.artists : album.artists,
      external_urls: item.external_urls || album.external_urls,
      album: { name: album.name, images: album.images },
    };
    const t = formatTrack(enriched, album);
    if (t) tracks.push(t);
  }
  return withCatalog(tracks.slice(0, 50));
}

/**
 * Resolve Spotify URL / URI / search text into catalog tracks (metadata).
 * Playback URL is attached later by music/fullAudio.
 */
export async function resolveSpotify(input) {
  const parsed = parseSpotifyInput(input);
  if (!parsed) return [];

  if (!spotifyConfigured()) {
    throw new Error("SPOTIFY_NOT_CONFIGURED");
  }

  if (parsed.type === "track") {
    const item = await spotifyGet(`/tracks/${parsed.id}`);
    const t = formatTrack(item);
    return withCatalog(t ? [t] : []);
  }

  if (parsed.type === "album") {
    return fetchAlbumTracks(parsed.id);
  }

  if (parsed.type === "playlist") {
    return fetchPlaylistTracks(parsed.id, 50);
  }

  if (parsed.type === "search") {
    const q = encodeURIComponent(parsed.query);
    const data = await spotifyGet(`/search?type=track&limit=5&q=${q}`);
    const rows = (data.tracks?.items || []).map(formatTrack).filter(Boolean);
    return withCatalog(rows).slice(0, 1);
  }

  return [];
}
