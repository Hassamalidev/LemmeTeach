/**
 * The layering rule, enforced (§3, §25).
 *
 * "No provider name appears in a conditional above the adapter layer."
 *
 * This is a test rather than a convention because it is the kind of rule that
 * decays one small exception at a time: a single `if (provider === 'anthropic')`
 * in a component is harmless, and the fifth one means adding a provider is a
 * week's work instead of a file. When this fails, the fix is to move the fact
 * onto the adapter — a capability flag or a piece of text — not to widen the
 * exception list.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PROVIDER_IDS } from '../core/types';
import { ADAPTERS, PROVIDER_ORDER } from './index';

const ROOT = 'src';
/** Where naming a provider is the whole point. */
const EXEMPT = ['src/providers', 'src/core/types.ts'];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry).replace(/\\/g, '/');
    if (EXEMPT.some((e) => path.startsWith(e))) continue;
    if (statSync(path).isDirectory()) {
      out.push(...sourceFiles(path));
    } else if (/\.tsx?$/.test(path) && !path.includes('.test.')) {
      out.push(path);
    }
  }
  return out;
}

/** Strip comments and string literals: a provider named in prose is fine. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('the adapter boundary', () => {
  const files = sourceFiles(ROOT);

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no provider name in a conditional above src/providers', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const body = code(readFileSync(file, 'utf8'));
      body.split('\n').forEach((line, i) => {
        for (const id of PROVIDER_IDS) {
          // The string literals are gone, so any surviving mention of a
          // provider id is an identifier or a comparison.
          const pattern = new RegExp(`\\b${id}\\b`, 'i');
          if (pattern.test(line)) {
            offenders.push(`${file}:${i + 1} — ${line.trim().slice(0, 90)}`);
          }
        }
      });
    }

    expect(offenders, offenders.join('\n')).toEqual([]);
  });
});

describe('the adapters themselves', () => {
  it('cover every declared provider id', () => {
    for (const id of PROVIDER_IDS) {
      expect(ADAPTERS[id], id).toBeTruthy();
      expect(ADAPTERS[id].id, id).toBe(id);
    }
    expect(PROVIDER_ORDER.length).toBe(PROVIDER_IDS.length);
  });

  it('each carry what the UI needs, so no screen has to special-case them', () => {
    for (const id of PROVIDER_IDS) {
      const adapter = ADAPTERS[id];
      expect(adapter.label.length, id).toBeGreaterThan(2);
      expect(adapter.defaultModel.length, id).toBeGreaterThan(0);
      // Every adapter says where a key comes from, even the ones that need none.
      expect(adapter.keyHint.length, id).toBeGreaterThan(20);
    }
  });

  it('has exactly one adapter that needs no key or network', () => {
    const demos = PROVIDER_IDS.filter((id) => ADAPTERS[id].demo);
    expect(demos).toHaveLength(1);
    expect(ADAPTERS[demos[0] ?? 'mock'].demoNote).toBeTruthy();
  });

  it('marks the adapters that take a learner-supplied endpoint', () => {
    const custom = PROVIDER_IDS.filter((id) => ADAPTERS[id].needsBaseUrl);
    expect(custom.length).toBeGreaterThan(0);
    for (const id of custom) {
      expect(ADAPTERS[id].keyOptional, `${id} runs locally, so a key is optional`).toBe(true);
    }
  });
});
