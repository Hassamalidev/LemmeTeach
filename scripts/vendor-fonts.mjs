/**
 * Fetch the two typefaces into public/fonts/ so they are served from the same
 * origin as the app (§19: no third-party font CDN at runtime).
 *
 * Run once: `npm run vendor:fonts`. The files are committed. If you skip this,
 * the app falls through to the system font stack and works perfectly well —
 * it just looks like everything else.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

const OUT = 'public/fonts';

/**
 * Sources. Both families are open-licensed: Atkinson Hyperlegible Next is
 * SIL OFL 1.1 (Braille Institute), IBM Plex Mono is SIL OFL 1.1 (IBM).
 * The licence text is written alongside the files.
 */
const FILES = [
  {
    name: 'AtkinsonHyperlegibleNext-Regular.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/atkinson-hyperlegible-next@latest/latin-400-normal.woff2',
  },
  {
    name: 'AtkinsonHyperlegibleNext-Bold.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/atkinson-hyperlegible-next@latest/latin-700-normal.woff2',
  },
  {
    name: 'IBMPlexMono-Regular.woff2',
    url: 'https://cdn.jsdelivr.net/fontsource/fonts/ibm-plex-mono@latest/latin-400-normal.woff2',
  },
];

const LICENCE = `The typefaces in this directory are vendored so that nothing is
loaded from a third-party CDN at runtime.

  Atkinson Hyperlegible Next — (c) Braille Institute of America, Inc.
  IBM Plex Mono — (c) IBM Corp.

Both are licensed under the SIL Open Font License 1.1:
https://openfontlicense.org/

Refresh them with: npm run vendor:fonts
`;

async function main() {
  await mkdir(OUT, { recursive: true });

  let ok = 0;
  for (const file of FILES) {
    const path = join(OUT, file.name);
    try {
      await access(path);
      console.log(`  already have ${file.name}`);
      ok++;
      continue;
    } catch {
      /* not there yet — fetch it */
    }

    try {
      const res = await fetch(file.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length < 1000) throw new Error('the response was too small to be a font');
      await writeFile(path, bytes);
      console.log(`  fetched ${file.name} (${(bytes.length / 1024).toFixed(0)} KB)`);
      ok++;
    } catch (err) {
      console.warn(`  could not fetch ${file.name}: ${err.message}`);
    }
  }

  await writeFile(join(OUT, 'LICENCE.txt'), LICENCE);

  if (ok === FILES.length) {
    console.log('\nAll fonts vendored. Commit public/fonts/.');
  } else {
    console.log(
      `\n${ok} of ${FILES.length} fonts vendored. The app still works — missing faces fall\n` +
        'through to the system stack. Download them by hand into public/fonts/ if you\n' +
        'are behind a proxy that blocks the CDN.',
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
