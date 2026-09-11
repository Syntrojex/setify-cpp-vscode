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
 * Returns an array of { dir, version, binary }.
 */
function scanKnownLocations() {
  const found = [];
  for (const dir of KNOWN_INSTALL_LOCATIONS) {
    for (const binary of COMPILER_CANDIDATES) {
      const binPath = path.join(dir, binary + BINARY_SUFFIX);
      if (fs.existsSync(binPath)) {
        try {
          const out = execFileSync(binPath, ['--version'], { encoding: 'utf8' });
          found.push({ dir, version: out.split('\n')[0].trim(), binary });
        } catch (e) {
          found.push({ dir, version: 'found, but could not run --version', binary });
        }
        break; // one compiler per directory is enough
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
