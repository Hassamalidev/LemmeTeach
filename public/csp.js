/*
 * Content-Security-Policy bootstrap.
 *
 * connect-src is the guarantee behind §19: the page can reach our own origin
 * (for activation), the model providers, Wikipedia and the Pyodide CDN, and
 * nothing else. A key cannot travel anywhere it should not.
 *
 * The policy is assembled here, synchronously during head parsing, because a
 * self-hosted Pyodide (npm run vendor:pyodide) changes one of those origins.
 * This file is loaded with a plain <script src>, not inline, so script-src
 * stays 'self'.
 */
(function () {
  // The gateway a plan uses, and every service a learner's own key can
  // belong to (§5.8). A key only ever travels to the one that issued it.
  // Must list every origin in OWN_KEY_ORIGINS (src/providers/own-key.ts); a
  // test holds the two together.
  var PROVIDERS = [
    'https://openrouter.ai',
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'https://api.mistral.ai',
    'https://api.groq.com',
    'https://api.deepseek.com',
    'https://api.x.ai',
    'https://api.together.xyz',
    'https://api.fireworks.ai',
    'https://api.cerebras.ai',
    'https://api.cohere.ai',
    'https://dashscope-intl.aliyuncs.com',
    'https://api.moonshot.ai',
    'https://api.hyperbolic.xyz',
  ];
  // A local Ollama, on a local page only. Matches the development-only entry
  // in src/providers/own-key.ts; a deployed site never gets it.
  if (location.hostname === 'localhost') PROVIDERS.push('http://localhost:11434');
  var KNOWLEDGE = ['https://en.wikipedia.org', 'https://*.wikipedia.org'];
  // Paddle's checkout (§24): its script, the window it opens over the page,
  // and the requests that window makes. Loaded only when someone pays.
  var PADDLE = ['https://cdn.paddle.com', 'https://*.paddle.com'];
  var PYODIDE = ['https://cdn.jsdelivr.net'];

  var extra = [];
  try {
    var raw = localStorage.getItem('chalk.settings');
    if (raw) {
      var s = JSON.parse(raw);
      if (s && typeof s.pyodideBaseUrl === 'string' && s.pyodideBaseUrl.indexOf('http') === 0) {
        extra.push(new URL(s.pyodideBaseUrl).origin);
      }
    }
  } catch (e) {
    /* A malformed settings blob must not stop the app from booting. */
  }

  var connect = ["'self'", 'blob:', 'data:']
    .concat(PROVIDERS, KNOWLEDGE, PYODIDE, PADDLE, extra)
    .join(' ');

  var policy = [
    "default-src 'self'",
    // blob: lets the sandbox load learner code as a module instead of eval'ing
    // it; wasm-unsafe-eval is what Pyodide needs to compile its runtime.
    "script-src 'self' blob: 'wasm-unsafe-eval' " + PYODIDE.concat(PADDLE).join(' '),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob: " + PADDLE.join(' '),
    'connect-src ' + connect,
    "img-src 'self' data: blob: " + PADDLE.join(' '),
    // KaTeX and the board's computed layout both write style attributes.
    // Paddle's checkout brings its own stylesheet and fonts.
    "style-src 'self' 'unsafe-inline' " + PADDLE.join(' '),
    "font-src 'self' data: " + PADDLE.join(' '),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  var meta = document.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', policy);
  document.head.appendChild(meta);
})();
