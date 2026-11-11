// In-process harness for the real-editor suites.
//
// Why hand-rolled instead of a test framework: `@vscode/test-electron` asks
// `extensionTestsPath` for exactly one thing — an exported `run()` that the
// Extension Development Host calls *inside its own process* (see
// `@vscode/test-electron/out/runTest.d.ts`). That process is also the only place
// `require("vscode")` resolves, so the specs must execute in it rather than in a
// runner's worker pool. All this file supplies is the three globals the specs use
// — `suite` / `suiteSetup` / `test`, plus `this.timeout(ms)` — a per-test
// timeout, and a failure count that is thrown, which is what the host looks at.
const DEFAULT_TIMEOUT_MS = 180000;

const indent = (depth) => "  ".repeat(depth);

/** The `this` a suite body, hook or test sees; only `timeout()` is provided. */
function makeContext(owner) {
  return {
    timeout(ms) {
      owner.timeoutMs = ms;
      return this;
    },
  };
}

function newSuite(title, parent) {
  return {
    title,
    parent,
    depth: parent ? parent.depth + 1 : 0,
    timeoutMs: undefined,
    tests: [],
    suites: [],
    setup: [],
    teardown: [],
  };
}

/** Nearest declared timeout wins: test > its suite > enclosing suites > default. */
function timeoutFor(test, suite, defaultTimeoutMs) {
  if (test && test.timeoutMs !== undefined) return test.timeoutMs;
  for (let current = suite; current; current = current.parent) {
    if (current.timeoutMs !== undefined) return current.timeoutMs;
  }
  return defaultTimeoutMs;
}

async function withTimeout(fn, ms, label, context) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fn.call(context)),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout of ${ms}ms exceeded: ${label}`)),
          ms,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Install the globals, load the spec, then put the previous globals back: a spec
 * registers its suites synchronously at require time, exactly like Mocha.
 */
function collect(specPath) {
  const root = newSuite("", null);
  const stack = [root];

  const impls = {
    suite(title, fn) {
      const current = stack[stack.length - 1];
      const suite = newSuite(title, current);
      current.suites.push(suite);
      stack.push(suite);
      try {
        fn.call(makeContext(suite));
      } finally {
        stack.pop();
      }
    },
    suiteSetup(fn) {
      stack[stack.length - 1].setup.push(fn);
    },
    suiteTeardown(fn) {
      stack[stack.length - 1].teardown.push(fn);
    },
    test(title, fn) {
      stack[stack.length - 1].tests.push({ title, fn, timeoutMs: undefined });
    },
  };

  const previous = {};
  for (const [name, impl] of Object.entries(impls)) {
    previous[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    globalThis[name] = impl;
  }
  try {
    require(specPath);
  } finally {
    for (const [name, descriptor] of Object.entries(previous)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
  return root;
}

async function runTest(suite, test, results, defaultTimeoutMs) {
  const started = Date.now();
  const at = indent(suite.depth + 1);
  try {
    await withTimeout(
      test.fn,
      timeoutFor(test, suite, defaultTimeoutMs),
      test.title,
      makeContext(test),
    );
    results.passed += 1;
    console.log(`${at}✔ ${test.title} (${Date.now() - started}ms)`);
  } catch (error) {
    results.failures.push({ title: test.title, error });
    console.log(`${at}✗ ${test.title} (${Date.now() - started}ms)`);
    console.log(`${at}  ${(error && error.stack) || error}`);
  }
}

/** A failed `suiteSetup` fails every test below it, as Mocha does. */
function failSubtree(suite, error, results) {
  for (const test of suite.tests) {
    results.failures.push({ title: test.title, error });
    console.log(
      `${indent(suite.depth + 1)}✗ ${test.title} (suiteSetup failed)`,
    );
  }
  for (const child of suite.suites) failSubtree(child, error, results);
}

async function runSuite(suite, results, defaultTimeoutMs) {
  const context = makeContext(suite);
  const timeoutMs = timeoutFor(undefined, suite, defaultTimeoutMs);

  let setupError = null;
  for (const hook of suite.setup) {
    try {
      await withTimeout(hook, timeoutMs, `${suite.title} suiteSetup`, context);
    } catch (error) {
      setupError = error;
      break;
    }
  }

  if (setupError) {
    console.log(`${indent(suite.depth + 1)}✗ ${suite.title} suiteSetup`);
    console.log(`${indent(suite.depth + 2)}${setupError.stack || setupError}`);
    failSubtree(suite, setupError, results);
  } else {
    for (const test of suite.tests) {
      await runTest(suite, test, results, defaultTimeoutMs);
    }
    for (const child of suite.suites) {
      await runSuite(child, results, defaultTimeoutMs);
    }
  }

  for (const hook of suite.teardown) {
    try {
      await withTimeout(
        hook,
        timeoutMs,
        `${suite.title} suiteTeardown`,
        context,
      );
    } catch (error) {
      results.failures.push({ title: `${suite.title} suiteTeardown`, error });
      console.log(`${indent(suite.depth + 1)}✗ ${suite.title} suiteTeardown`);
      console.log(`${indent(suite.depth + 2)}${error.stack || error}`);
    }
  }
}

/** Load `specPath` and run it; throws when anything failed or nothing ran. */
exports.runSpec = async function runSpec(specPath, options = {}) {
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const root = collect(specPath);
  const results = { passed: 0, failures: [] };
  await runSuite(root, results, defaultTimeoutMs);

  const total = results.passed + results.failures.length;
  if (total === 0) {
    throw new Error(`no tests collected from ${specPath}`);
  }
  console.log(
    `\n${results.passed}/${total} passing` +
      (results.failures.length ? `, ${results.failures.length} failing` : ""),
  );
  if (results.failures.length > 0) {
    throw new Error(
      `${results.failures.length} test(s) failed: ` +
        results.failures.map((failure) => failure.title).join("; "),
    );
  }
};
