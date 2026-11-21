/**
 * Interactive mini-games — button boards like classic chat bots (XO, RPS, …).
 * Callers: createBot.js → registerGames / gameCommands.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  SlashCommandBuilder,
} from "@zrzur/sdk/bot";
import { BRAND, mentionUser, userId } from "../brand.js";
import { t } from "../core/i18n.js";
import { registry } from "../core/registry.js";
import { guildT } from "../util/locale.js";

const games = new Map();
const TTL_MS = 30 * 60_000;
const MAX_GAMES = 200;
const gamesFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "data", "games-sessions.json");

function newId() {
  return Math.random().toString(16).slice(2, 10);
}

function asUserId(value) {
  if (!value) return null;
  if (typeof value === "string") return value;
  return userId(value) || null;
}

function persistGames() {
  try {
    mkdirSync(dirname(gamesFile), { recursive: true });
    const body = JSON.stringify(Object.fromEntries(games));
    const tmp = `${gamesFile}.${process.pid}.tmp`;
    writeFileSync(tmp, body, "utf8");
    try {
      renameSync(tmp, gamesFile);
    } catch {
      writeFileSync(gamesFile, body, "utf8");
    }
  } catch {
    /* ignore */
  }
}

function loadGames() {
  if (!existsSync(gamesFile)) return;
  try {
    const raw = JSON.parse(readFileSync(gamesFile, "utf8"));
    const now = Date.now();
    for (const [id, g] of Object.entries(raw || {})) {
      if (!g || g.expires < now || g.ended) continue;
      games.set(id, g);
    }
  } catch {
    /* corrupt — start fresh */
  }
}

function touch(game) {
  game.expires = Date.now() + TTL_MS;
  persistGames();
}

function prune() {
  const now = Date.now();
  let changed = false;
  for (const [id, g] of games) {
    if (g.expires < now || g.ended) {
      games.delete(id);
      changed = true;
    }
  }
  if (games.size > MAX_GAMES) {
    const oldest = [...games.entries()].sort((a, b) => a[1].expires - b[1].expires);
    for (const [id] of oldest.slice(0, games.size - MAX_GAMES)) {
      games.delete(id);
      changed = true;
    }
  }
  if (changed) persistGames();
}

loadGames();

function gameEmbed(tr, title, description, colour = BRAND.colour.primary) {
  return new EmbedBuilder()
    .title(title)
    .description(description)
    .colour(colour)
    .footer(tr("commands.game.footer"))
    .timestamp();
}

/* ─── Tic-Tac-Toe (XO) ─────────────────────────────────────────── */

function emptyBoard() {
  return Array(9).fill(null);
}

function xoWinner(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const [a, b, c] of lines) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return board[a];
  }
  if (board.every(Boolean)) return "draw";
  return null;
}

function xoMoves(board) {
  return board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
}

/** Medium AI: win > block > center > corner > random */
function xoAiMove(board, ai = "O", human = "X") {
  const moves = xoMoves(board);
  if (!moves.length) return -1;
  for (const i of moves) {
    const t = board.slice();
    t[i] = ai;
    if (xoWinner(t) === ai) return i;
  }
  for (const i of moves) {
    const t = board.slice();
    t[i] = human;
    if (xoWinner(t) === human) return i;
  }
  if (moves.includes(4)) return 4;
  const corners = moves.filter((i) => [0, 2, 6, 8].includes(i));
  if (corners.length) return corners[(Math.random() * corners.length) | 0];
  return moves[(Math.random() * moves.length) | 0];
}

function xoButtons(gameId, board, ended, winLine = null) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = new ActionRowBuilder();
    for (let c = 0; c < 3; c++) {
      const i = r * 3 + c;
      const cell = board[i];
      const inWin = winLine?.includes(i);
      // Empty = blue (clickable). X = green. O = red. Win line stays green.
      let style = ButtonStyle.Primary;
      let label = "·";
      if (cell === "X") {
        label = "X";
        style = ButtonStyle.Success;
      } else if (cell === "O") {
        label = "O";
        style = ButtonStyle.Danger;
      }
      if (inWin) style = ButtonStyle.Success;
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`sanad:xo:${gameId}:${i}`)
          .setLabel(label)
          .setStyle(style)
          .setDisabled(ended || Boolean(cell)),
      );
    }
    rows.push(row);
  }
  return rows;
}

function xoWinLine(board) {
  const lines = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];
  for (const line of lines) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) return line;
  }
  return null;
}

function xoStatus(tr, game) {
  const result = xoWinner(game.board);
  if (result === "draw") return tr("commands.game.xo.draw");
  if (result === "X") {
    return game.vsBot
      ? tr("commands.game.xo.youWin")
      : tr("commands.game.xo.playerWin", { user: mentionUser(game.x) });
  }
  if (result === "O") {
    return game.vsBot
      ? tr("commands.game.xo.botWin")
      : tr("commands.game.xo.playerWin", { user: mentionUser(game.o) });
  }
  const turnId = game.turn === "X" ? game.x : game.o;
  if (game.vsBot && game.turn === "X") return tr("commands.game.xo.yourTurn");
  if (game.vsBot) return tr("commands.game.xo.botTurn");
  return tr("commands.game.xo.turn", { user: mentionUser(turnId) });
}

function xoPayload(tr, game) {
  const ended = Boolean(xoWinner(game.board)) || game.ended;
  const winLine = ended ? xoWinLine(game.board) : null;
  const vs = game.vsBot
    ? tr("commands.game.xo.vsBot")
    : tr("commands.game.xo.vsPlayer", {
        x: mentionUser(game.x),
        o: mentionUser(game.o),
      });
  return {
    embeds: [
      gameEmbed(
        tr,
        tr("commands.game.xo.title"),
        `${vs}\n\n${xoStatus(tr, game)}`,
        ended ? BRAND.colour.success : BRAND.colour.ticket,
      ),
    ],
    components: xoButtons(game.id, game.board, ended || game.ended, winLine),
  };
}

/* ─── Rock Paper Scissors ──────────────────────────────────────── */

const RPS = ["rock", "paper", "scissors"];

function rpsBeat(a, b) {
  if (a === b) return 0;
  if (
    (a === "rock" && b === "scissors") ||
    (a === "paper" && b === "rock") ||
    (a === "scissors" && b === "paper")
  ) {
    return 1;
  }
  return -1;
}

function rpsButtons(gameId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`sanad:rps:${gameId}:rock`)
        .setLabel("🪨 Rock")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`sanad:rps:${gameId}:paper`)
        .setLabel("📄 Paper")
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(`sanad:rps:${gameId}:scissors`)
        .setLabel("✂️ Cut")
        .setStyle(ButtonStyle.Danger),
    ),
  ];
}

/* ─── Slots ────────────────────────────────────────────────────── */

const SLOT_SYMBOLS = ["🍒", "🍋", "🔔", "⭐", "7️⃣", "💎"];

function spinSlots() {
  return [
    SLOT_SYMBOLS[(Math.random() * SLOT_SYMBOLS.length) | 0],
    SLOT_SYMBOLS[(Math.random() * SLOT_SYMBOLS.length) | 0],
    SLOT_SYMBOLS[(Math.random() * SLOT_SYMBOLS.length) | 0],
  ];
}

function slotsScore(reels) {
  if (reels[0] === reels[1] && reels[1] === reels[2]) {
    if (reels[0] === "💎") return 50;
    if (reels[0] === "7️⃣") return 25;
    return 10;
  }
  if (reels[0] === reels[1] || reels[1] === reels[2] || reels[0] === reels[2]) return 2;
  return 0;
}

/* ─── Connect Four ─────────────────────────────────────────────── */

function c4Empty() {
  return Array.from({ length: 6 }, () => Array(7).fill(null));
}

function c4Drop(board, col, piece) {
  for (let r = 5; r >= 0; r--) {
    if (!board[r][col]) {
      board[r][col] = piece;
      return r;
    }
  }
  return -1;
}

function c4Winner(board) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 7; c++) {
      const p = board[r][c];
      if (!p) continue;
      for (const [dr, dc] of dirs) {
        let ok = true;
        for (let k = 1; k < 4; k++) {
          const rr = r + dr * k;
          const cc = c + dc * k;
          if (rr < 0 || rr > 5 || cc < 0 || cc > 6 || board[rr][cc] !== p) {
            ok = false;
            break;
          }
        }
        if (ok) return p;
      }
    }
  }
  if (board[0].every(Boolean)) return "draw";
  return null;
}

function c4Render(board) {
  return board.map((row) => row.map((c) => (c === "R" ? "🔴" : c === "Y" ? "🟡" : "⬛")).join("")).join("\n");
}

function c4Ai(board) {
  const open = [];
  for (let c = 0; c < 7; c++) if (!board[0][c]) open.push(c);
  for (const c of open) {
    const copy = board.map((r) => r.slice());
    c4Drop(copy, c, "Y");
    if (c4Winner(copy) === "Y") return c;
  }
  for (const c of open) {
    const copy = board.map((r) => r.slice());
    c4Drop(copy, c, "R");
    if (c4Winner(copy) === "R") return c;
  }
  if (open.includes(3)) return 3;
  return open[(Math.random() * open.length) | 0];
}

function c4Buttons(gameId, board, ended) {
  const mk = (cols, style) =>
    new ActionRowBuilder().addComponents(
      ...cols.map((c) =>
        new ButtonBuilder()
          .setCustomId(`sanad:c4:${gameId}:${c}`)
          .setLabel(String(c + 1))
          .setStyle(style)
          .setDisabled(ended || Boolean(board[0][c])),
      ),
    );
  return [mk([0, 1, 2, 3, 4], ButtonStyle.Primary), mk([5, 6], ButtonStyle.Success)];
}

/* ─── Commands ─────────────────────────────────────────────────── */

export function gameCommands() {
  return [
    new SlashCommandBuilder("game", t("en", "commands.game.description"))
      .describe({
        en: t("en", "commands.game.description"),
        ar: t("ar", "commands.game.description"),
      })
      .subcommand("xo", t("en", "commands.game.xo.description"), (s) =>
        s.user("opponent", t("en", "commands.game.options.opponent"), {
          descriptions: { ar: t("ar", "commands.game.options.opponent") },
        }),
      )
      .subcommand("rps", t("en", "commands.game.rps.description"))
      .subcommand("slots", t("en", "commands.game.slots.description"))
      .subcommand("c4", t("en", "commands.game.c4.description"), (s) =>
        s.user("opponent", t("en", "commands.game.options.opponent"), {
          descriptions: { ar: t("ar", "commands.game.options.opponent") },
        }),
      )
      .subcommand("list", t("en", "commands.game.listDescription")),
    new SlashCommandBuilder("xo", t("en", "commands.game.xo.description"))
      .describe({
        en: t("en", "commands.game.xo.description"),
        ar: t("ar", "commands.game.xo.description"),
      })
      .user("opponent", t("en", "commands.game.options.opponent"), {
        descriptions: { ar: t("ar", "commands.game.options.opponent") },
      }),
  ];
}

export function registerGames(client) {
  const startXo = async (i, opponentOpt) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    const me = userId(i.user);
    const opp = asUserId(opponentOpt);
    if (opp && opp === me) {
      return i.reply({ content: tr("commands.game.self"), ephemeral: true });
    }

    if (opp) {
      const id = newId();
      const game = {
        id,
        type: "xo-challenge",
        serverId: i.serverId,
        challenger: me,
        opponent: opp,
        expires: Date.now() + TTL_MS,
      };
      games.set(id, game);
      persistGames();
      return i.reply({
        content: tr("commands.game.xo.challenge", {
          from: mentionUser(me),
          to: mentionUser(opp),
        }),
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`sanad:xo:${id}:accept`)
              .setLabel(tr("commands.game.accept"))
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId(`sanad:xo:${id}:decline`)
              .setLabel(tr("commands.game.decline"))
              .setStyle(ButtonStyle.Danger),
          ),
        ],
      });
    }

    const id = newId();
    const game = {
      id,
      type: "xo",
      vsBot: true,
      board: emptyBoard(),
      turn: "X",
      x: me,
      o: "bot",
      serverId: i.serverId,
      ended: false,
      expires: Date.now() + TTL_MS,
    };
    games.set(id, game);
    persistGames();
    return i.reply({
      content: tr("commands.game.xo.startBot"),
      ...xoPayload(tr, game),
    });
  };

  client.command("game", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    prune();
    const sub = i.subcommand;

    if (sub === "list") {
      return i.reply({
        embeds: [
          gameEmbed(
            tr,
            tr("commands.game.listTitle"),
            tr("commands.game.listBody"),
            BRAND.colour.info,
          ),
        ],
        ephemeral: true,
      });
    }

    if (sub === "xo") return startXo(i, i.option("opponent"));

    if (sub === "rps") {
      const id = newId();
      games.set(id, {
        id,
        type: "rps",
        userId: userId(i.user),
        expires: Date.now() + TTL_MS,
      });
      persistGames();
      return i.reply({
        embeds: [gameEmbed(tr, tr("commands.game.rps.title"), tr("commands.game.rps.pick"))],
        components: rpsButtons(id),
      });
    }

    if (sub === "slots") {
      const reels = spinSlots();
      const score = slotsScore(reels);
      const result =
        score >= 10
          ? tr("commands.game.slots.jackpot", { n: score })
          : score > 0
            ? tr("commands.game.slots.win", { n: score })
            : tr("commands.game.slots.lose");
      return i.reply({
        embeds: [
          gameEmbed(
            tr,
            tr("commands.game.slots.title"),
            `**| ${reels.join(" | ")} |**\n\n${result}`,
            score > 0 ? BRAND.colour.success : BRAND.colour.mute,
          ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`sanad:slots:${userId(i.user)}:spin`)
              .setLabel(tr("commands.game.slots.again"))
              .setStyle(ButtonStyle.Primary),
          ),
        ],
      });
    }

    if (sub === "c4") {
      const me = userId(i.user);
      const opp = asUserId(i.option("opponent"));
      if (opp && opp === me) return i.reply({ content: tr("commands.game.self"), ephemeral: true });
      if (opp) {
        const id = newId();
        games.set(id, {
          id,
          type: "c4-challenge",
          challenger: me,
          opponent: opp,
          serverId: i.serverId,
          expires: Date.now() + TTL_MS,
        });
        persistGames();
        return i.reply({
          content: tr("commands.game.c4.challenge", {
            from: mentionUser(me),
            to: mentionUser(opp),
          }),
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`sanad:c4:${id}:accept`)
                .setLabel(tr("commands.game.accept"))
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`sanad:c4:${id}:decline`)
                .setLabel(tr("commands.game.decline"))
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
      }
      const id = newId();
      const game = {
        id,
        type: "c4",
        vsBot: true,
        board: c4Empty(),
        turn: "R",
        red: me,
        yellow: "bot",
        ended: false,
        serverId: i.serverId,
        expires: Date.now() + TTL_MS,
      };
      games.set(id, game);
      persistGames();
      return i.reply({
        content: tr("commands.game.c4.startBot"),
        embeds: [
          gameEmbed(
            tr,
            tr("commands.game.c4.title"),
            `${tr("commands.game.c4.vsBot")}\n\n${c4Render(game.board)}\n\n${tr("commands.game.c4.yourTurn")}`,
          ),
        ],
        components: c4Buttons(id, game.board, false),
      });
    }
  });

  client.command("xo", (i) => startXo(i, i.option("opponent")));

  /* XO components */
  client.component(/^sanad:xo:[a-f0-9]+:(accept|decline|\d)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId).split(":");
    const id = parts[2];
    const action = parts[3];
    const game = games.get(id);
    if (!game) return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    touch(game);

    if (game.type === "xo-challenge") {
      if (action === "decline") {
        if (userId(i.user) !== game.opponent && userId(i.user) !== game.challenger) {
          return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
        }
        games.delete(id);
        persistGames();
        return i.update({ content: tr("commands.game.declined"), components: [], embeds: [] });
      }
      if (action === "accept") {
        if (userId(i.user) !== game.opponent) {
          return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
        }
        const live = {
          id,
          type: "xo",
          vsBot: false,
          board: emptyBoard(),
          turn: "X",
          x: game.challenger,
          o: game.opponent,
          ended: false,
          serverId: game.serverId,
          expires: Date.now() + TTL_MS,
        };
        games.set(id, live);
        persistGames();
        return i.update({
          content: tr("commands.game.xo.startPvp", {
            x: mentionUser(live.x),
            o: mentionUser(live.o),
          }),
          ...xoPayload(tr, live),
        });
      }
      return;
    }

    if (game.type !== "xo") return;

    const cell = Number(action);
    if (!Number.isInteger(cell) || cell < 0 || cell > 8) return;
    if (game.ended || xoWinner(game.board)) {
      return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    }
    if (game.board[cell]) {
      return i.reply({ content: tr("commands.game.xo.taken"), ephemeral: true });
    }

    const uid = userId(i.user);
    const expected = game.turn === "X" ? game.x : game.o;
    if (game.vsBot) {
      if (uid !== game.x || game.turn !== "X") {
        return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
      }
    } else if (uid !== expected) {
      return i.reply({ content: tr("commands.game.xo.waitTurn"), ephemeral: true });
    }

    game.board[cell] = game.turn;
    let result = xoWinner(game.board);
    if (!result) {
      game.turn = game.turn === "X" ? "O" : "X";
      if (game.vsBot && game.turn === "O") {
        const ai = xoAiMove(game.board);
        if (ai >= 0) game.board[ai] = "O";
        result = xoWinner(game.board);
        game.turn = "X";
      }
    }
    if (result) game.ended = true;
    touch(game);
    return i.update(xoPayload(tr, game));
  });

  /* RPS */
  client.component(/^sanad:rps:[a-f0-9]+:(rock|paper|scissors)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const [, , id, pick] = String(i.customId).split(":");
    const game = games.get(id);
    if (!game || game.type !== "rps") {
      return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    }
    if (userId(i.user) !== game.userId) {
      return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    }
    const bot = RPS[(Math.random() * 3) | 0];
    const outcome = rpsBeat(pick, bot);
    const msg =
      outcome === 0
        ? tr("commands.game.rps.tie")
        : outcome > 0
          ? tr("commands.game.rps.win")
          : tr("commands.game.rps.lose");
    games.delete(id);
    persistGames();
    return i.update({
      embeds: [
        gameEmbed(
          tr,
          tr("commands.game.rps.title"),
          tr("commands.game.rps.result", {
            you: tr(`commands.game.rps.${pick}`),
            bot: tr(`commands.game.rps.${bot}`),
            outcome: msg,
          }),
          outcome > 0 ? BRAND.colour.success : outcome < 0 ? BRAND.colour.danger : BRAND.colour.mute,
        ),
      ],
      components: [],
    });
  });

  /* Slots again */
  client.component(/^sanad:slots:[0-9A-HJKMNP-TV-Z]{26}:spin$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const owner = String(i.customId).split(":")[2];
    if (userId(i.user) !== owner) {
      return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
    }
    const reels = spinSlots();
    const score = slotsScore(reels);
    const result =
      score >= 10
        ? tr("commands.game.slots.jackpot", { n: score })
        : score > 0
          ? tr("commands.game.slots.win", { n: score })
          : tr("commands.game.slots.lose");
    return i.update({
      embeds: [
        gameEmbed(
          tr,
          tr("commands.game.slots.title"),
          `**| ${reels.join(" | ")} |**\n\n${result}`,
          score > 0 ? BRAND.colour.success : BRAND.colour.mute,
        ),
      ],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(`sanad:slots:${owner}:spin`)
            .setLabel(tr("commands.game.slots.again"))
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
  });

  /* Connect 4 */
  client.component(/^sanad:c4:[a-f0-9]+:(accept|decline|\d)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    const parts = String(i.customId).split(":");
    const id = parts[2];
    const action = parts[3];
    const game = games.get(id);
    if (!game) return i.reply({ content: tr("commands.game.expired"), ephemeral: true });
    touch(game);

    if (game.type === "c4-challenge") {
      if (action === "decline") {
        if (userId(i.user) !== game.opponent && userId(i.user) !== game.challenger) {
          return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
        }
        games.delete(id);
        persistGames();
        return i.update({ content: tr("commands.game.declined"), components: [] });
      }
      if (action === "accept") {
        if (userId(i.user) !== game.opponent) {
          return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
        }
        const live = {
          id,
          type: "c4",
          vsBot: false,
          board: c4Empty(),
          turn: "R",
          red: game.challenger,
          yellow: game.opponent,
          ended: false,
          serverId: game.serverId,
          expires: Date.now() + TTL_MS,
        };
        games.set(id, live);
        persistGames();
        return i.update({
          content: tr("commands.game.c4.startPvp", {
            red: mentionUser(live.red),
            yellow: mentionUser(live.yellow),
          }),
          embeds: [
            gameEmbed(
              tr,
              tr("commands.game.c4.title"),
              `${c4Render(live.board)}\n\n${tr("commands.game.c4.turn", { user: mentionUser(live.red) })}`,
            ),
          ],
          components: c4Buttons(id, live.board, false),
        });
      }
      return;
    }

    if (game.type !== "c4") return;

    const col = Number(action);
    if (!Number.isInteger(col) || col < 0 || col > 6) return;
    if (game.ended || c4Winner(game.board)) {
      return i.reply({ content: tr("commands.game.ended"), ephemeral: true });
    }
    const uid = userId(i.user);
    const expected = game.turn === "R" ? game.red : game.yellow;
    if (game.vsBot) {
      if (uid !== game.red || game.turn !== "R") {
        return i.reply({ content: tr("commands.game.notYours"), ephemeral: true });
      }
    } else if (uid !== expected) {
      return i.reply({ content: tr("commands.game.c4.waitTurn"), ephemeral: true });
    }

    if (c4Drop(game.board, col, game.turn) < 0) {
      return i.reply({ content: tr("commands.game.c4.full"), ephemeral: true });
    }

    let result = c4Winner(game.board);
    if (!result) {
      game.turn = game.turn === "R" ? "Y" : "R";
      if (game.vsBot && game.turn === "Y") {
        const aiCol = c4Ai(game.board);
        if (aiCol >= 0) c4Drop(game.board, aiCol, "Y");
        result = c4Winner(game.board);
        game.turn = "R";
      }
    }

    let status;
    if (result === "draw") status = tr("commands.game.c4.draw");
    else if (result === "R") {
      status = game.vsBot
        ? tr("commands.game.c4.youWin")
        : tr("commands.game.c4.playerWin", { user: mentionUser(game.red) });
    } else if (result === "Y") {
      status = game.vsBot
        ? tr("commands.game.c4.botWin")
        : tr("commands.game.c4.playerWin", { user: mentionUser(game.yellow) });
    } else if (game.vsBot) status = tr("commands.game.c4.yourTurn");
    else {
      status = tr("commands.game.c4.turn", {
        user: mentionUser(game.turn === "R" ? game.red : game.yellow),
      });
    }

    if (result) {
      game.ended = true;
      games.delete(id);
    }
    touch(game);
    return i.update({
      embeds: [
        gameEmbed(
          tr,
          tr("commands.game.c4.title"),
          `${c4Render(game.board)}\n\n${status}`,
          result ? BRAND.colour.success : BRAND.colour.ticket,
        ),
      ],
      components: c4Buttons(id, game.board, Boolean(result) || game.ended),
    });
  });

  registry.register({
    name: "game",
    slash: false,
    aliases: ["لعبة", "العاب", "ألعاب", "play"],
    async execute(ctx) {
      const sub = String(ctx.args[0] || "list").toLowerCase();
      if (["list", "قائمة", "help", "مساعدة"].includes(sub)) {
        return ctx.reply({
          embeds: [
            gameEmbed(ctx.t, ctx.t("commands.game.listTitle"), ctx.t("commands.game.listBody")),
          ],
        });
      }
      return ctx.reply(ctx.t("commands.game.prefixHint", { prefix: ctx.prefix || "!" }));
    },
  });

  registry.register({
    name: "xo",
    slash: false,
    aliases: ["اكس او", "xo", "tictactoe"],
    async execute(ctx) {
      const opp =
        String(ctx.args[0] || "").match(/^<@!?([0-9A-HJKMNP-TV-Z]{26})>$/i)?.[1] || null;
      prune();
      if (opp === ctx.userId) return ctx.reply(ctx.t("commands.game.self"));
      if (opp) {
        const id = newId();
        games.set(id, {
          id,
          type: "xo-challenge",
          serverId: ctx.serverId,
          challenger: ctx.userId,
          opponent: opp,
          expires: Date.now() + TTL_MS,
        });
        persistGames();
        return ctx.reply({
          content: ctx.t("commands.game.xo.challenge", {
            from: mentionUser(ctx.userId),
            to: mentionUser(opp),
          }),
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`sanad:xo:${id}:accept`)
                .setLabel(ctx.t("commands.game.accept"))
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`sanad:xo:${id}:decline`)
                .setLabel(ctx.t("commands.game.decline"))
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
      }
      const id = newId();
      const game = {
        id,
        type: "xo",
        vsBot: true,
        board: emptyBoard(),
        turn: "X",
        x: ctx.userId,
        o: "bot",
        ended: false,
        serverId: ctx.serverId,
        expires: Date.now() + TTL_MS,
      };
      games.set(id, game);
      persistGames();
      return ctx.reply({
        content: ctx.t("commands.game.xo.startBot"),
        ...xoPayload(ctx.t, game),
      });
    },
  });

  registry.register({
    name: "rps",
    slash: false,
    aliases: ["حجرة", "casra"],
    async execute(ctx) {
      prune();
      const id = newId();
      games.set(id, {
        id,
        type: "rps",
        userId: ctx.userId,
        expires: Date.now() + TTL_MS,
      });
      persistGames();
      return ctx.reply({
        embeds: [gameEmbed(ctx.t, ctx.t("commands.game.rps.title"), ctx.t("commands.game.rps.pick"))],
        components: rpsButtons(id),
      });
    },
  });

  registry.register({
    name: "slots",
    slash: false,
    aliases: ["سلوتس", "حظ"],
    async execute(ctx) {
      const reels = spinSlots();
      const score = slotsScore(reels);
      const result =
        score >= 10
          ? ctx.t("commands.game.slots.jackpot", { n: score })
          : score > 0
            ? ctx.t("commands.game.slots.win", { n: score })
            : ctx.t("commands.game.slots.lose");
      return ctx.reply({
        embeds: [
          gameEmbed(
            ctx.t,
            ctx.t("commands.game.slots.title"),
            `**| ${reels.join(" | ")} |**\n\n${result}`,
            score > 0 ? BRAND.colour.success : BRAND.colour.mute,
          ),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`sanad:slots:${ctx.userId}:spin`)
              .setLabel(ctx.t("commands.game.slots.again"))
              .setStyle(ButtonStyle.Primary),
          ),
        ],
      });
    },
  });

  registry.register({
    name: "c4",
    slash: false,
    aliases: ["connect4", "اربع", "٤"],
    async execute(ctx) {
      prune();
      const opp =
        String(ctx.args[0] || "").match(/^<@!?([0-9A-HJKMNP-TV-Z]{26})>$/i)?.[1] || null;
      if (opp === ctx.userId) return ctx.reply(ctx.t("commands.game.self"));
      if (opp) {
        const id = newId();
        games.set(id, {
          id,
          type: "c4-challenge",
          challenger: ctx.userId,
          opponent: opp,
          serverId: ctx.serverId,
          expires: Date.now() + TTL_MS,
        });
        persistGames();
        return ctx.reply({
          content: ctx.t("commands.game.c4.challenge", {
            from: mentionUser(ctx.userId),
            to: mentionUser(opp),
          }),
          components: [
            new ActionRowBuilder().addComponents(
              new ButtonBuilder()
                .setCustomId(`sanad:c4:${id}:accept`)
                .setLabel(ctx.t("commands.game.accept"))
                .setStyle(ButtonStyle.Success),
              new ButtonBuilder()
                .setCustomId(`sanad:c4:${id}:decline`)
                .setLabel(ctx.t("commands.game.decline"))
                .setStyle(ButtonStyle.Danger),
            ),
          ],
        });
      }
      const id = newId();
      const game = {
        id,
        type: "c4",
        vsBot: true,
        board: c4Empty(),
        turn: "R",
        red: ctx.userId,
        yellow: "bot",
        ended: false,
        serverId: ctx.serverId,
        expires: Date.now() + TTL_MS,
      };
      games.set(id, game);
      persistGames();
      return ctx.reply({
        content: ctx.t("commands.game.c4.startBot"),
        embeds: [
          gameEmbed(
            ctx.t,
            ctx.t("commands.game.c4.title"),
            `${ctx.t("commands.game.c4.vsBot")}\n\n${c4Render(game.board)}\n\n${ctx.t("commands.game.c4.yourTurn")}`,
          ),
        ],
        components: c4Buttons(id, game.board, false),
      });
    },
  });
}
