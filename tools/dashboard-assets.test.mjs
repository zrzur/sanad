import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { iconFiles, esc, initial, fileUrl } from '../src/web/public/dashboard-ui.js';

test('every interface icon is available as a local, non-scripted SVG', () => {
  for (const name of new Set(Object.values(iconFiles))) {
    const url = new URL(`../src/web/public/icons/${name}.svg`,import.meta.url);
    assert.ok(existsSync(url),name);
    const svg = readFileSync(url,'utf8');
    assert.match(svg,/<svg\b/);
    assert.doesNotMatch(svg,/<script\b|\bonload\s*=/i);
  }
});
test('both scripts and every used font weight ship valid local WOFF2 files', () => {
  for (const family of ['ibm-plex-sans','ibm-plex-sans-arabic']) {
    for (const weight of [400,500,600,700]) {
      const font = readFileSync(new URL(`../src/web/public/fonts/${family}-${weight}.woff2`,import.meta.url));
      assert.equal(font.subarray(0,4).toString(),'wOF2');
    }
  }
});
test('names remain escaped and initials handle Arabic and supplementary Unicode', () => {
  assert.equal(initial('مجتمع سند'),'مس');
  assert.equal(initial('Zrzur Lounge'),'ZL');
  assert.equal(initial('🎮 Club'),'🎮C');
  assert.equal(esc('<img src="x" onerror=\'bad\'>'),'&lt;img src=&quot;x&quot; onerror=&#39;bad&#39;&gt;');
});
test('CDN IDs remain a single URL path segment', () => {
  assert.equal(fileUrl('avatar',{avatar:{_id:'a/b?x'}}),'https://cdn.zrzur.com/avatars/a%2Fb%3Fx');
});
