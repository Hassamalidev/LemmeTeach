/**
 * Copy Pyodide into public/ for offline or restricted networks (§11).
 *
 * The default is to load Pyodide from a CDN, because vendoring it adds roughly
 * 10 MB to the deploy and most people never run Python at all. Use this when
 * the CDN is blocked, or when the deployment has to work without a network.
 *
 * Afterwards, set the Pyodide base URL in Settings to `./pyodide/`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const VERSION = '0.26.4';
const BASE = `https://cdn.jsdelivr.net/pyodide/v${VERSION}/full/`;
const OUT = 'public/pyodide';

/**
 * The runtime itself plus the five packages §11 allows. Everything else is
 * fetched on demand, which is exactly what a restricted network cannot do —
 * so this list has to be complete.
 */
const CORE = [
  'pyodide.js',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
];

async function fetchTo(name) {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(join(OUT, name), bytes);
  return bytes.length;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Vendoring Pyodide ${VERSION} into ${OUT}/`);

  let total = 0;
  for (const name of CORE) {
    const size = await fetchTo(name);
    total += size;
    console.log(`  ${name} — ${(size / 1024 / 1024).toFixed(1)} MB`);
  }

  // The package wheels are named in the lock file, so read it rather than
  // hard-coding filenames that change with every Pyodide release.
  const lock = JSON.parse(
    await (await fetch(`${BASE}pyodide-lock.json`)).text(),
  );
  const wanted = new Set(['numpy', 'sympy', 'scipy', 'matplotlib', 'pandas']);
  const queue = [...wanted];
  const done = new Set();

  while (queue.length) {
    const name = queue.shift();
    if (!name || done.has(name)) continue;
    done.add(name);
    const pkg = lock.packages?.[name];
    if (!pkg) continue;
    for (const dep of pkg.depends ?? []) queue.push(dep);
    try {
      const size = await fetchTo(pkg.file_name);
      total += size;
      console.log(`  ${pkg.file_name} — ${(size / 1024 / 1024).toFixed(1)} MB`);
    } catch (err) {
      console.warn(`  skipped ${name}: ${err.message}`);
    }
  }

  console.log(
    `\nDone — about ${(total / 1024 / 1024).toFixed(0)} MB.\n` +
      'Set the Pyodide base URL in Settings to "./pyodide/" and redeploy.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
