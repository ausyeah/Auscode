const MD_TICK = String.fromCharCode(96);

function isMdTableSep(line) {
  const s = String(line || "").trim().replace(/\|/g, " ").trim();
  if (!s) return false;
  const parts = s.split(/\s+/);
  return parts.length >= 2 && parts.every((part) => /^:?-{3,}:?$/.test(part));
}

function splitMdRow(line) {
  let s = String(line || "").trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function appendText(parent, text) {
  if (text) parent.appendChild(document.createTextNode(text));
}

function takeDelimited(src, start, delim) {
  const end = src.indexOf(delim, start + delim.length);
  if (end < 0) return null;
  return { text: src.slice(start + delim.length, end), next: end + delim.length };
}

/* ---- LaTeX (KaTeX) helpers ---- */

function mathDelimText(tex, displayMode) {
  const l = displayMode ? "$$" : "$";
  const r = displayMode ? "$$" : "$";
  return l + tex + r;
}

function mathInlineEl(tex, displayMode, tag) {
  const el = document.createElement(tag || "span");
  if (displayMode) el.className = "math-display";
  if (window.katex) {
    try {
      window.katex.render(tex, el, { throwOnError: false, displayMode });
      return el;
    } catch (err) { /* fall through to plain text */ }
  }
  el.textContent = mathDelimText(tex, displayMode);
  return el;
}

// Reject false positives like "$5" / "$5–$10" (currency). Require a math-ish
// core (letters, backslash commands, or operators) and no outer whitespace.
// Inner spaces are allowed (e.g. "$x + y$"), so we avoid the "no inner space"
// bluntness that would break legitimate spaced math.
function canBeInlineMath(t) {
  const s = String(t || "");
  if (!s || /^\s|\s$/.test(s)) return false;
  return /[a-zA-Z\\^_{}=<>]/.test(s);
}

// Try to parse an inline math expression starting at index i. Returns
// { node, next } or null.
function tryInlineMath(text, i) {
  if (text.startsWith("\\(", i)) {
    const hit = takeDelimited(text, i, "\\)");
    if (hit && hit.text.trim()) return { node: mathInlineEl(hit.text.trim(), false), next: hit.next };
  } else if (text.startsWith("\\[", i)) {
    const hit = takeDelimited(text, i, "\\]");
    if (hit && hit.text.trim()) return { node: mathInlineEl(hit.text.trim(), true), next: hit.next };
  } else if (text.startsWith("$$", i)) {
    const hit = takeDelimited(text, i, "$$");
    if (hit && hit.text.trim()) return { node: mathInlineEl(hit.text.trim(), true), next: hit.next };
  } else if (text[i] === "$") {
    const hit = takeDelimited(text, i, "$");
    if (hit && canBeInlineMath(hit.text)) {
      // Avoid currency ranges like "$5–$10": opening "$" must not follow a
      // digit and closing "$" must not precede a digit.
      const prev = i > 0 ? text[i - 1] : "";
      const nextCh = hit.next < text.length ? text[hit.next] : "";
      if (!/\d/.test(prev) && !/\d/.test(nextCh)) {
        return { node: mathInlineEl(hit.text.trim(), false), next: hit.next };
      }
    }
  }
  return null;
}

// Try to parse a block-level display math ($$ ... $$ or \[ ... \]) spanning
// lines. Returns { tex, next } or null so the caller can fall back to normal
// markdown when no closing delimiter is present.
function tryBlockMath(lines, i) {
  const trimmed = String(lines[i] || "").trim();
  if (trimmed.startsWith("\\[")) {
    const buf = [];
    const firstRest = trimmed.slice(2).trim();
    if (firstRest) buf.push(firstRest);
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const ln = lines[j];
      const idx = ln.indexOf("\\]");
      if (idx >= 0) {
        if (ln.slice(0, idx).trim()) buf.push(ln.slice(0, idx).trim());
        closed = true;
        j += 1;
        break;
      }
      buf.push(ln);
      j += 1;
    }
    if (!closed) return null;
    return { tex: buf.join("\n").trim(), next: j };
  }
  if (trimmed.startsWith("$$")) {
    if (trimmed.length > 4 && trimmed.endsWith("$$")) {
      return { tex: trimmed.slice(2, -2).trim(), next: i + 1 };
    }
    const buf = [];
    const firstRest = trimmed.slice(2).trim();
    if (firstRest) buf.push(firstRest);
    let j = i + 1;
    let closed = false;
    while (j < lines.length) {
      const lt = String(lines[j] || "").trim();
      const idx = lines[j].lastIndexOf("$$");
      if (lt === "$$" || (idx >= 0 && lt.endsWith("$$") && lt.length > 2)) {
        if (lt !== "$$" && idx >= 0) {
          const before = lines[j].slice(0, idx).trim();
          if (before) buf.push(before);
        }
        closed = true;
        j += 1;
        break;
      }
      buf.push(lines[j]);
      j += 1;
    }
    if (!closed) return null;
    return { tex: buf.join("\n").trim(), next: j };
  }
  return null;
}

function appendInline(parent, src) {
  const text = String(src || "");
  let i = 0;
  while (i < text.length) {
    const mathHit = tryInlineMath(text, i);
    if (mathHit) {
      parent.appendChild(mathHit.node);
      i = mathHit.next;
      continue;
    }
    if (text[i] === MD_TICK) {
      const hit = takeDelimited(text, i, MD_TICK);
      if (hit) {
        const code = document.createElement("code");
        appendText(code, hit.text);
        parent.appendChild(code);
        i = hit.next;
        continue;
      }
    }
    if (text.startsWith("**", i)) {
      const hit = takeDelimited(text, i, "**");
      if (hit) {
        const strong = document.createElement("strong");
        appendText(strong, hit.text);
        parent.appendChild(strong);
        i = hit.next;
        continue;
      }
    }
    if (text[i] === "*" && (i === 0 || text[i - 1] !== "*")) {
      const hit = takeDelimited(text, i, "*");
      if (hit && hit.text.indexOf("\n") < 0) {
        const em = document.createElement("em");
        appendText(em, hit.text);
        parent.appendChild(em);
        i = hit.next;
        continue;
      }
    }
    const nextTick = text.indexOf(MD_TICK, i + 1);
    const nextStar = text.indexOf("*", i + 1);
    const nextDollar = text.indexOf("$", i + 1);
    const nextLParen = text.indexOf("\\(", i + 1);
    const nextLBracket = text.indexOf("\\[", i + 1);
    let cut = text.length;
    if (nextTick >= 0) cut = Math.min(cut, nextTick);
    if (nextStar >= 0) cut = Math.min(cut, nextStar);
    if (nextDollar >= 0) cut = Math.min(cut, nextDollar);
    if (nextLParen >= 0) cut = Math.min(cut, nextLParen);
    if (nextLBracket >= 0) cut = Math.min(cut, nextLBracket);
    if (cut <= i) cut = i + 1;
    appendText(parent, text.slice(i, cut));
    i = cut;
  }
}

function makeHeading(level, text) {
  const el = document.createElement("h" + String(level));
  appendInline(el, text);
  return el;
}

function makeParagraph(text) {
  const el = document.createElement("p");
  appendInline(el, text);
  return el;
}

function makeTable(header, rows) {
  const wrap = document.createElement("div");
  wrap.className = "md-table";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const hr = document.createElement("tr");
  header.forEach((c) => {
    const th = document.createElement("th");
    appendInline(th, c);
    hr.appendChild(th);
  });
  thead.appendChild(hr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((c) => {
      const td = document.createElement("td");
      appendInline(td, c);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function headingLevel(line) {
  let n = 0;
  while (n < 4 && n < line.length && line[n] === "#") n += 1;
  if (n >= 1 && n <= 4 && line[n] === " ") return n;
  return 0;
}

function listItemText(line) {
  const s = String(line || "");
  const trimmed = s.replace(/^\s+/, "");
  if (trimmed.startsWith("- ")) return trimmed.slice(2);
  if (trimmed.startsWith("* ")) return trimmed.slice(2);
  return null;
}

function tidyDisplayText(src) {
  const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let blank = false;
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i];
    let end = line.length;
    while (end > 0) {
      const ch = line.charCodeAt(end - 1);
      if (ch !== 32 && ch !== 9 && ch !== 12288) break;
      end -= 1;
    }
    line = line.slice(0, end);
    if (!line) {
      if (out.length && !blank) {
        out.push("");
        blank = true;
      }
      continue;
    }
    blank = false;
    out.push(line);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out.join("\n");
}

function renderMarkdownInto(el, src) {
  const text = tidyDisplayText(src);
  const lines = text.split("\n");
  el.replaceChildren();
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (!para.length) return;
    el.appendChild(makeParagraph(para.join("\n")));
    para = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    const next = lines[i + 1] || "";
    const blockMath = tryBlockMath(lines, i);
    if (blockMath) {
      flushPara();
      el.appendChild(mathInlineEl(blockMath.tex, true, "div"));
      i = blockMath.next;
      continue;
    }
    if (line.indexOf("|") >= 0 && isMdTableSep(next)) {
      flushPara();
      const header = splitMdRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf("|") >= 0 && !isMdTableSep(lines[i])) {
        rows.push(splitMdRow(lines[i]));
        i += 1;
      }
      el.appendChild(makeTable(header, rows));
      continue;
    }
    const level = headingLevel(line);
    if (level) {
      flushPara();
      el.appendChild(makeHeading(level, line.slice(level + 1)));
      i += 1;
      continue;
    }
    if (listItemText(line) !== null) {
      flushPara();
      const ul = document.createElement("ul");
      while (i < lines.length) {
        const item = listItemText(lines[i]);
        if (item === null) break;
        const li = document.createElement("li");
        appendInline(li, item);
        ul.appendChild(li);
        i += 1;
      }
      el.appendChild(ul);
      continue;
    }
    if (!line.trim()) {
      flushPara();
      i += 1;
      continue;
    }
    para.push(line);
    i += 1;
  }
  flushPara();
}

function setBubbleContent(el, text, opts) {
  const markdown = !!(opts && opts.markdown);
  const extracted = (typeof extractText === "function" ? extractText(text) : "") || (typeof text === "string" ? text : "");
  el.dataset.raw = extracted;
  const visible = tidyDisplayText(extracted);
  if (markdown) {
    el.classList.add("md");
    renderMarkdownInto(el, visible);
  } else {
    el.classList.remove("md");
    el.textContent = visible;
  }
  return visible;
}
