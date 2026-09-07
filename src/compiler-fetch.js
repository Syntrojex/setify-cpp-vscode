'use strict';
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { MINGW_ZIP_URL, ZIP_TMP_PATH, PRIMARY_INSTALL_DIR, FALLBACK_INSTALL_DIR } = require('./config');

// Downloader with resume support: if destPath already has partial bytes
// from a previous attempt, requests only the remaining range instead of
// starting over. Falls back to a clean restart if the server doesn't
// honor the Range request, or if the partial file turns out to be invalid.
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

      // Ensures the write stream's file descriptor is always released before
      // rejecting — without this, a retry immediately trying to reopen the
      // same path (in append mode) could hit a "file in use" error on
      // Windows, since the previous handle might not be closed yet.
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
            // Server honored the resume request — append to what's already there.
            const match = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
            totalBytes = match ? parseInt(match[1], 10) : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'a' });
          } else if (res.statusCode === 200) {
            // Server ignored the Range header and is sending the whole file —
            // restart cleanly rather than risk duplicating/corrupting data.
            receivedBytes = 0;
            totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'w' });
          } else if (res.statusCode === 416 && resumeFrom > 0) {
            // The partial file doesn't match what the server has anymore
            // (stale/corrupt) — drop it and restart fresh.
            fs.unlink(destPath, () => request(url, 0));
            return;
          } else {
            reject(new Error(`Download failed with status code ${res.statusCode}`));
            return;
          }

          // On a network error mid-download, the partial file is deliberately
          // LEFT ON DISK (not deleted) so a subsequent call to download() can
          // resume from where it stopped instead of starting over.
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
              resolve();
            });
          });
        })
        .on('error', cleanupAndReject);

      // If the connection stalls (no data at all for 30s at any point — a
      // dead server, a captive portal, a dropped Wi-Fi), fail cleanly instead
      // of hanging forever. The partial file (if any) is left in place so a
      // retry can resume from it.
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

/**
 * Downloads with automatic retries — each retry resumes from where the
 * previous attempt left off (via download()'s Range support) rather than
 * starting over, so a flaky connection costs time, not re-downloaded data.
 */
async function downloadWithRetries(url, destPath, attempts = 3, onRetry) {
  let lastError;
  for (let i = 1; i <= attempts; i++) {
    try {
      await download(url, destPath);
      return;
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

// Uses Windows' built-in PowerShell Expand-Archive — no 7zip / no npm dependency
// required. Runs ASYNCHRONOUSLY (spawn, not execFileSync): the MinGW zip is
// ~260MB and extraction can take 10-60+ seconds. A synchronous call here would
// block VS Code's whole extension host process for that entire time, which is
// exactly what was causing the "extension host unresponsive / reload?" prompt.
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

// winlibs zips extract into a top-level "mingw64" folder — flatten it up one
// level. Defensive against retries: if a previous install attempt was
// interrupted partway and left files behind, renaming over them would
// normally throw — so any conflicting leftover is removed first, ensuring
// a re-run after a failed attempt always succeeds instead of getting stuck.
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

/**
 * Installs MinGW to C:\mingw64. If that's not writable without elevation,
 * falls back to C:\Users\Public\mingw64 (still on the C: drive, still
 * shared/global, no admin rights needed).
 *
 * The download automatically retries on failure, resuming from wherever the
 * previous attempt left off (see downloadWithRetries/download) — a dropped
 * connection costs time, not already-downloaded data.
 *
 * Returns the directory it actually installed into.
 */
async function downloadAndInstall(onFallback, onRetry) {
  await downloadWithRetries(MINGW_ZIP_URL, ZIP_TMP_PATH, 3, onRetry);

  let targetDir = PRIMARY_INSTALL_DIR;
  if (!canWriteTo(PRIMARY_INSTALL_DIR)) {
    targetDir = FALLBACK_INSTALL_DIR;
    if (typeof onFallback === 'function') onFallback(targetDir);
  }

  await extractZip(ZIP_TMP_PATH, targetDir);
  flattenIfNested(targetDir);
  fs.unlinkSync(ZIP_TMP_PATH); // only removed after everything succeeded
  return targetDir;
}

module.exports = { download, downloadWithRetries, extractZip, flattenIfNested, canWriteTo, downloadAndInstall };
