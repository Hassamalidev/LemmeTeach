/**
 * Tidying board operations before they are checked (§10.3, §18).
 *
 * The model is told each operation's shape once, in the system prompt, and
 * mostly writes them right. When it slips, the slips are the same few every
 * time: `{"derive":[…]}` instead of `{"op":"derive","lines":[…]}`, a tone the
 * schema does not have, a number sent as a string. Each rejection costs a
 * whole turn — the full prompt and conversation sent again — and a model that
 * cannot see its mistake makes it again and again. One real run spent five
 * turns that way on a single step.
 *
 * So the unambiguous slips are put right here, before the schema sees them,
 * and the model is told what was changed so it writes it properly next time.
 * Anything ambiguous is left alone for the schema to reject, with the right
 * shape quoted back (`explainOps`).
 */
import { BOARD_OP_KINDS, NODE_TONES, TONES, type BoardOpKind } from './op-schema';

/** Each operation's shape, exactly as the system prompt gives it. */
export const OP_SHAPES: Record<BoardOpKind, string> = {
  heading: '{"op":"heading","text":"..."}',
  text: '{"op":"text","text":"...","tone":"note|warn|key"}',
  math: '{"op":"math","tex":"...","label":"..."}',
  derive: '{"op":"derive","lines":[{"tex":"...","note":"..."}]}',
  bullets: '{"op":"bullets","items":["..."]}',
  code: '{"op":"code","lang":"python","src":"...","focus":[4,6]}',
  diagram:
    '{"op":"diagram","layout":"flow|cycle|tree|web","nodes":[{"id","label","tone"}],"edges":[{"from","to","label"}]}',
  plot: '{"op":"plot","fns":[{"expr":"sin(x)/x","label":"..."}],"domain":[-10,10],"marks":[{"x":0,"y":1,"label":"..."}]}',
  vectors: '{"op":"vectors","origin":"...","arrows":[{"label":"F","dx":3,"dy":4}]}',
  reaction:
    '{"op":"reaction","left":[{"formula":"H2","coeff":2}],"right":[{"formula":"H2O","coeff":2}],"condition":"..."}',
  table: '{"op":"table","headers":["..."],"rows":[["..."]]}',
  figure: '{"op":"figure","figureId":"...","caption":"..."}',
  annotate: '{"op":"annotate","target":"someId","style":"circle|underline|arrow","text":"..."}',
};

const KINDS = new Set<string>(BOARD_OP_KINDS);
const isKind = (v: unknown): v is BoardOpKind => typeof v === 'string' && KINDS.has(v);
const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Words models reach for, mapped onto the tones a line of text has. */
const TEXT_TONE: Record<string, (typeof TONES)[number]> = {
  note: 'note',
  info: 'note',
  hint: 'note',
  aside: 'note',
  key: 'key',
  important: 'key',
  highlight: 'key',
  answer: 'key',
  result: 'key',
  warn: 'warn',
  warning: 'warn',
  danger: 'warn',
  caution: 'warn',
  error: 'warn',
};

/** And onto the tones a diagram node or an arrow has. */
const NODE_TONE: Record<string, (typeof NODE_TONES)[number]> = {
  default: 'default',
  normal: 'default',
  plain: 'default',
  key: 'key',
  important: 'key',
  highlight: 'key',
  primary: 'key',
  answer: 'key',
  warn: 'warn',
  warning: 'warn',
  danger: 'warn',
  error: 'warn',
  muted: 'muted',
  note: 'muted',
  info: 'muted',
  secondary: 'muted',
  dim: 'muted',
};

/** The field an operation's single value belongs in, when it was written as `{"derive": value}`. */
const MAIN_FIELD: Partial<Record<BoardOpKind, string>> = {
  heading: 'text',
  text: 'text',
  math: 'tex',
  derive: 'lines',
  bullets: 'items',
  code: 'src',
  figure: 'figureId',
};

/** Other names models use for a field, by operation. */
const FIELD_ALIASES: Partial<Record<BoardOpKind, Record<string, string>>> = {
  heading: { content: 'text', title: 'text', value: 'text' },
  text: { content: 'text', value: 'text' },
  math: { latex: 'tex', equation: 'tex', expr: 'tex', formula: 'tex', content: 'tex' },
  derive: { steps: 'lines', equations: 'lines' },
  bullets: { points: 'items', list: 'items', lines: 'items' },
  code: { code: 'src', source: 'src', language: 'lang', content: 'src' },
  table: { columns: 'headers', header: 'headers', data: 'rows' },
  plot: { functions: 'fns', x: 'domain', xrange: 'domain', yrange: 'range' },
  vectors: { vectors: 'arrows', forces: 'arrows' },
};

const asNumber = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v;

/**
 * Put the unambiguous slips right. Returns the operations, changed or not,
 * and a sentence for each kind of change made. Never throws.
 */
export function tidyOps(raw: unknown): { ops: unknown; fixes: string[] } {
  if (!Array.isArray(raw)) return { ops: raw, fixes: [] };
  const fixes = new Set<string>();

  const ops = raw.map((item) => {
    if (!isObject(item)) return item;
    const op: Record<string, unknown> = { ...item };

    // "type" or "kind" where "op" belongs.
    if (op.op === undefined) {
      for (const alias of ['type', 'kind', 'operation']) {
        if (isKind(op[alias])) {
          op.op = op[alias];
          delete op[alias];
          fixes.add(`the operation name goes in "op", not "${alias}"`);
          break;
        }
      }
    }

    // {"derive": [...]} rather than {"op":"derive","lines":[...]}.
    if (op.op === undefined) {
      const named = Object.keys(op).filter(isKind);
      const kind = named.length === 1 ? named[0] : undefined;
      if (kind) {
        const value = op[kind];
        delete op[kind];
        op.op = kind;
        if (isObject(value)) Object.assign(op, value);
        else if (MAIN_FIELD[kind] && op[MAIN_FIELD[kind] as string] === undefined) op[MAIN_FIELD[kind] as string] = value;
        fixes.add(`write ${OP_SHAPES[kind]}, not {"${kind}": ...}`);
      }
    }

    if (!isKind(op.op)) return op;
    const kind = op.op;

    for (const [from, to] of Object.entries(FIELD_ALIASES[kind] ?? {})) {
      if (op[from] !== undefined && op[to] === undefined) {
        op[to] = op[from];
        delete op[from];
        fixes.add(`${kind} takes "${to}", not "${from}"`);
      }
    }

    if (kind === 'code' && op.lang === undefined && typeof op.src === 'string') op.lang = 'text';

    // A label written like an id ("molar-h2") is an id: as a label it would be
    // printed on the board as a caption.
    if (kind === 'math' && typeof op.label === 'string' && /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/.test(op.label)) {
      if (op.id === undefined) op.id = op.label;
      delete op.label;
      fixes.add('"label" is a caption the learner reads; a name to point at later goes in "id"');
    }

    if (kind === 'derive' && Array.isArray(op.lines)) {
      op.lines = op.lines.map((line) => {
        if (typeof line === 'string') {
          fixes.add('each derive line is {"tex":"...","note":"..."}');
          return { tex: line };
        }
        if (!isObject(line)) return line;
        const l = { ...line };
        for (const alias of ['latex', 'equation', 'math', 'expr', 'line']) {
          if (l.tex === undefined && typeof l[alias] === 'string') {
            l.tex = l[alias];
            delete l[alias];
            fixes.add('each derive line is {"tex":"...","note":"..."}');
          }
        }
        for (const alias of ['explanation', 'comment', 'reason']) {
          if (l.note === undefined && typeof l[alias] === 'string') {
            l.note = l[alias];
            delete l[alias];
            fixes.add('each derive line is {"tex":"...","note":"..."}');
          }
        }
        return l;
      });
    }

    // The equations themselves: a programmer's "*" becomes a times sign, and
    // braces that do not balance — a model writing "}}}" after a number — are
    // put right, because KaTeX refuses the whole line over one stray brace.
    const fixTex = (tex: unknown): unknown => {
      if (typeof tex !== 'string') return tex;
      const balanced = balanceBraces(tex.replace(/(\d|\))\s*\*\s*(?=[\d(])/g, '$1 \\times '));
      if (balanced !== tex && balanceBraces(tex) !== tex) fixes.add('braces in an equation must balance');
      return balanced;
    };
    if (kind === 'math') op.tex = fixTex(op.tex);
    // A note beside a derivation line is plain text, but models write LaTeX
    // in it too; "\times" would be printed as it is.
    const plainNote = (note: unknown): unknown =>
      typeof note === 'string'
        ? note
            .replace(/\\times\b/g, '×')
            .replace(/\\cdot\b/g, '·')
            .replace(/\\(approx)\b/g, '≈')
            .replace(/\$/g, '')
        : note;
    if (kind === 'derive' && Array.isArray(op.lines)) {
      op.lines = op.lines.map((l) =>
        isObject(l) ? { ...l, tex: fixTex(l.tex), ...(l.note !== undefined ? { note: plainNote(l.note) } : {}) } : l,
      );
    }

    if (kind === 'bullets' && Array.isArray(op.items)) {
      op.items = op.items.map((it) => (isObject(it) && typeof it.text === 'string' ? it.text : it));
    }

    if (kind === 'text' && op.tone !== undefined) {
      const tone = TEXT_TONE[String(op.tone).toLowerCase()];
      if (tone !== op.tone) {
        if (tone) op.tone = tone;
        else delete op.tone;
        fixes.add('a text tone is note, warn or key');
      }
    }

    const fixToneIn = (list: unknown, what: string): unknown =>
      Array.isArray(list)
        ? list.map((entry) => {
            if (!isObject(entry) || entry.tone === undefined) return entry;
            const tone = NODE_TONE[String(entry.tone).toLowerCase()];
            if (tone === entry.tone) return entry;
            const e = { ...entry };
            if (tone) e.tone = tone;
            else delete e.tone;
            fixes.add(`${what} tone is default, key, warn or muted`);
            return e;
          })
        : list;
    if (kind === 'diagram') op.nodes = fixToneIn(op.nodes, 'a diagram node');
    if (kind === 'vectors') {
      op.arrows = fixToneIn(op.arrows, 'an arrow');
      if (Array.isArray(op.arrows)) {
        op.arrows = op.arrows.map((a) => (isObject(a) ? { ...a, dx: asNumber(a.dx), dy: asNumber(a.dy) } : a));
      }
    }

    if (kind === 'plot') {
      for (const field of ['domain', 'range']) {
        if (Array.isArray(op[field])) op[field] = (op[field] as unknown[]).map(asNumber);
      }
      if (typeof op.fns === 'string') op.fns = [{ expr: op.fns }];
      if (Array.isArray(op.fns)) op.fns = op.fns.map((f) => (typeof f === 'string' ? { expr: f } : f));
      if (Array.isArray(op.marks)) {
        op.marks = op.marks.map((m) => (isObject(m) ? { ...m, x: asNumber(m.x), y: asNumber(m.y) } : m));
      }
    }

    return op;
  });

  return { ops, fixes: [...fixes] };
}

/**
 * Drop closing braces that close nothing, and close any left open. Escaped
 * braces (`\{`, `\}`) are literal characters in LaTeX and are not counted.
 */
export function balanceBraces(tex: string): string {
  let depth = 0;
  let out = '';
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === '\\' && i + 1 < tex.length) {
      out += ch + tex[i + 1];
      i += 1;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      if (depth === 0) continue;
      depth -= 1;
    }
    out += ch;
  }
  return out + '}'.repeat(depth);
}

/**
 * When operations still do not fit, the shape each failing one should have.
 * The schema says which field is wrong; this says what right looks like, which
 * is what a model that has lost track of the prompt needs.
 */
export function explainOps(ops: unknown, failing: number[]): string {
  if (!Array.isArray(ops)) return '';
  const lines: string[] = [];
  for (const index of [...new Set(failing)].slice(0, 3)) {
    const item = ops[index];
    const kind = isObject(item) ? item.op : undefined;
    lines.push(
      isKind(kind)
        ? `Item ${index} is a ${kind}, written ${OP_SHAPES[kind]}.`
        : `Item ${index} needs "op", one of: ${BOARD_OP_KINDS.join(', ')}.`,
    );
  }
  return lines.join(' ');
}
