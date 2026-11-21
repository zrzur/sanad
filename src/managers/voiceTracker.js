/** Tracks which voice channel each user is in (per bot client). */
const byClient = new WeakMap();

function store(client) {
  let map = byClient.get(client);
  if (!map) {
    map = new Map(); // userId → channelId
    byClient.set(client, map);
  }
  return map;
}

export function attachVoiceTracker(client) {
  if (client.__sanadVoiceTracker) return;
  client.__sanadVoiceTracker = true;
  const map = store(client);

  client.on("Ready", (packet) => {
    map.clear();
    for (const ch of packet?.voice_states ?? []) {
      for (const p of ch.participants ?? []) {
        if (p?.id) map.set(p.id, ch.id);
      }
    }
  });

  client.on("VoiceChannelJoin", (packet) => {
    const userId = packet.state?.id;
    if (userId && packet.id) map.set(userId, packet.id);
  });

  client.on("VoiceChannelLeave", (packet) => {
    if (packet.user) map.delete(packet.user);
  });

  client.on("VoiceChannelMove", (packet) => {
    if (packet.user && packet.to) map.set(packet.user, packet.to);
  });
}

export function getUserVoiceChannel(client, userId) {
  return store(client).get(userId) ?? null;
}
