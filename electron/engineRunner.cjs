// Runs a helper program (the Python calculation engine) for one JSON request. Plain Node, so it can be
// tested with real child processes (src/model/engineRunner.test.ts).
//
// The program is started directly (no shell), gets the request on stdin and answers with JSON on stdout.
// The promise settles exactly once: with the answer, or a stable { error } when the program cannot start,
// fails, takes too long or writes more than the output limits. In those cases the child is stopped
// (SIGTERM, then SIGKILL if it is still running a moment later), so nothing is left running.

const { spawn: nodeSpawn } = require('node:child_process');
const { LIMITS, boundedCollector } = require('./limits.cjs');

function runJsonProcess({ command, args = [], input, timeoutMs = 120000, what = 'Engine', startError = (m) => `Could not start ${command}: ${m}`, spawn = nodeSpawn, stdoutBytes = LIMITS.engineStdoutBytes, stderrBytes = LIMITS.engineStderrBytes, killGraceMs = 2000, onSpawn = () => {} }) {
  return new Promise((resolve) => {
    let child;
    let settled = false;
    let timer;
    let killTimer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const running = () => child && child.exitCode === null && child.signalCode === null;
    const stop = () => {
      if (!running()) return;
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { if (running()) child.kill('SIGKILL'); } catch { /* already gone */ } }, killGraceMs);
    };
    const abort = (message) => { finish({ error: message }); stop(); };
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      finish({ error: startError(e.message) });
      return;
    }
    onSpawn(child);
    const out = boundedCollector(stdoutBytes, () => abort(`${what} output is too large (limit ${Math.round(stdoutBytes / 1024)} KB)`));
    const err = boundedCollector(stderrBytes, () => {}, true);
    timer = setTimeout(() => abort(`${what} timed out after ${timeoutMs / 1000} s`), timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => err.push(d));
    child.stdin.on('error', () => { /* the program closed its input early; its exit says why */ });
    child.on('error', (e) => abort(startError(e.message)));
    child.on('close', (code, signal) => {
      clearTimeout(killTimer);
      if (settled) return;
      try {
        finish(JSON.parse(out.text()));
      } catch {
        const tail = err.text().trim().split(/\r?\n/).slice(-3).join(' ');
        finish({ error: `${what} exited with ${code === null ? `signal ${signal}` : `code ${code}`}. ${tail}`.trim() });
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

module.exports = { runJsonProcess };
