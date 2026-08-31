#!/usr/bin/env node
/**
 * webQ-Gauntlet — launch.mjs
 *
 * One-time sign-in helper. Opens a visible Chromium with your real profile
 * so you can log into DeepSeek, ChatGPT, Claude, Gemini once.
 * Sessions persist across runs.
 */

import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const CHROMIUM_EXE_CANDIDATES = [
  // Playwright installed Chromium (highest priority)
  process.env.PLAYWRIGHT_BROWSERS_PATH && path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  path.join(process.env.LOCALAPPDATA || '', 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'),
  // Standard Chromium locations
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chrome.exe'),
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'Application', 'chromium.exe'),
  'C:/Program Files/Chromium/Application/chrome.exe',
  'C:/Program Files (x86)/Chromium/Application/chrome.exe',
].filter(Boolean);

function detectChromium() {
  return CHROMIUM_EXE_CANDIDATES.find((p) => existsSync(p)) || null;
}

function detectProfile() {
  const p = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'User Data');
  if (p && existsSync(p)) return p;
  return null;
}

async function main() {
  const exe = detectChromium();
  const profile = detectProfile();

  console.log('[launch] Opening visible Chromium for sign-in…');
  console.log(`[launch] Browser: ${exe ?? 'Playwright bundled chromium'}`);
  console.log(`[launch] Profile: ${profile ?? 'none — using temp browser-data in engine folder'}`);

  const profileDir = profile || path.join(ROOT, 'browser-data');

  const browser = await chromium.launchPersistentContext(profileDir, {
    executablePath: exe ?? undefined,
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  // Open all four sign-in pages in tabs
  const pages = await Promise.all([
    browser.newPage(),
    browser.newPage(),
    browser.newPage(),
    browser.newPage(),
  ]);

  await pages[0].goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
  await pages[1].goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  await pages[2].goto('https://claude.ai/new', { waitUntil: 'domcontentloaded' });
  await pages[3].goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded' });

  console.log('\n[launch] Please sign into all four sites in the opened tabs.');
  console.log('[launch] When done, close THIS terminal (Ctrl+C) or press Enter here to keep browser open.');
  console.log('[launch] Sessions will persist for future query.mjs runs.\n');

  // Wait for user input
  process.stdin.once('data', () => {
    console.log('[launch] Done. Browser stays open — close it manually when finished.');
  });
}

main().catch((err) => {
  console.error('[launch] fatal:', err);
  process.exit(1);
});