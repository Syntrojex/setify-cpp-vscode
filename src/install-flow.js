'use strict';
const path = require('path');
const { execFileSync } = require('child_process');
const { findCompiler } = require('./find-compiler');
const { downloadAndInstall } = require('./compiler-fetch');
const { addToUserPath } = require('./system');
const { wireGlobalVscode } = require('./vscode-global');
const { isXcodeToolsInstalled, triggerXcodeToolsInstall } = require('./mac-install');
const { PRIMARY_INSTALL_DIR } = require('./config');


async function safeWire(binDir, binaryName, log) {
  try {
    const compilerPath = await wireGlobalVscode(binDir, binaryName);
    log(`VS Code wired up globally (${compilerPath}), using ${binaryName}.`);
    return true;
  } catch (e) {
    log(`Could not update VS Code settings: ${e.message}`);
    return false;
  }
}


function safeAddToUserPath(dir, log) {
  try {
    return addToUserPath(dir);
  } catch (e) {
    log(`Could not update PATH automatically (${e.message}) — continuing anyway, VS Code will still work.`);
    return false;
  }
}


async function runWindowsInstall(log) {
  log('Scanning your system for an existing C++ compiler...');
  const { onPath, others } = findCompiler();
  let binDir;

  if (onPath) {
    log(`Found: ${onPath.version}`);
    try {
      binDir = path.dirname(execFileSync('where', [onPath.binary], { encoding: 'utf8' }).split('\n')[0].trim());
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

  const binary = onPath ? onPath.binary : 'g++';
  try {
    const version = execFileSync(path.join(binDir, `${binary}.exe`), ['--version'], { encoding: 'utf8' }).split('\n')[0];
    log(`Verified: ${version}`);
  } catch (e) {
    log('Could not verify compiler — you may need to reload VS Code.');
  }

  if (!(await safeWire(binDir, binary, log))) {
    return { ok: false, message: 'Compiler is installed, but VS Code settings could not be updated automatically.' };
  }

  log('Setup complete — this works in every folder VS Code opens now.');
  return { ok: true, binDir, message: 'Setup complete' };
}

async function runMacInstall(log) {
  log('Scanning your system for an existing C++ compiler...');
  const { onPath, others } = findCompiler();

  if (onPath) {
    log(`Found: ${onPath.version} (${onPath.binary})`);
    let binDir;
    try {
      binDir = path.dirname(execFileSync('which', [onPath.binary], { encoding: 'utf8' }).trim());
    } catch (e) {
      return { ok: false, message: `Compiler detected but its location could not be resolved: ${e.message}` };
    }
    if (!(await safeWire(binDir, onPath.binary, log))) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  if (others.length > 0) {
    log(`Found: ${others[0].version} (${others[0].binary})`);
    if (!(await safeWire(others[0].dir, others[0].binary, log))) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  if (isXcodeToolsInstalled()) {

    log('Xcode Command Line Tools are registered, but no working compiler was found.');
    log('This usually means the installation was interrupted or is incomplete.');
    log('Try running this in Terminal to reinstall cleanly, then run Setup again:');
    log('  sudo rm -rf /Library/Developer/CommandLineTools && xcode-select --install');
    return { ok: false, message: 'Xcode Command Line Tools appear incomplete — see the Output panel for a fix.' };
  }

  log('No compiler found. Triggering the Xcode Command Line Tools installer...');
  log('macOS requires you to click "Install" in the system dialog that just opened —');
  log('this is an Apple restriction, it cannot be automated further.');
  triggerXcodeToolsInstall((err) => {
    log(`Could not start the Xcode Command Line Tools installer: ${err.message}`);
    log('Try running "xcode-select --install" manually in Terminal instead.');
  });
  log("Setify C++ will keep checking in the background and finish setup automatically once it's done.");

  return { ok: false, waitingForXcodeInstall: true, message: 'Waiting on Xcode Command Line Tools install (user action required)' };
}

async function runLinuxInstall(log) {
  log('Scanning your system for an existing C++ compiler...');
  const { onPath, others } = findCompiler();

  if (onPath) {
    log(`Found: ${onPath.version} (${onPath.binary})`);
    let binDir;
    try {
      binDir = path.dirname(execFileSync('which', [onPath.binary], { encoding: 'utf8' }).trim());
    } catch (e) {
      return { ok: false, message: `Compiler detected but its location could not be resolved: ${e.message}` };
    }
    if (!(await safeWire(binDir, onPath.binary, log))) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  if (others.length > 0) {
    log(`Found: ${others[0].version} (${others[0].binary})`);
    if (!(await safeWire(others[0].dir, others[0].binary, log))) {
      return { ok: false, message: 'Compiler found, but VS Code settings could not be updated automatically.' };
    }
    return { ok: true, message: 'Setup complete' };
  }

  log('No C++ compiler found. Package managers differ too much across distros to');
  log('install one automatically, and Setify C++ will never run sudo on your behalf.');
  log('Install one yourself, for example:');
  log('  sudo apt install g++       (Debian, Ubuntu)');
  log('  sudo dnf install gcc-c++   (Fedora, RHEL)');
  log('  sudo pacman -S gcc         (Arch)');
  log('  sudo zypper install gcc-c++ (openSUSE)');
  log('Once installed, run "Setify C++: Setup C++ Compiler" again — it will be wired up automatically.');

  return { ok: false, message: 'No compiler found — install one via your package manager, then run Setup again' };
}

async function runInstall(log = () => {}) {
  if (process.platform === 'win32') return runWindowsInstall(log);
  if (process.platform === 'darwin') return runMacInstall(log);
  if (process.platform === 'linux') return runLinuxInstall(log);

  log('Setify C++ does not support automatic setup on this platform.');
  return { ok: false, message: 'Unsupported platform for automatic install' };
}

module.exports = { runInstall };
