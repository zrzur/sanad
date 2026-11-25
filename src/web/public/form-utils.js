// Pure form checks shared by the dashboard and its tests.
export function checkNumbers(fields) {
  for (const field of fields) {
    if (field.type !== 'number') continue;
    const value = Number(field.value);
    const min = field.path === 'starboard.threshold' ? 1 : 0;
    const max = field.path === 'starboard.threshold' ? 50 : 86400;
    if (!String(field.value).trim() || !Number.isInteger(value) || value < min || value > max) {
      return {path: field.path, min, max};
    }
  }
  const low = fields.find(field => field.path === 'leveling.xpMin');
  const high = fields.find(field => field.path === 'leveling.xpMax');
  if (low && high && Number(low.value) > Number(high.value)) return {path:low.path, order:true};
  return null;
}
export function mergeSavedFields(baseline, saved) {
  const changed = new Map(saved);
  return baseline.map(([key,value]) => [key,changed.has(key) ? changed.get(key) : value]);
}
