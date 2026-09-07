'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { findCompiler } = require('./find-compiler');
const { downloadAndInstall } = require('./compiler-fetch');
const { addToUserPath } = require('./system');
const { wireGlobalVscode } = require('./vscode-global');
const { isXcodeToolsInstalled, triggerXcodeToolsInstall } = require('./mac-install');
const { PRIMARY_INSTALL_DIR } = require('./config');

/**
 * Wraps wireGlobalVscode so a parse failure on the user's existing
 * settings.json (which makes it throw, by design — see vscode-global.js)
 * turns into a graceful { ok: false } result instead of an unhandled
 * exception bubbling all the way up through VS Code's progress API.
 */
function safeWire(binDir, log) {
  try {
    const settingsPath = wireGlobalVscode(binDir);
    log(`VS Code wired up globally (${settingsPath}).`);
    return true;
  } catch (e) {
    log(`Could not update VS Code settings: ${e.message}`);
    return false;
  }
}

/**
 * Wraps addToUserPath so a PowerShell failure (e.g. a locked-down corporate
 * machine with restrictive execution policy) doesn't crash the whole setup.
 * PATH is a nice-to-have for terminal use — the part that actually matters
 * for VS Code's Run button is wireGlobalVscode() pointing at the compiler's
 * absolute path directly, so a PATH failure here is logged and setup
 * continues rather than aborting.
 */
function safeAddToUserPath(dir, log) {
  try {
    return addToUserPath(dir);
  } catch (e) {
    log(`Could not update PATH automatically (${e.message}) — continuing anyway, VS Code will still work.`);
    return false;
  }
}

/**
 * Windows flow: fully automatic. Detect → download MinGW if missing →
 * add to PATH → wire VS Code globally.
 */
async function runWindowsInstall(log) {
  log('Scanning your system for an existing C++ compiler...');
  const { onPath, others } = findCompiler();
  let binDir;

  if (onPath) {
    log(`Found: ${onPath}`);
    try {
      binDir = path.dirname(execFileSync('where', ['g++'], { encoding: 'utf8' }).split('\n')[0].trim());
    } catch (e) {
      return { ok: false, message: `Compiler detected but its location could not be resolved: ${e.message}` };
    }
  } else if (others.length > 0) {
    log(`Found (not on PATH yet): ${others[0].version}`);
    safeAddToUserPath(others[0].dir, log);
    log('Added to PATH.');
    binDir = others[0].dir;
  } else {
    log(`No compiler found. Installing MinGW-w64 to ${PRIMARY_INSTALL_DIR}...`);
    log('Downloading (~260MB) — this can take a few minutes.');
    let installedTo;
    try {
      installedTo = await downloadAndInstall(
        (fallbackDir) => {
          log(`C:\\ isn't writable without admin rights — using ${fallbackDir} instead.`);
        },
        (attempt, totalAttempts, err) => {
          log(`Connection issue (${err.message}) — resuming download, attempt ${attempt + 1}/${totalAttempts}...`);
        }
      );
    } catch (e) {
      log(`Download failed: ${e.message}`);
      return { ok: false, message: e.message };
    }
    log(`Installed to ${installedTo}`);
    binDir = path.join(installedTo, 'bin');
    const added = safeAddToUserPath(binDir, log);
    log(added ? 'Added to PATH.' : 'Already on PATH (or could not be updated).');
  }

  try {
    const version = execFileSync(path.join(binDir, 'g++.exe'), ['--version'], { encoding: 'utf8' }).split('\n')[0];
    log(`Verified: ${version}`);
  } catch (e) {
    log('Could not verify g++ — you may need to reload VS Code.');
  }

  if (!safeWire(binDir, log)) {
    return { ok: false, message: 'Compiler is installed, but VS Code settings could not be updated automatically.' };
  }

  log('Setup complete — this works in every folder VS Code opens now.');
  return { ok: true, binDir, message: 'Setup complete' };
}

/**
 * macOS flow: Apple does not allow silently installing Xcode Command Line
 * Tools — it always requires the user to click "Install" in a native
 * system dialog. We detect, and either confirm it's already there, or
 * trigger that dialog and tell the user what to do next. Homebrew's gcc
 * (if present) is detected the same way as any other known location.
 */
async function runMacInstall(log) {
  log('Scanning your system for an existing C++ compiler...');
  const { onPath, others } = findCompiler();

  if (onPath) {
    log(`Found: ${onPath}`);
    let binDir;
    try {
      binDir = path.dirname(execFileSync('which', ['g++'], { encoding: 'utf8' }).trim());
    } catch (e) {
      return { ok: false, message: `Compiler detected but its location could not be resolved: ${e.message}` };
    }
    if (!safeWire(binDir, log)) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  if (others.length > 0) {
    log(`Found: ${others[0].version}`);
    if (!safeWire(others[0].dir, log)) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  if (isXcodeToolsInstalled()) {
    // Tools report installed but g++/clang wasn't picked up above — rare, but
    // don't loop the install dialog in that case.
    log('Xcode Command Line Tools are installed, but g++ could not be verified.');
    log('Try reloading VS Code, or run "xcode-select --install" manually in Terminal.');
    return { ok: false, message: 'Compiler not verified after Xcode Tools check' };
  }

  log('No compiler found. Triggering the Xcode Command Line Tools installer...');
  log('macOS requires you to click "Install" in the system dialog that just opened —');
  log('this is an Apple restriction, it cannot be automated further.');
  triggerXcodeToolsInstall();
  log('Once that finishes (can take several minutes), reload VS Code or run "Setify C++: Setup C++ Compiler" again.');

  return { ok: false, message: 'Waiting on Xcode Command Line Tools install (user action required)' };
}

/**
 * Runs the full detect → install → wire flow, branching by OS.
 * `log(message)` is called at each step so the caller can show progress.
 * Returns { ok: boolean, binDir?: string, message: string }
 */
async function runInstall(log = () => {}) {
  if (process.platform === 'win32') return runWindowsInstall(log);
  if (process.platform === 'darwin') return runMacInstall(log);

  log('Setify C++ currently supports Windows and macOS automatic setup.');
  log('On Linux, install g++ via your package manager (e.g. "sudo apt install g++"), then reload VS Code.');
  return { ok: false, message: 'Unsupported platform for automatic install' };
}

module.exports = { runInstall };
