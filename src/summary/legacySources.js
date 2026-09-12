import { consecutiveSummaries, fingerprint, parseRange, recordValid, sourcesMatch } from './provenance.js';
import { parseSummaryEntryName, parseMegaSummaryEntryName } from './utils.js';

// Old worldbooks can survive without their chat-local mega mapping. Recover only
// an unambiguous, complete partition; never replace known source fingerprints.
export function recoverLegacyMegaSources(entries, megaMap, archive, current) {
  let changed = false, mapChanged = false;
  for (const entry of entries.filter(item => parseMegaSummaryEntryName(item.name))) {
    const range = parseRange(entry.name), record = archive.records[entry.name];
    const missingMap = !Array.isArray(megaMap[entry.name]) || !megaMap[entry.name].length;
    const emptyLegacy = record?.legacy === true && record.committed !== false &&
      Array.isArray(record.sources) && !record.sources.length;
    if (!missingMap && record && !emptyLegacy) continue;
    if (record?.parents?.some(parent => !entries.some(item => item.name === parent.name && fingerprint(item.content ?? '') === parent.fingerprint))) continue;
    const overlaps = entries.filter(item => {
      const part = parseSummaryEntryName(item.name);
      return part && part.start <= range.end && part.end >= range.start;
    });
    const names = missingMap
      ? (record?.parents?.length ? record.parents.map(parent => parent.name) : overlaps.map(item => item.name))
      : megaMap[entry.name];
    let parts;
    try { parts = consecutiveSummaries(names); } catch { continue; }
    if (parts[0].start !== range.start || parts.at(-1).end !== range.end) continue;
    const recordedParents = missingMap && record?.parents?.length;
    if (entries.filter(item => item.name === entry.name).length !== 1 ||
        (!recordedParents && (overlaps.length !== parts.length || overlaps.some(item => !names.includes(item.name))))) continue;
    const parents = parts.map(part => entries.filter(item => item.name === part.name));
    if (parents.some(items => {
      if (items.length !== 1 || !items[0].content?.trim() || !recordValid(items[0], archive, current, entries)) return true;
      const part = parseRange(items[0].name), known = archive.records[items[0].name];
      return known?.sources?.some(source => source.id < part.start || source.id > part.end);
    })) continue;
    const selected = parents.map(items => items[0]);
    const sources = [...new Map(selected.flatMap(parent => {
      const known = archive.records[parent.name];
      if (known) return known.sources ?? [];
      const part = parseRange(parent.name);
      const available = current.filter(source => source.id >= part.start && source.id <= part.end);
      return available.length === part.end - part.start + 1 ? available : [];
    }).map(source => [source.id, source])).values()];
    if (!sourcesMatch(sources, current) || selected.some(parent => {
      const part = parseRange(parent.name);
      return !sources.some(source => source.id >= part.start && source.id <= part.end);
    })) continue;
    if (record && !emptyLegacy && !recordValid(entry, archive, current, entries)) continue;
    if (missingMap) { megaMap[entry.name] = parts.map(part => part.name); mapChanged = true; }
    if (!record || emptyLegacy) {
      archive.records[entry.name] = {
        sources, parents: selected.map(parent => ({ name: parent.name, fingerprint: fingerprint(parent.content) })),
        legacy: true, committed: true, invalid: null,
      };
      changed = true;
    }
  }
  return { changed, mapChanged };
}
