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

/**
 * Checks PATH for the first working compiler candidate.
 * Returns { version, binary } or null. `binary` is the bare executable name
 * that resolved (e.g. "clang++" or "g++") — callers need this to know which
 * one to point VS Code at.
 */
function findOnPath() {
  for (const binary of COMPILER_CANDIDATES) {
    try {
      const out = execSync(`${binary} --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
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
 * expected path is NOT enough on its own — it must also actually run
 * successfully. Without this, a broken/incomplete install (the classic
 * macOS symptom: partial Xcode Command Line Tools leaving a clang++ file
 * present but non-functional) would be reported as a valid, working
 * compiler, and setup would falsely claim success.
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
          stdio: ['ignore', 'pipe', 'ignore']
        });
        found.push({ dir, version: out.split('\n')[0].trim(), binary });
        break; // this directory has a working compiler — one per directory is enough
      } catch (e) {
        // File exists but isn't a usable compiler — do NOT treat it as a
        // valid installation. Keep checking other candidate names in the
        // same directory instead of giving up on it entirely.
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

module.exports = { findOnPath, scanKnownLocations, findCompiler, COMPILER_CANDIDATES };
