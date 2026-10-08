# Building LocalMind Desktop Client App

> **Warning**:
>
> This document is not guaranteed to be up-to-date.
> If you find any outdated information, please feel free to open an issue or submit a PR.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development](#development)
- [Build](#build)
- [CI](#ci)

## Things you may need to know before getting started

Building the desktop client app for the moment is a bit more complicated than building the web app. The client right now is an Electron app that wraps the prebuilt web app, with parts of the native modules written in Rust, which means we have the following source modules to build a desktop client app:

1. `packages/frontend/core`: the web app
2. `packages/frontend/native`: the native modules written in Rust (mostly the sqlite bindings)
3. `packages/frontend/apps/electron`: the Electron app (containing main & helper process, and the electron entry point in `packages/frontend/apps/electron-renderer`)

#3 is dependent on #1 and #2, and relies on electron-forge to make the final app & installer. To get a deep understanding of how the desktop client app is built, you may want to read the workflow file in [release-desktop.yml](/.github/workflows/release-desktop.yml).

Due to [some limitations of Electron builder](https://github.com/yarnpkg/berry/issues/4804), you may need to have two separate yarn config for building the core and the desktop client app:

1. build frontend (with default yarn settings)
2. build electron (reinstall with hoisting off)

We will explain the steps in the following sections.

## Prerequisites

Before you start building AFFiNE Desktop Client Application, please following the same steps in [BUILDING#Prerequisites](./BUILDING.md#prerequisites) to install Node.js and Rust.

LocalMind standardizes local development on Linux and Linux containers. Platform
specific desktop release flows are handled by CI when needed.

## Local macOS arm64 build

Apple Silicon Macs can build the native module, Electron renderer, desktop
processes, and DMG/ZIP locally. Use the repository's Node.js 22, Yarn 4.13.0,
Rust toolchain, and Xcode Command Line Tools. Use the system `strip` executable.

From the repository root, with dependencies installed using the default Yarn
configuration:

```sh
yarn install --immutable
MACOSX_DEPLOYMENT_TARGET=12.0 yarn affine @affine/native build
BUILD_TYPE=canary NODE_OPTIONS=--max-old-space-size=12288 yarn affine @affine/electron generate-assets
BUILD_TYPE=canary SKIP_GENERATE_ASSETS=1 NODE_OPTIONS='--max-old-space-size=12288 --import=tsx' yarn affine @affine/electron make --platform=darwin --arch=arm64
```

Check that both renderer and desktop-layer builds succeeded before running the
last command. `SKIP_GENERATE_ASSETS=1` reuses the assets from the preceding command.
The explicit `tsx` loader lets Forge load the TypeScript helpers imported by its
configuration. The default packaging hook links the root `node_modules`, and the
packager dereferences that link when copying production dependencies. Do not set
`HOIST_NODE_MODULES=1` for this default layout: that flag is for the separate
workspace-local dependency installation used by CI below.

Outputs are under `packages/frontend/apps/electron/out/canary/`:

- Application: `LocalMind-canary-darwin-arm64/LocalMind-canary.app`
- Disk image: `make/LocalMind.dmg`
- ZIP: `make/zip/darwin/arm64/LocalMind-canary-darwin-arm64-0.27.0.zip`
  (the version follows `packages/frontend/apps/electron/package.json`).

An unsigned local build does not establish Developer ID signing or Apple
notarization. Those require the Apple signing/notarization configuration in
`forge.config.mjs` and the desktop release workflow. An arm64 build also does not
verify the separate Intel x64 target.

Local verification on 2026-09-30 passed compilation, DMG/ZIP creation, archive
integrity checks, and startup from a DMG copy outside the checkout, including
rendering the local sample document. An initial normal-Quit `SIGSEGV` was traced
to workbench `WebContentsView` contents left alive when their windows were
destroyed. Window cleanup now explicitly closes standalone contents, including
detached background tabs, before destroying windows. Quit cleanup also guards
against reentry, and tab-action subscriptions retain their receiver when disposed.
The rebuilt DMG copy passed normal macOS Quit without a debugger, Quit with three
loaded tabs, and Quit with the main window hidden (all exit code 0). Five focused
lifecycle regression tests passed. Signing/notarization and Intel target
validation remain separate release requirements.

## Build, package & make the desktop client app

> repos/AFFiNE/.github/workflows/release-desktop.yml contains real order to build the desktop client app, but here we will explain the steps in a more detailed way. Up-to date.

### 0. Build the native modules

Please refer to `Build Native Dependencies` section in [BUILDING.md](./BUILDING.md#Build-Native-Dependencies) to build the native modules.

### 1. Build the core

On Linux

```shell
BUILD_TYPE=canary yarn affine @affine/electron build

BUILD_TYPE=canary yarn affine @affine/electron generate-assets
```

### 2. Re-config yarn, clean up the node_modules and reinstall the dependencies

As we said before, you need to reinstall the dependencies with hoisting off. You can do this by running the following command:

```shell
yarn config set nmMode classic
yarn config set nmHoistingLimits workspaces
```

Then, clean up all node_modules and reinstall the dependencies:

On Linux

```shell
find . -name 'node_modules' -type d -prune -exec rm -rf '{}' +
yarn install
```

### 3. Build the desktop client app installer

#### Linux

```shell
BUILD_TYPE=canary SKIP_WEB_BUILD=1 HOIST_NODE_MODULES=1 yarn affine @affine/electron make
```

Once the build is complete, you can find the paths to the binaries in the terminal output.

```
Finished 2 bundles at:
  › Artifacts available at: <affine-repo>/packages/frontend/apps/electron/out/canary/make
```

## CI

Please refer to `.github/workflows/release-desktop-app.yml` for the CI workflow. It will:

- build the app for all supported platforms
- upload the artifacts to GitHub Actions
