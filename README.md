# Sanad · سند

**Official open-source example bot for [Zrzur](https://zrzur.com)** — a full server-management bot you can run, fork, and learn from.

Sanad shows how to build production-style bots on the Zrzur platform with the [`@zrzur/sdk`](https://www.npmjs.com/package/@zrzur/sdk): slash + prefix commands, i18n (Arabic / English), music, tickets, moderation, leveling, panels, and more.

[![License: MIT](https://img.shields.io/badge/License-MIT-rose.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.3-brightgreen)](package.json)
[![Zrzur SDK](https://img.shields.io/badge/%40zrzur%2Fsdk-2.x-E11D48)](https://www.npmjs.com/package/@zrzur/sdk)

---

## Why this repo exists

Zrzur is growing. Developers need a **real, complete reference** — not a hello-world stub.

Sanad is that reference:

- One codebase → slash commands **and** prefix (`!`)
- Per-server language (`/language` → `ar` / `en`)
- Layout panels, dashboard, tickets, giveaways, music over LiveKit
- Multi-instance (`/instance`) so partners can run the same features under their own bot name

Use it to learn Zrzur bot APIs, intents, components, voice, and permissions.

---

## Features

| Area | What you get |
|------|----------------|
| **Moderation** | ban, kick, timeout, warn, purge, lock / unlock, cases, softban, slowmode |
| **Automod / Anti-raid** | spam, invites, links, caps, bad words, ignore roles, join surge |
| **Tickets** | panel, claim, reminder, rename, add member, close |
| **Community** | leveling + leaderboard, suggestions, polls, giveaways (min account age, participants pages) |
| **Server UX** | `/panel`, `/dashboard`, welcome / goodbye, starboard, role menus, autorespond |
| **Music** | Spotify search & links → full-length playback in voice (LiveKit + ffmpeg) |
| **i18n** | Guild locale drives every reply; slash picker stays English-consistent |
| **Instances** | Owners can attach extra bot tokens with the same Sanad features |

---

## Requirements

- **Node.js** `>= 22.3.0`
- A **Zrzur bot** (Settings → My Bots → create → copy token)
- Optional: [Spotify Developer](https://developer.spotify.com/dashboard) app (music)
- Optional: [yt-dlp](https://github.com/yt-dlp/yt-dlp/releases) binary in `tools/` (full-length music match) — see [`tools/README.md`](tools/README.md)
- ffmpeg (via `ffmpeg-static` dependency or system install)

### Zrzur portal checklist

In **My Bots** for your bot:

1. Copy the **bot token** into `.env`
2. Invite the bot with the permissions you need (manage channels, kick/ban, voice, …)
3. For prefix commands (`!help`, `!play`, …): enable **Message Content** (and Members / Reactions if you use those features), then set `SANAD_PRIVILEGED_INTENTS=1` in `.env`

> OAuth invite permissions ≠ privileged intents. Both must be configured correctly.

---

## Quick start

```bash
git clone https://github.com/zrzur/sanad.git
cd sanad
npm install
cp .env.example .env
# edit .env → paste ZRZUR_BOT_TOKEN
npm start
```

Dev mode (auto-restart):

```bash
npm run dev
```

### Minimal `.env`

```env
ZRZUR_BOT_TOKEN=zrzur_bot_...
SANAD_PREFIX=!
SANAD_LOCALE=ar
# SANAD_PRIVILEGED_INTENTS=1
# SPOTIFY_CLIENT_ID=
# SPOTIFY_CLIENT_SECRET=
```

Never commit `.env`. Runtime data lives in `data/` (gitignored).

---

## First commands after online

| Command | Purpose |
|---------|---------|
| `/help` or `!help` | Command guide |
| `/language ar` / `en` | Server language |
| `/dashboard` or `!dashboard` | Admin hub + feature toggles |
| `/panel` or `!panel` | Post the community panel |
| `/setup overview` | Feature overview |
| `/play <Spotify or song>` | Music (needs voice + Spotify env) |
| `/ticket panel` | Support ticket button |

---

## Project layout

```
src/
  index.js              # entry + PID lock + instances
  config.js             # env → config
  brand.js              # colours / mentions
  core/                 # createBot, registry, i18n, prefix bridge
  modules/              # moderation, tickets, panel, dashboard, utility, …
  managers/             # music, Spotify, voice, instances
  db/store.js           # JSON persistence under data/
  util/                 # format, locale, logs, lock
tools/                  # put yt-dlp here (not committed)
data/                   # created at runtime
```

### How commands are registered

- **Slash**: module `*Commands()` builders + `createBot` hard resync
- **Prefix**: `registry` + `prefixBridge` + Message Content intent
- **Buttons / modals**: `client.component` / `client.modal` with `sanad:` custom ids

Guild locale: `getGuild(serverId).locale` → `guildT()` → `ar.json` / `en.json`.

---

## Music notes

1. User sends a **Spotify URL** or song name (`/play` / `!play`)
2. Sanad queries the **Spotify Web API** for metadata
3. Full audio is resolved via a local **yt-dlp** match (not a public YouTube command)
4. Audio is decoded with **ffmpeg** to PCM and sent through **LiveKit** voice

YouTube links from users are rejected on purpose.

---

## Multi-instance

Set `SANAD_OWNER_IDS` to your Zrzur user id(s), then:

```
/instance add token:<other-bot-token> label:PartnerBot
```

Child bots share Sanad features under their own username. Tokens are stored locally in `data/` and never echoed back.

---

## Security

- Do **not** publish bot tokens, Spotify secrets, or `data/`
- Rotate any token that was ever pasted into chat, screenshots, or `.env.example`
- Prefix moderation commands check permission bits (fail closed on API errors)
- Music transport controls require Manage Messages **or** being in the bot’s voice channel

---

## Learn Zrzur bot APIs

Start with [docs/ZRZUR.md](docs/ZRZUR.md) — intents, components, voice, and a reading order through this codebase.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs that improve docs, i18n coverage, or Zrzur SDK patterns are especially welcome.

---

## License

[MIT](LICENSE) © Zrzur

---

## Links

- Platform: [zrzur.com](https://zrzur.com)
- SDK: [`@zrzur/sdk`](https://www.npmjs.com/package/@zrzur/sdk)
- Repo: [github.com/zrzur/sanad](https://github.com/zrzur/sanad)

---

### عربي · ملخص سريع

**سند** بوت إدارة سيرفرات زرزور مفتوح المصدر — مثال رسمي لتتعلم كيف تبرمج بوتات على المنصة.

```bash
git clone https://github.com/zrzur/sanad.git
cd sanad && npm install
cp .env.example .env   # حط توكن البوت من إعدادات زرزور → My Bots
npm start
```

فعّل Message Content من البوابة إذا بدك أوامر البرفكس (`!help`). الموسيقى تحتاج Spotify + ملف `yt-dlp` داخل `tools/`.
