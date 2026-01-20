import { execFileSync, spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();

const exists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
};

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', ...opts });

const ensureDir = (p) => fs.mkdirSync(p, { recursive: true });

const rmrf = (p) => fs.rmSync(p, { recursive: true, force: true });

const copyDir = (src, dst) => {
  rmrf(dst);
  ensureDir(path.dirname(dst));
  // Use ditto on mac for app bundles; fallback to cp elsewhere.
  if (process.platform === 'darwin') {
    run('ditto', [src, dst]);
  } else {
    run('cp', ['-R', src, dst]);
  }
};

const patchMacDevApp = () => {
  const electronAppSrc = path.join(projectRoot, 'node_modules/electron/dist/Electron.app');
  const devAppDst = path.join(projectRoot, 'tools/dev-mac/snowtree.app');
  const infoPlist = path.join(devAppDst, 'Contents/Info.plist');
  const resourcesDir = path.join(devAppDst, 'Contents/Resources');
  const macosDir = path.join(devAppDst, 'Contents/MacOS');

  if (!exists(electronAppSrc)) {
    console.error(`[snowtree] Missing Electron.app at ${electronAppSrc}`);
    process.exit(1);
  }

  // Copy Electron.app -> build/dev-mac/snowtree.app (so Dock shows the correct app name in dev).
  // Re-copy if destination missing; otherwise, keep it and just patch metadata/assets.
  if (!exists(devAppDst)) {
    copyDir(electronAppSrc, devAppDst);
  }

  // Patch Info.plist keys (best-effort). If PlistBuddy is missing, keep going.
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleName snowtree', infoPlist]);
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleName string snowtree', infoPlist]);
    } catch {}
  }
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleDisplayName snowtree', infoPlist]);
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleDisplayName string snowtree', infoPlist]);
    } catch {}
  }
  // Make the process/app name show as "snowtree" (Cmd-Tab, Dock label, menu bar).
  // This requires changing CFBundleExecutable and renaming the binary.
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleExecutable snowtree', infoPlist]);
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleExecutable string snowtree', infoPlist]);
    } catch {}
  }
  try {
    execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Set :CFBundleIdentifier com.snowtree.snowtree.dev', infoPlist]);
  } catch {
    try {
      execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Add :CFBundleIdentifier string com.snowtree.snowtree.dev', infoPlist]);
    } catch {}
  }

  // Rename the main executable (Electron -> snowtree) to match CFBundleExecutable.
  try {
    const oldExe = path.join(macosDir, 'Electron');
    const newExe = path.join(macosDir, 'snowtree');
    if (exists(oldExe) && !exists(newExe)) {
      fs.renameSync(oldExe, newExe);
      // Ensure it's executable (rename should preserve mode, but be safe).
      fs.chmodSync(newExe, 0o755);
    }
  } catch {
    // ignore
  }

  // Replace the default Electron icon (electron.icns) with Snowtree's icon.
  ensureDir(resourcesDir);
  const srcIcns = path.join(projectRoot, 'packages/desktop/assets/icon.icns');
  const dstIcns = path.join(resourcesDir, 'electron.icns');
  if (exists(srcIcns)) {
    fs.copyFileSync(srcIcns, dstIcns);
  }

  // Launch the dev app (it will load Vite URL in development mode).
  // Use spawn to keep the process running instead of open which exits immediately
  const electronBinary = path.join(devAppDst, 'Contents/MacOS/snowtree');
  const child = spawn(electronBinary, [projectRoot, '--snowtree-dev'], {
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
    detached: false
  });

  child.on('close', (code) => {
    console.log(`Electron process exited with code ${code}`);
    process.exit(code);
  });
};

if (process.platform === 'darwin') {
  patchMacDevApp();
} else {
  // Default cross-platform dev launcher.
  // Use electron from node_modules to avoid PATH issues on Windows
  const electronPath = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'electron.cmd' : 'electron');
  const child = spawn(electronPath, ['.', '--snowtree-dev'], {
    env: { ...process.env, NODE_ENV: 'development' },
    stdio: 'inherit',
    detached: false,
    shell: process.platform === 'win32'
  });

  child.on('close', (code) => {
    console.log(`Electron process exited with code ${code}`);
    process.exit(code);
  });
}
