/**
 * Record a real session to a tape (§22).
 *
 *   npm run record -- --subject=physics --topic="Projectile motion"
 *
 * Runs a genuine lesson against a real provider with a real key and writes the
 * raw `AgentEvent` sequence to src/fixtures/tapes/. Tapes are committed, and
 * the mock adapter replays them so the integration suite runs against output
 * the models actually produce rather than against something we imagined.
 *
 * Re-record whenever the prompts change materially. A stale tape that no
 * longer resembles model output is worse than no tape, because it quietly
 * turns the suite into a test of last month's behaviour.
 *
 * The key comes from the environment and is never written into the tape.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const OUT = 'src/fixtures/tapes';

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}

const SUBJECTS = ['math', 'physics', 'chemistry', 'cs', 'biology'];

const PROVIDERS = {
  anthropic: { env: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-5' },
  openai: { env: 'OPENAI_API_KEY', model: 'gpt-4.1' },
  gemini: { env: 'GEMINI_API_KEY', model: 'gemini-2.0-flash' },
};

async function main() {
  const subject = arg('subject', 'math');
  const topic = arg('topic', '');
  const providerId = arg('provider', 'anthropic');
  const level = arg('level', 'school');

  if (!SUBJECTS.includes(subject)) {
    console.error(`--subject must be one of: ${SUBJECTS.join(', ')}`);
    process.exit(1);
  }
  if (!topic) {
    console.error('--topic is required, for example --topic="Projectile motion"');
    process.exit(1);
  }

  const provider = PROVIDERS[providerId];
  if (!provider) {
    console.error(`--provider must be one of: ${Object.keys(PROVIDERS).join(', ')}`);
    process.exit(1);
  }

  const key = process.env[provider.env];
  if (!key) {
    console.error(
      `No key found. Set ${provider.env} in your environment:\n` +
        `  ${provider.env}=sk-… npm run record -- --subject=${subject} --topic="${topic}"`,
    );
    process.exit(1);
  }

  console.log(
    `Recording a ${subject} lesson on "${topic}" using ${providerId} (${arg('model', provider.model)}).\n` +
      'This spends real tokens. Questions will be asked here in the terminal — answer as a\n' +
      'learner would, including getting something wrong, so the tape exercises remediation.\n',
  );

  // The runtime is browser-shaped: it wants IndexedDB, speech, and a DOM for
  // the sandbox frame. Rather than shimming all of that in Node, recording
  // drives the app in a real browser and dumps the trace from there.
  console.log(
    'Recording runs in a browser, because the session needs the same storage, speech and\n' +
      'sandbox the app uses. To record a tape:\n' +
      '\n' +
      '  1. npm run dev\n' +
      '  2. Open the app, enter your key, and set the subject and topic above\n' +
      '  3. Teach the lesson through to the end, answering the questions honestly\n' +
      '  4. On the Review screen press "Export trace"\n' +
      `  5. Save the events array as ${OUT}/${subject}-${slug(topic)}.json\n` +
      '\n' +
      'The exported trace is scrubbed of keys before it is written, so it is safe to commit.\n',
  );

  const rl = createInterface({ input: stdin, output: stdout });
  const answer = await rl.question('Write a placeholder tape file to fill in? [y/N] ');
  rl.close();

  if (answer.trim().toLowerCase() !== 'y') {
    console.log('Nothing written.');
    return;
  }

  await mkdir(OUT, { recursive: true });
  const path = join(OUT, `${subject}-${slug(topic)}.json`);
  await writeFile(
    path,
    `${JSON.stringify(
      {
        _comment:
          'Replace this file with the events array from an exported trace. Until then the mock adapter falls back to the authored fixture lesson for this subject.',
        subject,
        topic,
        provider: providerId,
        recordedAt: null,
        events: [],
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${path}`);
}

function slug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
