'use strict';
const vscode = require('vscode');
const { findOnPath } = require('./src/find-compiler');
const { isGloballyWired } = require('./src/vscode-global');
const { runInstall } = require('./src/install-flow');

let outputChannel;
let isSettingUp = false;
let xcodeWatcherInterval = null;

function log(msg) {
  outputChannel.appendLine(msg);
}

/**
 * Runs the full detect/install/wire flow with a progress notification.
 * This is the ONLY thing Setify C++ does — it never adds its own Run
 * button or menu entries. Once a compiler is detected/installed and wired
 * into VS Code's global settings, VS Code's own built-in Run (the ▶ icon
 * the C/C++ extension provides, or the Run menu) just works on its own.
 *
 * `silent` suppresses the progress notification and success/warning popups
 * — used by the background Xcode-install watcher below, which checks
 * repeatedly and shouldn't spam a notification every 20 seconds.
 */
async function setupWithProgress(silent = false) {
  if (isSettingUp) return null;
  isSettingUp = true;
  if (!silent) outputChannel.show(true);

  let result = null;
  try {
    if (silent) {
      result = await runInstall(log);
    } else {
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Setify C++: setting up your C++ compiler',
          cancellable: false
        },
        async (progress) => {
          result = await runInstall((msg) => {
            log(msg);
            progress.report({ message: msg });
          });

          if (result.ok) {
            vscode.window.showInformationMessage(
              'Setify C++: your C++ compiler is ready. Open a .cpp file and use VS Code\'s Run button.'
            );
          } else if (!result.waitingForXcodeInstall) {
            vscode.window.showWarningMessage(`Setify C++: ${result.message}`);
          }
        }
      );
    }
  } finally {
    isSettingUp = false;
  }

  if (result && result.waitingForXcodeInstall) {
    startXcodeWatcher();
  } else {
    stopXcodeWatcher();
    if (silent && result && result.ok) {
      vscode.window.showInformationMessage(
        'Setify C++: Xcode Command Line Tools finished installing — your C++ compiler is ready.'
      );
    }
  }

  return result;
}

/**
 * On macOS, after triggering the Xcode Command Line Tools installer, there
 * is no event to listen for when the user finishes clicking through it —
 * Apple gives no callback. So instead of leaving the user to manually
 * reload VS Code or re-run Setup once it's done, this checks quietly in
 * the background every 20 seconds (up to 15 minutes) and finishes wiring
 * everything up automatically the moment a compiler becomes available.
 */
function startXcodeWatcher() {
  if (xcodeWatcherInterval) return; // already watching
  let checksLeft = 45; // 45 * 20s = 15 minutes
  xcodeWatcherInterval = setInterval(async () => {
    checksLeft--;
    if (checksLeft <= 0) {
      stopXcodeWatcher();
      return;
    }
    if (findOnPath()) {
      await setupWithProgress(true);
    }
  }, 20000);
}

function stopXcodeWatcher() {
  if (xcodeWatcherInterval) {
    clearInterval(xcodeWatcherInterval);
    xcodeWatcherInterval = null;
  }
}

function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Setify C++');
  context.subscriptions.push(outputChannel);
  context.subscriptions.push({ dispose: stopXcodeWatcher });

  context.subscriptions.push(vscode.commands.registerCommand('setify-cpp.setup', () => setupWithProgress(false)));

  // Fully automatic — the ONLY manual step is installing this extension
  // (and, on macOS, clicking "Install" in the one native Apple dialog).
  //
  // Self-healing, checked fresh on every activation instead of a one-time
  // flag: setup runs whenever EITHER a compiler isn't found OR VS Code's
  // global settings aren't wired to one yet. This guarantees a compiler
  // that already existed still gets wired up (not just newly-installed
  // ones), AND that wiring which was somehow removed or never completed
  // gets fixed automatically next time VS Code starts — without ever
  // re-downloading anything when a compiler is already present, since that
  // check (isGloballyWired) is just a fast local file read.
  if (!findOnPath() || !isGloballyWired()) {
    setupWithProgress(false);
  }
}

function deactivate() {
  stopXcodeWatcher();
}

module.exports = { activate, deactivate };
