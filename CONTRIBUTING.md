# Contributing to Sanad

Thanks for helping make the Zrzur example bot better.

## Ground rules

1. **No secrets** — never commit `.env`, tokens, or real `data/` dumps.
2. **Keep i18n in sync** — every user-facing string needs both `src/core/locales/en.json` and `ar.json`.
3. **Small PRs** — one feature or fix per pull request when possible.
4. **Match existing style** — ESM, `@zrzur/sdk` builders, `guildT()` for replies.

## Local setup

```bash
npm install
cp .env.example .env
npm run dev
```

Use a **dev bot token** so you do not disturb production servers.

## Useful checks before a PR

- [ ] Bot starts with `npm start` and prints `Sanad online`
- [ ] New slash command has EN default description + AR localization
- [ ] Prefix bridge added if the command is advertised in `!help`
- [ ] No hardcoded Arabic/English mixed into module logic (use locales)
- [ ] `.env` / `data/` still gitignored

## Code map

| Want to change… | Look in… |
|-----------------|----------|
| Slash + login lifecycle | `src/core/createBot.js` |
| Prefix-only helpers | `src/core/prefixBridge.js` |
| Moderation | `src/modules/moderation.js` |
| Tickets | `src/modules/tickets.js` |
| Music | `src/managers/music.js`, `spotify.js`, `fullAudio.js` |
| Strings | `src/core/locales/*.json` |

## Commit style

Prefer short, imperative messages:

- `fix: deny prefix perms when role lookup fails`
- `docs: clarify privileged intents in README`
- `feat: add ignore_role to automod config`

## Questions

Open a GitHub Issue on [zrzur/sanad](https://github.com/zrzur/sanad) or ask in the Zrzur community.
