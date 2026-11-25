/** Isolated design preview. Fake data, in-memory changes, no credentials or bot requests. */
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const config = {
  locale: 'ar', prefix: '!', welcome: { enabled: true, channelId: 'welcome', message: 'أهلًا {user} في {server}!' },
  goodbye: { enabled: false }, leveling: { enabled: true, xpMin: 15, xpMax: 25, cooldownSec: 60 },
  tickets: { enabled: true, staffRoleId: 'staff', categoryId: '', logChannelId: 'logs' },
  automod: { enabled: true, antiSpam: true, antiDuplicate: true, antiInvites: true, antiLinks: false,
    antiMassMention: true, antiEmojiSpam: true, antiNewlines: true, antiZalgo: true, antiAttachments: true,
    bypassMods: true, quietAlerts: true, action: 'delete', timeoutSeconds: 300, maxMentions: 5,
    spamCount: 6, badWords: [], allowDomains: [], ignoreChannels: [] },
  antiraid: { enabled: false, joinThreshold: 8, joinWindowSec: 10, lockSeconds: 120 },
  starboard: { enabled: true, threshold: 3, emoji: '⭐' }, suggest: {}, autorole: { roleIds: [] }, modLogChannelId: 'logs',
};
const servers = [
  { id:'lounge', name:'Zrzur Lounge', botPresent:true, previewIcon:'/assets/brand/mark-white.svg' },
  { id:'design', name:'Zrzur Designs', botPresent:true },
  { id:'community', name:'مجتمع سند', botPresent:true },
  { id:'developers', name:'Zrzur Developers', botPresent:true },
  { id:'invite-needed', name:"MAHER X's server", botPresent:false },
  { id:'unavailable', name:'السيرفر التجريبي', botPresent:null },
];
const configs = new Map(servers.map(s => [s.id, structuredClone(config)]));
const channels = ['general', 'welcome', 'announcements', 'support', 'logs', 'suggestions'].map(id => ({ id, name: id }));
const roles = [{ id: 'staff', name: 'Staff' }, { id: 'member', name: 'Member' }, { id: 'muted', name: 'Muted' }];
const hooks = [];
const publicDir = new URL('../src/web/public/', import.meta.url);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  if (url.pathname === '/api/boot') return json({ user: String(req.headers.referer).includes('preview=login') ? null : { username: 'Maher', display_name: 'Maher' }, servers, hidden: 0, invite: 'https://app.zrzur.com/' });
  if (url.pathname.startsWith('/api/servers/')) {
    const [, , , id, kind] = url.pathname.split('/');
    const c = configs.get(id);
    if (!c) return json({ error: 'not_found' }, 404);
    if (servers.find(server => server.id === id)?.botPresent !== true) return json({ error: 'bot_not_in_server' }, 403);
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    if (kind === 'config' && req.method === 'GET') return json(c);
    if (kind === 'toggle' || kind === 'config') {
      const keys = String(body.path).split('.'); let target = c;
      for (const key of keys.slice(0, -1)) target = target[key] ??= {};
      let value = body.value;
      if (['automod.badWords', 'automod.allowDomains', 'autorole.roleIds', 'automod.ignoreChannels'].includes(body.path)) value = String(value || '').split(/[,\n]/).map(v => v.trim()).filter(Boolean);
      target[keys.at(-1)] = kind === 'toggle' ? !target[keys.at(-1)] : value;
      return json(c);
    }
    if (kind === 'channels') return json({ channels });
    if (kind === 'roles') return json({ roles });
    if (kind === 'webhooks') {
      if (req.method === 'POST' && !url.pathname.includes('/webhooks/')) hooks.push({ id: String(hooks.length + 1), name: body.name, channelId: body.channelId, hasToken: true });
      return json({ webhooks: hooks, ok: true });
    }
    if (kind === 'messages') return json({ id: 'preview-message' });
    return json({ error: 'not_found' }, 404);
  }
  const files = { '/': ['index.html', 'text/html'], '/assets/app.js': ['app.js', 'text/javascript'], '/assets/app.css': ['app.css', 'text/css'] };
  let file = files[url.pathname];
  if (!file && url.pathname.startsWith('/assets/')) {
    const relative = url.pathname.slice('/assets/'.length);
    const root = fileURLToPath(publicDir);
    const absolute = resolve(root, relative);
    const type = {'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'}[extname(absolute)];
    if (type && absolute.startsWith(resolve(root) + sep) && existsSync(absolute) && statSync(absolute).isFile()) file = [relative,type];
  }
  if (!file) return json({ error: 'preview_only' }, 404);
  res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store' });
  let content = readFileSync(fileURLToPath(new URL(file[0], publicDir)));
  if (file[0] === 'index.html') content = content.toString().replace('</body>', '<div style="position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:50;pointer-events:none;background:#343044;color:#e6d6e4;border:1px solid #68536a;border-radius:6px;padding:3px 10px;font:11px sans-serif">Design preview · Sample data / بيانات تجريبية</div></body>');
  res.end(content);
});
server.listen(8790, '127.0.0.1', () => console.log('Design preview (sample data only): http://127.0.0.1:8790'));
