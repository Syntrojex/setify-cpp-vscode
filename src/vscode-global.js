'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { VSCODE_USER_SETTINGS } = require('./config');

/**
 * Strips // and /* *\/ comments, and trailing commas, from a JSONC file so
 * it can be JSON.parse'd. VS Code's own settings.json format allows both —
 * a plain JSON.parse would choke on either.
 */
function stripJsonComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Reads and parses the user's existing settings.json.
 * Returns { settings, parseFailed }. On a parse failure — including the
 * content being valid JSON but not a plain object (e.g. an array, which
 * VS Code itself would never write there, but a corrupted file theoretically
 * could contain) — `settings` is an EMPTY object but `parseFailed` is true.
 * Callers must check this and refuse to write, rather than silently
 * overwriting a file we couldn't fully understand and risking deleting
 * everything the user already had configured there.
 */
function readSettings() {
  if (!fs.existsSync(VSCODE_USER_SETTINGS)) return { settings: {}, parseFailed: false };
  const raw = fs.readFileSync(VSCODE_USER_SETTINGS, 'utf8');
  if (!raw.trim()) return { settings: {}, parseFailed: false };
  try {
    const parsed = JSON.parse(stripJsonComments(raw));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { settings: {}, parseFailed: true };
    }
    return { settings: parsed, parseFailed: false };
  } catch (e) {
    return { settings: {}, parseFailed: true };
  }
}

/**
 * Resolves the correct cpptools IntelliSense mode string for the current
 * platform + architecture. Apple Silicon (M1/M2/M3/M4/M5, arm64) is NOT the
 * same as an Intel Mac — using "macos-clang-x64" on an arm64 Mac gives
 * cpptools a wrong target triple for IntelliSense.
 */
function intelliSenseModeFor(isWin, isMac) {
  if (isWin) return 'windows-gcc-x64';
  if (isMac) return process.arch === 'arm64' ? 'macos-clang-arm64' : 'macos-clang-x64';
  return 'linux-gcc-x64';
}

/**
 * Writes compiler info into VS Code's GLOBAL user settings — this is what
 * makes it work in any folder/project VS Code ever opens, not just the one
 * you happened to run Setify C++ in. Existing unrelated settings are
 * preserved.
 *
 * @param {string} binDir - directory containing the compiler binary
 * @param {string} [binaryName] - bare executable name to use, e.g. "clang++"
 *   or "g++" (without platform-specific extension). Detection tells us which
 *   one actually resolved — on macOS this is usually "clang++" since that's
 *   what /usr/bin/g++ really is under the hood. Defaults to "g++" for
 *   backwards compatibility (Windows always uses this).
 *
 * Throws if the existing settings.json couldn't be safely parsed, instead
 * of overwriting it — an unparseable file is left completely untouched
 * rather than risk destroying whatever the user already had in it.
 */
function wireGlobalVscode(binDir, binaryName) {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const compilerBinary = binaryName || 'g++';

  const exeName = isWin ? `${compilerBinary}.exe` : compilerBinary;
  const compilerPath = path.join(binDir, exeName).replace(/\\/g, '/');

  const { settings, parseFailed } = readSettings();
  if (parseFailed) {
    throw new Error(
      `Could not safely parse your existing VS Code settings.json (${VSCODE_USER_SETTINGS}) — ` +
        'left it untouched rather than risk overwriting it. Please fix any syntax errors in that file and try again.'
    );
  }

  settings['C_Cpp.default.compilerPath'] = compilerPath;
  settings['C_Cpp.default.cStandard'] = 'c17';
  settings['C_Cpp.default.cppStandard'] = 'c++17';
  settings['C_Cpp.default.intelliSenseMode'] = intelliSenseModeFor(isWin, isMac);
  settings['C_Cpp.debugShortcut'] = true;

  // Debugger path: only ever set this to a GDB binary, and only when one
  // genuinely exists next to the compiler (Windows/MinGW, or a Linux distro
  // GCC toolchain). macOS's native debugger is LLDB, which cpptools already
  // knows how to use on its own via the system's Xcode Command Line Tools —
  // forcing a gdb path there would be wrong and is never done.
  if (!isMac) {
    const gdbPath = path.join(binDir, isWin ? 'gdb.exe' : 'gdb').replace(/\\/g, '/');
    if (fs.existsSync(gdbPath)) {
      settings['C_Cpp.default.debuggerPath'] = gdbPath;
    }
  }

  fs.mkdirSync(path.dirname(VSCODE_USER_SETTINGS), { recursive: true });
  fs.writeFileSync(VSCODE_USER_SETTINGS, JSON.stringify(settings, null, 4));

  return VSCODE_USER_SETTINGS;
}

/**
 * True only if VS Code is wired to a compiler path that GENUINELY WORKS
 * right now on THIS platform — not just "a file exists at that path".
 *
 * Three things are checked, in order:
 *   1. The path actually resolves at all (fs.existsSync alone doesn't
 *      guarantee that — a broken symlink or a leftover from a different
 *      install could still "exist" without being usable).
 *   2. Running it with --version succeeds (exit code 0). A path could exist
 *      and even be executable without being a compiler at all.
 *   3. The --version output actually looks like a C/C++ compiler's. Many
 *      unrelated Unix tools also respond successfully to --version (e.g.
 *      `ls --version` exits 0 on most systems) — checking exit code alone
 *      isn't enough to distinguish "some executable" from "an actual
 *      compiler". Matching known compiler signature text closes that gap.
 *
 * This intentionally does NOT try to match the specific binary name
 * (clang++ vs g++) that Setify itself would have chosen — a user is free to
 * have a different, perfectly valid compiler configured, and that should
 * still count as "wired". What matters is that whatever is configured is a
 * real, currently-working compiler on this machine.
 */
function isGloballyWired() {
  const { settings } = readSettings();
  const compilerPath = settings['C_Cpp.default.compilerPath'];
  if (!compilerPath || !fs.existsSync(compilerPath)) return false;

  try {
    const output = execFileSync(compilerPath, ['--version'], { encoding: 'utf8' }).toLowerCase();
    const compilerSignatures = ['gcc', 'g++', 'clang', 'mingw', 'apple llvm'];
    return compilerSignatures.some((sig) => output.includes(sig));
  } catch (e) {
    return false;
  }
}

module.exports = { wireGlobalVscode, isGloballyWired, VSCODE_USER_SETTINGS };
