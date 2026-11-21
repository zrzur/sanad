/**
 * Full server webhook manager — create / list / edit / delete / regenerate /
 * test / send custom messages (content + embed + username/avatar).
 *
 * Callers: src/core/createBot.js (registerWebhooks + webhookCommands).
 * Storage: src/db/store.js webhook-tokens vault.
 */
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  Permissions,
  SlashCommandBuilder,
  TextInputStyle,
} from "@zrzur/sdk/bot";
import { BRAND, mentionChannel } from "../brand.js";
import { t } from "../core/i18n.js";
import {
  buildWebhookUrl,
  deleteWebhookSecret,
  getWebhookSecret,
  listSavedWebhooks,
  maskToken,
  parseWebhookRef,
  saveWebhookSecret,
} from "../db/store.js";
import { guildT } from "../util/locale.js";

const MANAGE = Permissions.ManageWebhooks;

function parseColour(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{6}$/.test(s)) return Number.parseInt(s, 16);
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    const expanded = s
      .split("")
      .map((c) => c + c)
      .join("");
    return Number.parseInt(expanded, 16);
  }
  return null;
}

function errMsg(error) {
  return String(error?.message || error?.body?.type || error || "error").slice(0, 200);
}

async function requireManage(i, tr) {
  if (!i.serverId) {
    await i.reply({ content: tr("common.guildOnly"), ephemeral: true });
    return false;
  }
  if (!i.has(MANAGE)) {
    await i.reply({ content: tr("commands.webhook.needPerm"), ephemeral: true });
    return false;
  }
  return true;
}

async function listServerWebhooks(client, serverId) {
  const data = await client.rest.get(`/servers/${serverId}/webhooks`);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.webhooks)) return data.webhooks;
  return [];
}

/** Ensure webhook id belongs to this server (blocks cross-guild IDOR). */
async function assertWebhookInServer(client, serverId, webhookId) {
  const hooks = await listServerWebhooks(client, serverId);
  const hit = hooks.find((h) => (h.id || h._id) === webhookId);
  if (!hit) {
    const err = new Error("WebhookNotInServer");
    err.code = "WebhookNotInServer";
    throw err;
  }
  return hit;
}

function parseIdOption(raw) {
  const ref = parseWebhookRef(raw);
  if (ref?.id) return ref;
  const id = String(raw || "").trim();
  if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(id)) return { id, token: null };
  return null;
}

async function resolveToken(id, serverId, providedToken) {
  if (providedToken) return providedToken;
  const row = listSavedWebhooks(serverId).find((r) => r.id === id);
  if (row?.token) return row.token;
  const global = getWebhookSecret(id);
  // Only use unscoped vault entry if it is tagged to this server (or untagged legacy).
  if (!global) return null;
  const meta = listSavedWebhooks().find((r) => r.id === id);
  if (meta?.serverId && meta.serverId !== serverId) return null;
  return global;
}

function notInServerReply(i, tr) {
  return i.reply({ content: tr("commands.webhook.notInServer"), ephemeral: true });
}

async function executeWebhook(client, id, token, body, { wait = true } = {}) {
  const path = wait ? `/webhooks/${id}/${token}?wait=true` : `/webhooks/${id}/${token}`;
  return client.rest.post(path, body);
}

function webhookEmbed(tr, title, description, colour = BRAND.colour.primary) {
  return new EmbedBuilder()
    .title(title)
    .description(description)
    .colour(colour)
    .footer(tr("commands.webhook.footer"))
    .timestamp();
}

function formatHookRow(hook, tr) {
  const id = hook.id || hook._id;
  const name = hook.name || "—";
  const ch = hook.channel_id ? mentionChannel(hook.channel_id) : "—";
  const hasToken = Boolean(getWebhookSecret(id));
  const tokenMark = hasToken ? tr("commands.webhook.tokenSaved") : tr("commands.webhook.tokenMissing");
  return `• **${name}** \`${id}\`\n  ${tr("common.channel")}: ${ch} · ${tokenMark}`;
}

export function webhookCommands() {
  return [
    new SlashCommandBuilder("webhook", t("en", "commands.webhook.description"))
      .describe({
        en: t("en", "commands.webhook.description"),
        ar: t("ar", "commands.webhook.description"),
      })
      .subcommand("create", t("en", "commands.webhook.createCmd"), (s) =>
        s
          .string("name", t("en", "commands.webhook.options.name"), {
            required: true,
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.name") },
          })
          .channel("channel", t("en", "common.channel"), {
            descriptions: { ar: t("ar", "common.channel") },
          }),
      )
      .subcommand("list", t("en", "commands.webhook.listCmd"))
      .subcommand("info", t("en", "commands.webhook.infoCmd"), (s) =>
        s.string("id", t("en", "commands.webhook.options.id"), {
          required: true,
          maxLength: 200,
          descriptions: { ar: t("ar", "commands.webhook.options.id") },
        }),
      )
      .subcommand("edit", t("en", "commands.webhook.editCmd"), (s) =>
        s
          .string("id", t("en", "commands.webhook.options.id"), {
            required: true,
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.id") },
          })
          .string("name", t("en", "commands.webhook.options.name"), {
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.name") },
          })
          .channel("channel", t("en", "commands.webhook.options.moveChannel"), {
            descriptions: { ar: t("ar", "commands.webhook.options.moveChannel") },
          }),
      )
      .subcommand("delete", t("en", "commands.webhook.deleteCmd"), (s) =>
        s.string("id", t("en", "commands.webhook.options.id"), {
          required: true,
          maxLength: 80,
          descriptions: { ar: t("ar", "commands.webhook.options.id") },
        }),
      )
      .subcommand("regenerate", t("en", "commands.webhook.regenCmd"), (s) =>
        s.string("id", t("en", "commands.webhook.options.id"), {
          required: true,
          maxLength: 80,
          descriptions: { ar: t("ar", "commands.webhook.options.id") },
        }),
      )
      .subcommand("url", t("en", "commands.webhook.urlCmd"), (s) =>
        s.string("id", t("en", "commands.webhook.options.id"), {
          required: true,
          maxLength: 80,
          descriptions: { ar: t("ar", "commands.webhook.options.id") },
        }),
      )
      .subcommand("save", t("en", "commands.webhook.saveCmd"), (s) =>
        s.string("url", t("en", "commands.webhook.options.url"), {
          required: true,
          maxLength: 400,
          descriptions: { ar: t("ar", "commands.webhook.options.url") },
        }),
      )
      .subcommand("test", t("en", "commands.webhook.testCmd"), (s) =>
        s
          .string("id", t("en", "commands.webhook.options.id"), {
            required: true,
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.id") },
          })
          .string("content", t("en", "commands.webhook.options.testContent"), {
            maxLength: 200,
            descriptions: { ar: t("ar", "commands.webhook.options.testContent") },
          }),
      )
      .subcommand("send", t("en", "commands.webhook.sendCmd"), (s) =>
        s
          .string("id", t("en", "commands.webhook.options.idOrUrl"), {
            required: true,
            maxLength: 400,
            descriptions: { ar: t("ar", "commands.webhook.options.idOrUrl") },
          })
          .string("content", t("en", "commands.webhook.options.content"), {
            maxLength: 2000,
            descriptions: { ar: t("ar", "commands.webhook.options.content") },
          })
          .string("username", t("en", "commands.webhook.options.username"), {
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.username") },
          })
          .string("avatar_url", t("en", "commands.webhook.options.avatar"), {
            maxLength: 400,
            descriptions: { ar: t("ar", "commands.webhook.options.avatar") },
          }),
      )
      .subcommand("embed", t("en", "commands.webhook.embedCmd"), (s) =>
        s
          .string("id", t("en", "commands.webhook.options.idOrUrl"), {
            required: true,
            maxLength: 400,
            descriptions: { ar: t("ar", "commands.webhook.options.idOrUrl") },
          })
          .string("title", t("en", "commands.webhook.options.embedTitle"), {
            maxLength: 256,
            descriptions: { ar: t("ar", "commands.webhook.options.embedTitle") },
          })
          .string("description", t("en", "commands.webhook.options.embedDesc"), {
            maxLength: 2000,
            descriptions: { ar: t("ar", "commands.webhook.options.embedDesc") },
          })
          .string("colour", t("en", "commands.webhook.options.colour"), {
            maxLength: 7,
            descriptions: { ar: t("ar", "commands.webhook.options.colour") },
          })
          .string("content", t("en", "commands.webhook.options.content"), {
            maxLength: 2000,
            descriptions: { ar: t("ar", "commands.webhook.options.content") },
          })
          .string("username", t("en", "commands.webhook.options.username"), {
            maxLength: 80,
            descriptions: { ar: t("ar", "commands.webhook.options.username") },
          })
          .string("avatar_url", t("en", "commands.webhook.options.avatar"), {
            maxLength: 400,
            descriptions: { ar: t("ar", "commands.webhook.options.avatar") },
          }),
      )
      .subcommand("compose", t("en", "commands.webhook.composeCmd"), (s) =>
        s.string("id", t("en", "commands.webhook.options.idOrUrl"), {
          required: true,
          maxLength: 400,
          descriptions: { ar: t("ar", "commands.webhook.options.idOrUrl") },
        }),
      )
      .permissions(MANAGE),
  ];
}

export function registerWebhooks(client) {
  client.command("webhook", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireManage(i, tr))) return;

    const sub = i.subcommand;

    if (sub === "create") {
      const name = String(i.option("name") || "").trim();
      const channelId = i.option("channel") || i.channelId;
      if (!name) {
        return i.reply({ content: tr("commands.webhook.badName"), ephemeral: true });
      }
      try {
        const ch = await client.rest.get(`/channels/${channelId}`);
        const chServer = ch?.server || ch?.server_id || ch?.serverId;
        if (chServer && chServer !== i.serverId) {
          return i.reply({ content: tr("commands.webhook.notInServer"), ephemeral: true });
        }
        const created = await client.rest.post(`/channels/${channelId}/webhooks`, { name });
        const id = created.id || created._id;
        const token = created.token;
        const url = created.url || (token ? buildWebhookUrl(id, token) : null);
        if (token) {
          saveWebhookSecret(id, {
            token,
            name: created.name || name,
            channelId: created.channel_id || channelId,
            serverId: i.serverId,
            url,
          });
        }
        return i.reply({
          embeds: [
            webhookEmbed(
              tr,
              tr("commands.webhook.createdTitle"),
              tr("commands.webhook.createdBody", {
                name: created.name || name,
                id,
                channel: mentionChannel(created.channel_id || channelId),
                url: url || tr("commands.webhook.noUrl"),
                tokenNote: token
                  ? tr("commands.webhook.tokenOnce")
                  : tr("commands.webhook.tokenMissing"),
              }),
              BRAND.colour.success,
            ),
          ],
          ephemeral: true,
        });
      } catch (error) {
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "list") {
      try {
        const hooks = await listServerWebhooks(client, i.serverId);
        if (!hooks.length) {
          return i.reply({ content: tr("commands.webhook.empty"), ephemeral: true });
        }
        const lines = hooks.slice(0, 25).map((h) => formatHookRow(h, tr));
        const saved = listSavedWebhooks(i.serverId).length;
        return i.reply({
          embeds: [
            webhookEmbed(
              tr,
              tr("commands.webhook.listTitle", { n: hooks.length }),
              `${lines.join("\n\n")}\n\n${tr("commands.webhook.savedCount", { n: saved })}`,
            ),
          ],
          ephemeral: true,
        });
      } catch (error) {
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "info") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) {
        return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      }
      try {
        await assertWebhookInServer(client, i.serverId, ref.id);
        const hook = await client.rest.get(`/webhooks/${ref.id}`);
        const id = hook.id || hook._id || ref.id;
        const saved = await resolveToken(id, i.serverId, null);
        return i.reply({
          embeds: [
            webhookEmbed(
              tr,
              tr("commands.webhook.infoTitle", { name: hook.name || id }),
              [
                `**ID:** \`${id}\``,
                `**${tr("common.channel")}:** ${hook.channel_id ? mentionChannel(hook.channel_id) : "—"}`,
                `**${tr("commands.webhook.creator")}:** \`${hook.creator_id || "—"}\``,
                `**${tr("commands.webhook.tokenLabel")}:** ${
                  saved
                    ? `${maskToken(saved)} (${tr("commands.webhook.tokenSaved")})`
                    : tr("commands.webhook.tokenMissing")
                }`,
                hook.last_used ? `**${tr("commands.webhook.lastUsed")}:** ${hook.last_used}` : null,
              ]
                .filter(Boolean)
                .join("\n"),
            ),
          ],
          ephemeral: true,
        });
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "edit") {
      const ref = parseIdOption(i.option("id"));
      const name = i.option("name") ? String(i.option("name")).trim() : null;
      const channelId = i.option("channel") || null;
      if (!ref?.id) return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      if (!name && !channelId) {
        return i.reply({ content: tr("commands.webhook.editNothing"), ephemeral: true });
      }
      const id = ref.id;
      const body = {};
      if (name) body.name = name;
      if (channelId) body.channel_id = channelId;
      try {
        await assertWebhookInServer(client, i.serverId, id);
        const updated = await client.rest.patch(`/webhooks/${id}`, body);
        saveWebhookSecret(id, {
          name: updated.name || name || undefined,
          channelId: updated.channel_id || channelId || undefined,
          serverId: i.serverId,
        });
        return i.reply({
          content: tr("commands.webhook.edited", {
            name: updated.name || name || id,
            id,
          }),
          ephemeral: true,
        });
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "delete") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      const id = ref.id;
      try {
        await assertWebhookInServer(client, i.serverId, id);
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
      return i.reply({
        content: tr("commands.webhook.deleteConfirm", { id }),
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(`sanad:webhook:del:${id}`)
              .setLabel(tr("common.confirm"))
              .setStyle(ButtonStyle.Danger),
            new ButtonBuilder()
              .setCustomId("sanad:webhook:cancel")
              .setLabel(tr("common.cancel"))
              .setStyle(ButtonStyle.Secondary),
          ),
        ],
        ephemeral: true,
      });
    }

    if (sub === "regenerate") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      const id = ref.id;
      try {
        await assertWebhookInServer(client, i.serverId, id);
        const result = await client.rest.post(`/webhooks/${id}/token`);
        // SDK returns the new post URL string; some builds return {token,url}.
        let url = null;
        let finalToken = null;
        if (typeof result === "string") {
          url = result;
          finalToken = parseWebhookRef(result)?.token || null;
        } else if (result && typeof result === "object") {
          finalToken = result.token || null;
          url = result.url || (finalToken ? buildWebhookUrl(id, finalToken) : null);
          if (!finalToken && url) finalToken = parseWebhookRef(url)?.token || null;
        }
        if (finalToken) {
          let meta = {};
          try {
            meta = await client.rest.get(`/webhooks/${id}`);
          } catch {
            /* ignore */
          }
          saveWebhookSecret(id, {
            token: finalToken,
            name: meta.name,
            channelId: meta.channel_id,
            serverId: i.serverId,
            url: url || buildWebhookUrl(id, finalToken),
          });
        }
        return i.reply({
          embeds: [
            webhookEmbed(
              tr,
              tr("commands.webhook.regenTitle"),
              tr("commands.webhook.regenBody", {
                id,
                url: url || tr("commands.webhook.noUrl"),
              }),
              BRAND.colour.success,
            ),
          ],
          ephemeral: true,
        });
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "url") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      try {
        await assertWebhookInServer(client, i.serverId, ref.id);
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
      const token = await resolveToken(ref.id, i.serverId, null);
      if (!token) {
        return i.reply({ content: tr("commands.webhook.needToken", { id: ref.id }), ephemeral: true });
      }
      const url = buildWebhookUrl(ref.id, token);
      return i.reply({
        content: tr("commands.webhook.urlReveal", { url }),
        ephemeral: true,
      });
    }

    if (sub === "save") {
      const raw = String(i.option("url") || "").trim();
      const ref = parseWebhookRef(raw);
      if (!ref?.id || !ref.token) {
        return i.reply({ content: tr("commands.webhook.badUrl"), ephemeral: true });
      }
      try {
        const meta = await assertWebhookInServer(client, i.serverId, ref.id);
        const url = buildWebhookUrl(ref.id, ref.token);
        saveWebhookSecret(ref.id, {
          token: ref.token,
          name: meta.name,
          channelId: meta.channel_id,
          serverId: i.serverId,
          url,
        });
        return i.reply({
          content: tr("commands.webhook.saved", {
            id: ref.id,
            name: meta.name || ref.id,
          }),
          ephemeral: true,
        });
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "test") {
      const ref = parseIdOption(i.option("id"));
      const content =
        String(i.option("content") || "").trim() || tr("commands.webhook.testDefault");
      if (!ref?.id) return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      try {
        await assertWebhookInServer(client, i.serverId, ref.id);
        await client.rest.post(`/webhooks/${ref.id}/test`, { content: content.slice(0, 200) });
        return i.reply({ content: tr("commands.webhook.testOk"), ephemeral: true });
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "send" || sub === "embed") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) {
        return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      }
      try {
        await assertWebhookInServer(client, i.serverId, ref.id);
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
      const token = await resolveToken(ref.id, i.serverId, ref.token);
      if (!token) {
        return i.reply({
          content: tr("commands.webhook.needToken", { id: ref.id }),
          ephemeral: true,
        });
      }
      if (ref.token) {
        saveWebhookSecret(ref.id, {
          token: ref.token,
          serverId: i.serverId,
          url: buildWebhookUrl(ref.id, ref.token),
        });
      }

      const content = i.option("content") ? String(i.option("content")) : null;
      const username = i.option("username") ? String(i.option("username")).trim() : null;
      const avatarUrl = i.option("avatar_url") ? String(i.option("avatar_url")).trim() : null;
      const body = {};
      if (content) body.content = content.slice(0, 2000);
      if (username) body.username = username.slice(0, 80);
      if (avatarUrl) body.avatar_url = avatarUrl;

      if (sub === "embed") {
        const title = i.option("title") ? String(i.option("title")).slice(0, 256) : null;
        const description = i.option("description")
          ? String(i.option("description")).slice(0, 2000)
          : null;
        const colour = parseColour(i.option("colour"));
        if (!title && !description && !content) {
          return i.reply({ content: tr("commands.webhook.emptyPayload"), ephemeral: true });
        }
        const embed = {};
        if (title) embed.title = title;
        if (description) embed.description = description;
        if (colour != null) embed.color = colour;
        body.embeds = [embed];
      } else if (!content) {
        return i.reply({ content: tr("commands.webhook.emptyPayload"), ephemeral: true });
      }

      try {
        await executeWebhook(client, ref.id, token, body, { wait: true });
        return i.reply({ content: tr("commands.webhook.sent"), ephemeral: true });
      } catch (error) {
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
    }

    if (sub === "compose") {
      const ref = parseIdOption(i.option("id"));
      if (!ref?.id) {
        return i.reply({ content: tr("commands.webhook.badId"), ephemeral: true });
      }
      try {
        await assertWebhookInServer(client, i.serverId, ref.id);
      } catch (error) {
        if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
        return i.reply({
          content: tr("commands.webhook.apiError", { error: errMsg(error) }),
          ephemeral: true,
        });
      }
      const token = await resolveToken(ref.id, i.serverId, ref.token);
      if (!token) {
        return i.reply({
          content: tr("commands.webhook.needToken", { id: ref.id }),
          ephemeral: true,
        });
      }
      if (ref.token) {
        saveWebhookSecret(ref.id, {
          token: ref.token,
          serverId: i.serverId,
          url: buildWebhookUrl(ref.id, ref.token),
        });
      }
      const customId = `sanad:webhook:compose:${ref.id}`;
      try {
        await i.showModal(
          new ModalBuilder()
            .setCustomId(customId)
            .setTitle(tr("commands.webhook.composeTitle"))
            .addLabelComponents(
              new LabelBuilder()
                .setLabel(tr("commands.webhook.options.content"))
                .setTextInputComponent((input) =>
                  input
                    .setCustomId("content")
                    .setStyle(TextInputStyle.Paragraph)
                    .setRequired(true)
                    .setMaxLength(2000)
                    .setPlaceholder(tr("commands.webhook.contentPlaceholder")),
                ),
              new LabelBuilder()
                .setLabel(tr("commands.webhook.options.username"))
                .setTextInputComponent((input) =>
                  input
                    .setCustomId("username")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(80)
                    .setPlaceholder(tr("commands.webhook.usernamePlaceholder")),
                ),
              new LabelBuilder()
                .setLabel(tr("commands.webhook.options.avatar"))
                .setTextInputComponent((input) =>
                  input
                    .setCustomId("avatar_url")
                    .setStyle(TextInputStyle.Short)
                    .setRequired(false)
                    .setMaxLength(400)
                    .setPlaceholder("https://…"),
                ),
            ),
        );
      } catch (error) {
        if (/AlreadyAcknowledged|409/i.test(String(error?.message || error))) return;
        throw error;
      }
      return;
    }

    return i.reply({ content: tr("commands.webhook.unknownSub"), ephemeral: true });
  });

  client.component(/^sanad:webhook:del:(.+)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireManage(i, tr))) return;
    const id = i.customId.split(":").pop();
    try {
      await assertWebhookInServer(client, i.serverId, id);
      await client.rest.delete(`/webhooks/${id}`);
      deleteWebhookSecret(id);
      return i.update({
        content: tr("commands.webhook.deleted", { id }),
        components: [],
        embeds: [],
      });
    } catch (error) {
      if (error?.code === "WebhookNotInServer") {
        return i.update({ content: tr("commands.webhook.notInServer"), components: [], embeds: [] });
      }
      return i.update({
        content: tr("commands.webhook.apiError", { error: errMsg(error) }),
        components: [],
      });
    }
  });

  client.component("sanad:webhook:cancel", async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    return i.update({ content: tr("common.cancel"), components: [], embeds: [] });
  });

  client.modal(/^sanad:webhook:compose:(.+)$/, async (i) => {
    const { t: tr } = guildT(i.serverId, i.locale);
    if (!(await requireManage(i, tr))) return;
    const id = i.customId.split(":").pop();
    try {
      await assertWebhookInServer(client, i.serverId, id);
    } catch (error) {
      if (error?.code === "WebhookNotInServer") return notInServerReply(i, tr);
      return i.reply({
        content: tr("commands.webhook.apiError", { error: errMsg(error) }),
        ephemeral: true,
      });
    }
    const token = await resolveToken(id, i.serverId, null);
    if (!token) {
      return i.reply({ content: tr("commands.webhook.needToken", { id }), ephemeral: true });
    }
    let content = "";
    let username = "";
    let avatarUrl = "";
    try {
      content = (i.fields.getTextInputValue("content") || "").trim();
    } catch {
      content = "";
    }
    try {
      username = (i.fields.getTextInputValue("username") || "").trim();
    } catch {
      username = "";
    }
    try {
      avatarUrl = (i.fields.getTextInputValue("avatar_url") || "").trim();
    } catch {
      avatarUrl = "";
    }
    if (!content) {
      return i.reply({ content: tr("commands.webhook.emptyPayload"), ephemeral: true });
    }
    const body = { content: content.slice(0, 2000) };
    if (username) body.username = username.slice(0, 80);
    if (avatarUrl) body.avatar_url = avatarUrl;
    try {
      await executeWebhook(client, id, token, body, { wait: true });
      return i.reply({ content: tr("commands.webhook.sent"), ephemeral: true });
    } catch (error) {
      return i.reply({
        content: tr("commands.webhook.apiError", { error: errMsg(error) }),
        ephemeral: true,
      });
    }
  });
}
