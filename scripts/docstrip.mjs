/** Minimal DocStrip extractor for vendored CTAN .dtx packages. */

export function evalGuard(expr, opts) {
  const tokens = expr.replace(/\s+/g, "");
  let i = 0;
  function parseOr() {
    let v = parseAnd();
    while (tokens[i] === "|") {
      i++;
      v = v || parseAnd();
    }
    return v;
  }
  function parseAnd() {
    let v = parseUnary();
    while (tokens[i] === "&") {
      i++;
      v = v && parseUnary();
    }
    return v;
  }
  function parseUnary() {
    if (tokens[i] === "!") {
      i++;
      return !parseUnary();
    }
    if (tokens[i] === "(") {
      i++;
      const v = parseOr();
      if (tokens[i] === ")") i++;
      return v;
    }
    let name = "";
    while (i < tokens.length && /[A-Za-z0-9_-]/.test(tokens[i])) name += tokens[i++];
    return opts.has(name);
  }
  return parseOr();
}

/**
 * DocStrip guard syntax (asterisk inside brackets):
 *   %<*foo> ... %</foo>     block include when foo is selected
 *   %<foo>code              single-line include
 *   %<<name ... %name       verbatim (strip one leading %)
 */
export function docstrip(src, optionList) {
  const opts = new Set(optionList);
  const lines = src.split(/\r?\n/);
  const out = [];
  const stack = [];
  let include = true;
  let verbatimEnd = null;

  for (const line of lines) {
    if (verbatimEnd) {
      if (line.startsWith("%" + verbatimEnd)) {
        verbatimEnd = null;
        continue;
      }
      // DocStrip verbatim keeps line as-is after removing one leading %
      out.push(line.startsWith("%") ? line.slice(1) : line);
      continue;
    }

    // Block start: %<*expr>
    const mStart = line.match(/^%<\*([^>]+)>/);
    if (mStart) {
      const ok = evalGuard(mStart[1], opts);
      stack.push(include);
      include = include && ok;
      continue;
    }
    // Block end: %</expr>
    const mEnd = line.match(/^%<\/([^>]+)>/);
    if (mEnd) {
      include = stack.length ? stack.pop() : true;
      continue;
    }
    // Verbatim: %<<name
    const mVerb = line.match(/^%<<([A-Za-z0-9_-]+)/);
    if (mVerb) {
      if (include) verbatimEnd = mVerb[1];
      continue;
    }
    // Single-line: %<expr>rest  (must not match %<* or %</)
    const mLine = line.match(/^%<([^*>][^>]*)>(.*)$/);
    if (mLine) {
      if (include && evalGuard(mLine[1], opts)) out.push(mLine[2]);
      continue;
    }
    if (!include) continue;
    if (line.startsWith("%%")) {
      out.push(line.slice(1));
      continue;
    }
    // Guard-only meta lines
    if (/^%(\s|$)/.test(line) || line.startsWith("% ")) {
      if (line.startsWith("% ")) out.push("%" + line.slice(1));
      else if (line === "%") out.push("%");
      continue;
    }
    if (line.startsWith("%")) continue;
    out.push(line);
  }
  return out.join("\n") + "\n";
}
