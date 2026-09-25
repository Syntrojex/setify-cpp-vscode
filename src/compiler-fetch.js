'use strict';
const https = require('https');
const fs = require('fs');
const { spawn } = require('child_process');
const path = require('path');
const { MINGW_ZIP_URL, ZIP_TMP_PATH, PRIMARY_INSTALL_DIR, FALLBACK_INSTALL_DIR } = require('./config');

const REPORT_ISSUE_URL =
  'https://github.com/Syntrojex/setify-cpp-vscode/issues/new?title=MinGW%20download%20URL%20expired&body=The%20MinGW-w64%20download%20link%20in%20config.js%20appears%20to%20be%20dead%20(the%20upstream%20WinLibs%20release%20may%20have%20moved%20or%20been%20removed).%20Please%20update%20MINGW_ZIP_URL.';

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

          if (res.statusCode === 206)
          {
            const match = /\/(\d+)\s*$/.exec(res.headers['content-range'] || '');
            totalBytes = match ? parseInt(match[1], 10) : resumeFrom + parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'a' });
          } 
          
          else if (res.statusCode === 200) 
          {
            receivedBytes = 0;
            totalBytes = parseInt(res.headers['content-length'] || '0', 10);
            file = fs.createWriteStream(destPath, { flags: 'w' });
          } 
          
          else if (res.statusCode === 416 && resumeFrom > 0) 
          {
            // (stale/corrupt) — drop it and restart fresh.
            fs.unlink(destPath, () => request(url, 0));
            return;
          } else {
            reject(new Error(`Download failed with status code ${res.statusCode}`));
            return;
          }

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

async function downloadAndInstall(onFallback, onRetry) {
  const status = await checkUrlStatus(MINGW_ZIP_URL);
  if (status === 404 || status === 410) {
    throw new Error(
      `The MinGW download link is no longer available (server responded ${status}). ` +
        `This means the upstream WinLibs release moved and Setify C++ needs an update. ` +
        `Please report this: ${REPORT_ISSUE_URL}`
    );
  }

  await downloadWithRetries(MINGW_ZIP_URL, ZIP_TMP_PATH, 3, onRetry);

  let targetDir = PRIMARY_INSTALL_DIR;
  if (!canWriteTo(PRIMARY_INSTALL_DIR)) {
    targetDir = FALLBACK_INSTALL_DIR;
    if (typeof onFallback === 'function') onFallback(targetDir);
  }

  await extractZip(ZIP_TMP_PATH, targetDir);
  flattenIfNested(targetDir);
  fs.unlinkSync(ZIP_TMP_PATH); 
  return targetDir;
}

module.exports = {
  download,
  downloadWithRetries,
  checkUrlStatus,
  extractZip,
  flattenIfNested,
  canWriteTo,
  downloadAndInstall
};
