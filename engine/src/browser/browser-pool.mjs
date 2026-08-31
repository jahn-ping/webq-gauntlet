import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';

import {
  ROOT,
  DEFAULT_CDP_PORT,
  CDP_PORT_SCAN_RANGE,
  tryConnectCDP,
  readCdpLock,
  writeCdpLock,
  clearCdpLock,
  resolveDefaultChromiumExe,
  killProcessOnPort,
} from './cdp.mjs';

const CDP_SPAWN_WAIT_MS = 20000;

class PageWrapper {
  constructor(page, index) {
    this.page = page;
    this.index = index;
    this.busy = false;
    this.currentSite = null;
  }
}

export class BrowserPool {
  /**
   * @param {object} opts
   * @param {number} [opts.poolSize=4]
   * @param {boolean} [opts.headless=false]
   * @param {string|null} [opts.exe] explicit Chromium/Chrome executable path
   * @param {string[]} [opts.args] extra launch args (only used if we spawn our own instance)
   * @param {object} [opts.viewport]
   * @param {string|null} [opts.realProfile] the user's real Chromium profile dir, if detected
   * @param {string|null} [opts.snapshotProfile] a pre-made cookie-snapshot dir, if any
   * @param {() => Promise<string|null>} [opts.snapshotProfileFactory] lazily produces a snapshot dir
   *        only if we actually need to spawn a fresh instance (avoids copying files we never use)
   * @param {number} [opts.cdpPort=9222]
   */
  constructor(opts = {}) {
    this.poolSize = opts.poolSize ?? 4;
    this.headless = opts.headless ?? false;
    this.exe = opts.exe ?? null;
    this.args = opts.args ?? [];
    this.viewport = opts.viewport ?? { width: 1280, height: 900 };
    this.realProfile = opts.realProfile ?? null;
    this.snapshotProfile = opts.snapshotProfile ?? null;
    this.snapshotProfileFactory = opts.snapshotProfileFactory ?? null;
    this.cdpPort = opts.cdpPort ?? DEFAULT_CDP_PORT;

    this.browser = null;  // Playwright Browser, always CDP-attached
    this.context = null;  // BrowserContext used for all pages
    this.pages = [];
    this.available = [];
    this.waiters = [];
    this.initialized = false;

    this.ownsProcess = false;  // true only if WE spawned the Chromium process
    this.spawnedPid = null;
  }

  async initialize() {
    if (this.initialized) return;
    console.log(`[BrowserPool] Initializing pool (target size ${this.poolSize})...`);

    const attach = await this._connectOrLaunch();
    this.browser = attach.browser;
    this.ownsProcess = attach.ownsProcess;
    this.spawnedPid = attach.pid;

    // Prefer an existing context so we inherit whatever logins are already
    // active in that browser (this is the whole point of CDP attach).
    const contexts = this.browser.contexts();
    if (contexts.length > 0) {
      this.context = contexts[0];
      console.log(`[BrowserPool] Reusing existing browser context (${contexts.length} found) — existing logins preserved.`);
    } else {
      this.context = await this.browser.newContext({
        viewport: this.viewport,
        acceptDownloads: true,
      });
      console.log('[BrowserPool] No existing context on the attached browser; created a new one.');
    }

    // Reuse already-open tabs first, then top up to poolSize with new tabs.
    const existingPages = this.context.pages();
    for (const p of existingPages) {
      if (this.pages.length >= this.poolSize) break;
      const idx = this.pages.length;
      this.pages.push(new PageWrapper(p, idx));
      this.available.push(idx);
    }
    while (this.pages.length < this.poolSize) {
      const idx = this.pages.length;
      const page = await this.context.newPage();
      this.pages.push(new PageWrapper(page, idx));
      this.available.push(idx);
    }

    this.initialized = true;
    console.log(`[BrowserPool] Ready: ${this.pages.length} page(s), owns-process=${this.ownsProcess}.`);
  }

  async _connectOrLaunch() {
    // 1. Fast path: a webQ-managed instance recorded in the lock file.
    const lock = readCdpLock();
    if (lock?.port) {
      const b = await tryConnectCDP(lock.port);
      if (b) {
        console.log(`[BrowserPool] Reattached via CDP to previously-managed instance on port ${lock.port}.`);
        return { browser: b, ownsProcess: false, pid: lock.pid ?? null };
      }
      // Stale — kill the old process by PID from lock file
      if (lock.pid) {
        console.log(`[BrowserPool] Killing stale browser pid ${lock.pid}...`);
        try { process.kill(lock.pid, 'SIGTERM'); } catch {}
        await new Promise(r => setTimeout(r, 1000)); // Give it time to die
      }
      clearCdpLock();
    }

    // 2. Scan a small port range for ANY Chromium already running with CDP
    //    enabled (e.g. the user started it manually with --remote-debugging-port).
    for (let p = this.cdpPort; p < this.cdpPort + CDP_PORT_SCAN_RANGE; p++) {
      const b = await tryConnectCDP(p);
      if (b) {
        console.log(`[BrowserPool] Detected a running Chromium with CDP on port ${p}. Attaching — will NOT close it.`);
        return { browser: b, ownsProcess: false, pid: null };
      }
    }

    // 3. Nothing reachable — kill any orphaned process on the target port,
    //    then spawn our own Chromium with CDP enabled.
    console.log('[BrowserPool] No reachable CDP endpoint found — cleaning up port and launching a managed Chromium instance...');
    await killProcessOnPort(this.cdpPort);
    return this._spawnAndConnect();
  }

  async _spawnAndConnect() {
    const exe = this.exe || (await resolveDefaultChromiumExe(this.exe));
    if (!exe || !existsSync(exe)) {
      throw new Error(
        '[BrowserPool] Could not locate a Chromium/Chrome executable. Pass --exe or set CHROMIUM_PATH.'
      );
    }

    let profileDir = this.snapshotProfile;
    if (!profileDir && this.snapshotProfileFactory) {
      profileDir = await this.snapshotProfileFactory();
    }
    const userDataDir = profileDir || this.realProfile || path.join(ROOT, 'browser-data-pool');
    mkdirSync(userDataDir, { recursive: true });

    // Pick a free-ish port near the preferred one.
    let port = this.cdpPort;
    for (let p = this.cdpPort; p < this.cdpPort + CDP_PORT_SCAN_RANGE; p++) {
      const taken = await tryConnectCDP(p, 400);
      if (!taken) { port = p; break; }
    }

    const spawnArgs = [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      ...(this.headless ? ['--headless=new'] : []),
      '--no-first-run',
      '--no-default-browser-check',
      ...this.args,
    ];

    const child = spawn(exe, spawnArgs, { detached: true, stdio: 'ignore', windowsHide: false });
    child.unref();

    const browser = await this._waitForCdpAndConnect(port, CDP_SPAWN_WAIT_MS);
    if (!browser) {
      throw new Error(
        `[BrowserPool] Spawned Chromium (pid ${child.pid}) but could not attach via CDP on port ${port} within ${CDP_SPAWN_WAIT_MS}ms.`
      );
    }

    writeCdpLock({ port, pid: child.pid, startedAt: Date.now() });
    console.log(`[BrowserPool] Launched managed Chromium (pid ${child.pid}) with CDP on port ${port}.`);

    return { browser, ownsProcess: true, pid: child.pid };
  }

  async _waitForCdpAndConnect(port, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const b = await tryConnectCDP(port, 800);
      if (b) return b;
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  }

  async acquire(siteKey = null) {
    while (true) {
      const idx = this.available.find((i) => !this.pages[i].busy);
      if (idx !== undefined) {
        const pw = this.pages[idx];
        pw.busy = true;
        pw.currentSite = siteKey;
        this.available = this.available.filter((i) => i !== idx);
        return pw;
      }
      await new Promise((resolve) => this.waiters.push(resolve));
    }
  }

  release(pageWrapper) {
    pageWrapper.busy = false;
    pageWrapper.currentSite = null;
    this.available.push(pageWrapper.index);
    const waiter = this.waiters.shift();
    if (waiter) waiter();
  }

  /**
   * @param {object} opts
   * @param {boolean} [opts.force=false] if true AND we spawned the process
   *   ourselves, actually terminate it. Otherwise we only ever disconnect —
   *   an externally-owned (or previously-managed) browser is NEVER closed.
   */
  
  /**
   * Execute multiple queries in parallel across the page pool.
   * All pages share the SAME context (cookies, session, login).
   */
  async parallelMap(items, fn, concurrency = null) {
    const maxConcurrency = concurrency || this.pages.length;
    const results = [];
    const executing = [];

    for (const item of items) {
      const promise = (async () => {
        const pw = await this.acquire();
        try {
          const result = await fn(pw.page, this.context, pw, item);
          return { item, result, error: null };
        } catch (err) {
          return { item, result: null, error: err };
        } finally {
          this.release(pw);
        }
      })();

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        const batch = await Promise.allSettled(executing);
        results.push(...batch.map(r => r.status === 'fulfilled' ? r.value : r.reason));
        executing.length = 0;
      }
    }

    if (executing.length > 0) {
      const batch = await Promise.allSettled(executing);
      results.push(...batch.map(r => r.status === 'fulfilled' ? r.value : r.reason));
    }

    return results;
  }


  async shutdown({ force = false } = {}) {
    if (!this.browser) return;

    if (!this.ownsProcess) {
      console.log('[BrowserPool] Detaching from externally-owned Chromium (leaving it running).');
      this.browser = null;
      this.context = null;
      this.pages = [];
      this.available = [];
      return;
    }

    if (force && this.spawnedPid) {
      try { await this.browser.close(); } catch { /* connection may already be gone */ }
      try { process.kill(this.spawnedPid); } catch { /* already exited */ }
      clearCdpLock();
    } else {
      console.log('[BrowserPool] Leaving managed Chromium instance running so future runs can reattach.');
    }

    this.browser = null;
  }

  async close() { return this.shutdown({ force: false }); }
}

export async function createBrowserPoolFromArgs(args) {
  const pool = new BrowserPool({
    poolSize: args.poolSize || (args.sites ? (Array.isArray(args.sites) ? args.sites.length : args.sites.split(",").length) : 4),
    exe: args.exe || null,
    realProfile: args.profile || null,
    cdpPort: args.cdpPort || 9222,
    headless: args.headless ?? false,
  });
  await pool.initialize();
  return pool;
}
