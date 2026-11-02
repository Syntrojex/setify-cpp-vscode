'use strict';
const { execSync, spawn } = require('child_process');

function isXcodeToolsInstalled() {
  try {
    execSync('xcode-select -p', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (e) {
    return false;
  }
}

function triggerXcodeToolsInstall(onError) {
  const child = spawn('xcode-select', ['--install'], { detached: true, stdio: 'ignore' });
  child.on('error', (err) => {
    if (typeof onError === 'function') onError(err);
  });
  child.unref();
}

module.exports = { isXcodeToolsInstalled, triggerXcodeToolsInstall };
