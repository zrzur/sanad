/**
 * Professional arcade games (buttons + minimal embeds).
 * Callers: createBot.js → registerArcade / arcadeCommands.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  Permissions,
  SlashCommandBuilder,
} from "@zrzur/sdk/bot";
import { BRAND, userId } from "../brand.js";
import { makeT, t } from "../core/i18n.js";
import { registry } from "../core/registry.js";
import { guildT } from "../util/locale.js";

const sessions = new Map();
const TTL_MS = 30 * 60_000;
const MAX = 200;

function nid() {
  return Math.random().toString(16).slice(2, 10);
}

function touch(g) {
  g.expires = Date.now() + TTL_MS;
}

function prune() {
  const now = Date.now();
  for (const [id, g] of sessions) {
    if (g.expires < now || g.ended) sessions.delete(id);
  }
  if (sessions.size > MAX) {
    const oldest = [...sessions.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (const [id] of oldest.slice(0, sessions.size - MAX)) sessions.delete(id);
  }
}

function emb(title, body, colour = BRAND.colour.primary) {
  return new EmbedBuilder().title(title).description(body).colour(colour);
}

/** Monospace board — pads lines so the embed doesn't shrink to a tiny strip. */
function codeBoard(lines, minWidth = 32) {
  const rows = (Array.isArray(lines) ? lines : String(lines).split("\n")).map((l) =>
    String(l).padEnd(minWidth, " "),
  );
  return `\`\`\`\n${rows.join("\n")}\n\`\`\``;
}

function own(i, g) {
  return userId(i.user) === g.userId;
}

/* ─── Blackjack ───────────────────────────────────────────────── */

const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function freshDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

function cardStr(c) {
  return `${c.r}${c.s}`;
}

function handVal(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === "A") {
      aces += 1;
      total += 11;
    } else if (["K", "Q", "J"].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total;
}

function bjButtons(tr, id, ended) {
  if (ended) return [];
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sanad:bj:${id}:hit`).setLabel(tr("commands.game.bj.hit")).setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sanad:bj:${id}:stand`).setLabel(tr("commands.game.bj.stand")).setStyle(ButtonStyle.Success),
    ),
  ];
}

function bjPayload(tr, g) {
  const you = g.player.map(cardStr).join("  ");
  const dealerShow = g.ended ? g.dealer.map(cardStr).join("  ") : `${cardStr(g.dealer[0])}  ??`;
  const yv = handVal(g.player);
  const dv = g.ended ? handVal(g.dealer) : "?";
  let status = tr("commands.game.bj.playing", { you: yv });
  if (g.ended) {
    if (g.result === "win") status = tr("commands.game.bj.win", { you: yv, dealer: handVal(g.dealer) });
    else if (g.result === "lose") status = tr("commands.game.bj.lose", { you: yv, dealer: handVal(g.dealer) });
    else status = tr("commands.game.bj.push", { you: yv });
  }
  const colour = g.ended
    ? g.result === "win"
      ? BRAND.colour.success
      : g.result === "lose"
        ? BRAND.colour.danger
        : BRAND.colour.mute
    : BRAND.colour.ticket;
  const board = codeBoard(
    [
      `${tr("commands.game.bj.you").padEnd(8)} ${you}  (${yv})`,
      `${tr("commands.game.bj.dealer").padEnd(8)} ${dealerShow}${g.ended ? `  (${dv})` : ""}`,
    ],
    34,
  );
  return {
    embeds: [emb(tr("commands.game.bj.title"), `${board}\n${status}`, colour)],
    components: bjButtons(tr, g.id, g.ended),
  };
}

function startBj(uid) {
  const deck = freshDeck();
  const g = {
    id: nid(),
    type: "bj",
    userId: uid,
    deck,
    player: [deck.pop(), deck.pop()],
    dealer: [deck.pop(), deck.pop()],
    ended: false,
    result: null,
    expires: Date.now() + TTL_MS,
  };
  if (handVal(g.player) === 21) {
    g.ended = true;
    g.result = handVal(g.dealer) === 21 ? "push" : "win";
  }
  sessions.set(g.id, g);
  return g;
}

function bjDealerPlay(g) {
  while (handVal(g.dealer) < 17) g.dealer.push(g.deck.pop());
  const p = handVal(g.player);
  const d = handVal(g.dealer);
  if (d > 21 || p > d) g.result = "win";
  else if (p < d) g.result = "lose";
  else g.result = "push";
  g.ended = true;
}

/* ─── Minesweeper 4×4 ─────────────────────────────────────────── */

const MINE_W = 4;
const MINE_H = 4;
const MINE_N = 5;

function minesBuild() {
  const cells = Array(MINE_W * MINE_H)
    .fill(0)
    .map(() => ({ mine: false, open: false, n: 0 }));
  let placed = 0;
  while (placed < MINE_N) {
    const i = (Math.random() * cells.length) | 0;
    if (cells[i].mine) continue;
    cells[i].mine = true;
    placed += 1;
  }
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].mine) continue;
    const r = (i / MINE_W) | 0;
    const c = i % MINE_W;
    let n = 0;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= MINE_H || cc < 0 || cc >= MINE_W) continue;
        if (cells[rr * MINE_W + cc].mine) n += 1;
      }
    }
    cells[i].n = n;
  }
  return cells;
}

function minesFlood(cells, start) {
  const q = [start];
  const seen = new Set();
  while (q.length) {
    const i = q.shift();
    if (seen.has(i)) continue;
    seen.add(i);
    const cell = cells[i];
    if (cell.mine || cell.open) continue;
    cell.open = true;
    if (cell.n !== 0) continue;
    const r = (i / MINE_W) | 0;
    const c = i % MINE_W;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || rr >= MINE_H || cc < 0 || cc >= MINE_W) continue;
        q.push(rr * MINE_W + cc);
      }
    }
  }
}

function minesLabel(cell, ended) {
  if (cell.open) {
    if (cell.mine) return "X";
    return cell.n === 0 ? "·" : String(cell.n);
  }
  if (ended && cell.mine) return "X";
  return "·";
}

function minesButtons(g) {
  const rows = [];
  for (let r = 0; r < MINE_H; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < MINE_W; c++) {
      const i = r * MINE_W + c;
      const cell = g.cells[i];
      let style = ButtonStyle.Secondary;
      if (cell.open) {
        style = cell.mine ? ButtonStyle.Danger : cell.n === 0 ? ButtonStyle.Success : ButtonStyle.Primary;
      }
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:mine:${g.id}:${i}`)
          .setLabel(minesLabel(cell, g.ended))
          .setStyle(style)
          .setDisabled(cell.open || g.ended),
      );
    }
    rows.push(row);
  }
  return rows;
}

function minesWon(cells) {
  return cells.every((c) => c.mine || c.open);
}

function minesPayload(tr, g) {
  const body = g.ended
    ? g.won
      ? tr("commands.game.mines.win")
      : tr("commands.game.mines.lose")
    : tr("commands.game.mines.hint", { n: MINE_N });
  const open = g.cells.filter((c) => c.open && !c.mine).length;
  const total = g.cells.length - MINE_N;
  return {
    embeds: [
      emb(
        tr("commands.game.mines.title"),
        `${codeBoard([`Mines  ${MINE_N}`, `Clear ${open}/${total}`], 24)}\n${body}`,
        g.ended ? (g.won ? BRAND.colour.success : BRAND.colour.danger) : BRAND.colour.ticket,
      ),
    ],
    components: minesButtons(g),
  };
}

/* ─── Hangman (type letters in chat) ──────────────────────────── */

const HANG_WORDS = [
  "sanad",
  "zrzur",
  "server",
  "button",
  "memory",
  "music",
  "ticket",
  "webhook",
  "prefix",
  "arcade",
  "galaxy",
  "python",
  "engine",
  "rocket",
  "planet",
  "status",
  "panel",
  "level",
  "moderator",
  "channel",
  "invite",
  "member",
  "voice",
  "queue",
  "shuffle",
];

function hangMask(word, guessed) {
  return [...word].map((ch) => (guessed.includes(ch) ? ch.toUpperCase() : "_")).join(" ");
}

/** Clean gallows on the right — word on the left. */
function hangArtLines(wrong, wordLine) {
  const n = Math.max(0, Math.min(6, wrong | 0));
  const head = n >= 1 ? "O" : " ";
  const torso = n >= 2 ? "|" : " ";
  const lArm = n >= 3 ? "/" : " ";
  const rArm = n >= 4 ? "\\" : " ";
  const lLeg = n >= 5 ? "/" : " ";
  const rLeg = n >= 6 ? "\\" : " ";
  const fig = [
    "  +----+",
    "  |    |",
    `  |    ${head}`,
    `  |   ${lArm}${torso}${rArm}`,
    `  |   ${lLeg} ${rLeg}`,
    "  |",
    " ========",
  ];
  const leftW = Math.max(16, String(wordLine).length + 2);
  const left = [String(wordLine), "", "", "", "", "", ""];
  return fig.map((row, i) => `${(left[i] || "").padEnd(leftW)}${row}`);
}

function hangPayload(tr, g) {
  const wordLine = g.ended ? [...g.word.toUpperCase()].join(" ") : hangMask(g.word, g.guessed);
  const hits = g.guessed.filter((L) => g.word.includes(L)).map((L) => L.toUpperCase());
  const misses = g.guessed.filter((L) => !g.word.includes(L)).map((L) => L.toUpperCase());
  const hitLog = hits.length ? hits.join(" · ") : "—";
  const missLog = misses.length ? misses.join(" · ") : "—";
  let footer = [
    tr("commands.game.hang.lives", { n: Math.max(0, 6 - g.wrong) }),
    tr("commands.game.hang.hits", { entries: hitLog }),
    tr("commands.game.hang.misses", { entries: missLog }),
  ].join("\n");
  if (g.ended) {
    footer +=
      "\n" +
      (g.won
        ? tr("commands.game.hang.win", { word: g.word.toUpperCase() })
        : tr("commands.game.hang.lose", { word: g.word.toUpperCase() }));
  } else {
    footer += `\n${tr("commands.game.hang.typeHint")}`;
  }
  return {
    embeds: [
      emb(
        tr("commands.game.hang.title"),
        `${codeBoard(hangArtLines(g.wrong, wordLine), 36)}\n${footer}`,
        g.ended ? (g.won ? BRAND.colour.success : BRAND.colour.danger) : BRAND.colour.ticket,
      ),
    ],
    components: [],
  };
}

function startHang(uid, channelId) {
  for (const [id, s] of sessions) {
    if (s.type === "hang" && s.userId === uid && !s.ended) {
      s.ended = true;
      sessions.delete(id);
    }
  }
  const word = HANG_WORDS[(Math.random() * HANG_WORDS.length) | 0];
  const g = {
    id: nid(),
    type: "hang",
    userId: uid,
    channelId: channelId || null,
    messageId: null,
    word,
    guessed: [],
    wrong: 0,
    ended: false,
    won: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

function applyHangLetter(g, letter) {
  if (g.ended || g.guessed.includes(letter)) return false;
  g.guessed.push(letter);
  if (!g.word.includes(letter)) {
    g.wrong += 1;
    if (g.wrong >= 6) {
      g.ended = true;
      g.won = false;
    }
  } else if ([...g.word].every((ch) => g.guessed.includes(ch))) {
    g.ended = true;
    g.won = true;
  }
  return true;
}

function findHangGame(channelId, uid) {
  for (const g of sessions.values()) {
    if (g.type === "hang" && !g.ended && g.userId === uid && g.channelId === channelId) return g;
  }
  return null;
}

async function publishGame(client, channelId, payload, g, serverId) {
  const sent = await client.send(channelId, payload);
  g.channelId = channelId;
  g.messageId = sent?.id || sent?._id || null;
  if (serverId) g.serverId = serverId;
  return sent;
}

async function refreshGame(client, g, payload) {
  if (!g.channelId || !g.messageId) return;
  try {
    await client.editMessage(g.channelId, g.messageId, payload);
  } catch {
    /* message gone */
  }
  if (g.ended) sessions.delete(g.id);
}

const refreshTimers = new Map();
const refreshGen = new Map();
const deleteBuckets = new Map();

/** Apply state instantly; one in-flight edit per game, always paints latest. */
function scheduleRefresh(client, g, buildPayload) {
  touch(g);
  const gen = (refreshGen.get(g.id) || 0) + 1;
  refreshGen.set(g.id, gen);
  const prev = refreshTimers.get(g.id);
  if (prev) clearTimeout(prev);
  // Tiny coalesce only — keep board snappy while typing fast
  const delay = g.ended ? 0 : 15;
  const timer = setTimeout(() => {
    refreshTimers.delete(g.id);
    if (refreshGen.get(g.id) !== gen) return;
    const payload = buildPayload();
    void refreshGame(client, g, payload);
  }, delay);
  refreshTimers.set(g.id, timer);
}

function queueDelete(client, channelId, messageId) {
  if (!channelId || !messageId) return;
  let bucket = deleteBuckets.get(channelId);
  if (!bucket) {
    bucket = { ids: [], timer: null };
    deleteBuckets.set(channelId, bucket);
  }
  bucket.ids.push(messageId);
  if (bucket.timer) return;
  bucket.timer = setTimeout(async () => {
    bucket.timer = null;
    const ids = [...new Set(bucket.ids.splice(0, 100))];
    if (!ids.length) return;
    try {
      if (ids.length === 1) await client.messages.delete(channelId, ids[0]);
      else await client.messages.bulkDelete(channelId, ids);
    } catch (error) {
      // Fallback one-by-one; log once so missing Manage Messages is visible
      let failed = 0;
      for (const id of ids) {
        try {
          await client.messages.delete(channelId, id);
        } catch {
          failed += 1;
        }
      }
      if (failed) {
        console.warn(
          `[sanad:arcade] could not delete ${failed} guess message(s) in ${channelId} — grant the bot Manage Messages`,
        );
      }
    }
  }, 20);
}

function gameTr(g, message) {
  // Lock language at game start — never re-resolve via missing serverId (was flipping en→ar).
  if (g.locale === "ar" || g.locale === "en") return makeT(g.locale);
  return guildT(g.serverId || message.server || null).t;
}

function bindGameLocale(g, serverId, locale) {
  g.serverId = serverId || g.serverId || null;
  g.locale = locale === "ar" ? "ar" : "en";
}

function canDeleteGuesses(i) {
  try {
    return Boolean(i.has?.(Permissions.ManageMessages, "app") || i.has?.(Permissions.ManageMessages));
  } catch {
    return false;
  }
}

function deletePermHint(tr, key) {
  return tr(key);
}

function findChatGame(type, channelId, uid) {
  for (const g of sessions.values()) {
    if (g.type === type && !g.ended && g.userId === uid && g.channelId === channelId) return g;
  }
  return null;
}

function endPreviousChatGame(type, uid) {
  for (const [id, s] of sessions) {
    if (s.type === type && s.userId === uid && !s.ended) {
      s.ended = true;
      sessions.delete(id);
    }
  }
}

function deleteChatGuess(client, message) {
  const channelId = message.channel || message.channelId || message.channel_id;
  const messageId = message._id || message.id || message.message_id;
  if (!channelId || !messageId) return;
  // Immediate first try — queue handles bursts / retries
  void client.messages.delete(channelId, messageId).catch(() => {
    queueDelete(client, channelId, messageId);
  });
}

/** Chat typing for hangman / wordle / guess. Returns true if consumed. */
export async function handleArcadeChat(client, message) {
  const content = String(message.content || message.body || "").trim();
  const channelId = message.channel;
  const uid = message.author;
  if (!channelId || !uid || !content) return false;

  const hang = findChatGame("hang", channelId, uid) || findHangGame(channelId, uid);
  const wordle = findChatGame("wordle", channelId, uid);
  const guess = findChatGame("guess", channelId, uid);
  if (!hang && !wordle && !guess) return false;

  // Wipe the typed message immediately (don't wait for embed edit)
  deleteChatGuess(client, message);

  const tr = gameTr(hang || wordle || guess, message);

  // Hangman: any A–Z attempt (1 letter counts; longer letter spam still cleaned)
  if (hang && /^[a-zA-Z]+$/.test(content)) {
    if (!sessions.has(hang.id)) return true;
    if (!hang.serverId && message.server) hang.serverId = message.server;
    if (content.length === 1) {
      applyHangLetter(hang, content.toLowerCase());
      scheduleRefresh(client, hang, () => hangPayload(tr, hang));
    }
    return true;
  }

  // Wordle: 5-letter guess counted; any letter-only mistype cleaned
  if (wordle && /^[a-zA-Z]+$/.test(content)) {
    if (!sessions.has(wordle.id)) return true;
    if (!wordle.serverId && message.server) wordle.serverId = message.server;
    if (content.length === 5) {
      const word = content.toLowerCase();
      if (!WORDLE_WORDS.includes(word)) {
        wordle.notice = "invalid";
        scheduleRefresh(client, wordle, () => wordlePayload(tr, wordle));
        return true;
      }
      wordle.notice = null;
      if (wordle.guesses.includes(word)) {
        wordle.notice = "dup";
        scheduleRefresh(client, wordle, () => wordlePayload(tr, wordle));
        return true;
      }
      wordle.guesses.push(word);
      if (word === wordle.word) {
        wordle.ended = true;
        wordle.won = true;
      } else if (wordle.guesses.length >= 6) {
        wordle.ended = true;
        wordle.won = false;
      }
      scheduleRefresh(client, wordle, () => wordlePayload(tr, wordle));
    }
    return true;
  }

  // Guess: number attempts + cleanup digit spam
  if (guess && /^\d+$/.test(content)) {
    if (!sessions.has(guess.id)) return true;
    if (!guess.serverId && message.server) guess.serverId = message.server;
    const n = Number(content);
    if (n >= 1 && n <= 100) {
      guess.left -= 1;
      let hint = null;
      if (n === guess.target) {
        guess.ended = true;
        guess.won = true;
        hint = "ok";
      } else if (guess.left <= 0) {
        guess.ended = true;
        guess.won = false;
        hint = n > guess.target ? "high" : "low";
      } else {
        hint = n > guess.target ? "high" : "low";
        guess.hint = hint;
      }
      guess.log.push({ n, hint });
      scheduleRefresh(client, guess, () => guessPayload(tr, guess));
    }
    return true;
  }

  return false;
}

/** @deprecated use handleArcadeChat */
export async function handleHangmanGuess(client, message) {
  return handleArcadeChat(client, message);
}

/* ─── Higher / Lower ──────────────────────────────────────────── */

function hlRank(c) {
  if (c.r === "A") return 14;
  if (c.r === "K") return 13;
  if (c.r === "Q") return 12;
  if (c.r === "J") return 11;
  return Number(c.r);
}

function hlButtons(tr, id, ended) {
  if (ended) {
    return [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:hl:${id}:again`)
          .setLabel(tr("commands.game.hl.again"))
          .setStyle(ButtonStyle.Primary),
      ),
    ];
  }
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sanad:hl:${id}:higher`)
        .setLabel(tr("commands.game.hl.higher"))
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sanad:hl:${id}:lower`)
        .setLabel(tr("commands.game.hl.lower"))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`sanad:hl:${id}:same`)
        .setLabel(tr("commands.game.hl.same"))
        .setStyle(ButtonStyle.Secondary),
    ),
  ];
}

function hlPayload(tr, g) {
  const cur = cardStr(g.current);
  const body = g.ended
    ? tr("commands.game.hl.over", { card: cur, next: cardStr(g.next), score: g.score })
    : tr("commands.game.hl.prompt", { card: cur, score: g.score });
  return {
    embeds: [
      emb(
        tr("commands.game.hl.title"),
        `${codeBoard([`Card   ${cur}`, `Score  ${g.score}`], 24)}\n${body}`,
        g.ended ? BRAND.colour.mute : BRAND.colour.ticket,
      ),
    ],
    components: hlButtons(tr, g.id, g.ended),
  };
}

function startHl(uid) {
  const deck = freshDeck();
  const g = {
    id: nid(),
    type: "hl",
    userId: uid,
    deck,
    current: deck.pop(),
    next: null,
    score: 0,
    ended: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

/* ─── Trivia ──────────────────────────────────────────────────── */

const TRIVIA = [
  { q: { en: "Zrzur site?", ar: "موقع زرزور؟" }, a: ["zrzur.com", "zrzur.net", "zrzur.org", "zrzur.io"], c: 0 },
  { q: { en: "This bot's name?", ar: "اسم هالبوت؟" }, a: ["Sanad", "Tre", "Panel", "Vault"], c: 0 },
  { q: { en: "HTTP OK code?", ar: "رمز HTTP نجاح؟" }, a: ["200", "404", "500", "301"], c: 0 },
  { q: { en: "typeof null in JS?", ar: "typeof null؟" }, a: ["object", "null", "undefined", "number"], c: 0 },
  { q: { en: "Git create branch?", ar: "إنشاء فرع Git؟" }, a: ["git branch", "git clone", "git push", "git log"], c: 0 },
  { q: { en: "Red Planet?", ar: "الكوكب الأحمر؟" }, a: ["Mars", "Venus", "Jupiter", "Mercury"], c: 0 },
  { q: { en: "Binary of 2?", ar: "ثنائي 2؟" }, a: ["10", "11", "01", "100"], c: 0 },
  { q: { en: "CSS flex main axis?", ar: "محور flex؟" }, a: ["justify-content", "align-items", "gap", "order"], c: 0 },
  { q: { en: "Zrzur bots use?", ar: "بوتات زرزور؟" }, a: ["Slash + buttons", "Email only", "SMS only", "Fax"], c: 0 },
  { q: { en: "Sanad language cmds?", ar: "أوامر لغة سند؟" }, a: ["ar / en", "fr only", "de only", "tr only"], c: 0 },
];

function triviaPick() {
  const item = TRIVIA[(Math.random() * TRIVIA.length) | 0];
  const order = [0, 1, 2, 3].sort(() => Math.random() - 0.5);
  return {
    q: item.q,
    options: order.map((i) => item.a[i]),
    correct: order.indexOf(item.c),
  };
}

function triviaButtons(g) {
  const row = new ActionRowBuilder();
  g.options.forEach((opt, i) => {
    let style = ButtonStyle.Primary;
    if (g.ended) {
      if (i === g.correct) style = ButtonStyle.Success;
      else if (i === g.picked) style = ButtonStyle.Danger;
      else style = ButtonStyle.Secondary;
    }
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(`sanad:triv:${g.id}:${i}`)
        .setLabel(String(opt).slice(0, 80))
        .setStyle(style)
        .setDisabled(g.ended),
    );
  });
  return [row];
}

function triviaPayload(tr, g, locale) {
  const q = g.q[locale === "ar" ? "ar" : "en"] || g.q.en;
  let body = q;
  if (g.ended) {
    body +=
      "\n\n" +
      (g.picked === g.correct ? tr("commands.game.trivia.correct") : tr("commands.game.trivia.wrong"));
  }
  return {
    embeds: [
      emb(
        tr("commands.game.trivia.title"),
        body,
        g.ended ? (g.picked === g.correct ? BRAND.colour.success : BRAND.colour.danger) : BRAND.colour.ticket,
      ),
    ],
    components: triviaButtons(g),
  };
}

/* ─── Lights Out ──────────────────────────────────────────────── */

const LIGHT_N = 4;

function lightsToggle(grid, i) {
  const r = (i / LIGHT_N) | 0;
  const c = i % LIGHT_N;
  const flip = (rr, cc) => {
    if (rr < 0 || rr >= LIGHT_N || cc < 0 || cc >= LIGHT_N) return;
    grid[rr * LIGHT_N + cc] = !grid[rr * LIGHT_N + cc];
  };
  flip(r, c);
  flip(r - 1, c);
  flip(r + 1, c);
  flip(r, c - 1);
  flip(r, c + 1);
}

function lightsShuffle() {
  const grid = Array(LIGHT_N * LIGHT_N).fill(false);
  for (let k = 0; k < 8; k++) lightsToggle(grid, (Math.random() * grid.length) | 0);
  if (grid.every((x) => !x)) lightsToggle(grid, 0);
  return grid;
}

function lightsButtons(g) {
  const rows = [];
  for (let r = 0; r < LIGHT_N; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < LIGHT_N; c++) {
      const i = r * LIGHT_N + c;
      const on = g.grid[i];
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:light:${g.id}:${i}`)
          .setLabel(on ? "●" : "○")
          .setStyle(on ? ButtonStyle.Primary : ButtonStyle.Secondary)
          .setDisabled(g.ended),
      );
    }
    rows.push(row);
  }
  return rows;
}

function lightsPayload(tr, g) {
  const body = g.ended ? tr("commands.game.lights.win", { moves: g.moves }) : tr("commands.game.lights.hint");
  const on = g.grid.filter(Boolean).length;
  return {
    embeds: [
      emb(
        tr("commands.game.lights.title"),
        `${codeBoard(
          [tr("commands.game.lights.statOn", { n: on }), tr("commands.game.lights.statMoves", { n: g.moves })],
          28,
        )}\n${body}`,
        g.ended ? BRAND.colour.success : BRAND.colour.ticket,
      ),
    ],
    components: lightsButtons(g),
  };
}

/* ─── 2048 ────────────────────────────────────────────────────── */

function g2048Empty() {
  return Array(16).fill(0);
}

function g2048Spawn(board) {
  const empty = board.map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  if (!empty.length) return;
  board[empty[(Math.random() * empty.length) | 0]] = Math.random() < 0.9 ? 2 : 4;
}

function g2048SlideRow(row) {
  const nums = row.filter((n) => n);
  const out = [];
  let score = 0;
  for (let i = 0; i < nums.length; i++) {
    if (i + 1 < nums.length && nums[i] === nums[i + 1]) {
      out.push(nums[i] * 2);
      score += nums[i] * 2;
      i += 1;
    } else out.push(nums[i]);
  }
  while (out.length < 4) out.push(0);
  return { row: out, score };
}

function g2048Move(board, dir) {
  const next = board.slice();
  let gained = 0;
  const get = (r, c) => next[r * 4 + c];
  const set = (r, c, v) => {
    next[r * 4 + c] = v;
  };
  for (let i = 0; i < 4; i++) {
    let line;
    if (dir === "left") line = [0, 1, 2, 3].map((c) => get(i, c));
    else if (dir === "right") line = [3, 2, 1, 0].map((c) => get(i, c));
    else if (dir === "up") line = [0, 1, 2, 3].map((r) => get(r, i));
    else line = [3, 2, 1, 0].map((r) => get(r, i));
    const { row, score } = g2048SlideRow(line);
    gained += score;
    if (dir === "left") row.forEach((v, c) => set(i, c, v));
    else if (dir === "right") row.forEach((v, c) => set(i, 3 - c, v));
    else if (dir === "up") row.forEach((v, r) => set(r, i, v));
    else row.forEach((v, r) => set(3 - r, i, v));
  }
  const changed = next.some((v, i) => v !== board[i]);
  return { board: next, gained, changed };
}

function g2048CanMove(board) {
  if (board.some((v) => v === 0)) return true;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const v = board[r * 4 + c];
      if (c < 3 && board[r * 4 + c + 1] === v) return true;
      if (r < 3 && board[(r + 1) * 4 + c] === v) return true;
    }
  }
  return false;
}

function g2048Cell(v) {
  if (!v) return "    ";
  return String(v).padStart(4, " ");
}

function g2048Grid(board) {
  const lines = ["┌────┬────┬────┬────┐"];
  for (let r = 0; r < 4; r++) {
    lines.push("│" + [0, 1, 2, 3].map((c) => g2048Cell(board[r * 4 + c])).join("│") + "│");
    lines.push(r < 3 ? "├────┼────┼────┼────┤" : "└────┴────┴────┴────┘");
  }
  return codeBoard(lines, 21);
}

function g2048Buttons(id, ended) {
  if (ended) return [];
  const blank = (n) =>
    new ButtonBuilder()
      .setCustomId(`sanad:2048:${id}:pad${n}`)
      .setLabel("·")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true);
  return [
    new ActionRowBuilder().addComponents(
      blank(1),
      new ButtonBuilder().setCustomId(`sanad:2048:${id}:up`).setLabel("↑ Up").setStyle(ButtonStyle.Primary),
      blank(2),
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`sanad:2048:${id}:left`).setLabel("← Left").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sanad:2048:${id}:down`).setLabel("↓ Down").setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`sanad:2048:${id}:right`).setLabel("→ Right").setStyle(ButtonStyle.Primary),
    ),
  ];
}

function g2048Payload(tr, g) {
  let status = tr("commands.game.g2048.score", { score: g.score });
  if (g.ended) {
    status = g.won
      ? tr("commands.game.g2048.win", { score: g.score })
      : tr("commands.game.g2048.lose", { score: g.score });
  }
  return {
    embeds: [
      emb(
        tr("commands.game.g2048.title"),
        `${g2048Grid(g.board)}\n${status}`,
        g.ended ? (g.won ? BRAND.colour.success : BRAND.colour.mute) : BRAND.colour.ticket,
      ),
    ],
    components: g2048Buttons(g.id, g.ended),
  };
}

function start2048(uid) {
  const board = g2048Empty();
  g2048Spawn(board);
  g2048Spawn(board);
  const g = {
    id: nid(),
    type: "2048",
    userId: uid,
    board,
    score: 0,
    ended: false,
    won: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

/* ─── Reaction ────────────────────────────────────────────────── */

function reactionPayload(tr, g) {
  let body = tr("commands.game.reaction.wait");
  let colour = BRAND.colour.mute;
  const rows = [];
  if (g.phase === "go") {
    body = tr("commands.game.reaction.go");
    colour = BRAND.colour.success;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sanad:react:${g.id}:tap`).setLabel("GO").setStyle(ButtonStyle.Success),
      ),
    );
  } else if (g.phase === "wait") {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`sanad:react:${g.id}:early`).setLabel("…").setStyle(ButtonStyle.Secondary),
      ),
    );
  } else if (g.phase === "done") {
    body = g.early
      ? tr("commands.game.reaction.early")
      : tr("commands.game.reaction.result", { ms: g.ms });
    colour = g.early ? BRAND.colour.danger : BRAND.colour.success;
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:react:${g.id}:again`)
          .setLabel(tr("commands.game.reaction.again"))
          .setStyle(ButtonStyle.Primary),
      ),
    );
  }
  return {
    embeds: [emb(tr("commands.game.reaction.title"), body, colour)],
    components: rows,
  };
}

function startReaction(uid) {
  const g = {
    id: nid(),
    type: "reaction",
    userId: uid,
    phase: "wait",
    goAt: 0,
    ms: 0,
    early: false,
    ended: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

/* ─── Wordle (letter-by-letter) ───────────────────────────────── */

const WORDLE_WORDS = [
  "apple",
  "brave",
  "crane",
  "dream",
  "eagle",
  "flame",
  "grape",
  "house",
  "ivory",
  "jolly",
  "karma",
  "lemon",
  "magic",
  "noble",
  "ocean",
  "piano",
  "queen",
  "robot",
  "solar",
  "tiger",
  "ultra",
  "vivid",
  "whale",
  "xenon",
  "young",
  "zebra",
  "sanad",
  "music",
  "slash",
  "panel",
  "level",
  "admin",
  "botty",
  "track",
  "voice",
  "clear",
  "warns",
  "cases",
  "purge",
  "lobby",
  "stack",
  "frame",
  "globe",
  "orbit",
  "pixel",
  "codec",
];

function wordleScore(guess, word) {
  const res = Array(5).fill("⬛");
  const left = [...word];
  for (let i = 0; i < 5; i++) {
    if (guess[i] === word[i]) {
      res[i] = "🟩";
      left[i] = null;
    }
  }
  for (let i = 0; i < 5; i++) {
    if (res[i] !== "⬛") continue;
    const idx = left.indexOf(guess[i]);
    if (idx >= 0) {
      res[i] = "🟨";
      left[idx] = null;
    }
  }
  return res.join("");
}

function wordleBoard(g) {
  const lines = g.guesses.map((gu) => `${gu.toUpperCase().split("").join(" ")}  ${wordleScore(gu, g.word)}`);
  while (lines.length < 6) lines.push("_ _ _ _ _");
  return codeBoard(lines, 28);
}

function wordlePayload(tr, g) {
  const log = g.guesses.length ? g.guesses.map((w) => w.toUpperCase()).join(" · ") : "—";
  let status = `${tr("commands.game.wordle.tries", { n: g.guesses.length })}\n${tr("commands.game.wordle.log", { entries: log })}`;
  if (g.notice === "invalid") status += `\n${tr("commands.game.wordle.invalid")}`;
  else if (g.notice === "dup") status += `\n${tr("commands.game.wordle.dup")}`;
  if (g.ended) {
    status +=
      "\n" +
      (g.won
        ? tr("commands.game.wordle.win", { word: g.word.toUpperCase() })
        : tr("commands.game.wordle.lose", { word: g.word.toUpperCase() }));
  } else {
    status += `\n${tr("commands.game.wordle.typeHint")}`;
  }
  return {
    embeds: [
      emb(
        tr("commands.game.wordle.title"),
        `${wordleBoard(g)}\n\n${status}`,
        g.ended ? (g.won ? BRAND.colour.success : BRAND.colour.danger) : BRAND.colour.ticket,
      ),
    ],
    components: [],
  };
}

function startWordle(uid, channelId) {
  endPreviousChatGame("wordle", uid);
  const word = WORDLE_WORDS[(Math.random() * WORDLE_WORDS.length) | 0];
  const g = {
    id: nid(),
    type: "wordle",
    userId: uid,
    channelId: channelId || null,
    messageId: null,
    word,
    guesses: [],
    ended: false,
    won: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

/* ─── Guess number ────────────────────────────────────────────── */

function guessPayload(tr, g) {
  const log = g.log?.length
    ? g.log.map((e) => `${e.n}${e.hint === "high" ? "↓" : e.hint === "low" ? "↑" : "✓"}`).join(" · ")
    : "—";
  let body = tr("commands.game.guess.prompt", { left: g.left });
  if (g.hint === "high") body = tr("commands.game.guess.high", { left: g.left });
  else if (g.hint === "low") body = tr("commands.game.guess.low", { left: g.left });
  if (g.ended) {
    body = g.won
      ? tr("commands.game.guess.win", { n: g.target, tries: 7 - g.left })
      : tr("commands.game.guess.lose", { n: g.target });
  }
  body = `${codeBoard([String(body).replace(/\*\*/g, "")], 28)}\n${tr("commands.game.guess.log", { entries: log })}`;
  if (!g.ended) body += `\n${tr("commands.game.guess.typeHint")}`;
  return {
    embeds: [
      emb(
        tr("commands.game.guess.title"),
        body,
        g.ended ? (g.won ? BRAND.colour.success : BRAND.colour.danger) : BRAND.colour.ticket,
      ),
    ],
    components: [],
  };
}

function startGuess(uid, channelId) {
  endPreviousChatGame("guess", uid);
  const g = {
    id: nid(),
    type: "guess",
    userId: uid,
    channelId: channelId || null,
    messageId: null,
    target: 1 + ((Math.random() * 100) | 0),
    left: 7,
    hint: null,
    log: [],
    ended: false,
    won: false,
    expires: Date.now() + TTL_MS,
  };
  sessions.set(g.id, g);
  return g;
}

/* ─── Dice duel ───────────────────────────────────────────────── */

function dicePayload(tr, you, bot) {
  let outcome = tr("commands.game.dice.tie");
  let colour = BRAND.colour.mute;
  if (you > bot) {
    outcome = tr("commands.game.dice.win");
    colour = BRAND.colour.success;
  } else if (you < bot) {
    outcome = tr("commands.game.dice.lose");
    colour = BRAND.colour.danger;
  }
  const id = nid();
  return {
    embeds: [
      emb(
        tr("commands.game.dice.title"),
        tr("commands.game.dice.roll", { you, bot, outcome }),
        colour,
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:dice:${id}:again`)
          .setLabel(tr("commands.game.dice.again"))
          .setStyle(ButtonStyle.Primary),
      ),
    ],
  };
}

/* ─── Public API ──────────────────────────────────────────────── */

export function arcadeCommands() {
  return [
    new SlashCommandBuilder("blackjack", t("en", "commands.game.bj.description")).describe({
      en: t("en", "commands.game.bj.description"),
      ar: t("ar", "commands.game.bj.description"),
    }),
    new SlashCommandBuilder("mines", t("en", "commands.game.mines.description")).describe({
      en: t("en", "commands.game.mines.description"),
      ar: t("ar", "commands.game.mines.description"),
    }),
    new SlashCommandBuilder("hangman", t("en", "commands.game.hang.description")).describe({
      en: t("en", "commands.game.hang.description"),
      ar: t("ar", "commands.game.hang.description"),
    }),
    new SlashCommandBuilder("hl", t("en", "commands.game.hl.description")).describe({
      en: t("en", "commands.game.hl.description"),
      ar: t("ar", "commands.game.hl.description"),
    }),
    new SlashCommandBuilder("trivia", t("en", "commands.game.trivia.description")).describe({
      en: t("en", "commands.game.trivia.description"),
      ar: t("ar", "commands.game.trivia.description"),
    }),
    new SlashCommandBuilder("lights", t("en", "commands.game.lights.description")).describe({
      en: t("en", "commands.game.lights.description"),
      ar: t("ar", "commands.game.lights.description"),
    }),
    new SlashCommandBuilder("2048", t("en", "commands.game.g2048.description")).describe({
      en: t("en", "commands.game.g2048.description"),
      ar: t("ar", "commands.game.g2048.description"),
    }),
    new SlashCommandBuilder("reaction", t("en", "commands.game.reaction.description")).describe({
      en: t("en", "commands.game.reaction.description"),
      ar: t("ar", "commands.game.reaction.description"),
    }),
    new SlashCommandBuilder("wordle", t("en", "commands.game.wordle.description")).describe({
      en: t("en", "commands.game.wordle.description"),
      ar: t("ar", "commands.game.wordle.description"),
    }),
    new SlashCommandBuilder("guess", t("en", "commands.game.guess.description")).describe({
      en: t("en", "commands.game.guess.description"),
      ar: t("ar", "commands.game.guess.description"),
    }),
    new SlashCommandBuilder("dice", t("en", "commands.game.dice.description")).describe({
      en: t("en", "commands.game.dice.description"),
      ar: t("ar", "commands.game.dice.description"),
    }),
  ];
}

export function registerArcade(client) {
  client.command("blackjack", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    return i.reply(bjPayload(tr, startBj(userId(i.user))));
  });

  client.command("mines", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    const g = {
      id: nid(),
      type: "mines",
      userId: userId(i.user),
      cells: minesBuild(),
      ended: false,
      won: false,
      expires: Date.now() + TTL_MS,
    };
    sessions.set(g.id, g);
    return i.reply(minesPayload(tr, g));
  });

  client.command("hangman", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    prune();
    await i.defer({ ephemeral: true });
    const g = startHang(userId(i.user), i.channelId);
    bindGameLocale(g, i.serverId, locale);
    await publishGame(client, i.channelId, hangPayload(tr, g), g, i.serverId);
    const hint = tr("commands.game.hang.typeHint");
    const warn = canDeleteGuesses(i) ? "" : `\n⚠ ${deletePermHint(tr, "commands.game.hang.needDeletePerm")}`;
    return i.editReply(`${hint}${warn}`);
  });

  client.command("hl", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    return i.reply(hlPayload(tr, startHl(userId(i.user))));
  });

  client.command("trivia", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    prune();
    const pick = triviaPick();
    const g = {
      id: nid(),
      type: "trivia",
      userId: userId(i.user),
      ...pick,
      picked: null,
      ended: false,
      expires: Date.now() + TTL_MS,
    };
    sessions.set(g.id, g);
    return i.reply(triviaPayload(tr, g, locale === "ar" ? "ar" : "en"));
  });

  client.command("lights", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    const g = {
      id: nid(),
      type: "lights",
      userId: userId(i.user),
      grid: lightsShuffle(),
      moves: 0,
      ended: false,
      expires: Date.now() + TTL_MS,
    };
    sessions.set(g.id, g);
    return i.reply(lightsPayload(tr, g));
  });

  client.command("2048", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    return i.reply(g2048Payload(tr, start2048(userId(i.user))));
  });

  client.command("reaction", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    const g = startReaction(userId(i.user));
    await i.reply(reactionPayload(tr, g));
    const delay = 1200 + ((Math.random() * 2800) | 0);
    setTimeout(async () => {
      const cur = sessions.get(g.id);
      if (!cur || cur.phase !== "wait") return;
      cur.phase = "go";
      cur.goAt = Date.now();
      touch(cur);
      try {
        await i.editReply(reactionPayload(tr, cur));
      } catch {
        /* message gone */
      }
    }, delay);
  });

  client.command("wordle", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    prune();
    await i.defer({ ephemeral: true });
    const g = startWordle(userId(i.user), i.channelId);
    bindGameLocale(g, i.serverId, locale);
    await publishGame(client, i.channelId, wordlePayload(tr, g), g, i.serverId);
    const hint = tr("commands.game.wordle.typeHint");
    const warn = canDeleteGuesses(i) ? "" : `\n⚠ ${deletePermHint(tr, "commands.game.wordle.needDeletePerm")}`;
    return i.editReply(`${hint}${warn}`);
  });

  client.command("guess", async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    prune();
    await i.defer({ ephemeral: true });
    const g = startGuess(userId(i.user), i.channelId);
    bindGameLocale(g, i.serverId, locale);
    await publishGame(client, i.channelId, guessPayload(tr, g), g, i.serverId);
    const hint = tr("commands.game.guess.typeHint");
    const warn = canDeleteGuesses(i) ? "" : `\n⚠ ${deletePermHint(tr, "commands.game.guess.needDeletePerm")}`;
    return i.editReply(`${hint}${warn}`);
  });

  client.command("dice", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const you = 1 + ((Math.random() * 6) | 0);
    const bot = 1 + ((Math.random() * 6) | 0);
    return i.reply(dicePayload(tr, you, bot));
  });

  client.component(/^sanad:bj:[a-f0-9]+:(hit|stand)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const [, , id, act] = String(i.customId).split(":");
    const g = sessions.get(id);
    if (!g || g.type !== "bj") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    if (act === "hit") {
      g.player.push(g.deck.pop());
      if (handVal(g.player) > 21) {
        g.ended = true;
        g.result = "lose";
      } else if (handVal(g.player) === 21) bjDealerPlay(g);
    } else bjDealerPlay(g);
    if (g.ended) sessions.delete(id);
    return i.update(bjPayload(tr, g));
  });

  client.component(/^sanad:mine:[a-f0-9]+:\d+$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId).split(":");
    const id = parts[2];
    const idx = Number(parts[3]);
    const g = sessions.get(id);
    if (!g || g.type !== "mines") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended || g.cells[idx].open) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    if (g.cells[idx].mine) {
      g.cells[idx].open = true;
      g.ended = true;
      g.won = false;
      sessions.delete(id);
    } else {
      minesFlood(g.cells, idx);
      if (minesWon(g.cells)) {
        g.ended = true;
        g.won = true;
        sessions.delete(id);
      }
    }
    return i.update(minesPayload(tr, g));
  });

  client.component(/^sanad:hl:[a-f0-9]+:(higher|lower|same|again)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const [, , id, act] = String(i.customId).split(":");
    if (act === "again") {
      prune();
      return i.update(hlPayload(tr, startHl(userId(i.user))));
    }
    const g = sessions.get(id);
    if (!g || g.type !== "hl") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    g.next = g.deck.pop();
    const a = hlRank(g.current);
    const b = hlRank(g.next);
    let ok = false;
    if (act === "higher") ok = b > a;
    else if (act === "lower") ok = b < a;
    else ok = b === a;
    if (ok) {
      g.score += 1;
      g.current = g.next;
      g.next = null;
      if (g.deck.length < 2) {
        g.ended = true;
        sessions.delete(id);
      }
    } else {
      g.ended = true;
      sessions.delete(id);
    }
    return i.update(hlPayload(tr, g));
  });

  client.component(/^sanad:triv:[a-f0-9]+:\d$/, async (i) => {
    const { t: tr, locale } = guildT(i.serverId, i.locale);
    const parts = String(i.customId).split(":");
    const id = parts[2];
    const pick = Number(parts[3]);
    const g = sessions.get(id);
    if (!g || g.type !== "trivia") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    g.picked = pick;
    g.ended = true;
    sessions.delete(id);
    return i.update(triviaPayload(tr, g, locale === "ar" ? "ar" : "en"));
  });

  client.component(/^sanad:light:[a-f0-9]+:\d+$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId).split(":");
    const id = parts[2];
    const idx = Number(parts[3]);
    const g = sessions.get(id);
    if (!g || g.type !== "lights") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    lightsToggle(g.grid, idx);
    g.moves += 1;
    if (g.grid.every((x) => !x)) {
      g.ended = true;
      sessions.delete(id);
    }
    return i.update(lightsPayload(tr, g));
  });

  client.component(/^sanad:2048:[a-f0-9]+:(up|down|left|right)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const [, , id, dir] = String(i.customId).split(":");
    const g = sessions.get(id);
    if (!g || g.type !== "2048") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    if (g.ended) return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    touch(g);
    const { board, gained, changed } = g2048Move(g.board, dir);
    if (changed) {
      g.board = board;
      g.score += gained;
      g2048Spawn(g.board);
      if (g.board.some((v) => v === 2048)) {
        g.ended = true;
        g.won = true;
        sessions.delete(id);
      } else if (!g2048CanMove(g.board)) {
        g.ended = true;
        g.won = false;
        sessions.delete(id);
      }
    }
    return i.update(g2048Payload(tr, g));
  });

  client.component(/^sanad:react:[a-f0-9]+:(early|tap|again)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const [, , id, act] = String(i.customId).split(":");
    if (act === "again") {
      prune();
      const g = startReaction(userId(i.user));
      await i.update(reactionPayload(tr, g));
      const delay = 1200 + ((Math.random() * 2800) | 0);
      setTimeout(async () => {
        const cur = sessions.get(g.id);
        if (!cur || cur.phase !== "wait") return;
        cur.phase = "go";
        cur.goAt = Date.now();
        touch(cur);
        try {
          await i.message.edit(reactionPayload(tr, cur));
        } catch {
          /* gone */
        }
      }, delay);
      return;
    }
    const g = sessions.get(id);
    if (!g || g.type !== "reaction") return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    if (!own(i, g)) return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    touch(g);
    if (act === "early" || g.phase === "wait") {
      g.phase = "done";
      g.early = true;
      g.ended = true;
      sessions.delete(id);
      return i.update(reactionPayload(tr, g));
    }
    if (act === "tap" && g.phase === "go") {
      g.ms = Math.max(0, Date.now() - g.goAt);
      g.phase = "done";
      g.ended = true;
      sessions.delete(id);
      return i.update(reactionPayload(tr, g));
    }
    return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
  });

  client.component(/^sanad:dice:[a-f0-9]+:again$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const you = 1 + ((Math.random() * 6) | 0);
    const bot = 1 + ((Math.random() * 6) | 0);
    return i.update(dicePayload(tr, you, bot));
  });

  registry.register({
    name: "blackjack",
    slash: false,
    aliases: ["bj", "بلاكجاك"],
    async execute(ctx) {
      prune();
      return ctx.reply(bjPayload(ctx.t, startBj(ctx.userId)));
    },
  });
  registry.register({
    name: "mines",
    slash: false,
    aliases: ["minesweeper", "الغام", "ألغام"],
    async execute(ctx) {
      prune();
      const g = {
        id: nid(),
        type: "mines",
        userId: ctx.userId,
        cells: minesBuild(),
        ended: false,
        won: false,
        expires: Date.now() + TTL_MS,
      };
      sessions.set(g.id, g);
      return ctx.reply(minesPayload(ctx.t, g));
    },
  });
  registry.register({
    name: "hangman",
    slash: false,
    aliases: ["hang", "شنق"],
    async execute(ctx) {
      prune();
      const g = startHang(ctx.userId, ctx.channelId);
      bindGameLocale(g, ctx.serverId, ctx.locale);
      await publishGame(ctx.client, ctx.channelId, hangPayload(ctx.t, g), g, ctx.serverId);
    },
  });
  registry.register({
    name: "hl",
    slash: false,
    aliases: ["higher", "اعلى", "أعلى"],
    async execute(ctx) {
      prune();
      return ctx.reply(hlPayload(ctx.t, startHl(ctx.userId)));
    },
  });
  registry.register({
    name: "trivia",
    slash: false,
    aliases: ["quiz", "اسئلة", "أسئلة"],
    async execute(ctx) {
      prune();
      const locale = String(ctx.locale || "en").startsWith("ar") ? "ar" : "en";
      const pick = triviaPick();
      const g = {
        id: nid(),
        type: "trivia",
        userId: ctx.userId,
        ...pick,
        picked: null,
        ended: false,
        expires: Date.now() + TTL_MS,
      };
      sessions.set(g.id, g);
      return ctx.reply(triviaPayload(ctx.t, g, locale));
    },
  });
  registry.register({
    name: "lights",
    slash: false,
    aliases: ["light", "اضواء", "أضواء"],
    async execute(ctx) {
      prune();
      const g = {
        id: nid(),
        type: "lights",
        userId: ctx.userId,
        grid: lightsShuffle(),
        moves: 0,
        ended: false,
        expires: Date.now() + TTL_MS,
      };
      sessions.set(g.id, g);
      return ctx.reply(lightsPayload(ctx.t, g));
    },
  });
  registry.register({
    name: "2048",
    slash: false,
    aliases: ["twenty48"],
    async execute(ctx) {
      prune();
      return ctx.reply(g2048Payload(ctx.t, start2048(ctx.userId)));
    },
  });
  registry.register({
    name: "reaction",
    slash: false,
    aliases: ["react", "ردة", "ردفعل"],
    async execute(ctx) {
      prune();
      const g = startReaction(ctx.userId);
      const msg = await ctx.reply(reactionPayload(ctx.t, g));
      const delay = 1200 + ((Math.random() * 2800) | 0);
      setTimeout(async () => {
        const cur = sessions.get(g.id);
        if (!cur || cur.phase !== "wait") return;
        cur.phase = "go";
        cur.goAt = Date.now();
        touch(cur);
        try {
          if (typeof msg?.edit === "function") await msg.edit(reactionPayload(ctx.t, cur));
          else if (ctx.interaction?.editReply) await ctx.interaction.editReply(reactionPayload(ctx.t, cur));
        } catch {
          /* gone */
        }
      }, delay);
    },
  });
  registry.register({
    name: "wordle",
    slash: false,
    aliases: ["word", "وردل"],
    async execute(ctx) {
      prune();
      const g = startWordle(ctx.userId, ctx.channelId);
      bindGameLocale(g, ctx.serverId, ctx.locale);
      await publishGame(ctx.client, ctx.channelId, wordlePayload(ctx.t, g), g, ctx.serverId);
    },
  });
  registry.register({
    name: "guess",
    slash: false,
    aliases: ["number", "خمن", "خمّن"],
    async execute(ctx) {
      prune();
      const g = startGuess(ctx.userId, ctx.channelId);
      bindGameLocale(g, ctx.serverId, ctx.locale);
      await publishGame(ctx.client, ctx.channelId, guessPayload(ctx.t, g), g, ctx.serverId);
    },
  });
  registry.register({
    name: "dice",
    slash: false,
    aliases: ["نرد", "زار"],
    async execute(ctx) {
      const you = 1 + ((Math.random() * 6) | 0);
      const bot = 1 + ((Math.random() * 6) | 0);
      return ctx.reply(dicePayload(ctx.t, you, bot));
    },
  });
}
