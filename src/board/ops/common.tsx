/**
 * Shared props and helpers for the thirteen op components.
 *
 * Reveal works one way throughout: an op is handed how many of its units are
 * currently written, and each unit plays a one-shot write animation the first
 * time it appears. Content is *written*, not faded in (§16) — the animation
 * clips left to right along the stroke direction, which is the one place in
 * the whole app where motion is worth spending effort on.
 */
import { useEffect, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import type { BoardOp } from '../op-schema';

export interface OpProps<T extends BoardOp = BoardOp> {
  op: T;
  /** How many of this op's reveal units are written. Infinity when complete. */
  revealed: number;
  /** Registers the DOM node so `annotate` can point at it. */
  register?: (id: string, el: HTMLElement | null) => void;
}

/** True when unit `i` of this op should be on the board. */
export function shown(revealed: number, i: number): boolean {
  return revealed > i;
}

/**
 * Publishes an op's DOM node under its id so `annotate` can measure it. Only
 * ops the model gave an id are worth tracking, which is most of them off.
 */
export function useRegisterOp<T extends HTMLElement = HTMLDivElement>(
  id: string | undefined,
  register: OpProps['register'],
): RefObject<T> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!id || !register) return;
    register(id, ref.current);
    return () => register(id, null);
  }, [id, register]);
  return ref;
}

interface WriteProps {
  children: ReactNode;
  /** Written units animate once; already-written ones must not re-animate. */
  visible: boolean;
  delay?: number;
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'span' | 'li' | 'tr' | 'g';
}

/**
 * One written unit. Hidden units stay in the tree with `visibility: hidden`
 * rather than being unmounted, so the page does not reflow as a step reveals —
 * "no layout shift when the board paginates" applies within a step too.
 */
export function Written({
  children,
  visible,
  delay = 0,
  className = '',
  style,
  as = 'div',
}: WriteProps): JSX.Element {
  const Tag = as as 'div';
  return (
    <Tag
      className={`${visible ? 'chalk-write' : 'chalk-unwritten'} ${className}`}
      style={{ animationDelay: delay ? `${delay}ms` : undefined, ...style }}
    >
      {children}
    </Tag>
  );
}

export function toneClass(tone: string | undefined): string {
  switch (tone) {
    case 'key':
      return 'op-tone-key';
    case 'warn':
      return 'op-tone-warn';
    case 'note':
      return 'op-tone-note';
    case 'muted':
      return 'op-tone-muted';
    default:
      return '';
  }
}
