'use strict';
const fs = require('fs');
const path = require('path');
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
    // Must be a genuine plain object — an array or a primitive would silently
    // swallow the keys we set below (JSON.stringify on an array ignores
    // non-index properties), making it look like the write succeeded when
    // nothing was actually saved.
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { settings: {}, parseFailed: true };
    }
    return { settings: parsed, parseFailed: false };
  } catch (e) {
    return { settings: {}, parseFailed: true };
  }
}

/**
 * Writes compiler info into VS Code's GLOBAL user settings — this is what
 * makes it work in any folder/project VS Code ever opens, not just the one
 * you happened to run Setify C++ in. Existing unrelated settings are
 * preserved.
 *
 * Throws if the existing settings.json couldn't be safely parsed, instead
 * of overwriting it — an unparseable file is left completely untouched
 * rather than risk destroying whatever the user already had in it.
 */
function wireGlobalVscode(binDir) {
  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  const gppName = isWin ? 'g++.exe' : 'g++';
  const gdbName = isWin ? 'gdb.exe' : 'gdb';
  const intelliSenseMode = isWin ? 'windows-gcc-x64' : isMac ? 'macos-clang-x64' : 'linux-gcc-x64';

  const gppPath = path.join(binDir, gppName).replace(/\\/g, '/');
  const gdbPath = path.join(binDir, gdbName).replace(/\\/g, '/');

  const { settings, parseFailed } = readSettings();
  if (parseFailed) {
    throw new Error(
      `Could not safely parse your existing VS Code settings.json (${VSCODE_USER_SETTINGS}) — ` +
        'left it untouched rather than risk overwriting it. Please fix any syntax errors in that file and try again.'
    );
  }

  settings['C_Cpp.default.compilerPath'] = gppPath;
  settings['C_Cpp.default.cStandard'] = 'c17';
  settings['C_Cpp.default.cppStandard'] = 'c++17';
  settings['C_Cpp.default.intelliSenseMode'] = intelliSenseMode;
  // Keeps the C/C++ extension's own native ▶ Run icon (top-right of the
  // editor) visible — this IS the "VS Code Run" the user runs their code
  // with. Explicitly setting it to true (not just leaving it unset) also
  // reverses the false value an earlier Setify C++ version wrote, for
  // anyone upgrading from that release.
  settings['C_Cpp.debugShortcut'] = true;
  // macOS ships lldb, not gdb, via Xcode tools — only set a debuggerPath
  // override when we actually know a gdb binary exists there (Windows/Linux).
  if (isWin || fs.existsSync(gdbPath)) {
    settings['C_Cpp.default.debuggerPath'] = gdbPath;
  }

  fs.mkdirSync(path.dirname(VSCODE_USER_SETTINGS), { recursive: true });
  fs.writeFileSync(VSCODE_USER_SETTINGS, JSON.stringify(settings, null, 4));

  return VSCODE_USER_SETTINGS;
}

function isGloballyWired() {
  const { settings } = readSettings();
  return Boolean(settings['C_Cpp.default.compilerPath']);
}

module.exports = { wireGlobalVscode, isGloballyWired, VSCODE_USER_SETTINGS };
