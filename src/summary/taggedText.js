const tokenPattern = /<!--[\s\S]*?(?:-->|$)|<(\/?)([\w:-]+)(?=[\s/>])(?:"[^"]*"|'[^']*'|[^<>"'])*>/g;

export function scanTaggedText(text) {
  const pattern = new RegExp(tokenPattern);
  const open = new Map(), sections = [], tokens = [];
  let previous;
  for (let match; (match = pattern.exec(text));) {
    const [markup, slash, tag] = match;
    if (!tag) continue;
    const name = tag.toLowerCase();
    const token = { name, start: match.index, end: pattern.lastIndex, closing: !!slash };
    tokens.push(token);
    if (token.closing) {
      const section = open.get(name)?.pop();
      if (section) {
        section.end = token.end;
        section.closeStart = token.start;
      } else token.orphan = true;
    } else {
      const htmlSummary = name === 'summary' && previous?.name === 'details' && !previous.closing &&
        !text.slice(previous.end, token.start).trim();
      const selfClosing = /\/\s*>$/.test(markup);
      const section = { name, start: token.start, openEnd: token.end, end: selfClosing ? token.end : text.length, selfClosing, htmlSummary };
      sections.push(section);
      if (!selfClosing && (name === 'script' || name === 'style')) {
        const close = new RegExp(`</${name}\\s*>`, 'gi');
        close.lastIndex = token.end;
        const end = close.exec(text);
        section.closeStart = end?.index;
        section.end = end ? close.lastIndex : text.length;
        pattern.lastIndex = section.end;
      } else if (!selfClosing) {
        if (!open.has(name)) open.set(name, []);
        open.get(name).push(section);
      }
    }
    previous = token;
  }
  return { sections, tokens };
}

// Ranges arrive in document order. Overlapping or nested cuts are removed once.
export function omitRanges(text, ranges) {
  let output = '', cursor = 0;
  for (const { start, end } of ranges) {
    if (start >= cursor) output += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  return output + text.slice(cursor);
}
