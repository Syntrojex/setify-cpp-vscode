'use strict';
const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { KNOWN_INSTALL_LOCATIONS } = require('./config');

const COMPILER_CANDIDATES = process.platform === 'darwin' ? ['clang++', 'g++'] : ['g++'];
const BINARY_SUFFIX = process.platform === 'win32' ? '.exe' : '';

function findOnPath() {
  for (const binary of COMPILER_CANDIDATES) {
    try {
      const out = execSync(`${binary} --version`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
      return { version: out.split('\n')[0].trim(), binary };
    } catch (e) {
   
    }
  }
  return null;
}

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
        break;
      } catch (e) {

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
