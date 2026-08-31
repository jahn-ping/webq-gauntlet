import { chromium } from 'playwright';
import path from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');

export const CDP_LOCK_FILE = path.join(ROOT, '.webq-cdp-lock.json');
export const DEFAULT_CDP_PORT = 9222;
export const CDP_PORT_SCAN_RANGE = 20;

/**
 * Cheap HTTP probe for a CDP endpoint (avoids paying Playwright's connect
 * cost on ports that are obviously closed).
 */
export async function probeCdp(port, timeoutMs = 1200) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Attempts to attach to an existing Chromium instance via CDP.
 * Returns a Playwright Browser on success, or null if nothing is reachable.
 * Never throws.
 */
export async function tryConnectCDP(port, timeoutMs = 3000) {
  const reachable = await probeCdp(port, Math.min(timeoutMs, 1500));
  if (!reachable) return null;
  try {
    return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: timeoutMs });
  } catch (err) {
    console.log(`[cdp] Found an endpoint on port ${port} but Playwright could not attach: ${err.message}`);
    return null;
  }
}

export function readCdpLock() {
  try {
    if (!existsSync(CDP_LOCK_FILE)) return null;
    const data = JSON.parse(readFileSync(CDP_LOCK_FILE, 'utf8'));
    if (!data || typeof data.port !== 'number') return null;
    return data;
  } catch {
    return null;
  }
}

export function writeCdpLock(data) {
  try {
    mkdirSync(path.dirname(CDP_LOCK_FILE), { recursive: true });
    writeFileSync(CDP_LOCK_FILE, JSON.stringify({ ...data, updatedAt: Date.now() }, null, 2));
  } catch (err) {
    console.log('[cdp] Failed to write CDP lock file:', err.message);
  }
}

export function clearCdpLock() {
  try {
    if (existsSync(CDP_LOCK_FILE)) unlinkSync(CDP_LOCK_FILE);
  } catch {
    // best effort — a stale lock file just means the next run retries and overwrites it
  }
}

export async function resolveDefaultChromiumExe(explicit) {
  const candidates = [
    explicit,
    process.env.CHROMIUM_PATH,
    // Playwright installed Chromium (highest priority after explicit)
    process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chromium.exe'),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:/Program Files/Chromium/Application/chrome.exe',
    'C:/Program Files (x86)/Chromium/Application/chrome.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

/**
 * Kill any process occupying the given port.
 * Used before spawning a new browser to ensure the port is free.
 */
export async function killProcessOnPort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf-8', timeout: 5000 });
      const match = out.match(/(\d+)\s*$/m);
      if (match && match[1] !== '0') {
        console.log(`[cdp] Killing process ${match[1]} on port ${port}`);
        execSync(`taskkill /PID ${match[1]} /F`, { stdio: 'ignore', timeout: 5000 });
      }
    } else {
      const pid = execSync(`lsof -ti:${port}`, { encoding: 'utf-8', timeout: 5000 }).trim();
      if (pid) {
        console.log(`[cdp] Killing process ${pid} on port ${port}`);
        execSync(`kill -9 ${pid}`, { stdio: 'ignore', timeout: 5000 });
      }
    }
  } catch {
    // Port may already be free — that's fine
  }
}
