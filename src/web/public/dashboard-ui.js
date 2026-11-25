// Shared presentation helpers. Runtime and API operations live in app.js.
export const iconFiles = {
  home:'house', overview:'grid-nine', automod:'shield-check', community:'users', welcome:'hand-waving',
  tickets:'headset', levels:'medal', starboard:'star', send:'paper-plane-tilt', hooks:'webhooks-logo',
  settings:'gear-six', features:'squares-four', music:'music-note', games:'game-controller', search:'magnifying-glass',
  plus:'plus', chevron:'caret-down', refresh:'arrows-clockwise', globe:'globe', external:'arrow-square-out',
  next:'caret-right', back:'caret-left', logout:'sign-out', check:'check', close:'x', channel:'hash', bell:'bell',
  menu:'list', copy:'copy', save:'floppy-disk', info:'info', lock:'lock-simple', warning:'warning', message:'envelope', folder:'folder', trash:'trash',
};
export function icon(name) {
  return `<span class="icon" style="--icon-url:url(/assets/icons/${iconFiles[name] || iconFiles.features}.svg)" aria-hidden="true"></span>`;
}
export function brandMark(className = '', mood = false) {
  return `<img class="zrzur-mark ${className}" src="/assets/brand/${mood ? 'relaxed' : 'mark-white'}.svg" alt="" width="64" height="64"/>`;
}
export function esc(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
export function initial(name) {
  return (String(name || '?').trim().split(/\s+/).map(part => Array.from(part)[0]).slice(0,2).join('') || '?').toLocaleUpperCase();
}
export function fileUrl(kind, obj) {
  if (typeof obj?.previewIcon === 'string' && obj.previewIcon.startsWith('/assets/')) return obj.previewIcon;
  const id = obj?.[kind]?._id || obj?.[kind]?.id || obj?.[kind];
  return typeof id === 'string' ? `https://cdn.zrzur.com/${kind === 'avatar' ? 'avatars' : 'icons'}/${encodeURIComponent(id)}` : null;
}
export function serverIcon(server, className) {
  const url = fileUrl('icon', server);
  return `<span class="${className}">${url ? `<img src="${esc(url)}" alt="" loading="lazy"/>` : `<bdi>${esc(initial(server?.name))}</bdi>`}</span>`;
}
export function toggle(on, key) {
  return `<button class="toggle ${on ? 'on' : ''}" data-toggle="${esc(key)}" role="switch" aria-checked="${!!on}"></button>`;
}
let rowCount = 0;
export function row(label, hint, control) {
  const id = `field-${++rowCount}`;
  const labelledControl = control.replace(/<(input|select|textarea|button) /, `<$1 aria-labelledby="${id}" `);
  return `<div class="row"><div><div class="label" id="${id}">${label}</div>${hint ? `<div class="hint">${hint}</div>` : ''}</div>${labelledControl}</div>`;
}
