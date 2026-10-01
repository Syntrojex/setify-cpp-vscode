'use strict';
const { execFileSync } = require('child_process');

function getUserPath() {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', "[Environment]::GetEnvironmentVariable('Path', 'User')"],
    { encoding: 'utf8' }
  ).trim();
}

function setUserPath(newPath) {
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-Command', `[Environment]::SetEnvironmentVariable('Path', '${newPath.replace(/'/g, "''")}', 'User')`],
    { stdio: 'ignore' }
  );
}

// Adds a dir to the current user's PATH — this already applies machine-wide
// for every terminal/folder/project this user opens, no admin rights needed.
function addToUserPath(dir) {
  const currentPath = getUserPath();
  const already = currentPath.split(';').map((p) => p.trim().toLowerCase()).includes(dir.toLowerCase());
  if (already) return false;

  const newPath = currentPath ? `${currentPath};${dir}` : dir;
  setUserPath(newPath);
  process.env.PATH = `${process.env.PATH};${dir}`; // so `verify` works this session too
  return true;
}

function removeFromUserPath(dir) {
  const currentPath = getUserPath();
  const parts = currentPath.split(';').filter((p) => p.trim().toLowerCase() !== dir.toLowerCase());
  setUserPath(parts.join(';'));
}

module.exports = { addToUserPath, removeFromUserPath };
