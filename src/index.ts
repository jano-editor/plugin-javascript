import type { LanguagePlugin, PluginContext, HighlightToken } from "@jano-editor/plugin-types";

// JavaScript + TypeScript highlighting. A small tokenizer with state, so block comments
// and template strings that span lines are colored correctly.

const KEYWORDS = new Set([
  "async", "await", "break", "case", "catch", "class", "const", "continue", "debugger",
  "default", "delete", "do", "else", "export", "extends", "finally", "for", "from",
  "function", "get", "if", "import", "in", "instanceof", "let", "new", "of", "return",
  "set", "static", "switch", "throw", "try", "typeof", "var", "void", "while", "with",
  "yield",
  // typescript
  "abstract", "as", "asserts", "declare", "enum", "implements", "infer", "interface",
  "is", "keyof", "module", "namespace", "override", "private", "protected", "public",
  "readonly", "satisfies", "type", "unique",
]);

const CONSTANTS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "this", "super"]);

const TYPES = new Set([
  "string", "number", "boolean", "bigint", "symbol", "object", "any", "unknown",
  "never", "void",
]);

// keywords after which a "/" starts a regex instead of a division
const REGEX_AFTER_KEYWORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await"]);

const State = { Normal: 0, BlockComment: 1, Template: 2 } as const;
type State = (typeof State)[keyof typeof State];

interface Result {
  tokens: HighlightToken[];
  end: State;
}

const NUMBER = /^(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?)n?/;
const IDENT = /^[A-Za-z_$][\w$]*/;

/** Tokenizes one line, starting in `state`. With collect=false only the end state is computed. */
function tokenize(line: string, state: State, collect = true): Result {
  const tokens: HighlightToken[] = [];
  const add = (start: number, end: number, type: string) => {
    if (collect && end > start) tokens.push({ start, end, type });
  };
  let i = 0;
  // last significant token, decides whether "/" starts a regex
  let prev: "value" | "operator" = "operator";

  while (i < line.length) {
    if (state === State.BlockComment) {
      const close = line.indexOf("*/", i);
      const end = close === -1 ? line.length : close + 2;
      add(i, end, "comment");
      i = end;
      if (close !== -1) state = State.Normal;
      continue;
    }

    if (state === State.Template) {
      const start = i;
      while (i < line.length) {
        if (line[i] === "\\") i += 2;
        else if (line[i] === "`") {
          i++;
          state = State.Normal;
          break;
        } else if (line[i] === "$" && line[i + 1] === "{") {
          // interpolation on the same line: string up to it, code inside, then back to the string
          add(start, i, "string");
          const close = line.indexOf("}", i + 2);
          add(i, i + 2, "punctuation");
          if (close === -1) {
            i += 2;
            break;
          }
          const inner = tokenize(line.slice(i + 2, close), State.Normal, collect);
          for (const t of inner.tokens) add(t.start + i + 2, t.end + i + 2, t.type);
          add(close, close + 1, "punctuation");
          i = close + 1;
          return mergeTemplate(line, i, state, tokens, collect);
        } else i++;
      }
      add(start, Math.min(i, line.length), "string");
      prev = "value";
      continue;
    }

    const c = line[i];
    const rest = line.slice(i);

    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if (rest.startsWith("//")) {
      add(i, line.length, "comment");
      break;
    }
    if (rest.startsWith("/*")) {
      // search the end after the opener, so "/*/" doesn't close itself
      const close = line.indexOf("*/", i + 2);
      const end = close === -1 ? line.length : close + 2;
      add(i, end, "comment");
      i = end;
      if (close === -1) state = State.BlockComment;
      continue;
    }
    if (c === '"' || c === "'") {
      const start = i++;
      while (i < line.length && line[i] !== c) i += line[i] === "\\" ? 2 : 1;
      i = Math.min(i + 1, line.length);
      add(start, i, "string");
      prev = "value";
      continue;
    }
    if (c === "`") {
      add(i, i + 1, "string");
      i++;
      state = State.Template;
      continue;
    }
    if (c === "/" && prev === "operator") {
      // regex literal, e.g. after "=", "(" or "return"
      const start = i++;
      let inClass = false;
      while (i < line.length) {
        if (line[i] === "\\") i++;
        else if (line[i] === "[") inClass = true;
        else if (line[i] === "]") inClass = false;
        else if (line[i] === "/" && !inClass) break;
        i++;
      }
      i = Math.min(i + 1, line.length);
      while (i < line.length && /[a-z]/.test(line[i])) i++; // flags
      add(start, i, "string");
      prev = "value";
      continue;
    }
    if (c === "@") {
      const m = IDENT.exec(line.slice(i + 1));
      const end = i + 1 + (m ? m[0].length : 0);
      add(i, end, "attribute");
      i = end;
      continue;
    }

    const num = /\d/.test(c) || (c === "." && /\d/.test(line[i + 1] ?? "")) ? NUMBER.exec(rest) : null;
    if (num) {
      add(i, i + num[0].length, "number");
      i += num[0].length;
      prev = "value";
      continue;
    }

    const ident = IDENT.exec(rest);
    if (ident) {
      const word = ident[0];
      const end = i + word.length;
      const before = line.slice(0, i).trimEnd();
      const after = line.slice(end).trimStart();
      let type: string | null = null;
      if (before.endsWith(".") && !before.endsWith("..")) type = after.startsWith("(") ? "function" : "property";
      else if (KEYWORDS.has(word)) type = "keyword";
      else if (CONSTANTS.has(word)) type = "constant";
      else if (TYPES.has(word)) type = "type";
      else if (after.startsWith("(") || /^=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>/.test(after)) type = "function";
      else if (/^[A-Z][A-Z0-9_]+$/.test(word) && word.length > 1) type = "constant";
      else if (/^[A-Z]/.test(word)) type = "type";
      if (type) add(i, end, type);
      i = end;
      prev = KEYWORDS.has(word) && REGEX_AFTER_KEYWORD.has(word) ? "operator" : "value";
      continue;
    }

    if ("{}()[];,.".includes(c)) {
      add(i, i + 1, "punctuation");
      prev = c === ")" || c === "]" || c === "}" ? "value" : "operator";
      i++;
      continue;
    }

    // operators, longest match first
    const op = /^(?:=>|\.\.\.|\?\?=?|\?\.|\*\*=?|===?|!==?|<<=?|>>>?=?|[-+*/%&|^<>!=~?:]=?|&&=?|\|\|=?|\+\+|--)/.exec(rest);
    const len = op ? op[0].length : 1;
    add(i, i + len, "operator");
    prev = "operator";
    i += len;
  }

  return { tokens, end: state };
}

/** Continues a template string after an interpolation that closed on the same line. */
function mergeTemplate(line: string, from: number, state: State, tokens: HighlightToken[], collect: boolean): Result {
  const rest = tokenize(line.slice(from), state, collect);
  for (const t of rest.tokens) tokens.push({ start: t.start + from, end: t.end + from, type: t.type });
  return { tokens, end: rest.end };
}

// ----- start state of a line -----

// like vim's "syntax sync minlines": look back this many lines for an open comment or template
const SYNC_LINES = 500;

// the editor renders lines top to bottom in one go, so the end state of the previous
// line is reused. it is cleared after the frame, edits elsewhere can't leave it stale.
let memo: { lines: readonly string[]; index: number; text: string; end: State } | null = null;
let clearScheduled = false;

function startState(index: number, lines: readonly string[]): State {
  if (memo && memo.lines === lines && memo.index === index - 1 && memo.text === lines[index - 1]) {
    return memo.end;
  }
  let state: State = State.Normal;
  for (let i = Math.max(0, index - SYNC_LINES); i < index; i++) {
    state = tokenize(lines[i], state, false).end;
  }
  return state;
}

function highlightLine(line: string, index: number, lines: readonly string[]): HighlightToken[] {
  const { tokens, end } = tokenize(line, startState(index, lines));
  memo = { lines, index, text: line, end };
  if (!clearScheduled) {
    clearScheduled = true;
    queueMicrotask(() => {
      memo = null;
      clearScheduled = false;
    });
  }
  return tokens;
}

// ----- plugin -----

const plugin: LanguagePlugin = {
  name: "JavaScript",
  extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"],

  highlightLine,

  // keep the indent on Enter, one level deeper after an opening bracket or arrow
  onCursorAction(ctx: PluginContext) {
    if (!ctx.action || ctx.action.type !== "newline") return null;

    const curLine = ctx.action.cursor.position.line;
    const prevLine = curLine > 0 ? ctx.lines[curLine - 1] : "";
    let indent = /^\s*/.exec(prevLine)?.[0] ?? "";
    const trimmed = prevLine.replace(/\/\/.*$/, "").trimEnd();

    if (/[{([]$/.test(trimmed) || /=>$/.test(trimmed)) {
      indent += ctx.settings.insertSpaces ? " ".repeat(ctx.settings.tabSize) : "\t";
    }
    if (indent.length === 0) return null;

    return {
      edits: [
        {
          range: { start: { line: curLine, col: 0 }, end: { line: curLine, col: 0 } },
          text: indent,
        },
      ],
      cursors: [{ position: { line: curLine, col: indent.length }, anchor: null }],
    };
  },
};

export default plugin;
export { tokenize, State };
