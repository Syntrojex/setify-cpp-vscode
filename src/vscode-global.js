'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { execFileSync } = require('child_process');

const VALID_C_STANDARDS = ['c89', 'c99', 'c11', 'c17', 'c23', 'gnu89', 'gnu99', 'gnu11', 'gnu17', 'gnu23'];
const VALID_CPP_STANDARDS = [
  'c++98', 'c++03', 'c++11', 'c++14', 'c++17', 'c++20', 'c++23',
  'gnu++98', 'gnu++03', 'gnu++11', 'gnu++14', 'gnu++17', 'gnu++20', 'gnu++23'
];
const INTELLISENSE_MODE_RE = /^(windows|linux|macos)-(gcc|clang|msvc)-(x86|x64|arm|arm64)$/;

function isValidCStandard(v) {
  return typeof v === 'string' && VALID_C_STANDARDS.includes(v);
}
function isValidCppStandard(v) {
  return typeof v === 'string' && VALID_CPP_STANDARDS.includes(v);
}
function isValidIntelliSenseMode(v) {
  return typeof v === 'string' && INTELLISENSE_MODE_RE.test(v);
}

function intelliSenseModeFor(isWin, isMac) {
  if (isWin) return 'windows-gcc-x64';
  if (isMac) return process.arch === 'arm64' ? 'macos-clang-arm64' : 'macos-clang-x64';
  return process.arch === 'arm64' ? 'linux-gcc-arm64' : 'linux-gcc-x64';
}

/**
 * Writes compiler info into VS Code's GLOBAL settings using VS Code's own
 * configuration API, instead of hand-parsing and rewriting settings.json.
 *
 * IMPORTANT — what gets overwritten vs. preserved:
 *   - compilerPath is ALWAYS set. Pointing VS Code at a working compiler is
 *     Setify's entire job, not a "preference" — there's only one correct
 *     value here (wherever the compiler this run detected/installed
 *     actually lives), so this always reflects that.
 *   - intelliSenseMode is ALWAYS set to match the platform/arch/compiler
 *     Setify just configured. This isn't something a user meaningfully
 *     hand-picks independent of the compiler — an incorrect value here
 *     just breaks IntelliSense, it's never a legitimate "different but
 *     valid" choice the way a C++ standard version is.
 *   - cStandard / cppStandard are ONLY set when missing or not a value
 *     cpptools actually recognizes. If the user has already chosen, say,
 *     c++20, that's a legitimate personal preference — Setify has no
 *     business quietly reverting it back to its own c++17 default every
 *     time self-healing runs. This is the fix for a real bug: earlier
 *     versions always overwrote these on every wire, silently discarding
 *     a user's own standard-version choice.
 *   - debugShortcut is ONLY set when the key doesn't exist yet. If a user
 *     explicitly turned this off (they prefer cpptools' own Run icon
 *     hidden, for whatever reason), that's their call to keep — Setify
 *     only sets a default for someone who never touched this setting.
 *   - debuggerPath (Windows/Linux only, never macOS — see below) is only
 *     set when a real gdb binary is found; never forced onto a value that
 *     doesn't exist.
 *
 * @param {string} binDir - directory containing the compiler binary
 * @param {string} [binaryName] - bare executable name to use, e.g. "clang++"
 *   or "g++" (without platform-specific extension). Defaults to "g++".
 */
async function wireGlobalVscode(binDir, binaryName) {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const compilerBinary = binaryName || 'g++';

  const exeName = isWin ? `${compilerBinary}.exe` : compilerBinary;
  const compilerPath = path.join(binDir, exeName).replace(/\\/g, '/');

  const config = vscode.workspace.getConfiguration();
  const target = vscode.ConfigurationTarget.Global;

  await config.update('C_Cpp.default.compilerPath', compilerPath, target);
  await config.update('C_Cpp.default.intelliSenseMode', intelliSenseModeFor(isWin, isMac), target);

  const existingCStandard = config.get('C_Cpp.default.cStandard');
  if (!isValidCStandard(existingCStandard)) {
    await config.update('C_Cpp.default.cStandard', 'c17', target);
  }

  const existingCppStandard = config.get('C_Cpp.default.cppStandard');
  if (!isValidCppStandard(existingCppStandard)) {
    await config.update('C_Cpp.default.cppStandard', 'c++17', target);
  }

  const existingDebugShortcut = config.get('C_Cpp.debugShortcut');
  if (existingDebugShortcut === undefined) {
    await config.update('C_Cpp.debugShortcut', true, target);
  }

  if (!isMac) {
    const gdbPath = path.join(binDir, isWin ? 'gdb.exe' : 'gdb').replace(/\\/g, '/');
    if (fs.existsSync(gdbPath)) {
      await config.update('C_Cpp.default.debuggerPath', gdbPath, target);
    }
  }

  return compilerPath;
}

function isGloballyWired() {
  const config = vscode.workspace.getConfiguration();
  const compilerPath = config.get('C_Cpp.default.compilerPath');
  if (!compilerPath || !fs.existsSync(compilerPath)) return false;

  try {
    const output = execFileSync(compilerPath, ['--version'], { encoding: 'utf8' }).toLowerCase();
    const compilerSignatures = ['gcc', 'g++', 'clang', 'mingw', 'apple llvm'];
    if (!compilerSignatures.some((sig) => output.includes(sig))) return false;
  } catch (e) {
    return false;
  }

  if (!isValidCStandard(config.get('C_Cpp.default.cStandard'))) return false;
  if (!isValidCppStandard(config.get('C_Cpp.default.cppStandard'))) return false;
  if (!isValidIntelliSenseMode(config.get('C_Cpp.default.intelliSenseMode'))) return false;

  return true;
}

module.exports = { wireGlobalVscode, isGloballyWired };
