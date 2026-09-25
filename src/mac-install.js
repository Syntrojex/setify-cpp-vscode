'use strict';
const { execSync, spawn } = require('child_process');

function isXcodeToolsInstalled() {
  try {
    execSync('xcode-select -p', { stdio: 'ignore' });
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
