'use strict';
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { KNOWN_INSTALL_LOCATIONS } = require('./config');

// On macOS, /usr/bin/g++ is really just a wrapper around Apple Clang — the
// honest, canonical name for what's actually there is clang++. Detection
// tries clang++ first on macOS, falling back to g++ for anyone who's
// installed a real GNU toolchain via Homebrew. Windows/Linux only ever look
// for g++ (MinGW / distro GCC).
const COMPILER_CANDIDATES = process.platform === 'darwin' ? ['clang++', 'g++'] : ['g++'];
const BINARY_SUFFIX = process.platform === 'win32' ? '.exe' : '';
const EXEC_TIMEOUT_MS = 5000;
const COMPILER_SIGNATURES = ['gcc', 'g++', 'clang', 'mingw', 'apple llvm'];

// A command exiting 0 for "--version" isn't proof it's actually a compiler —
// some unrelated executable named g++ (or a broken wrapper) could still
// succeed. Checking the output for a known compiler signature filters that
// out cheaply.
function looksLikeCompiler(output) {
  const lower = output.toLowerCase();
  return COMPILER_SIGNATURES.some((sig) => lower.includes(sig));
}

/**
 * Checks PATH for the first working compiler candidate.
 * Returns { version, binary } or null.
 */
function findOnPath() {
  for (const binary of COMPILER_CANDIDATES) {
    try {
      const out = execSync(`${binary} --version`, {
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: EXEC_TIMEOUT_MS
      }).toString();
      if (!looksLikeCompiler(out)) continue;
      return { version: out.split('\n')[0].trim(), binary };
    } catch (e) {
      // try the next candidate
    }
  }
  return null;
}

/**
 * Scans well-known install locations even if they're not currently on PATH.
 * Returns an array of { dir, version, binary }. A file existing at the
 * expected path, and even running successfully, still isn't enough — its
 * output must actually look like a real compiler's.
 */
function scanKnownLocations() {
  const found = [];
  for (const dir of KNOWN_INSTALL_LOCATIONS) {
    for (const binary of COMPILER_CANDIDATES) {
      const binPath = path.join(dir, binary + BINARY_SUFFIX);
      if (!fs.existsSync(binPath)) continue;

      try {
        const out = execFileSync(binPath, ['--version'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
          timeout: EXEC_TIMEOUT_MS
        });
        if (!looksLikeCompiler(out)) continue;
        found.push({ dir, version: out.split('\n')[0].trim(), binary });
        break;
      } catch (e) {
        // Broken/unrelated executable — keep checking other candidates.
      }
    }
  }
  return found;
}

function findCompiler() {
  const onPath = findOnPath();
  const others = scanKnownLocations();
  return { onPath, others };
}

module.exports = { findOnPath, scanKnownLocations, findCompiler, looksLikeCompiler, COMPILER_CANDIDATES, EXEC_TIMEOUT_MS };
