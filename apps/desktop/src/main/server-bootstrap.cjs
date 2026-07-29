/**
 * Édition Server : bootstrap automatique au 1er lancement (machine vierge).
 * Copie server-stack vers ProgramData, installe Docker, démarre la stack locale.
 */
const { app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { getAppEdition } = require('./edition.cjs');

function getBundledStackDir() {
  if (process.resourcesPath) {
    const fromResources = path.join(process.resourcesPath, 'server-stack');
    if (fs.existsSync(fromResources)) return fromResources;
  }
  const fromDev = path.join(__dirname, '../../server-stack');
  if (fs.existsSync(fromDev)) return fromDev;
  return null;
}

function getInstalledStackDir() {
  const programData = process.env.ProgramData || 'C:\\ProgramData';
  return path.join(programData, 'POS Eau Cascade', 'server-stack');
}

function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
}

function ensureStackInstalled() {
  const bundled = getBundledStackDir();
  const installed = getInstalledStackDir();
  if (!bundled) {
    throw new Error('Fichiers server-stack introuvables dans l’installateur.');
  }
  // Toujours resynchroniser images + scripts depuis l’installateur (mise à jour Server).
  fs.mkdirSync(installed, { recursive: true });
  for (const entry of fs.readdirSync(bundled, { withFileTypes: true })) {
    const from = path.join(bundled, entry.name);
    const to = path.join(installed, entry.name);
    // Ne pas écraser .env.server / .bootstrap-done (secrets et état locaux).
    if (entry.name === '.env.server' || entry.name === '.bootstrap-done') continue;
    if (entry.isDirectory()) {
      copyDirRecursive(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
  return installed;
}

function runBootstrap(stackDir) {
  return new Promise((resolve, reject) => {
    const script = path.join(stackDir, 'bootstrap.ps1');
    if (!fs.existsSync(script)) {
      reject(new Error(`Script bootstrap introuvable: ${script}`));
      return;
    }
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-StackDir', stackDir],
      { windowsHide: false },
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `bootstrap exit ${code}`));
    });
  });
}

async function waitForApi(maxMs = 120000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch('http://127.0.0.1:3000/auth/setup-status');
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  return false;
}

async function isApiUp(timeoutMs = 3000) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch('http://127.0.0.1:3000/auth/setup-status', { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

function markBootstrapDone(stackDir) {
  const doneFile = path.join(stackDir, '.bootstrap-done');
  if (!fs.existsSync(doneFile)) {
    fs.writeFileSync(doneFile, new Date().toISOString(), 'utf8');
  }
}

/**
 * @returns {Promise<{ ran: boolean, ok: boolean, message?: string }>}
 */
async function ensureServerStack() {
  if (getAppEdition() !== 'server') return { ran: false, ok: true };
  if (process.env.VITE_DEV_SERVER_URL) return { ran: false, ok: true };

  let stackDir;
  try {
    stackDir = ensureStackInstalled();
  } catch (err) {
    return {
      ran: false,
      ok: false,
      message: err?.message || String(err),
    };
  }

  const doneFile = path.join(stackDir, '.bootstrap-done');
  const envFile = path.join(stackDir, '.env.server');
  const apiAlreadyUp = await isApiUp();
  const firstRun = !fs.existsSync(doneFile) && !fs.existsSync(envFile) && !apiAlreadyUp;

  if (firstRun) {
    const dockerHint = 'Une fenêtre PowerShell peut s\'afficher.';
    await dialog.showMessageBox({
      type: 'info',
      title: 'Configuration machine mère',
      message:
        `Premier lancement : démarrage du serveur local (Docker).\n\n${dockerHint}\nCela peut prendre plusieurs minutes.`,
      buttons: ['Continuer'],
    });
  }

  try {
    await runBootstrap(stackDir);
    const apiUp = await waitForApi();
    if (!apiUp) {
      return {
        ran: true,
        ok: false,
        message:
          'La stack Docker a démarré mais l’API ne répond pas encore sur http://localhost:3000. Réessayez dans quelques minutes ou redémarrez le PC.',
      };
    }
    markBootstrapDone(stackDir);
    return { ran: firstRun, ok: true };
  } catch (err) {
    if (await isApiUp(5000)) {
      markBootstrapDone(stackDir);
      return { ran: false, ok: true };
    }
    return {
      ran: true,
      ok: false,
      message: err?.message || String(err),
    };
  }
}

module.exports = { ensureServerStack, getInstalledStackDir };
