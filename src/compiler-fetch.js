'use strict';
const https = require('https');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const path = require('path');
const { MINGW_ZIP_URL, ZIP_TMP_PATH, PRIMARY_INSTALL_DIR, FALLBACK_INSTALL_DIR } = require('./config');

const REPORT_ISSUE_URL =
  'https://github.com/Syntrojex/set-cpp-vscode/issues/new?title=MinGW%20download%20URL%20expired&body=The%20MinGW-w64%20download%20link%20in%20config.js%20appears%20to%20be%20dead%20(the%20upstream%20WinLibs%20release%20may%20have%20moved%20or%20been%20removed).%20Please%20update%20MINGW_ZIP_URL.';

// HEAD request (follows redirects) to check a URL without downloading the
// whole file. Returns the status code, or null if inconclusive (timeout,
// no connection) — null is never treated as "the URL is broken".
function checkUrlStatus(url, redirectsLeft = 5) {
  return new Promise((resolve) => {
    const req = https
      .request(url, { method: 'HEAD' }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirectsLeft > 0) {
          resolve(checkUrlStatus(res.headers.location, redirectsLeft - 1));
          return;
        }
        resolve(res.statusCode);
      })
      .on('error', () => resolve(null));

    req.setTimeout(10000, () => {
      req.destroy();
      resolve(null);
    });

    req.end();
  });
}

// Resumable downloader: continues from an existing partial file via HTTP
// Range instead of restarting. Resolves with { receivedBytes, totalBytes }.
function download(url, destPath) {
  return new Promise((resolve, reject) => {
    let existingBytes = 0;
    try {
      existingBytes = fs.statSync(destPath).size;
    } catch (e) {
      existingBytes = 0;
    }

    let receivedBytes = existingBytes;
    let totalBytes = 0;
    let lastPercent = -1;

    const request = (currentUrl, resumeFrom) => {
      const headers = resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-` } : {};
      let file = null;

      // Releases the file handle before rejecting, so an immediate retry
      // reopening the same path doesn't hit a Windows "file in use" error.
      const cleanupAndReject = (err) => {
        if (file) file.destroy();
        reject(err);
      };

      const req = https
        .get(currentUrl, { headers }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            request(res.headers.location, resumeFrom);
            return;
          }

          if (res.statusCode === 206) {
            const match = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
            totalBytes = match ? parseInt(match[1], 10) : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'a' });
          } else if (res.statusCode === 200) {
            // Server ignored Range and sent the whole file — restart clean.
            receivedBytes = 0;
            totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'w' });
          } else if (res.statusCode === 416 && resumeFrom > 0) {
            // Partial file no longer matches the server — drop and restart.
            fs.unlink(destPath, () => request(url, 0));
            return;
          } else {
            reject(new Error(`Download failed with status code ${res.statusCode}`));
            return;
          }

          // Partial file stays on disk on error so a retry can resume it.
          res.on('error', cleanupAndReject);

          res.on('data', (chunk) => {
            receivedBytes += chunk.length;
            if (totalBytes) {
              const percent = Math.floor((receivedBytes / totalBytes) * 100);
              if (percent !== lastPercent) {
                lastPercent = percent;
                const mb = (receivedBytes / 1024 / 1024).toFixed(1);
                const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
                process.stdout.write(`\r  Downloading... ${percent}% (${mb}MB / ${totalMb}MB)`);
              }
            }
          });

          res.pipe(file);

          file.on('error', cleanupAndReject);
          file.on('finish', () => {
            file.close(() => {
              process.stdout.write('\n');
              resolve({ receivedBytes, totalBytes });
            });
          });
        })
        .on('error', cleanupAndReject);

      // No data for 30s at any point (dead server, dropped Wi-Fi) fails
      // cleanly instead of hanging; the partial file stays for resume.
      req.setTimeout(30000, () => {
        req.destroy(new Error('Download timed out — no response from the server for 30 seconds.'));
      });
    };

    request(url, existingBytes);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Retries with resume — each attempt continues from where the last one
// stopped, so a flaky connection costs time, not re-downloaded data.
async function downloadWithRetries(url, destPath, attempts = 3, onRetry) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await download(url, destPath);
    } catch (e) {
      lastError = e;
      if (i < attempts) {
        if (typeof onRetry === 'function') onRetry(i, attempts, e);
        await delay(3000);
      }
    }
  }
  throw lastError;
}

// A completed stream doesn't guarantee a correct file — checks size matches
// what the server promised, and that it's actually a zip (PK signature).
function verifyZipIntegrity(filePath, expectedSize) {
  const actualSize = fs.statSync(filePath).size;
  if (expectedSize && actualSize !== expectedSize) {
    throw new Error(`Downloaded file is incomplete (expected ${expectedSize} bytes, got ${actualSize}).`);
  }
  const fd = fs.openSync(filePath, 'r');
  const header = Buffer.alloc(4);
  fs.readSync(fd, header, 0, 4, 0);
  fs.closeSync(fd);
  if (!(header[0] === 0x50 && header[1] === 0x4b)) {
    throw new Error('Downloaded file is not a valid zip archive.');
  }
}

// Async (spawn, not execFileSync) — a synchronous call here would freeze
// VS Code's extension host for the 10-60+ seconds extraction can take.
function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(destDir, { recursive: true });
    const ps = spawn(
      'powershell.exe',
      ['-NoProfile', '-Command', `Expand-Archive -LiteralPath "${zipPath}" -DestinationPath "${destDir}" -Force`],
      { stdio: 'ignore' }
    );
    ps.on('error', reject);
    ps.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Extraction failed with exit code ${code}`));
    });
  });
}

// winlibs zips nest everything under "mingw64" — flatten it up one level.
// Leftover files from an interrupted prior attempt are removed first so a
// retry always succeeds instead of failing on a rename conflict.
function flattenIfNested(destDir) {
  const nested = path.join(destDir, 'mingw64');
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    for (const item of fs.readdirSync(nested)) {
      const src = path.join(nested, item);
      const dest = path.join(destDir, item);
      if (fs.existsSync(dest)) {
        fs.rmSync(dest, { recursive: true, force: true });
      }
      fs.renameSync(src, dest);
    }
    fs.rmdirSync(nested);
  }
}

function canWriteTo(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.set-cpp-write-test');
    fs.writeFileSync(probe, 'x');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
}

// Stops two VS Code windows installing at once and colliding on the same
// temp file/install dir. A lock older than 20 minutes is treated as
// left over from a crashed process and cleared.
const LOCK_PATH = path.join(os.tmpdir(), 'setify-cpp-install.lock');
const LOCK_STALE_MS = 20 * 60 * 1000;

function tryAcquireLock() {
  try {
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: 'wx' });
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    try {
      if (Date.now() - fs.statSync(LOCK_PATH).mtimeMs > LOCK_STALE_MS) {
        fs.unlinkSync(LOCK_PATH);
        return tryAcquireLock();
      }
    } catch (e2) {}
    return false;
  }
}

function releaseLock() {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch (e) {}
}

async function waitForLockRelease(maxWaitMs = 5 * 60 * 1000) {
  const start = Date.now();
  while (fs.existsSync(LOCK_PATH) && Date.now() - start < maxWaitMs) {
    await delay(2000);
  }
}

// Detect → download (retry+resume) → verify → extract, guarded by a
// cross-process lock. If another window is already installing, waits for
// it and reuses its result instead of downloading twice.
async function downloadAndInstall(onFallback, onRetry) {
  if (!tryAcquireLock()) {
    await waitForLockRelease();
    if (fs.existsSync(path.join(PRIMARY_INSTALL_DIR, 'bin', 'g++.exe'))) return PRIMARY_INSTALL_DIR;
    if (fs.existsSync(path.join(FALLBACK_INSTALL_DIR, 'bin', 'g++.exe'))) return FALLBACK_INSTALL_DIR;
    if (!tryAcquireLock()) throw new Error('Another Setify C++ install is already in progress.');
  }

  try {
    const status = await checkUrlStatus(MINGW_ZIP_URL);
    if (status === 404 || status === 410) {
      throw new Error(
        `The MinGW download link is no longer available (server responded ${status}). ` +
          `This means the upstream WinLibs release moved and Setify C++ needs an update. ` +
          `Please report this: ${REPORT_ISSUE_URL}`
      );
    }

    const { totalBytes } = await downloadWithRetries(MINGW_ZIP_URL, ZIP_TMP_PATH, 3, onRetry);
    verifyZipIntegrity(ZIP_TMP_PATH, totalBytes);

    let targetDir = PRIMARY_INSTALL_DIR;
    if (!canWriteTo(PRIMARY_INSTALL_DIR)) {
      targetDir = FALLBACK_INSTALL_DIR;
      if (typeof onFallback === 'function') onFallback(targetDir);
    }

    await extractZip(ZIP_TMP_PATH, targetDir);
    flattenIfNested(targetDir);
    fs.unlinkSync(ZIP_TMP_PATH);
    return targetDir;
  } finally {
    releaseLock();
  }
}

module.exports = {
  download,
  downloadWithRetries,
  checkUrlStatus,
  verifyZipIntegrity,
  extractZip,
  flattenIfNested,
  canWriteTo,
  downloadAndInstall
};
