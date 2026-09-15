import { tavernContext } from './ambient.js';

export const IDENTITY_MACRO_SOURCE = String.raw`\{\{\s*(user|char|group|charIfNotGroup)\s*\}\}|<(user|char|bot|group|charIfNotGroup)>`;

// Resolve names at request time, never while saving reusable prompt templates.
export function captureIdentityValues() {
  const st = tavernContext(), ctx = st?.getContext?.() ?? st ?? {};
  const values = { user: st?.name1 ?? ctx.name1 ?? 'User', char: st?.name2 ?? ctx.name2 ?? 'Character' };
  const owner = typeof st?.substituteParams === 'function' ? st : ctx;
  for (const name of ['group', 'charIfNotGroup']) {
    const token = `{{${name}}}`;
    // Only evaluate a known, side-effect-free name macro, not an entire prompt.
    const result = owner?.substituteParams?.(token);
    values[name.toLowerCase()] = typeof result === 'string' && result !== token ? result : values.char;
  }
  return values;
}

export function identityMacroValue(name, values) {
  const key = name.toLowerCase() === 'bot' ? 'char' : name.toLowerCase();
  return values[key] ?? (key === 'charifnotgroup' ? values.charIfNotGroup : undefined);
}

export function expandIdentityMacros(text, values) {
  let names = values;
  return String(text ?? '').replace(new RegExp(IDENTITY_MACRO_SOURCE, 'gi'), (whole, curly, legacy) => {
    names ??= captureIdentityValues();
    return identityMacroValue(curly ?? legacy, names) ?? whole;
  });
}
