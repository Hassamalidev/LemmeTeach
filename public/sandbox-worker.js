/*
 * Sandbox worker (§11).
 *
 * Runs learner-visible code on its own thread so it can be terminated on
 * timeout. Two languages: JavaScript, which starts instantly, and Python via
 * Pyodide, which costs three to five seconds the first time and is therefore
 * only worth it for numpy, sympy, scipy, matplotlib and pandas.
 *
 * Network access is removed here, before any user code runs. The CSP is a
 * second layer, not the only one.
 */
'use strict';

/* --------------------------- no network, at all --------------------------- */

(function removeNetwork() {
  var refuse = function (name) {
    return function () {
      throw new Error(
        name +
          ' is not available in the sandbox. Code here computes and draws; it cannot reach the network.',
      );
    };
  };
  // Captured before anything else runs, so Pyodide's own loader can still use
  // the originals through the closure below.
  self.__chalkFetch = self.fetch ? self.fetch.bind(self) : null;
  self.__chalkXHR = self.XMLHttpRequest;

  self.XMLHttpRequest = refuse('XMLHttpRequest');
  self.WebSocket = refuse('WebSocket');
  self.EventSource = refuse('EventSource');
  self.importScripts = (function (original) {
    return function () {
      // Pyodide's loader needs this; user code does not get a chance to call
      // it, because it runs after the lock is set.
      if (self.__chalkLocked) {
        throw new Error('importScripts is not available in the sandbox.');
      }
      return original.apply(self, arguments);
    };
  })(self.importScripts);
})();

var pyodide = null;
var pyodideLoading = null;
var loadedPackages = {};

var ALLOWED_PACKAGES = ['numpy', 'sympy', 'scipy', 'matplotlib', 'pandas'];

function progress(message) {
  self.postMessage({ type: 'progress', message: message });
}

function reply(result) {
  self.postMessage({ type: 'result', result: result });
}

/* ------------------------------ JavaScript ------------------------------- */

/**
 * Executed as a blob module rather than through eval or new Function, so the
 * page never needs 'unsafe-eval' in its CSP.
 */
async function runJavaScript(source, seed) {
  var stdout = [];
  var log = function () {
    var parts = [];
    for (var i = 0; i < arguments.length; i++) parts.push(formatValue(arguments[i]));
    stdout.push(parts.join(' '));
  };

  var previousConsole = self.console;
  self.console = { log: log, info: log, warn: log, error: log, debug: log };

  // Seeded so a replayed tape produces identical output (§11).
  var rngState = seed >>> 0 || 1;
  var seededRandom = function () {
    rngState ^= rngState << 13;
    rngState ^= rngState >>> 17;
    rngState ^= rngState << 5;
    return ((rngState >>> 0) % 1e9) / 1e9;
  };
  var previousRandom = Math.random;
  Math.random = seededRandom;

  try {
    var wrapped =
      'export default async function () {\n' +
      '"use strict";\n' +
      source +
      '\n}';
    var blob = new Blob([wrapped], { type: 'text/javascript' });
    var url = URL.createObjectURL(blob);
    var module = await import(/* @vite-ignore */ url);
    URL.revokeObjectURL(url);

    var value = await module.default();
    return {
      ok: true,
      stdout: stdout.join('\n'),
      result: value === undefined ? '' : formatValue(value),
      figures: [],
    };
  } catch (err) {
    return {
      ok: false,
      stdout: stdout.join('\n'),
      result: '',
      figures: [],
      error: String((err && err.stack) || err),
    };
  } finally {
    self.console = previousConsole;
    Math.random = previousRandom;
  }
}

function formatValue(v) {
  if (typeof v === 'string') return v;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  try {
    return JSON.stringify(v, null, 2);
  } catch (e) {
    return String(v);
  }
}

/* -------------------------------- Python --------------------------------- */

async function loadPyodide(baseUrl) {
  if (pyodide) return pyodide;
  if (pyodideLoading) return pyodideLoading;

  pyodideLoading = (async function () {
    progress('Setting up Python — about five seconds');
    self.importScripts(baseUrl + 'pyodide.js');
    pyodide = await self.loadPyodide({ indexURL: baseUrl });
    return pyodide;
  })();

  return pyodideLoading;
}

/** Which of the allowed packages the source actually imports. */
function detectPackages(source) {
  var wanted = [];
  for (var i = 0; i < ALLOWED_PACKAGES.length; i++) {
    var name = ALLOWED_PACKAGES[i];
    var re = new RegExp('(^|\\n)\\s*(import|from)\\s+' + name + '\\b');
    if (re.test(source)) wanted.push(name);
  }
  // matplotlib.pyplot needs numpy in practice, and asking for it up front
  // avoids a second load pause mid-lesson.
  if (wanted.indexOf('matplotlib') !== -1 && wanted.indexOf('numpy') === -1) {
    wanted.push('numpy');
  }
  return wanted;
}

function rejectedImports(source) {
  var found = [];
  var re = /(?:^|\n)\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  var builtins = [
    'math', 'random', 'itertools', 'functools', 'collections', 'statistics',
    'decimal', 'fractions', 'json', 're', 'string', 'textwrap', 'datetime',
    'heapq', 'bisect', 'copy', 'operator', 'time', 'cmath', 'typing', 'io',
    'abc', 'enum', 'dataclasses', 'unittest', 'sys', 'os', 'pprint', 'array',
  ];
  var m;
  while ((m = re.exec(source))) {
    var name = m[1];
    if (ALLOWED_PACKAGES.indexOf(name) === -1 && builtins.indexOf(name) === -1) {
      if (found.indexOf(name) === -1) found.push(name);
    }
  }
  return found;
}

var PRELUDE = [
  'import sys, io, random',
  '_chalk_stdout = io.StringIO()',
  'sys.stdout = _chalk_stdout',
  'sys.stderr = _chalk_stdout',
  'random.seed(__CHALK_SEED__)',
  'try:',
  '    import numpy as _np',
  '    _np.random.seed(__CHALK_SEED__)',
  'except Exception:',
  '    pass',
  'try:',
  '    import matplotlib',
  '    matplotlib.use("Agg")',
  'except Exception:',
  '    pass',
].join('\n');

var CAPTURE_FIGURES = [
  '_chalk_figures = []',
  'try:',
  '    import matplotlib.pyplot as _plt',
  '    import base64 as _b64, io as _io',
  '    for _num in _plt.get_fignums():',
  '        _fig = _plt.figure(_num)',
  '        _buf = _io.BytesIO()',
  '        _fig.savefig(_buf, format="png", dpi=140, bbox_inches="tight", facecolor="white")',
  '        _buf.seek(0)',
  '        _chalk_figures.append("data:image/png;base64," + _b64.b64encode(_buf.read()).decode())',
  '    _plt.close("all")',
  'except Exception:',
  '    pass',
  '_chalk_stdout.getvalue()',
].join('\n');

async function runPython(source, seed, baseUrl) {
  var refused = rejectedImports(source);
  if (refused.length) {
    return {
      ok: false,
      stdout: '',
      result: '',
      figures: [],
      error:
        'These modules are not available here: ' +
        refused.join(', ') +
        '. Available: numpy, sympy, scipy, matplotlib, pandas, and the Python standard library.',
    };
  }

  var py;
  try {
    py = await loadPyodide(baseUrl);
  } catch (err) {
    return {
      ok: false,
      stdout: '',
      result: '',
      figures: [],
      error:
        'Python could not be loaded (' +
        String(err) +
        '). This is usually a network restriction on the Pyodide CDN.',
    };
  }

  var wanted = detectPackages(source);
  var toLoad = [];
  for (var i = 0; i < wanted.length; i++) {
    if (!loadedPackages[wanted[i]]) toLoad.push(wanted[i]);
  }
  if (toLoad.length) {
    progress('Loading ' + toLoad.join(', '));
    try {
      await py.loadPackage(toLoad);
      for (var j = 0; j < toLoad.length; j++) loadedPackages[toLoad[j]] = true;
    } catch (err) {
      return {
        ok: false,
        stdout: '',
        result: '',
        figures: [],
        error: 'Could not load ' + toLoad.join(', ') + ': ' + String(err),
      };
    }
  }

  try {
    await py.runPythonAsync(PRELUDE.replace(/__CHALK_SEED__/g, String(seed | 0)));
    self.__chalkLocked = true;

    var value = await py.runPythonAsync(source);
    var stdout = await py.runPythonAsync(CAPTURE_FIGURES);
    var figures = py.globals.get('_chalk_figures');
    var figureList = figures ? figures.toJs() : [];
    if (figures && figures.destroy) figures.destroy();

    return {
      ok: true,
      stdout: String(stdout || ''),
      result: value === undefined || value === null ? '' : String(value),
      figures: figureList,
    };
  } catch (err) {
    var partial = '';
    try {
      partial = String(await py.runPythonAsync('_chalk_stdout.getvalue()'));
    } catch (e) {
      /* the traceback below is the useful part anyway */
    }
    return {
      ok: false,
      stdout: partial,
      result: '',
      figures: [],
      error: String((err && err.message) || err),
    };
  } finally {
    self.__chalkLocked = false;
    // Restore stdout so the next execution in this session starts clean.
    try {
      await py.runPythonAsync('import sys; sys.stdout = sys.__stdout__; sys.stderr = sys.__stderr__');
    } catch (e) {
      /* nothing useful to do */
    }
  }
}

/* --------------------------------- entry --------------------------------- */

self.onmessage = async function (e) {
  var msg = e.data || {};
  if (msg.type !== 'run') return;

  try {
    var result =
      msg.language === 'python'
        ? await runPython(msg.source, msg.seed, msg.pyodideBaseUrl)
        : await runJavaScript(msg.source, msg.seed);
    reply(result);
  } catch (err) {
    reply({
      ok: false,
      stdout: '',
      result: '',
      figures: [],
      error: String((err && err.stack) || err),
    });
  }
};
