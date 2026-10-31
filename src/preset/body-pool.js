// Weighted body-type pool for the Prime 体型随机 entry. Weights are relative
// integers; the pool is drawn locally each time its short macro expands.

export const BODY_POOL_MAX_WEIGHT = 10;
export const BODY_POOL_DRAWS = 3;

export const BODY_POOL_GROUPS = Object.freeze([
  Object.freeze({ key: 'female_build', label: '女性体格', options: Object.freeze([['骨感', 1], ['纤细', 6], ['匀称', 8], ['健美', 3], ['丰腴', 4], ['微胖', 1]]) }),
  Object.freeze({ key: 'female_bust', label: '女性胸型', options: Object.freeze([['平坦', 1], ['小巧', 3], ['适中', 4], ['丰满', 3], ['巨乳', 1]]) }),
  Object.freeze({ key: 'male_build', label: '男性体格', options: Object.freeze([['瘦削', 1], ['匀称', 6], ['精壮', 5], ['魁梧', 3], ['敦实', 2], ['肥胖', 1]]) }),
]);

const groupByKey = new Map(BODY_POOL_GROUPS.map(group => [group.key, group]));

function defaultGroup(group) {
  return Object.fromEntries(group.options.map(([name, weight]) => [name, weight]));
}

export function defaultBodyPool() {
  return Object.fromEntries(BODY_POOL_GROUPS.map(group => [group.key, defaultGroup(group)]));
}

function validWeight(value) {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return Number.isSafeInteger(number) && number >= 0 && number <= BODY_POOL_MAX_WEIGHT ? number : null;
}

// Unknown options are dropped, missing or invalid weights fall back to the
// default, and a group whose weights are all zero returns to its defaults.
export function normalizeBodyPool(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return Object.fromEntries(BODY_POOL_GROUPS.map(group => {
    const raw = source[group.key] && typeof source[group.key] === 'object' ? source[group.key] : {};
    const weights = Object.fromEntries(group.options.map(([name, fallback]) => [name, validWeight(raw[name]) ?? fallback]));
    return [group.key, Object.values(weights).some(weight => weight > 0) ? weights : defaultGroup(group)];
  }));
}

export function bodyPoolShares(weights) {
  const entries = Object.entries(weights ?? {});
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  return Object.fromEntries(entries.map(([name, weight]) => [name, total > 0 ? Math.round(weight / total * 100) : 0]));
}

export function pickWeighted(weights, random = Math.random) {
  const entries = Object.entries(weights ?? {}).filter(([, weight]) => weight > 0);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return '';
  let point = random() * total;
  for (const [name, weight] of entries) {
    point -= weight;
    if (point < 0) return name;
  }
  return entries[entries.length - 1][0];
}

export function drawBodyPool(pool, gender, random = Math.random) {
  const value = normalizeBodyPool(pool);
  const items = Array.from({ length: BODY_POOL_DRAWS }, () => gender === 'female'
    ? `${pickWeighted(value.female_build, random)}·${pickWeighted(value.female_bust, random)}`
    : pickWeighted(value.male_build, random));
  return `[${items.join(', ')}]`;
}

export function setBodyPoolWeight(pool, groupKey, option, rawWeight) {
  const group = groupByKey.get(groupKey);
  if (!group || !group.options.some(([name]) => name === option)) throw new Error('不支持的体型选项。');
  const weight = validWeight(rawWeight);
  if (weight === null) throw new Error(`体型权重须为 0～${BODY_POOL_MAX_WEIGHT} 的整数。`);
  const next = normalizeBodyPool(pool);
  next[groupKey] = { ...next[groupKey], [option]: weight };
  if (!Object.values(next[groupKey]).some(value => value > 0)) throw new Error(`${group.label}至少保留一项大于 0。`);
  return next;
}
