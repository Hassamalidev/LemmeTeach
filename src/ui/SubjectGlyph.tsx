/**
 * One small drawn mark per subject.
 *
 * Line drawings in the subject's accent, in the same hand as the board's own
 * strokes. Decorative: the subject's name is always written beside it.
 */
import { SUBJECT_ACCENTS, type SubjectId } from '../core/types';

const PATHS: Record<SubjectId, JSX.Element> = {
  // A curve through its axes.
  math: (
    <>
      <path d="M4 20V4M4 20h16" />
      <path d="M6 17c3 0 4-10 7-10s3 6 6 6" />
    </>
  ),
  // Two orbits round a nucleus.
  physics: (
    <>
      <ellipse cx="12" cy="12" rx="9" ry="3.6" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" />
    </>
  ),
  // A flask, part full.
  chemistry: (
    <>
      <path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" />
      <path d="M7.5 15h9" />
    </>
  ),
  // A small tree of nodes.
  cs: (
    <>
      <circle cx="12" cy="5" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M11 6.8 7 16.2M13 6.8l4 9.4" />
    </>
  ),
  // A leaf with its midrib.
  biology: (
    <>
      <path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15" />
      <path d="M5 19c3-5 6-8 10-10" />
    </>
  ),
  // Bars climbing under a rising line.
  finance: (
    <>
      <path d="M4 20h16M7 20v-5M12 20v-8M17 20v-12" />
      <path d="M5 11l5-4 4 2 5-5" />
    </>
  ),
  // A head in profile with a thought in it.
  psychology: (
    <>
      <path d="M9 21v-3H7a2 2 0 0 1-2-2v-2l-1.5-1L5 10a7 7 0 1 1 11 5.7V21" />
      <circle cx="12" cy="9.5" r="2" />
    </>
  ),
  // An open book.
  general: (
    <>
      <path d="M12 6c-2-1.5-5-2-8-2v14c3 0 6 .5 8 2 2-1.5 5-2 8-2V4c-3 0-6 .5-8 2z" />
      <path d="M12 6v14" />
    </>
  ),
};

export function SubjectGlyph({ subject, size = 28 }: { subject: SubjectId; size?: number }): JSX.Element {
  return (
    <svg
      className="subject-glyph"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: SUBJECT_ACCENTS[subject] }}
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[subject]}
    </svg>
  );
}
