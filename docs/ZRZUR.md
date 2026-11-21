# Building bots on Zrzur (with Sanad as reference)

This note is for developers learning the Zrzur platform.

## Concepts Sanad uses

| Concept | Where in Sanad |
|---------|----------------|
| `Client` login + intents | `src/core/createBot.js` |
| Slash commands | `SlashCommandBuilder` in each `modules/*.js` |
| Prefix / message content | `createBot` message handler + `SANAD_PRIVILEGED_INTENTS` |
| Buttons & selects | `client.component("sanad:…")` |
| Modals | `client.modal("sanad:…")` |
| Permissions | `Permissions.*` from `@zrzur/sdk/bot` + `i.has(perm)` |
| Voice / LiveKit | `src/managers/music.js` + `voiceTracker.js` |
| REST helpers | `client.rest.get/post`, `client.members.*`, `client.channels.*` |

## Intents vs invite permissions

- **Invite OAuth scopes / permission bits** control what the bot *may* do when invited.
- **Privileged intents** (Message Content, Members, …) control what events the gateway *sends*.

Sanad needs Message Content for `!prefix` commands. Toggle them in **Zrzur → My Bots**, then set `SANAD_PRIVILEGED_INTENTS=1`.

## Suggested learning path

1. Clone Sanad, run with your token, try `/ping` and `/help`
2. Read `src/modules/moderation.js` — classic slash + permission pattern
3. Read `src/core/registry.js` + `prefixBridge.js` — unified slash/prefix
4. Read `src/modules/tickets.js` — buttons, modals, channel ACLs
5. Read `src/managers/music.js` — voice + session state

## Official links

- [zrzur.com](https://zrzur.com)
- npm: `@zrzur/sdk`
