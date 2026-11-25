# Sanad web dashboard

The dashboard uses Zrzur's dark surfaces, pink accent, teal welcome banner,
server rail, and grouped navigation. Arabic uses RTL layout; English uses LTR.
The interface language is independent of the bot's configured server language.

## Run the real dashboard

```sh
npm run oauth
```

Open `http://localhost:8787` (or your configured OAuth address). Sign in with
Zrzur. Existing OAuth configuration, permissions, bot API requests, and server
configuration storage are handled by `src/web/oauthServer.js`.

Management controls are shown only after the bot can access the server and the
signed-in account passes the server permission check. OAuth-owned servers where
the bot is absent are listed separately with an Add bot action. Temporary API
failures show an unavailable state instead of incorrectly claiming absence.
Changes to settings require each section's Save button. Feature switches save
immediately. Messages and webhooks use the existing backend endpoints.

## Design preview with sample data

```sh
node tools/preview-dashboard.mjs
```

Open `http://127.0.0.1:8790`. For the sign-in screen, open
`http://127.0.0.1:8790/?preview=login`.

This separate preview server binds only to loopback and displays a sample-data
label. It never loads `.env`, contacts Zrzur, signs in, runs the bot, or reads or
writes production data. Preview changes live in memory and reset on restart.
It is a design and interaction fixture, not an OAuth or bot integration test.

## Available screens

- Home: searchable server directory and bot invitation.
- Overview: real configuration counts, channel/role counts, feature status,
  protection summary, and shortcuts. Unavailable directory data shows an error
  and a dash rather than a misleading zero.
- Features: seven independently saved feature switches.
- Protection: detectors, policy, thresholds, words/domains, and anti-raid.
- Welcome, tickets, levels, starboard: dedicated configuration screens.
- Community: the same configuration sections together; Save affects its section.
- Send: channel selection, text/embed composer, and a live approximate preview.
- Webhooks: existing create, send, token, regeneration, and deletion operations.
- Music and games: guides to commands executed inside Zrzur channels.
- Settings: language, prefix, roles, logging, auto roles, and ignored channels.

The current shell uses the original rounded outline icon family, locally hosted
IBM Plex Sans and IBM Plex Sans Arabic, a server banner, grouped navigation, and
page tabs. Account controls remain available on mobile. Dialogs keep their
header and footer visible while the body scrolls. Navigation and language
changes warn about unsaved form changes. Directional icons, names, messages,
and technical identifiers use appropriate RTL, LTR, or automatic direction.

Asset sources and separate licenses are listed in
`src/web/public/ASSET_NOTICES.md`. There are no runtime Google Fonts requests.

The dashboard does not claim live bot presence, activity analytics, or a browser
music player: those data and controls are not exposed by its current backend.

## Verification

### Responsive navigation

Phones up to 760px use the full content width, a four-item bottom navigation
bar, a server chooser in the header, and an additional-tools sheet. The sheet
also contains the current user's account and logout action. All existing
sections remain reachable. Dialogs become bottom sheets; touch targets and
inputs are larger, and safe-area insets are respected. Save controls follow
their section instead of covering form fields on phones.

Tablet portrait retains the server rail and sidebar with two-column cards.
Wider layouts retain the desktop navigation. Arabic mirrors the layout;
English uses LTR. Icons remain the existing licensed rounded outline family,
with consistent sizing and understated containers.

Browser viewport checks used 390×844 and 768×1024 for Arabic page coverage,
and 320×740 and 1024×768 for key English screens. These are desktop-browser
viewport simulations, not physical iPhone/iPad or Safari device testing.

Run `node --check src/web/public/app.js` and
`node --check tools/preview-dashboard.mjs` for syntax checks.

Run `node --test tools/dashboard-access.test.mjs tools/dashboard-assets.test.mjs`
for server access, local asset loading, and Unicode/escaping checks. These tests
do not load credentials or write production data.

Browser checks performed against the isolated preview include Arabic/English
navigation, every section, server search and empty search results, switches,
ticket settings, scoped community saving, message preview and sample sending,
desktop sign-in, and a 390px mobile layout without horizontal content overflow.
Live OAuth and actual Zrzur operations still require a signed-in integration
check with the real service.
