/*
 * Content-Security-Policy bootstrap.
 *
 * The policy is mostly static, but §5.5 lets a learner point the "compatible"
 * adapter at their own base URL (Ollama, LM Studio, vLLM, a company gateway).
 * A hard-coded <meta> could never allow that host, and the alternative —
 * a wide-open connect-src — throws away the guarantee that the key can only
 * travel to the endpoint the user chose.
 *
 * So the meta element is assembled here instead, synchronously during head
 * parsing, from the one origin the user has actually configured. This file is
 * loaded with a plain <script src>, not inline, so script-src stays 'self'.
 */
(function () {
  var PROVIDERS = [
    'https://api.anthropic.com',
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'https://openrouter.ai',
  ];
  var KNOWLEDGE = ['https://en.wikipedia.org', 'https://*.wikipedia.org'];
  var PYODIDE = ['https://cdn.jsdelivr.net'];

  var extra = [];
  try {
    var raw = localStorage.getItem('chalk.settings');
    if (raw) {
      var s = JSON.parse(raw);
      var base = s && s.compatibleBaseUrl;
      if (typeof base === 'string' && base) {
        var u = new URL(base);
        extra.push(u.protocol + '//' + u.host);
      }
      if (s && typeof s.pyodideBaseUrl === 'string' && s.pyodideBaseUrl.indexOf('http') === 0) {
        extra.push(new URL(s.pyodideBaseUrl).origin);
      }
    }
  } catch (e) {
    /* A malformed settings blob must not stop the app from booting. */
  }

  var connect = ["'self'", 'blob:', 'data:']
    .concat(PROVIDERS, KNOWLEDGE, PYODIDE, extra)
    .join(' ');

  var policy = [
    "default-src 'self'",
    // blob: lets the sandbox load learner code as a module instead of eval'ing
    // it; wasm-unsafe-eval is what Pyodide needs to compile its runtime.
    "script-src 'self' blob: 'wasm-unsafe-eval' " + PYODIDE.join(' '),
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'self' blob:",
    'connect-src ' + connect,
    "img-src 'self' data: blob:",
    // KaTeX and the board's computed layout both write style attributes.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  var meta = document.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', policy);
  document.head.appendChild(meta);
})();
