/**
 * reaction, table and figure.
 *
 * The chemistry one earns its own op because subscripts, charges and state
 * symbols in a chemical formula are structure, not typography: `H2O(l)` and
 * `H₂O(l)` are the same fact, and asking a model for the second is asking for
 * trouble. The formula is parsed here instead.
 */
import { useEffect, useState } from 'react';
import type { BoardOp } from '../op-schema';
import { Written, shown, useRegisterOp, type OpProps } from './common';
import { loadFigure } from '../../storage/db';

type ReactionOpType = Extract<BoardOp, { op: 'reaction' }>;
type TableOpType = Extract<BoardOp, { op: 'table' }>;
type FigureOpType = Extract<BoardOp, { op: 'figure' }>;

/** Split "Ca(OH)2(aq)" into text, subscript, charge and state parts. */
function formulaParts(formula: string): { text: string; kind: 'main' | 'sub' | 'sup' | 'state' }[] {
  const out: { text: string; kind: 'main' | 'sub' | 'sup' | 'state' }[] = [];
  const re = /(\((?:s|l|g|aq)\))|(\^?[0-9]*[+-])|([0-9]+)|([^0-9^]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(formula))) {
    if (m[1]) out.push({ text: m[1], kind: 'state' });
    else if (m[2]) out.push({ text: m[2].replace('^', ''), kind: 'sup' });
    else if (m[3]) out.push({ text: m[3], kind: 'sub' });
    else if (m[4]) out.push({ text: m[4], kind: 'main' });
  }
  return out;
}

function Formula({ formula }: { formula: string }): JSX.Element {
  return (
    <span className="formula">
      {formulaParts(formula).map((p, i) => {
        if (p.kind === 'sub') return <sub key={i}>{p.text}</sub>;
        if (p.kind === 'sup') return <sup key={i}>{p.text}</sup>;
        if (p.kind === 'state') return (
          <span key={i} className="state">
            {p.text}
          </span>
        );
        return <span key={i}>{p.text}</span>;
      })}
    </span>
  );
}

export function ReactionOpView({ op, revealed, register }: OpProps<ReactionOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);

  const side = (
    species: ReactionOpType['left'],
    offset: number,
  ): JSX.Element[] =>
    species.flatMap((sp, i) => {
      const el = (
        <span
          key={`s${offset}${i}`}
          className={`species ${shown(revealed, offset + i) ? 'chalk-write' : 'chalk-unwritten'}`}
        >
          {sp.coeff && sp.coeff !== 1 ? <span className="coeff">{sp.coeff}</span> : null}
          <Formula formula={sp.formula} />
        </span>
      );
      return i === 0
        ? [el]
        : [
            <span key={`p${offset}${i}`} className="plus">
              +
            </span>,
            el,
          ];
    });

  return (
    <div ref={ref} className="op op-reaction">
      <div className="reaction-row" role="img" aria-label={describeReaction(op)}>
        {side(op.left, 0)}
        <span className="arrow">
          {op.condition ? <span className="condition">{op.condition}</span> : null}
          <svg width="56" height="14" viewBox="0 0 56 14" aria-hidden="true">
            <path d="M0 7 H48 M42 2 L50 7 L42 12" fill="none" stroke="currentColor" strokeWidth="1.8" />
          </svg>
        </span>
        {side(op.right, op.left.length)}
      </div>
    </div>
  );
}

function describeReaction(op: ReactionOpType): string {
  const s = (list: ReactionOpType['left']) =>
    list.map((x) => `${x.coeff && x.coeff !== 1 ? `${x.coeff} ` : ''}${x.formula}`).join(' plus ');
  return `${s(op.left)} gives ${s(op.right)}${op.condition ? `, ${op.condition}` : ''}`;
}

export function TableOpView({ op, revealed, register }: OpProps<TableOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);

  return (
    <div ref={ref} className="op op-table">
      {/* Wide tables scroll inside their own box; the page never scrolls sideways. */}
      <div className="table-scroll">
        <table>
          <thead>
            <tr className={shown(revealed, 0) ? 'chalk-write' : 'chalk-unwritten'}>
              {op.headers.map((h, i) => (
                <th key={i}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {op.rows.map((row, r) => (
              <tr key={r} className={shown(revealed, r + 1) ? 'chalk-write' : 'chalk-unwritten'}>
                {row.map((cell, c) => (
                  <td key={c}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function FigureOpView({ op, revealed, register }: OpProps<FigureOpType>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let live = true;
    loadFigure(op.figureId).then((f) => {
      if (!live) return;
      if (f) setSrc(f.dataUrl);
      else setMissing(true);
    });
    return () => {
      live = false;
    };
  }, [op.figureId]);

  return (
    <div ref={ref} className="op op-figure">
      <Written visible={shown(revealed, 0)}>
        {src ? (
          <img src={src} alt={op.caption ?? 'Figure produced by running code'} className="figure-img" />
        ) : (
          // Never a bare spinner: say what is happening, or what went wrong.
          <div className="figure-placeholder">
            {missing ? 'That figure is no longer available.' : 'Drawing the figure…'}
          </div>
        )}
        {op.caption ? <div className="figure-caption">{op.caption}</div> : null}
      </Written>
    </div>
  );
}
