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

// Runs detect/install/wire with a progress notification. `silent` skips the
// notification/popups — used by the background Xcode watcher below, which
// checks repeatedly and shouldn't spam a notification every 20 seconds.
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

// On macOS, after triggering the Xcode installer, there's no callback for
// when the user finishes it — this polls every 20s (up to 15 min) and
// finishes wiring automatically once a compiler appears. If it times out
// with no result, the user is told clearly instead of it just going quiet.
function startXcodeWatcher() {
  if (xcodeWatcherInterval) return;
  let checksLeft = 45; // 45 * 20s = 15 minutes
  xcodeWatcherInterval = setInterval(async () => {
    checksLeft--;
    if (checksLeft <= 0) {
      stopXcodeWatcher();
      vscode.window.showWarningMessage(
        'Setify C++: still waiting on Xcode Command Line Tools after 15 minutes. ' +
          'Run "Setify C++: Setup C++ Compiler" once the installer finishes.'
      );
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

  // Self-healing, checked fresh on every activation: setup runs whenever
  // EITHER a compiler isn't found OR VS Code isn't wired to one yet, so a
  // pre-existing compiler still gets wired and lost config gets repaired —
  // without re-installing anything already correct.
  if (!findOnPath() || !isGloballyWired()) {
    setupWithProgress(false);
  }
}

function deactivate() {
  stopXcodeWatcher();
}

module.exports = { activate, deactivate };
