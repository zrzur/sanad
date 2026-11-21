/**
 * Effective permission bits for a Zrzur server member.
 * Role.permissions is OverrideField { a, d }.
 * Called from src/core/createBot.js message handler (prefix ctx.has).
 * No existing util covered this — logic lived only inline in createBot.
 */
export async function memberPermissionBits(client, serverId, userId) {
  try {
    const server = await client.rest.get(`/servers/${serverId}`);
    if (server?.owner === userId) return ~0n;
    const me = await client.rest.get(`/servers/${serverId}/members/${userId}`);
    const member = me?.member ?? me;
    const roleMap = server?.roles && typeof server.roles === "object" ? server.roles : {};
    const mine = new Set(member?.roles || []);
    let bits = BigInt(server?.default_permissions || 0);
    for (const [roleId, role] of Object.entries(roleMap)) {
      if (!mine.has(roleId) && !mine.has(role?._id) && !mine.has(role?.id)) continue;
      const allow = role?.permissions?.a ?? role?.permissions ?? 0;
      const deny = role?.permissions?.d ?? 0;
      bits |= BigInt(allow || 0);
      bits &= ~BigInt(deny || 0);
    }
    return bits;
  } catch {
    return 0n;
  }
}

export async function memberHasPermission(client, serverId, userId, permission) {
  if (permission == null) return true;
  const bits = await memberPermissionBits(client, serverId, userId);
  return (bits & BigInt(permission)) === BigInt(permission);
}
