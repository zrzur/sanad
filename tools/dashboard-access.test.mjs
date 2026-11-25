import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual server guards without starting OAuth, loading .env, or touching data/.
const source = readFileSync(new URL('../src/web/oauthServer.js', import.meta.url), 'utf8');
const start = source.indexOf('function userCanAccessServer(');
const end = source.indexOf('function botError(');
assert.ok(start > 0 && end > start, 'Access guard source boundaries exist');
function harness(routes, owners = []) {
  const context = {
    BOT_TOKEN: 'test-only', API: 'https://test.invalid', OWNERS: new Set(owners),
    PERM: { ManageServer: 2n, Administrator: 70368744177664n },
    send(response, status, body) { Object.assign(response, { status, body }); },
    async fetch(url) {
      const path = new URL(url).pathname;
      const result = routes[path];
      if (!result) return { ok:false, status:404, json:async () => ({type:'NotFound'}) };
      return { ok: !result.status || result.status < 400, status:result.status || 200, json:async () => result.body || result };
    },
  };
  return runInNewContext(source.slice(start,end) + '\n({manageableServers, assertManage})',context);
}
const session = (servers, id = 'me') => ({ user:{_id:id}, servers });

test('owned server without the bot is an invite entry, not a manageable server', async () => {
  const api = harness({});
  const result = await api.manageableServers(session([{_id:'absent',name:'My server',owner:'me'}]));
  assert.equal(result.length,1);
  assert.equal(result[0].botPresent,false);
  const response = {};
  assert.equal(await api.assertManage(response,session([{_id:'absent',owner:'me'}]),'absent'),false);
  assert.equal(response.body.error,'bot_not_in_server');
});
test('unverified OAuth membership stays visible without configuration access', async () => {
  const api = harness({});
  const result = await api.manageableServers(session([{_id:'absent',owner:'someone-else'}]));
  assert.equal(result.length,1);
  assert.equal(result[0].botPresent,null);
  assert.equal(await api.assertManage({},session([{_id:'absent',owner:'someone-else'}]),'absent'),false);
});
test('temporary API failure does not claim the bot is absent', async () => {
  const api = harness({'/servers/retry':{status:503,body:{type:'Unavailable'}}});
  const result = await api.manageableServers(session([{_id:'retry',owner:'me'}]));
  assert.equal(result[0].botPresent,null);
});
test('permission failures are not mistaken for confirmed bot absence', async () => {
  const api = harness({'/servers/denied':{status:403,body:{type:'Forbidden'}}});
  const user = session([{id:'denied',owner:'me'}]);
  assert.equal((await api.manageableServers(user))[0].botPresent,null);
  const response = {};
  assert.equal(await api.assertManage(response,user,'denied'),false);
  assert.equal(response.body.error,'bot_access_denied');
});
test('configured dashboard owners still cannot configure a server without the bot', async () => {
  const api = harness({},['me']);
  const response = {};
  assert.equal(await api.assertManage(response,session([{id:'absent'}]),'absent'),false);
  assert.equal(response.status,403);
});
test('server owners and members with Manage Server get available entries', async () => {
  const api = harness({
    '/servers/owned':{owner:'me'},
    '/servers/staff':{owner:'another',roles:{staff:{permissions:{a:2,d:0}}}},
    '/servers/staff/members/me':{roles:['staff']},
    '/servers/plain':{owner:'another',roles:{}},
    '/servers/plain/members/me':{roles:[]},
  });
  const user = session([{id:'owned'},{id:'staff'},{id:'plain'}]);
  const entries = await api.manageableServers(user);
  assert.equal(entries.length,2);
  assert.equal(entries.every(entry => entry.botPresent === true),true);
  assert.equal(await api.assertManage({},user,'owned'),true);
  assert.equal(await api.assertManage({},user,'staff'),true);
  const denied = {};
  assert.equal(await api.assertManage(denied,user,'plain'),false);
  assert.equal(denied.body.error,'need_manage_server');
});
test('administrator without the Manage Server bit can configure the server', async () => {
  const api = harness({
    '/servers/admin': { owner: 'another', roles: { lead: { rank: 10, permissions: { a: 70368744177664, d: 0 } } } },
    '/servers/admin/members/me': { roles: ['lead'] },
  });
  const user = session([{ id: 'admin' }]);
  assert.equal((await api.manageableServers(user)).length, 1);
  assert.equal(await api.assertManage({}, user, 'admin'), true);
});
test('OAuth server scope remains mandatory, including for configured owners', async () => {
  const api = harness({'/servers/foreign':{owner:'me'}},['me']);
  const response = {};
  assert.equal(await api.assertManage(response,session([]),'foreign'),false);
  assert.equal(response.body.error,'forbidden');
});
test('anonymous requests remain unauthorized', async () => {
  const api = harness({});
  const response = {};
  assert.equal(await api.assertManage(response,null,'any'),false);
  assert.equal(response.status,401);
});
