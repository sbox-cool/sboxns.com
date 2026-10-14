// Extracts the public HTTP routes from the server's ASP.NET endpoint files and
// cross-checks them against the parity corpus. Unknown corpus routes fail the build.
const METHOD_OF = { Get: 'GET', Post: 'POST', Put: 'PUT', Patch: 'PATCH', Delete: 'DELETE' };

function lineOf(text, index) {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

function stringLiterals(s) {
  return [...s.matchAll(/"([^"]*)"/g)].map((m) => m[1]);
}

// Parses `string[] NAME = [...]` / `new[] {...}` arrays into name -> values.
function parseArrays(text) {
  const arrays = new Map();
  for (const m of text.matchAll(/string\[\]\s+(\w+)\s*=\s*([\s\S]*?);/g)) {
    arrays.set(m[1], stringLiterals(m[2]));
  }
  for (const m of text.matchAll(/HttpMethods\.(\w+)/g)) void m;
  return arrays;
}

function resolveMethods(token, arrays, text) {
  if (token === 'Methods' || arrays.has(token)) return arrays.get(token);
  if (token.startsWith('[')) return [...token.matchAll(/HttpMethods\.(\w+)/g)].map((m) => m[1].toUpperCase());
  return null;
}

// Expands `foreach (var prefix in NAME)` loops around `$"{prefix}/..."` routes.
function foreachPrefixes(text, index, varName, arrays) {
  const before = text.slice(0, index);
  const re = new RegExp(`foreach\\s*\\(\\s*var\\s+${varName}\\s+in\\s+(\\w+)\\s*\\)`, 'g');
  let last = null;
  for (const m of before.matchAll(re)) last = m;
  if (!last) return null;
  return arrays.get(last[1]) ?? null;
}

export function extractRoutes(files) {
  // files: [{ path, text }] for the server's Endpoints directory.
  const routes = [];
  const skipped = [];
  for (const { path, text } of files) {
    const arrays = parseArrays(text);
    // Literal and interpolated route calls: MapGet("...") / MapMethods("...", Methods, ...) / MapManagementMutation(endpoints, [HttpMethods.X], "...").
    // The pattern argument is matched alone; MapMethods reads its method list from the next
    // argument only (never past the closing parenthesis), so one call cannot swallow the next.
    const callRe = /\.(Map(?:Get|Post|Put|Patch|Delete|Methods))\(\s*(?:\$?"([^"]*)"|([\w.]+))/g;
    const mmRe = /MapManagementMutation\(\s*\w+\s*,\s*(\[[^\]]*\]|\w+)\s*,\s*"([^"]*)"/g;
    const hits = [];
    for (const m of text.matchAll(callRe)) {
      const methodsToken = m[1] === 'MapMethods'
        ? /^\s*,\s*(\[[^\]]*\]|\w+)/.exec(text.slice(m.index + m[0].length))?.[1]
        : undefined;
      hits.push({ index: m.index, kind: m[1], literal: m[2], variable: m[3], methodsToken });
    }
    for (const m of text.matchAll(mmRe)) {
      hits.push({ index: m.index, kind: 'MapManagement', literal: m[2], methodsToken: m[1].trim() });
    }
    for (const hit of hits) {
      const line = lineOf(text, hit.index);
      if (hit.literal === undefined || hit.literal === null) {
        skipped.push({ path, line, reason: `dynamic pattern ${hit.variable ?? '?'}` });
        continue;
      }
      let methods;
      if (hit.kind === 'MapMethods' || hit.kind === 'MapManagement') {
        methods = resolveMethods(hit.methodsToken ?? '', arrays, text);
        if (!methods) { skipped.push({ path, line, reason: 'unresolved methods' }); continue; }
      } else {
        methods = [METHOD_OF[hit.kind.slice(3)]];
      }
      const templates = [];
      const interp = /^\{(\w+)\}(.*)$/.exec(hit.literal);
      if (interp) {
        const prefixes = foreachPrefixes(text, hit.index, interp[1], arrays);
        if (!prefixes) { skipped.push({ path, line, reason: `unresolved prefix ${interp[1]}` }); continue; }
        for (const p of prefixes) templates.push(p + interp[2].replace(/\{\{/g, '{').replace(/\}\}/g, '}'));
      } else {
        templates.push(hit.literal);
      }
      for (const t of templates) {
        for (const method of methods) {
          routes.push({ method, template: t, file: path, line, kind: hit.kind });
        }
      }
    }
  }
  // Dedupe on method + template, keeping the first declaration.
  const seen = new Map();
  for (const r of routes) {
    const key = `${r.method} ${r.template}`;
    if (!seen.has(key)) seen.set(key, r);
  }
  return { routes: [...seen.values()], skipped };
}

function segments(p) {
  return p.replace(/^\/+/, '').split('/').filter((s) => s.length > 0);
}

// Returns {score} if the concrete request path matches the route template.
function matchTemplate(template, reqPath) {
  const t = segments(template);
  const r = segments(reqPath);
  let score = 0;
  for (let i = 0; i < t.length; i++) {
    const seg = t[i];
    if (seg.startsWith('{**')) return i === t.length - 1 ? { score } : null;
    if (i >= r.length) return null;
    if (seg.startsWith('{')) continue;
    if (seg !== r[i]) return null;
    score++;
  }
  return t.length === r.length ? { score } : null;
}

export function matchRoute(routes, method, reqPath) {
  let best = null;
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = matchTemplate(route.template, reqPath);
    if (!m) continue;
    if (!best || m.score > best.score) best = { route, score: m.score };
  }
  return best ? best.route : null;
}

// Corpus placeholders become concrete values so they match templates.
export function concretePath(p) {
  return p.replace(/\$\{[^}]+\}/g, 'X').split('?')[0];
}

export function crossCheckCorpus(routes, corpusFiles) {
  const steps = [];
  for (const { file, doc } of corpusFiles) {
    for (const scenario of doc.scenarios ?? []) {
      for (const step of scenario.steps ?? []) {
        steps.push({ file, scenario: scenario.name, step, source: scenario.source });
      }
    }
  }
  const unrouted = [];
  const failures = [];
  const matched = new Map();
  for (const entry of steps) {
    const { step } = entry;
    const reqPath = concretePath(step.path);
    const route = matchRoute(routes, step.method, reqPath);
    if (!route) {
      const status = step.expect?.status;
      if (status === 404) unrouted.push(entry);
      else failures.push(`${entry.file} ${entry.scenario}/${step.id}: no route for ${step.method} ${step.path} (expected ${status})`);
      continue;
    }
    const key = `${route.method} ${route.template}`;
    if (!matched.has(key)) matched.set(key, []);
    matched.get(key).push(entry);
  }
  if (failures.length) throw new Error(`corpus routes not found in server source:\n  ${failures.join('\n  ')}`);
  return { matched, unrouted, stepCount: steps.length };
}
