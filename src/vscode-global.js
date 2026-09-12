'use strict';
const fs = require('fs');
const path = require('path');
const vscode = require('vscode');
const { execFileSync } = require('child_process');

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
 * Writes compiler info into VS Code's GLOBAL settings using VS Code's own
 * configuration API (vscode.workspace.getConfiguration().update(...) with
 * ConfigurationTarget.Global) instead of hand-parsing and rewriting
 * settings.json ourselves.
 *
 * This matters: a manual JSON.parse + regex-based comment/trailing-comma
 * stripper is fragile — e.g. a `//` inside a string value like a URL
 * ("https://example.com") could be mis-stripped by a naive comment regex,
 * and rewriting the whole file with JSON.stringify throws away the user's
 * original formatting and comments even for keys we never touched. VS
 * Code's own API updates exactly the keys we ask for, safely, using the
 * same mechanism the Settings UI itself uses — no parsing risk, no
 * clobbered formatting.
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
  await config.update('C_Cpp.default.cStandard', 'c17', target);
  await config.update('C_Cpp.default.cppStandard', 'c++17', target);
  await config.update('C_Cpp.default.intelliSenseMode', intelliSenseModeFor(isWin, isMac), target);
  // Keeps the C/C++ extension's own native ▶ Run icon (top-right of the
  // editor) visible — this IS the "VS Code Run" the user runs their code
  // with.
  await config.update('C_Cpp.debugShortcut', true, target);

  // Debugger path: only ever set this to a GDB binary, and only when one
  // genuinely exists next to the compiler (Windows/MinGW, or a Linux distro
  // GCC toolchain). macOS's native debugger is LLDB, which cpptools already
  // knows how to use on its own via the system's Xcode Command Line Tools —
  // forcing a gdb path there would be wrong and is never done.
  if (!isMac) {
    const gdbPath = path.join(binDir, isWin ? 'gdb.exe' : 'gdb').replace(/\\/g, '/');
    if (fs.existsSync(gdbPath)) {
      await config.update('C_Cpp.default.debuggerPath', gdbPath, target);
    }
  }

  return compilerPath;
}

/**
 * True only if VS Code is wired to a compiler path that GENUINELY WORKS
 * right now on THIS platform — not just "a file exists at that path".
 *
 * Three things are checked, in order:
 *   1. A compilerPath is actually set at all.
 *   2. The path resolves and is executable (fs.existsSync alone doesn't
 *      guarantee that — a broken symlink or a leftover from a different
 *      install could still "exist" without being usable).
 *   3. Running it with --version succeeds AND the output actually looks
 *      like a C/C++ compiler's. Many unrelated Unix tools also respond
 *      successfully to --version (e.g. `ls --version` exits 0 on most
 *      systems) — checking exit code alone isn't enough. Matching known
 *      compiler signature text closes that gap.
 *
 * This intentionally does NOT try to match the specific binary name
 * (clang++ vs g++) that Setify itself would have chosen — a user is free to
 * have a different, perfectly valid compiler configured, and that should
 * still count as "wired".
 */
function isGloballyWired() {
  const compilerPath = vscode.workspace.getConfiguration().get('C_Cpp.default.compilerPath');
  if (!compilerPath || !fs.existsSync(compilerPath)) return false;

  try {
    const output = execFileSync(compilerPath, ['--version'], { encoding: 'utf8' }).toLowerCase();
    const compilerSignatures = ['gcc', 'g++', 'clang', 'mingw', 'apple llvm'];
    return compilerSignatures.some((sig) => output.includes(sig));
  } catch (e) {
    return false;
  }
}

module.exports = { wireGlobalVscode, isGloballyWired };
