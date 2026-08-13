/** Rewrite journal title-page macros into commands Pandoc's LaTeX reader keeps. */

const JOURNAL_TITLE_PAGE_RE =
  /\\author\*|\\author\s*\[|\\fnm\{|\\affil(?:\*|\s*\[)|\\ead\{|\\cortext|\\email\{|\\abstract\{/;

function skipSpaceAndComments(source, index) {
  let i = index;
  while (i < source.length) {
    if (source[i] === "%" && (i === 0 || source[i - 1] !== "\\")) {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (/\s/.test(source[i])) {
      i += 1;
      continue;
    }
    break;
  }
  return i;
}

function readDelimited(source, index, open, close) {
  const start = skipSpaceAndComments(source, index);
  if (source[start] !== open) return null;
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "%") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return { end: i + 1, inner: source.slice(start + 1, i) };
      }
    }
    i += 1;
  }
  return null;
}

function readCommand(source, index, name) {
  const match = source.slice(index).match(new RegExp(`^\\\\${name}(\\*)?`));
  if (!match) return null;
  let i = index + match[0].length;
  const starred = match[1] === "*";
  const optional = readDelimited(source, i, "[", "]");
  if (optional) i = optional.end;
  const argument = readDelimited(source, i, "{", "}");
  if (!argument) return null;
  return {
    start: index,
    end: argument.end,
    starred,
    optional: optional?.inner ?? "",
    body: argument.inner,
  };
}

function unwrapMacros(text) {
  const names = [
    "fnm",
    "sur",
    "orgdiv",
    "orgname",
    "orgaddress",
    "street",
    "city",
    "postcode",
    "state",
    "country",
  ];
  let current = text;
  let previous;
  do {
    previous = current;
    for (const name of names) {
      current = current.replace(new RegExp(`\\\\${name}\\{([^{}]*)\\}`, "g"), "$1");
    }
  } while (current !== previous);
  return current
    .replace(/\\\\/g, ", ")
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .replace(/^[, ]+|[, ]+$/g, "")
    .trim();
}

function findCommands(source, name) {
  const found = [];
  let i = 0;
  while (i < source.length) {
    if (source[i] === "%" && (i === 0 || source[i - 1] !== "\\")) {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (source[i] === "\\" && source.startsWith(name, i + 1)) {
      const next = source[i + 1 + name.length];
      if (!next || /[^A-Za-z]/.test(next)) {
        const command = readCommand(source, i, name);
        if (command) {
          found.push(command);
          i = command.end;
          continue;
        }
      }
    }
    i += 1;
  }
  return found;
}

function replaceSpan(source, start, end, replacement) {
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function prepareLatexForWordExport(source) {
  if (!JOURNAL_TITLE_PAGE_RE.test(source)) return source;

  const titles = findCommands(source, "title");
  const authors = findCommands(source, "author");
  const emails = findCommands(source, "email");
  const eads = findCommands(source, "ead");
  const affils = findCommands(source, "affil");
  const abstracts = findCommands(source, "abstract");
  const keywords = findCommands(source, "keywords");
  const equalConts = findCommands(source, "equalcont");
  if (titles.length === 0 && authors.length === 0 && abstracts.length === 0) return source;

  const authorLines = authors.map((author, index) => {
    const name = unwrapMacros(author.body) || `Author ${index + 1}`;
    const marks = author.optional ? `$^{${author.optional}}$` : "";
    const contact = [...emails, ...eads].find(
      (item) => item.start >= author.end && (authors[index + 1] ? item.start < authors[index + 1].start : true),
    );
    const notes = [];
    if (author.starred) notes.push("Corresponding author");
    if (contact) notes.push(`E-mail: ${unwrapMacros(contact.body)}`);
    const thanks = notes.length > 0 ? `\\thanks{${notes.join(". ")}}` : "";
    return `${name}${marks}${thanks}`;
  });

  const affilLines = affils.map((affil) => {
    const mark = affil.optional ? `$^{${affil.optional}}$` : "";
    return `${mark}${unwrapMacros(affil.body)}`;
  });

  const parts = [];
  if (titles[0]) parts.push(`\\title{${unwrapMacros(titles[0].body)}}`);
  if (authorLines.length > 0) parts.push(`\\author{${authorLines.join(" \\and ")}}`);
  if (equalConts[0]) parts.push(`\\thanks{${unwrapMacros(equalConts[0].body)}}`);
  if (abstracts[0]) parts.push(`\\begin{abstract}\n${abstracts[0].body.trim()}\n\\end{abstract}`);
  if (keywords[0]) parts.push(`\\noindent\\textbf{Keywords.} ${unwrapMacros(keywords[0].body)}`);
  if (affilLines.length > 0) parts.push(affilLines.join("\\\\\n"));

  const spans = [...titles, ...authors, ...emails, ...eads, ...affils, ...abstracts, ...keywords, ...equalConts]
    .sort((a, b) => b.start - a.start);
  let next = source;
  for (const span of spans) {
    next = replaceSpan(next, span.start, span.end, "");
  }
  const begin = next.search(/\\begin\s*\{\s*document\s*\}/);
  if (begin < 0) return `${parts.join("\n")}\n${next}`;
  const insertAt = next.indexOf("}", begin) + 1;
  return `${next.slice(0, insertAt)}\n${parts.join("\n")}\n${next.slice(insertAt)}`;
}
