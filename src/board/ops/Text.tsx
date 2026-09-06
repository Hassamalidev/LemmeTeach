/**
 * heading, text, bullets, math, derive — the five ops that are mostly words.
 */
import type { BoardOp } from '../op-schema';
import { renderInline, renderTex, texToWords } from '../tex';
import { Written, shown, toneClass, useRegisterOp, type OpProps } from './common';

type Of<K extends BoardOp['op']> = Extract<BoardOp, { op: K }>;

export function HeadingOpView({ op, revealed, register }: OpProps<Of<'heading'>>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  return (
    <div ref={ref} className="op op-heading">
      <Written visible={shown(revealed, 0)}>
        <h2>{op.text}</h2>
      </Written>
    </div>
  );
}

export function TextOpView({ op, revealed, register }: OpProps<Of<'text'>>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  return (
    <div ref={ref} className={`op op-text ${toneClass(op.tone)}`}>
      <Written visible={shown(revealed, 0)}>
        {op.tone === 'key' ? (
          <div className="key-box">
            <span className="key-flag" aria-hidden="true" />
            <p dangerouslySetInnerHTML={{ __html: renderInline(op.text) }} />
          </div>
        ) : (
          <p dangerouslySetInnerHTML={{ __html: renderInline(op.text) }} />
        )}
      </Written>
    </div>
  );
}

export function BulletsOpView({ op, revealed, register }: OpProps<Of<'bullets'>>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  return (
    <div ref={ref} className="op op-bullets">
      <ul>
        {op.items.map((item, i) => (
          <Written as="li" key={i} visible={shown(revealed, i)}>
            <span className="bullet-mark" aria-hidden="true" />
            <span dangerouslySetInnerHTML={{ __html: renderInline(item) }} />
          </Written>
        ))}
      </ul>
    </div>
  );
}

export function MathOpView({ op, revealed, register }: OpProps<Of<'math'>>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  return (
    <div ref={ref} className="op op-math">
      <Written visible={shown(revealed, 0)}>
        <div
          className="tex"
          role="math"
          aria-label={texToWords(op.tex)}
          dangerouslySetInnerHTML={{ __html: renderTex(op.tex, true) }}
        />
        {op.label ? <div className="tex-label">{op.label}</div> : null}
      </Written>
    </div>
  );
}

export function DeriveOpView({ op, revealed, register }: OpProps<Of<'derive'>>): JSX.Element {
  const ref = useRegisterOp(op.id, register);
  return (
    <div ref={ref} className="op op-derive">
      {op.lines.map((line, i) => (
        <Written key={i} visible={shown(revealed, i)} className="derive-line">
          <div
            className="tex"
            role="math"
            aria-label={texToWords(line.tex)}
            dangerouslySetInnerHTML={{ __html: renderTex(line.tex, true) }}
          />
          {line.note ? <div className="derive-note">{line.note}</div> : null}
        </Written>
      ))}
    </div>
  );
}
