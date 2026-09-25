'use strict';
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MINGW_ZIP_URL =
  'https://github.com/brechtsanders/winlibs_mingw/releases/download/16.1.0posix-14.0.0-ucrt-r2/winlibs-x86_64-posix-seh-gcc-16.1.0-mingw-w64ucrt-14.0.0-r2.zip';

const PRIMARY_INSTALL_DIR = 'C:\\mingw64';
const FALLBACK_INSTALL_DIR = 'C:\\Users\\Public\\mingw64';

const urlHash = crypto.createHash('sha1').update(MINGW_ZIP_URL).digest('hex').slice(0, 10);
const ZIP_TMP_PATH = path.join(os.tmpdir(), `setify-cpp-download-${urlHash}.zip`);

const KNOWN_INSTALL_LOCATIONS =
  process.platform === 'darwin'
    ? [
        '/usr/bin', 
        '/usr/local/bin',
        '/opt/homebrew/bin'
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
