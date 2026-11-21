import { ApiError } from "@zrzur/sdk/bot";
import { mentionUser } from "../brand.js";
import { getGuild } from "../db/store.js";
import { fillTemplate } from "../util/format.js";
import { guildT } from "../util/locale.js";

async function serverMeta(client, serverId, tr) {
  let count = "?";
  let serverName = tr("welcome.serverFallback");
  try {
    const server = await client.rest.get(`/servers/${serverId}`);
    serverName = server.name ?? serverName;
    count = server.member_count ?? server.members ?? "?";
  } catch {
    /* ignore */
  }
  return { serverName, count };
}

export function registerWelcome(client) {
  client.onMemberJoin(async ({ serverId, userId }) => {
    if (userId === client.user?.id || userId === client.user?._id) return;
    // Only main instance greets — avoids double welcome from child bots
    if (client.__sanad && client.__sanad.isMain === false) return;

    const cfg = getGuild(serverId);
    const { t: tr } = guildT(serverId);

    for (const roleId of cfg.autorole.roleIds) {
      await client.members.addRole(serverId, userId, roleId).catch(() => {});
    }

    const { serverName, count } = await serverMeta(client, serverId, tr);

    if (cfg.welcome.enabled && cfg.welcome.channelId) {
      const content = fillTemplate(cfg.welcome.message || tr("welcome.default"), {
        user: mentionUser(userId),
        server: serverName,
        count,
      });
      try {
        await client.send(cfg.welcome.channelId, content);
      } catch (error) {
        if (!(error instanceof ApiError && error.type === "MissingPermission")) {
          console.warn("[sanad:welcome]", error?.message || error);
        }
      }
    }

    // Explicit dm string wins; empty string disables DM; unset → default DM when welcome is on
    const dmTemplate =
      cfg.welcome.dm === ""
        ? null
        : cfg.welcome.dm != null
          ? cfg.welcome.dm
          : cfg.welcome.enabled
            ? tr("welcome.defaultDm")
            : null;
    if (dmTemplate) {
      const text = fillTemplate(dmTemplate, {
        user: mentionUser(userId),
        server: serverName,
        count,
      });
      await client.users.sendDM(userId, text).catch(() => {});
    }
  });

  client.onMemberLeave(async ({ serverId, userId }) => {
    if (client.__sanad && client.__sanad.isMain === false) return;
    const cfg = getGuild(serverId);
    if (!cfg.goodbye.enabled || !cfg.goodbye.channelId) return;
    const { t: tr } = guildT(serverId);
    const { serverName, count } = await serverMeta(client, serverId, tr);
    const content = fillTemplate(cfg.goodbye.message || tr("welcome.goodbye"), {
      user: mentionUser(userId),
      server: serverName,
      count,
    });
    try {
      await client.send(cfg.goodbye.channelId, content);
    } catch (error) {
      if (!(error instanceof ApiError && error.type === "MissingPermission")) {
        console.warn("[sanad:goodbye]", error?.message || error);
      }
    }
  });
}
