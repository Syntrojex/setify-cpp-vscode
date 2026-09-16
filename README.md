<div align="center">

<img src="images/icon.png" width="110" alt="Setify C++ icon">


# Setify C++

### Zero-configuration C++ tooling for Visual Studio Code

**Install one extension. Write `.cpp`. Press Run. That's the entire setup process.**

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-0078D4?style=flat-square&logo=visualstudiocode&logoColor=white)](https://marketplace.visualstudio.com/items?itemName=Syntrojex.setify-cpp)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20macOS-lightgrey?style=flat-square)](https://marketplace.visualstudio.com/items?itemName=Syntrojex.setify-cpp)

[**Install from Marketplace**](https://marketplace.visualstudio.com/items?itemName=Syntrojex.setify-cpp) &nbsp;·&nbsp; [Repository](https://github.com/Syntrojex/setify-cpp-vscode) &nbsp;·&nbsp; [Report an Issue](https://github.com/Syntrojex/setify-cpp-vscode/issues) &nbsp;·&nbsp; [Changelog](#-release-notes)

</div>

---

## Table of Contents

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [Features](#-features)
- [Platform Support](#️-platform-support)
- [Installation](#-installation)
- [How It Works, Technically](#-how-it-works-technically)
- [Requirements](#-requirements)
- [Commands](#️-commands)
- [Frequently Asked Questions](#-frequently-asked-questions)
- [Privacy & Safety](#-privacy--safety)
- [Release Notes](#-release-notes)
- [Credits](#credits)
- [License](#license)

---

## The Problem

Every C++ beginner on Windows hits the same wall before writing a single meaningful line of code:

- Which MinGW build do I even download — MinGW, MinGW-w64, TDM-GCC, MSYS2, WinLibs?
- Where do I extract it?
- How do I add it to PATH without breaking something else?
- Why does VS Code's Run button keep asking me to "select a compiler"?
- Why does IntelliSense show red squiggles under `#include <iostream>` even after installing everything?

None of this has anything to do with learning C++. It's tooling friction, and it stops people before they start.

---

## The Solution

**Setify C++ removes every one of those steps.** Install the extension once, and in the background it:

1. Checks whether a C++ compiler already exists on your machine — and uses it if so, changing nothing.
2. If none exists, downloads and installs a complete MinGW-w64 toolchain (GCC, G++, GDB) automatically — with resume support, so a dropped connection doesn't mean starting the ~260MB download over from scratch.
3. Registers that compiler with VS Code's official C/C++ extension — globally, so it applies to every project you ever open, not just one.
4. Brings the official C/C++ extension along as a dependency, so IntelliSense and the built-in Run button are ready immediately.
5. Re-checks this on every VS Code startup — self-healing, so if the configuration is ever removed or a compiler goes missing later, it's fixed automatically.

You never open a terminal. You never touch an environment variable. You never see an installer wizard. You write a `.cpp` file, click VS Code's own ▶ Run button, and it runs — with output printed straight into the integrated terminal panel at the bottom, exactly the way it would on a workstation somebody had already configured by hand.

---

## ✨ Features

| | |
|---|---|
| 🔍 **Smart detection** | Scans PATH plus every common install location a compiler might already live in — MSYS2, TDM-GCC, Chocolatey, Scoop (Windows) and Homebrew (macOS) — before ever downloading anything new. |
| ⚙️ **Silent, automatic installation** | On Windows, if nothing is found, a full MinGW-w64 toolchain installs itself in the background with zero prompts. |
| 🔄 **Resumable, retrying downloads** | A dropped connection resumes from where it left off instead of restarting, and retries automatically up to 3 times. |
| 🌍 **Global, not per-project** | Configuration is written once into VS Code's user-level settings. Open any folder, on any drive, at any time afterward — it's already ready. |
| 🧩 **Brings its own dependency** | The official Microsoft C/C++ extension installs automatically alongside Setify C++ if you don't already have it — a proper `extensionDependencies` entry, not a suggestion you can miss. |
| 🎯 **Uses VS Code's native tools only** | No custom Run button, no proprietary terminal, no new keyboard shortcuts. Setify C++ configures the tools you already know how to use and gets out of the way. |
| 🔁 **Self-healing** | Re-verifies on every VS Code startup that both a compiler exists and VS Code is correctly wired to it — and fixes either if something changes later. |
| 🔬 **Fully transparent** | Every step — detection, download progress, install paths, configuration — logs to a dedicated Output channel you can inspect at any time. |
| 🧠 **Non-destructive by design** | If a compiler or the C/C++ extension already exists, Setify C++ never overwrites, duplicates, or reinstalls anything — it simply confirms and wires up what's already there. |

---

## 🖥️ Platform Support

| Platform | Automatic Setup | What Happens |
|---|:---:|---|
| **Windows 10 / 11** | ✅ Fully automatic | MinGW-w64 installs itself with zero manual steps, straight to `C:\mingw64` (or a permission-safe fallback). |
| **macOS** | ⚠️ Semi-automatic | Triggers Apple's native Xcode Command Line Tools installer. macOS requires a manual click on "Install" in that system dialog — this is an operating-system-level restriction that no extension, from any publisher, can bypass. Everything after that click is automatic. |
| **Linux** | 🛠️ Manual compiler install | Distributions and package managers vary too widely to automate safely. Install `g++` through your distro's package manager, and Setify C++ wires it into VS Code automatically on the next start. |

---

## Credits

Designed and built by **Muhammad Mustafa Amir**

<a href="https://github.com/Syntrojex"><img src="https://img.shields.io/badge/GitHub-Syntrojex-181717?style=flat-square&logo=github" alt="GitHub"></a>
<a href="https://www.linkedin.com/in/mustafa-amir-syntrojex"><img src="https://img.shields.io/badge/LinkedIn-mustafa--amir--syntrojex-0A66C2?style=flat-square&logo=linkedin" alt="LinkedIn"></a>

---

## License

Released under the [MIT License](LICENSE) — free to use, modify, and distribute.

---

<div align="center">

If Setify C++ saved you the trouble of manually configuring MinGW, consider ⭐ starring [the repository](https://github.com/Syntrojex/set-cpp-vscode).

</div>
