// Parses public C# declarations and their /// XML documentation comments.
// Scope: `public` types and their `public` members. Non-public types are skipped.

const TYPE_RE = /^((?:(?:public|internal|private|protected|static|sealed|abstract|partial|readonly|new|unsafe|file)\s+)*)(class|struct|record|interface|enum)\s+([A-Za-z_]\w*)/;
const MEMBER_START_RE = /^public\s/;

function stripStrings(line) {
  return line
    .replace(/\$?@?"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)'/g, "''")
    .replace(/\/\/.*$/, '');
}

function braceDelta(line) {
  let d = 0;
  for (const ch of stripStrings(line)) {
    if (ch === '{') d++;
    else if (ch === '}') d--;
  }
  return d;
}

function tidy(s) {
  return s
    .replace(/\s+/g, ' ')
    .replace(/\s*\(\s*/g, '(')
    .replace(/\s*\)/g, ')')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*<\s*/g, '<')
    .replace(/\s*>/g, '>')
    .trim();
}

// Collects a declaration until the first `{`, `=>` or `;` outside parentheses.
function collectSignature(lines, start) {
  let text = '';
  let parens = 0;
  for (let i = start; i < Math.min(lines.length, start + 25); i++) {
    const code = stripStrings(lines[i]);
    for (let c = 0; c < code.length; c++) {
      const ch = code[c];
      if (ch === '(') parens++;
      else if (ch === ')') parens--;
      else if (parens === 0 && ch === '{') return tidy(text + code.slice(0, c));
      else if (parens === 0 && ch === ';') return tidy(text + code.slice(0, c));
      else if (parens === 0 && ch === '=' && code[c + 1] === '>') return tidy(text + code.slice(0, c));
    }
    text += `${code} `;
  }
  return tidy(text);
}

function classifyMember(sig, typeName) {
  const head = sig.replace(/\s*=.*$/, '');
  const parenIdx = head.indexOf('(');
  const beforeParen = parenIdx >= 0 ? head.slice(0, parenIdx).trim() : head;
  const words = beforeParen.split(/\s+/);
  const name = words.at(-1).replace(/<.*$/, '');
  if (/^(static\s+|public\s+)*event\s/.test(sig)) return { kind: 'event', name: sig.split(/\s+/).at(-1) };
  if (parenIdx >= 0 && name === typeName) return { kind: 'constructor', name };
  if (parenIdx >= 0) return { kind: 'method', name };
  if (/\bconst\b/.test(sig)) return { kind: 'constant', name };
  if (/\{/.test(sig) || /\bget\b/.test(sig)) return { kind: 'property', name };
  return { kind: 'field', name };
}

function shortRef(c) {
  const base = c.replace(/^[A-Z]:/, '');
  const last = base.split('(')[0].split('.').pop();
  return base.includes('(') ? `${last}(...)` : last;
}

function decodeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function dedent(block) {
  const lines = block.replace(/^\n+|\s+$/g, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^\s*/)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

// XML doc comment body -> HTML. Known doc tags become HTML; other text is decoded and escaped.
export function docToHtml(raw) {
  const store = [];
  const hold = (html) => `\u0000${store.push(html) - 1}\u0000`;

  let s = raw;
  s = s.replace(/<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/g, (_, inner) =>
    hold(`<pre><code class="language-csharp">${escapeHtml(dedent(decodeEntities(inner)))}</code></pre>`));
  s = s.replace(/<see\s+cref="([^"]+)"\s*\/>/g, (_, c) => hold(`<code>${escapeHtml(shortRef(c))}</code>`));
  s = s.replace(/<see\s+cref="([^"]+)"\s*>[\s\S]*?<\/see>/g, (_, c) => hold(`<code>${escapeHtml(shortRef(c))}</code>`));
  s = s.replace(/<(?:paramref|typeparamref)\s+name="([^"]+)"\s*\/>/g, (_, n) => hold(`<code>${escapeHtml(n)}</code>`));
  s = s.replace(/<c>([\s\S]*?)<\/c>/g, (_, inner) => hold(`<code>${escapeHtml(decodeEntities(inner))}</code>`));
  s = s.replace(/<list[^>]*>([\s\S]*?)<\/list>/g, (_, inner) => {
    const items = [...inner.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
      const desc = m[1].match(/<description>([\s\S]*?)<\/description>/);
      const term = m[1].match(/<term>([\s\S]*?)<\/term>/);
      const text = desc ? desc[1] : m[1];
      const lead = term ? `<code>${escapeHtml(decodeEntities(term[1].trim()))}</code> ` : '';
      return `<li>${lead}${escapeHtml(decodeEntities(text.replace(/\s+/g, ' ').trim()))}</li>`;
    });
    return hold(`<ul>${items.join('')}</ul>`);
  });
  s = s.replace(/<para>([\s\S]*?)<\/para>/g, (_, inner) =>
    hold(`<p>${escapeHtml(decodeEntities(inner.replace(/\s+/g, ' ').trim()))}</p>`));
  s = s.replace(/<br\s*\/?>/g, () => hold('<br>'));
  s = s.replace(/<\/?(summary|remarks|returns|example|value|note|seealso|exception|param|typeparam|inheritdoc|description|term|item)\b[^>]*>/g, '');

  const blocks = s.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const out = blocks.map((b) => {
    const isBlock = /^\u0000\d+\u0000$/.test(b);
    if (isBlock) return b;
    const text = escapeHtml(decodeEntities(b.replace(/\s*\n\s*/g, ' ')));
    return text ? `<p>${text}</p>` : '';
  }).join('\n');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => store[Number(i)]);
}

function tagInner(raw, tag) {
  const m = raw.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`));
  return m ? m[1] : null;
}

function docParts(lines) {
  const raw = lines.join('\n').trim();
  const params = [...raw.matchAll(/<param\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/param>/g)]
    .map((m) => ({ name: m[1], html: docToHtml(m[2]) }));
  const exceptions = [...raw.matchAll(/<exception\s+cref="([^"]+)"[^>]*>([\s\S]*?)<\/exception>/g)]
    .map((m) => ({ name: shortRef(m[1]), html: docToHtml(m[2]) }));
  const pick = (tag) => {
    const inner = tagInner(raw, tag);
    return inner === null ? '' : docToHtml(inner);
  };
  const summaryRaw = tagInner(raw, 'summary');
  const bare = raw
    .replace(/<param\s[\s\S]*?<\/param>/g, '')
    .replace(/<exception\s[\s\S]*?<\/exception>/g, '')
    .replace(/<(returns|remarks|example)>[\s\S]*?<\/\1>/g, '');
  return {
    summary: docToHtml(summaryRaw === null ? bare : summaryRaw),
    params,
    returns: pick('returns'),
    remarks: pick('remarks'),
    example: pick('example'),
    exceptions,
  };
}

export function parseCSharp(text, relPath) {
  const lines = text.split(/\r?\n/);
  const types = [];
  // Each entry is a type whose body is open or about to open.
  const stack = [];
  let depth = 0;
  let pendingDoc = [];
  let namespace = null;

  // Marks a type's body as opened and pops types whose body has closed.
  const settle = () => {
    for (;;) {
      const top = stack.at(-1);
      if (!top) return;
      if (!top.opened && depth >= top.bodyDepth) top.opened = true;
      if (!top.opened || depth >= top.bodyDepth) return;
      stack.pop();
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith('///')) {
      pendingDoc.push(trimmed.slice(3));
      continue;
    }
    if (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#')) continue;
    if (trimmed.startsWith('[')) {
      depth += braceDelta(line);
      settle();
      continue;
    }

    const nsMatch = /^namespace\s+([\w.]+)/.exec(trimmed);
    if (nsMatch) namespace = nsMatch[1];

    const cur = stack.at(-1);
    // Members sit one level inside their type body; top-level types sit at depth 0 or 1.
    const atBody = cur ? depth === cur.bodyDepth : depth <= 1;
    const typeMatch = TYPE_RE.exec(trimmed);

    if (typeMatch && atBody) {
      const [, mods, kind, name] = typeMatch;
      const isPublic = /\bpublic\b/.test(mods) && (!cur || cur.isPublic);
      const entry = {
        name,
        kind,
        namespace,
        file: relPath,
        line: i + 1,
        isPublic,
        doc: docParts(pendingDoc),
        signature: collectSignature(lines, i),
        members: [],
        values: [],
        bodyDepth: depth + 1,
        opened: false,
      };
      pendingDoc = [];
      if (isPublic) types.push(entry);
      depth += braceDelta(line);
      // A declaration ending in ';' with no brace (e.g. positional record) has no body.
      if (!(trimmed.endsWith(';') && !line.includes('{'))) {
        entry.opened = line.includes('{') && depth >= entry.bodyDepth;
        stack.push(entry);
      }
      settle();
      continue;
    }

    if (cur && atBody && cur.isPublic) {
      if (cur.kind === 'enum') {
        const value = /^([A-Za-z_]\w*)/.exec(trimmed);
        if (value) cur.values.push({ name: value[1], doc: docParts(pendingDoc) });
      } else if (MEMBER_START_RE.test(trimmed)) {
        const sig = collectSignature(lines, i);
        const { kind, name } = classifyMember(sig, cur.name);
        cur.members.push({ kind, name, signature: sig, file: relPath, line: i + 1, doc: docParts(pendingDoc) });
      }
    }
    pendingDoc = [];
    depth += braceDelta(line);
    settle();
  }
  return types;
}
