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

function startXcodeWatcher() {
  if (xcodeWatcherInterval) return;
  let checksLeft = 45;
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
  if (!findOnPath() || !isGloballyWired()) {
    setupWithProgress(false);
  }
}

function deactivate() {
  stopXcodeWatcher();
}

module.exports = { activate, deactivate };
