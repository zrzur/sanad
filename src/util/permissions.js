/**
 * Effective server permissions, matching @zrzur/sdk serverChannelPermission:
 * the server owner and the Administrator bit grant every safe permission.
 * Role overrides apply lowest rank first. A bad permission value is zero,
 * never a thrown error.
 *
 * Called from src/core/context.js (fromInteraction.has), src/core/createBot.js
 * (prefix ctx.has), and the command modules that check i.has themselves.
 * Reads the Zrzur server document and member role list. Writes nothing.
 */
import { Permission } from "@zrzur/sdk";

export function asBits(value) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  if (value && typeof value === "object") return asBits(value.a ?? value.allow ?? 0);
  return 0n;
}

export function ownerIdOf(server) {
  const owner = server?.owner;
  if (typeof owner === "string" || typeof owner === "number") return String(owner);
  return owner?._id || owner?.id || "";
}

/** True when the held bits include Administrator, or every requested bit. */
export function holds(held, wanted) {
  const bits = asBits(held);
  if ((bits & Permission.Administrator) === Permission.Administrator) return true;
  const need = asBits(wanted);
  return need === 0n || (bits & need) === need;
}

/**
 * Bits for one member of one server. `member.roles` is the role id list.
 * Pass `userId` so the server owner is recognised even with an empty role list.
 */
export function memberRoleBits(server, member, userId) {
  const uid = String(userId || member?._id || member?.id || "");
  if (uid && ownerIdOf(server) === uid) return Permission.GrantAllSafe;
  const roleMap = server?.roles && typeof server.roles === "object" ? server.roles : {};
  const mine = new Set(Array.isArray(member?.roles) ? member.roles.map(String) : []);
  const roles = Object.entries(roleMap)
    .filter(([roleId, role]) => mine.has(roleId) || mine.has(String(role?._id || "")) || mine.has(String(role?.id || "")))
    .sort((a, b) => (Number(a[1]?.rank) || 0) - (Number(b[1]?.rank) || 0));
  let bits = asBits(server?.default_permissions || 0);
  for (const [, role] of roles) {
    const raw = role?.permissions;
    const allow = raw && typeof raw === "object" ? asBits(raw.a ?? raw.allow ?? 0) : asBits(raw);
    const deny = raw && typeof raw === "object" ? asBits(raw.d ?? raw.deny ?? 0) : 0n;
    bits = (bits | allow) & ~deny;
  }
  if ((bits & Permission.Administrator) === Permission.Administrator) return Permission.GrantAllSafe;
  return bits;
}

/** Interaction.has does not treat Administrator as every other bit. This does. */
export function actorHas(interaction, permission, who = "member") {
  if (!interaction || typeof interaction.has !== "function") return false;
  try {
    if (interaction.has(Permission.Administrator, who)) return true;
    return interaction.has(permission, who);
  } catch {
    return false;
  }
}

export async function memberPermissionBits(client, serverId, userId) {
  try {
    const server = await client.rest.get(`/servers/${serverId}`);
    const me = await client.rest.get(`/servers/${serverId}/members/${userId}`);
    return memberRoleBits(server, me?.member ?? me, userId);
  } catch {
    return 0n;
  }
}

export async function memberHasPermission(client, serverId, userId, permission) {
  if (permission == null) return true;
  const bits = await memberPermissionBits(client, serverId, userId);
  return holds(bits, permission);
}
