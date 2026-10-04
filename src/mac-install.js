'use strict';
const { execSync, spawn } = require('child_process');

/**
 * Checks if Xcode Command Line Tools are installed via `xcode-select -p`.
 * NOTE: this only confirms the path is registered — it does NOT guarantee
 * the toolchain inside is complete/working (a previous interrupted or
 * partial install can leave xcode-select "aware" of a broken installation).
 * Callers should still verify an actual compiler resolves before trusting
 * this alone.
 */
function isXcodeToolsInstalled() {
  try {
    execSync('xcode-select -p', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Triggers the native macOS installer dialog for Command Line Tools.
 * Apple requires explicit user consent through this GUI dialog — there is
 * no way to install it silently/headlessly, by design. This function only
 * *starts* the process; it does not (and cannot) wait for the user to
 * finish clicking through it.
 *
 * @param {(err: Error) => void} [onError] - called if the spawn itself
 *   fails (e.g. the `xcode-select` binary is missing, a permissions issue,
 *   or some other OS-level problem launching it). Without this handler, a
 *   failed spawn on a detached, unref'd child process becomes an unhandled
 *   error — this makes sure it's surfaced instead of silently swallowed.
 */
function triggerXcodeToolsInstall(onError) {
  const child = spawn('xcode-select', ['--install'], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    if (typeof onError === 'function') onError(err);
  });
  child.unref();
}

module.exports = { isXcodeToolsInstalled, triggerXcodeToolsInstall };
