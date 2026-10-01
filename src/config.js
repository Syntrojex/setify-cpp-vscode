'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// ── Windows: MinGW-w64 download/install (WinLibs releases update every few
// weeks — if this link ever 404s, grab a fresh "Win64 Zip archive" link from
// https://winlibs.com/ here). ────────────────────────────────────────────
const MINGW_ZIP_URL =
  'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r2.zip';

// Primary: straight on C:\ so it's a real global install, not hidden in a
// per-user profile folder. Some locked-down machines don't allow writing to
// the drive root without admin rights — if that happens we fall back to
// C:\Users\Public, which is still on the C: drive and still shared/global
// across everything that user account touches, just without needing elevation.
const PRIMARY_INSTALL_DIR = 'C:\\mingw64';
const FALLBACK_INSTALL_DIR = 'C:\\Users\\Public\\mingw64';

// The temp filename includes a short hash of the download URL. This matters
// for resume support: if a download is interrupted, left as a partial file,
// and THEN this extension updates to a newer version pointing at a
// different MINGW_ZIP_URL (WinLibs ships new releases every few weeks), a
// fixed filename would cause the new version to try resuming the old
// version's leftover bytes onto the new URL — silently corrupting the
// download by splicing together two different files. Hashing the URL into
// the filename means a URL change always gets a fresh temp path instead.
const urlHash = crypto.createHash('sha1').update(MINGW_ZIP_URL).digest('hex').slice(0, 10);
const ZIP_TMP_PATH = path.join(os.tmpdir(), `setify-cpp-download-${urlHash}.zip`);

// Common places g++/MinGW/clang already lives, checked during auto-detection
// so we never re-download or re-trigger an install that's already there.
const KNOWN_INSTALL_LOCATIONS =
  process.platform === 'darwin'
    ? [
        '/usr/bin', // Xcode Command Line Tools
        '/usr/local/bin', // Homebrew (Intel Macs)
        '/opt/homebrew/bin' // Homebrew (Apple Silicon)
      ]
    : process.platform === 'linux'
    ? ['/usr/bin', '/usr/local/bin']
    : [
        path.join(PRIMARY_INSTALL_DIR, 'bin'),
        path.join(FALLBACK_INSTALL_DIR, 'bin'),
        'C:\\MinGW\\bin',
        'C:\\msys64\\mingw64\\bin',
        'C:\\msys64\\ucrt64\\bin',
        'C:\\TDM-GCC-64\\bin',
        'C:\\Strawberry\\c\\bin',
        'C:\\ProgramData\\chocolatey\\lib\\mingw\\tools\\install\\mingw64\\bin',
        path.join(os.homedir(), 'scoop', 'apps', 'mingw', 'current', 'bin'),
        path.join(os.homedir(), 'scoop', 'apps', 'gcc', 'current', 'bin')
      ];

// Global VS Code User settings.json — NOT tied to any workspace/folder, so
// once written here, IntelliSense + the built-in Run button work in every
// folder VS Code ever opens, on this machine, for this user. Path differs
// per OS.
function vscodeUserSettingsPath() {
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json');
  }
  if (process.platform === 'linux') {
    return path.join(os.homedir(), '.config', 'Code', 'User', 'settings.json');
  }
  return path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'Code',
    'User',
    'settings.json'
  );
}

const VSCODE_USER_SETTINGS = vscodeUserSettingsPath();

module.exports = {
  MINGW_ZIP_URL,
  PRIMARY_INSTALL_DIR,
  FALLBACK_INSTALL_DIR,
  ZIP_TMP_PATH,
  KNOWN_INSTALL_LOCATIONS,
  VSCODE_USER_SETTINGS
};
