#!/usr/bin/env node
/**
 * webQ — query.mjs (v2)
 *
 * Two-round multi-AI cross-reference engine for use with a local 12B model.
 * The web AIs do ALL the thinking; the local model just implements.
 *
 * Rounds 1..N: Round 1 queries all AIs in parallel. Rounds 2..N feed ALL
 * previous rounds' answers back to each AI and ask for the best combined
 * solution (auto-synthesis). With --bar and --critic-gap this becomes a
 * gauntlet loop: iterate against a concrete quality bar, closing the single
 * biggest gap each round, until the output beats the bar.
 *
 * Output: results.md (human-readable) + results.json (for the local model).
 *
 * Usage:
 *   node query.mjs "your question"
 *   node query.mjs --mode plan "Design a REST API for users"
 *   node query.mjs --mode code --json "Write the auth middleware"
 *   node query.mjs --no-synthesis "Quick question"       # Round 1 only
 *   node query.mjs --rounds 4 --bar "..." "Iterate vs bar"
 *   node query.mjs --rounds 3 --critic-gap "gap" "Improve"
 */

import { chromium } from 'playwright';
import { BrowserPool as CdpBrowserPool } from './src/browser/browser-pool.mjs';
import { isChromiumProcessRunning } from './src/browser/process-utils.mjs';
import { siteQueue } from './src/coordinator/site-queue.mjs';
import { TARGETS as NEW_TARGETS } from './src/query/targets.mjs';
import { looksLoggedOut as newLooksLoggedOut, dismissWelcome as newDismissWelcome, waitForStreaming as newWaitForStreaming, waitForIdle as newWaitForIdle, waitForLogin as newWaitForLogin, detectRateLimit, clickContinueIfPresent } from './src/query/streaming.mjs';

import {
  appendFileSync, existsSync, writeFileSync, readFileSync,
  mkdirSync, rmSync, readdirSync, copyFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createInterface } from 'node:readline';

// Security modules
import { 
  DEFAULT_SECURITY_CONFIG, 
  validateNavigationURL,
  installNavigationGuard,
  extractSafeText,
  extractSafeHtml,
  sanitizeExtractedText,
  getSecurityLogger,
  SecurityEventTypes 
} from './src/security/index.mjs';

// BrowserPool for multi-context management
import { BrowserPool, createBrowserPoolFromArgs } from './src/browser/browser-pool.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const RESULTS_MD = path.join(ROOT, 'results.md');
const RESULTS_JSON = path.join(ROOT, 'results.json');
const LIVE_FILE = path.join(ROOT, 'answer-live.txt');
const STATUS_FILE = path.join(ROOT, 'run-status.txt');
const CONTEXT_FILE = path.join(path.dirname(ROOT), 'context.md');

// ---- constants -------------------------------------------------------------

const STABLE_GAP_MS = 1500;
const MIN_ANSWER_LEN = 300;
const SHORT_ANSWER_BACKSTOP_MS = 15_000;
const MIN_ACCEPT_CHARS = 120;
const STUB_WORDS = new Set(['musing', 'honing', 'thinking', 'searching', 'analyzing']);
const QUERY_SITE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes hard timeout per site

// ---- thinking modes --------------------------------------------------------

const MODES = {
  plan: {
    label: 'Planning',
    prefix: 'You are a senior software architect. Produce a detailed, step-by-step project plan. Structure your answer as numbered steps with clear deliverables. Include: architecture decisions, file structure, key functions/classes, data flow, and edge cases. Be specific and actionable.',
  },
  code: {
    label: 'Code Generation',
    prefix: 'You are an expert software engineer. Provide production-ready code. Put each file in a fenced code block with the file path as a comment on the first line. Include all imports, types, and error handling. Do not use placeholders or ellipsis — write complete code.',
  },
  analyze: {
    label: 'Architecture Analysis',
    prefix: 'You are a systems architect. Analyze the question from multiple angles: performance, security, maintainability, scalability. List trade-offs explicitly. End with a concrete recommendation.',
  },
  brainstorm: {
    label: 'Brainstorm',
    prefix: 'You are a creative technical advisor. Explore multiple approaches, list pros/cons of each, and recommend the best path forward.',
  },
  debug: {
    label: 'Debug',
    prefix: 'You are a debugging expert. Analyze the error/log carefully. Identify root cause, explain why it happens, and provide the exact fix with code.',
  },
};

// ---- target registry (cleaned, deduplicated) -------------------------------

const TARGETS = {
  deepseek: {
    label: 'DeepSeek',
    home: 'https://chat.deepseek.com/',
    inputSels: [
      'textarea#chat-input',
      'textarea[placeholder*="Message"]',
      'div[contenteditable="true"][class*="input"]',
      'div[role="textbox"][contenteditable="true"]',
      '.chat-input',
      'textarea',
      '[contenteditable="true"]',
    ],
    stopSels: ['[aria-label*="stop" i]', 'button[title*="Stop" i]', 'div[class*="stop" i][role="button"]'],
    sendSels: ['button[aria-label*="send" i]', 'div[role="button"][aria-label*="send" i]'],
    answerSels: ['div.ds-markdown', 'div[class*="ds-markdown"]'],
    welcomeSels: ['button:has-text("Continue")', 'button:has-text("Get started")', 'button:has-text("Start chatting")'],
    newChatSels: ['[aria-label*="new chat" i]', 'button:has-text("New chat")', 'a:has-text("New chat")', 'button[aria-label*="new" i]', 'a[href="/"]', '.new-chat', 'button:has-text("New")', 'nav button:first-child', '[class*="new-chat"]', '[class*="sidebar"] button:first-child'],
    newChatKeys: ['Control+Shift+N', 'Control+N'],
    rateLimitSels: ['text=/too many messages/i', 'text=/rate limit/i', 'text=/try again later/i', 'text=/server is busy/i'],
    conversationLimitSels: ['text=/reached the limit/i', 'text=/maximum conversation length/i'],
    continueSels: ['button:has-text("Continue generating")', 'div[role=button]:has-text("Continue generating")', 'button:has-text("Continue")', 'div[role=button]:has-text("Continue")'],
    loggedOutSels: ['button:has-text("Log in")', 'button:has-text("Sign in")', 'a:has-text("Log in")'],
    modelSupport: true,
    popupSels: ['button:has-text("Accept all")', 'button:has-text("Got it")', 'button:has-text("OK")', '[aria-label="Close"]', 'button:has-text("Dismiss")'],
  },
  chatgpt: {
    label: 'ChatGPT',
    home: 'https://chatgpt.com/',
    inputSels: [
      '#prompt-textarea',
      'div[contenteditable="true"][id*="prompt"]',
      'div[contenteditable="true"][data-testid*="composer" i]',
      'div[contenteditable="true"]',
    ],
    stopSels: ['button[data-testid="stop-button"]', '[aria-label*="stop" i]'],
    sendSels: [
      'button#composer-submit-button',
      'button[data-testid="composer-s_send-button"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="send prompt" i]',
    ],
    answerSels: ['[data-message-author-role="assistant"]'],
    welcomeSels: [],
    newChatSels: ['[aria-label*="new chat" i]', '[data-testid*="new-chat" i]', 'button:has-text("New chat")', 'a:has-text("New chat")'],
    newChatKeys: ['Control+Shift+O'],
    loggedOutSels: ['a[href*="auth/login"]', 'button:has-text("Log in")', 'button:has-text("Sign up")'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: ['text=/you.ve reached/i', 'text=/you have reached/i', 'text=/rate limit/i', 'text=/try again later/i',
      'text=/out of (?:free )?messages/i',
      'text=/messages? (?:remaining|limit|quota)/i'],
    conversationLimitSels: ['text=/maximum length/i', 'text=/this conversation is too long/i'],
    modelSupport: false,
    popupSels: ['button:has-text("Accept all")', 'button:has-text("Got it")', '[aria-label="Close"]', 'button:has-text("Dismiss")'],
  },
  claude: {
    label: 'Claude',
    home: 'https://claude.ai/new',
    inputSels: [
      'div.ProseMirror[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"][data-testid*="prompt" i]',
      'div[contenteditable="true"][data-testid="phi-input"]',
      '.phi-input',
      'div[contenteditable="true"]',
      'textarea',
    ],
    stopSels: ['[data-testid="stop-button"]', 'button[aria-label*="stop" i]'],
    sendSels: [
      'button[aria-label="Send message"]',
      'button[data-testid="send-button"]',
      'button[aria-label*="send" i]',
      'button:has-text("Send")',
    ],
    answerSels: [
      '[data-testid="assistant-message"]',
      'div[data-testid="assistant-message"]',
      'div[data-testid*="assistant-message"]',
    ],
    welcomeSels: ['button:has-text("Accept")', 'button:has-text("Continue")'],
    newChatSels: ['[aria-label*="new chat" i]', 'button:has-text("New chat")'],
    loggedOutSels: ['a[href*="/auth"]', 'button:has-text("Log in")', 'button:has-text("Sign in")'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: ['text=/you.ve reached your usage limit/i', 'text=/reached the limit for this/i', 'text=/try again later/i', 'text=/out of (?:free )?messages/i', 'text=/messages? (?:remaining|limit|quota)/i'],
    conversationLimitSels: ['text=/this conversation is long/i', 'text=/start a new conversation/i'],
    modelSupport: false,
    bodyFallback: true,
    bodyFallbackContainer: 'main, [role="main"], div[class*="conversation"], div[class*="thread"]',
    // Claude-specific: doesn't clear composer, need alternative detection
    composerDoesNotClear: true,
    popupSels: ['#portal-root button:has-text("Close")', '#portal-root button:has-text("Not now")', '#portal-root button:has-text("Explore plans")', 'button:has-text("Accept")', 'button:has-text("Got it")', '[aria-label="Close"]'],
  },
  gemini: {
    label: 'Gemini',
    home: 'https://gemini.google.com/app',
    inputSels: [
      'div.ql-editor',
      'rich-textarea div[contenteditable="true"]',
      'div[contenteditable="true"][role="textbox"]',
      'div[contenteditable="true"]',
    ],
    stopSels: ['button[aria-label*="Stop" i]', 'div[class*="stop" i][role="button"]'],
    sendSels: [
      'button[aria-label="Send message"]',
      'button.send-button',
      'button[aria-label*="send" i]',
    ],
    answerSels: [
      'model-response message-content',
      'model-response .response-content',
      'div.response-content',
      'model-response',
    ],
    welcomeSels: ['button:has-text("Accept all")', 'button:has-text("Accept")', 'button:has-text("Continue")'],
    newChatSels: ['[aria-label*="new chat" i]', 'a[aria-label*="new chat" i]'],
    loggedOutSels: ['button:has-text("Sign in")', 'a[href*="ServiceLogin"]'],
    continueSels: ['button:has-text("Continue generating")', 'button:has-text("Continue")'],
    rateLimitSels: ['text=/you.ve reached your limit/i', 'text=/rate limit/i', 'text=/try again later/i', 'text=/high demand/i'],
    conversationLimitSels: ['text=/conversation is too long/i', 'text=/start a new chat/i'],
    modelSupport: false,
    bodyFallback: true,
    bodyFallbackContainer: 'main, [role="main"], div[class*="conversation"], model-response',
    popupSels: ['button:has-text("Accept all")', 'button:has-text("Got it")', '[aria-label="Close"]', 'button:has-text("Dismiss")'],
  },
};

const DEFAULT_SITES = ['deepseek', 'chatgpt', 'claude', 'gemini'];

const SEND_BTN_SELS = [
  'button[data-testid="send-button"]',
  'button[aria-label*="send prompt" i]',
  'button[aria-label*="send message" i]',
  'button[aria-label="Send"]',
  'button[aria-label*="submit" i]',
];

// ---- Chromium detection (Chromium-only) ------------------------------------

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

function detectProfile(args) {
  // Explicit --profile override
  if (args.profile && existsSync(args.profile)) return args.profile;
  // Standard Chromium profile location
  const p = process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Chromium', 'User Data');
  if (p && existsSync(p)) return p;
  return null;
}

// ---- profile snapshot (when Chromium is already running) -------------------

function pruneOldSnapshots() {
  let entries = [];
  try { entries = readdirSync(ROOT); } catch { return; }
  for (const e of entries) {
    if (/^\.webq-snap/.test(e)) {
      try { rmSync(path.join(ROOT, e), { recursive: true, force: true }); } catch {}
    }
  }
}

function makeProfileSnapshot(srcProfile) {
  const srcDefault = path.join(srcProfile, 'Default');
  if (!existsSync(path.join(srcDefault, 'Network', 'Cookies')) && !existsSync(path.join(srcDefault, 'Local Storage'))) {
    return null;
  }
  const snapDir = path.join(ROOT, `.webq-snap-${Date.now()}`);
  try {
    mkdirSync(path.join(snapDir, 'Default/Network'), { recursive: true });
    mkdirSync(path.join(snapDir, 'Default/Local Storage/leveldb'), { recursive: true });
    const localState = path.join(srcProfile, 'Local State');
    if (existsSync(localState)) {
      try { copyFileSync(localState, path.join(snapDir, 'Local State')); } catch {}
    }
    for (const f of ['Cookies', 'Cookies-wal', 'Cookies-shm']) {
      const s = path.join(srcDefault, 'Network', f);
      if (existsSync(s)) { try { copyFileSync(s, path.join(snapDir, 'Default/Network', f)); } catch {} }
    }
    const lsSrc = path.join(srcDefault, 'Local Storage', 'leveldb');
    if (existsSync(lsSrc)) {
      for (const f of readdirSync(lsSrc)) {
        try { copyFileSync(path.join(lsSrc, f), path.join(snapDir, 'Default/Local Storage/leveldb', f)); } catch {}
      }
    }
    return snapDir;
  } catch (err) {
    console.log('[webQ] profile snapshot failed:', err.message);
    return null;
  }
}

// ---- helpers ---------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function status(args, line) {
  console.log(line);
  if (args.save) writeFileSync(STATUS_FILE, `${new Date().toISOString()} ${line}\n`, 'utf-8');
}

const isStub = (text) => {
  const t = text.trim();
  if (t.length > 120) return false;
  const words = t.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  return words.length > 0 && words.every((w) => STUB_WORDS.has(w));
};

// Read file with encoding auto-detection (handles UTF-16 LE / UTF-8)
function readFileSmart(filePath) {
  const buf = readFileSync(filePath);
  // UTF-16 LE BOM detection (FF FE)
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) {
    return buf.toString('utf16le').replace(/^\uFEFF/, '').trim();
  }
  // UTF-8 (with or without BOM)
  return buf.toString('utf-8').replace(/^\uFEFF/, '').trim();
}

// ---- CLI parser ------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    keepOpen: false, debug: false, save: true, synthesis: true,
    query: null, sites: null, model: null, profile: null,
    mode: null, jsonOutput: false, autoContext: false,
    loginTimeoutSec: 120, answerTimeoutSec: 300, help: false,
    context: null, contextText: null,
    rounds: 2, bar: null, criticGap: null,
    noContext: false, writeContext: false,
  };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--keep-open': args.keepOpen = true; break;
      case '--debug': args.debug = true; break;
      case '--no-save': args.save = false; break;
      case '--no-synthesis': args.synthesis = false; break;
      case '--json': args.jsonOutput = true; break;
      case '--auto-context': args.autoContext = true; break;
      case '--sites': args.sites = argv[++i] ?? null; break;
      case '--model': args.model = argv[++i] ?? null; break;
      case '--profile': args.profile = argv[++i] ?? null; break;
      case '--mode': args.mode = argv[++i] ?? null; break;
      case '--context': args.context = argv[++i] ?? null; break;
      case '--context-text': args.contextText = argv[++i] ?? null; break;
      case '--query': args.query = argv[++i] ?? ''; break;
      case '--login-timeout': args.loginTimeoutSec = Number(argv[++i]) || 120; break;
      case '--answer-timeout': args.answerTimeoutSec = Number(argv[++i]) || 300; break;
      case '--rounds': {
        const n = Number(argv[++i]);
        args.rounds = Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 2;
        break;
      }
      case '--no-context': args.noContext = true; break;
      case '--write-context': args.writeContext = true; break;
      case '--bar': args.bar = argv[++i] ?? null; break;
      case '--critic-gap': args.criticGap = argv[++i] ?? null; break;
      case '-h': case '--help': args.help = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
        positional.push(a);
    }
  }
  if (!args.query && positional.length) args.query = positional.join(' ');
  if (args.mode && !MODES[args.mode]) {
    throw new Error(`Unknown mode: ${args.mode}. Available: ${Object.keys(MODES).join(', ')}`);
  }
  return args;
}  // Write an auto-detected project snapshot to the default context.md.
  // Use this when switching to a new project: the per-project context must
  // be refreshed so stale context from another project never leaks into a run.
  function writeDefaultContext() {
    const snapshot = autoDetectContext();
    if (!snapshot.text) {
      console.log('[webQ] --write-context: could not auto-detect any project info in this directory.');
      return null;
    }
    mkdirSync(path.dirname(CONTEXT_FILE), { recursive: true });
    writeFileSync(CONTEXT_FILE, snapshot.text + '\n', 'utf-8');
    console.log(`[webQ] Project context written → ${CONTEXT_FILE}`);
    return snapshot;
  }

  // ---- context loading -------------------------------------------------------

function loadContext(args) {
  if (args.noContext) {
    return { text: null, source: null };
  }
  if (args.autoContext) {
    return autoDetectContext();
  }
  if (args.context) {
    try {
      const text = readFileSmart(args.context);
      if (text) return { text, source: `--context ${args.context}` };
    } catch (err) {
      console.log(`[webQ] --context unreadable: ${err.message}`);
    }
    return { text: null, source: null };
  }
  if (args.contextText) {
    const text = args.contextText.trim();
    if (text) return { text, source: '--context-text (inline)' };
    return { text: null, source: null };
  }
  try {
    if (existsSync(CONTEXT_FILE)) {
      const text = readFileSmart(CONTEXT_FILE);
      if (text) return { text, source: `context.md (${CONTEXT_FILE})` };
    }
  } catch {}
  return { text: null, source: null };
}

// Auto-detect project context from working directory
function autoDetectContext() {
  const cwd = process.cwd();
  const parts = [];
  try {
    const pkgPath = path.join(cwd, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      parts.push(`## Project: ${pkg.name || 'unnamed'}`);
      if (pkg.description) parts.push(`Description: ${pkg.description}`);
      if (pkg.dependencies) parts.push(`Dependencies: ${Object.keys(pkg.dependencies).join(', ')}`);
      if (pkg.devDependencies) parts.push(`DevDeps: ${Object.keys(pkg.devDependencies).join(', ')}`);
    }
  } catch {}
  try {
    const readmePath = path.join(cwd, 'README.md');
    if (existsSync(readmePath)) {
      const readme = readFileSync(readmePath, 'utf-8').trim();
      const firstPara = readme.split('\n\n').slice(0, 3).join('\n\n');
      if (firstPara) parts.push(`## README (excerpt)\n${firstPara}`);
    }
  } catch {}
  try {
    // List top-level directories for structure context
    const entries = readdirSync(cwd, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('node_modules')).map((e) => e.name);
    if (dirs.length) parts.push(`## Directory structure\n${dirs.join(', ')}`);
  } catch {}
  if (parts.length === 0) return { text: null, source: null };
  return { text: parts.join('\n\n'), source: 'auto-detected from working directory' };
}

// Assemble the outbound prompt with mode prefix + context
// Natural language format: overview context first, then specific ask
function assemblePrompt(mode, context, question) {
  let parts = [];
  if (mode && MODES[mode]) {
    parts.push(MODES[mode].prefix);
  }
  // Only include context if it's substantial enough to be useful
  const hasContext = context && context.text && context.text.length > 50;
  if (hasContext) {
    parts.push(`Here is some context about the project I'm working on:\n\n${context.text}`);
    parts.push(`Based on the above context, here is my specific question:\n\n${question}`);
  } else {
    parts.push(question);
  }
  return parts.join('\n\n');
}

// Build an improvement-round prompt (gauntlet iteration).
// history: array of { round, label, response } from all previous rounds.
// bar: concrete quality reference; criticGap: single biggest gap to close.
function buildImprovePrompt(mode, context, question, bar, criticGap, history) {
  const answersBlock = history
    .map((h) => `### Round ${h.round} — ${h.label}\n${h.response}`)
    .join('\n\n---\n\n');

  let parts = [];
  parts.push("You are part of a multi-AI gauntlet loop. Multiple AIs are iterating on the same question over several rounds. Below are all previous rounds' answers. Your job is to produce THE SINGLE BEST combined solution that takes the strongest elements from every answer, resolves conflicts, closes the biggest remaining gap, and produces a definitive, actionable result. Do not just summarize — produce the actual deliverable (code, plan, analysis) that represents the best of all answers combined.");

  if (mode && MODES[mode]) {
    parts.push(MODES[mode].prefix);
  }
  if (context && context.text) {
    parts.push(`Here is the project context I'm working with:\n\n${context.text}`);
  }
  if (bar) {
    parts.push(`QUALITY BAR (the output must beat this reference):\n\n${bar}`);
  }
  if (criticGap) {
    parts.push(`LATEST CRITIQUE — the single biggest remaining gap to close this round:\n\n${criticGap}`);
  }
  parts.push(`Original question asked:\n\n${question}`);
  parts.push(`All previous rounds' answers:\n\n${answersBlock}`);
  parts.push(`Your task: Produce the single best combined solution now, closing the biggest gap against the quality bar. Be complete and specific.`);

  return parts.join('\n\n---\n\n');
}

// ---- per-site interaction --------------------------------------------------

async function stopBtnVisible(page, stopSels) {
  for (const sel of stopSels) {
    const btn = page.locator(sel).first();
    try {
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) return true;
    } catch {}
  }
  return false;
}

// preText: snapshot of any pre-existing answer text taken AFTER submit.
// Text equal to / shorter than it is a stale (previous-round) answer and is ignored.
async function waitForStreaming(page, answerSels, startTime, timeoutMs, stopSels, bodyFallback = false, baselineLen = 0, bodyFallbackContainer = null, preText = '', continueSels = []) {
  let lastContinueClickAt = 0;
  const isStale = (t) => !!preText && (t === preText || preText.startsWith(t));
  let lastText = '';
  let stableCount = 0;
  let stableStart = null;
  let answerMatched = false;
  let stopSeen = false;

  while (Date.now() - startTime < timeoutMs) {
    let currentText = '';
    let generating = false;
    try {
      generating = await stopBtnVisible(page, stopSels);
      if (generating) stopSeen = true;
      if (!answerMatched) {
        const el = page.locator(answerSels.join(', ')).last();
        if (await el.count() > 0) {
          const t = (await el.innerText()).trim();
          if (t.length > 0 && !isStale(t)) { currentText = t; answerMatched = true; }
        }
      } else {
        // Keep reading from matched selector to track streaming
        try {
          const el = page.locator(answerSels.join(', ')).last();
          if (await el.count() > 0) {
            currentText = (await el.innerText()).trim();
            if (isStale(currentText)) { currentText = ''; answerMatched = false; }
          }
        } catch {}
      }
      if (!currentText && bodyFallback) {
        const t = await page.evaluate((containerSel) => {
          // Try conversation container first, fall back to body
          let el = null;
          if (containerSel) {
            for (const sel of containerSel.split(', ')) {
              const found = document.querySelector(sel);
              if (found) { el = found; break; }
            }
          }
          if (!el) el = document.body;
          return (el.innerText || '').trim();
        }, bodyFallbackContainer || null);
        if (t.length - baselineLen > 300) {
          const cand = t.slice(baselineLen);
          if (!isStale(cand)) currentText = cand;
        }
      }
    } catch {}

    if (currentText && !isStub(currentText)) {
      if (currentText === lastText) {
        stableCount++;
        if (stableCount === 1) stableStart = Date.now();
        const stableMs = Date.now() - stableStart;
        const longEnough = currentText.length >= MIN_ANSWER_LEN;
        const backstopPassed = stableMs >= SHORT_ANSWER_BACKSTOP_MS;
        // Never accept while still generating (stop button still visible).
        // Backstop escape hatch: if the answer has been stable far beyond the
        // backstop window, accept anyway (guards against a stop-selector
        // matching a permanently-visible element).
              //      // Auto-click continue button during streaming (4s cooldown)
      const now_cc = Date.now();
      if (now_cc - (lastContinueClickAt || 0) > 4000) {
        const continueClicked = await handleContinueButton(page, continueSels);
        if (continueClicked) { lastContinueClickAt = now_cc; stableCount = 0; stableStart = null; continue; }
      }const genDone = !generating || stableMs >= 2 * SHORT_ANSWER_BACKSTOP_MS;
        if (stableMs >= 2 * STABLE_GAP_MS && (longEnough || backstopPassed) && genDone) {
          return currentText;
        }
      } else {
        stableCount = 0;
        stableStart = null;
        lastText = currentText;
      }
    }
    await page.waitForTimeout(STABLE_GAP_MS);
  }
  // On timeout, never hand back the stale pre-existing answer
  if (lastText.trim() && !isStale(lastText.trim())) return lastText.trim();
  throw new Error('Response timed out');
}

async function dismissWelcome(page, welcomeSels) {
  for (const sel of welcomeSels) {
    const btn = page.locator(sel).first();
    if (await btn.count() > 0) {
      try { await btn.click({ timeout: 2000 }); await page.waitForTimeout(800); } catch {}
    }
  }
}

async function looksLoggedOut(page, loggedOutSels) {
  for (const sel of loggedOutSels) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) return true;
  }
  return false;
}

async function resolveVisibleInput(page, inputSels, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await page.keyboard.press('Escape'); } catch {}
    for (const sel of inputSels) {
      const loc = page.locator(sel).first();
      try {
        if (await loc.count() > 0 && await loc.isVisible()) {
          await loc.waitFor({ state: 'visible', timeout: 2000 }).catch(() => {});
          return loc;
        }
      } catch {}
    }
    await page.waitForTimeout(800);
  }
  // Last resort: any contenteditable
  const any = page.locator('[contenteditable="true"]').first();
  if (await any.count() > 0) {
    try { await any.click({ force: true, timeout: 3000 }); return any; } catch {}
  }
  throw new Error('No visible input found');
}

// ---- submit verification helpers --------------------------------------------

function composerText(box) {
  return box.evaluate((el) => {
    const v = el.value;
    if (typeof v === 'string') return v.trim();
    return (el.innerText || '').trim();
  }).catch(() => '');
}

async function isBtnEnabled(loc) {
  try {
    if (!(await loc.count() > 0)) return false;
    if (!(await loc.isVisible().catch(() => false))) return false;
    return await loc.evaluate((el) => {
      const b = el.closest('button') || el;
      return !(b.disabled === true || b.hasAttribute('disabled') || b.getAttribute('aria-disabled') === 'true');
    });
  } catch { return false; }
}

// Click/press until the composer provably empties (= message actually sent)
// More robust: uses multiple detection strategies
async function submitPrompt(page, box, target) {
  const allSels = [...(target.sendSels || []), ...SEND_BTN_SELS];
  const typed = await composerText(box);
  
  // Record initial user message count to detect NEW messages only
  let initialUserMsgCount = 0;
  try {
    initialUserMsgCount = await page.locator('[data-message-author-role="user"], .user-message, [data-testid="user-message"]').count();
  } catch {}
  
  // Multiple detection strategies
  const composerCleared = async () => {
    const t = await composerText(box);
    return typed.length > 0 && t.length < typed.length / 2;
  };
  
  // Alternative: check if NEW message appeared in conversation (for sites that don't clear composer)
  // Only returns true if a NEW user message appeared (count increased AND contains our text)
  const messageAppeared = async () => {
    try {
      const currentCount = await page.locator('[data-message-author-role="user"], .user-message, [data-testid="user-message"]').count();
      if (currentCount > initialUserMsgCount) {
        // A new user message appeared — check if it's ours
        const lastMsg = await page.locator('[data-message-author-role="user"], .user-message, [data-testid="user-message"]').last();
        if (await lastMsg.count() > 0) {
          const text = await lastMsg.innerText();
          return text.includes(typed.slice(0, 50));
        }
      }
    } catch {}
    return false;
  };

  const SUBMIT_TIMEOUT_MS = 15000; // Overall timeout for submission
  const startTime = Date.now();

  for (let attempt = 1; attempt <= 3; attempt++) {
    // Check overall timeout
    if (Date.now() - startTime > SUBMIT_TIMEOUT_MS) {
      console.log('[webQ] submitPrompt: overall timeout reached');
      break;
    }
    
    for (const sel of allSels) {
      const loc = page.locator(sel).first();
      if (!(await loc.count() > 0)) continue;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !(await isBtnEnabled(loc))) {
        await page.waitForTimeout(250);
      }
      if (!(await isBtnEnabled(loc))) continue;
      try { 
        await loc.click({ timeout: 2500 }); 
      } catch { continue; }
      
      // Wait for either composer to clear OR message to appear
      for (let i = 0; i < 10; i++) { // Extended wait
        await sleep(700);
        if (await composerCleared()) return true;
        if (await messageAppeared()) return true;
      }
    }
    for (const key of ['Enter', 'Control+Enter']) {
      try { await page.keyboard.press(key); } catch {}
      for (let i = 0; i < 8; i++) {
        await sleep(800);
        if (await composerCleared()) return true;
        if (await messageAppeared()) return true;
      }
    }
    await sleep(500);
  }
  
  // Final fallback: if we typed the message, assume it was sent
  // Some sites (Claude) don't clear the composer but the message still goes through
  const finalCheck = await composerText(box);
  if (typed.length > 0 && finalCheck.length < typed.length) {
    return true; // Text was partially cleared, likely sent
  }
  
  // Last resort: check if our message appears in conversation
  if (await messageAppeared()) {
    return true;
  }
  
  return false;
}

async function debugShot(page, id) {
  try {
    const file = path.join(ROOT, `debug-${id}.png`);
    await page.screenshot({ path: file });
    console.log(`[webQ] debug screenshot: ${file}`);
  } catch {}
}

// ---- Rate limit / popup detection -------------------------------------------

const RATE_LIMIT_PATTERNS = [
  /out of (?:free )?messages/i,
  /you've? used (?:all|your) (?:daily )?messages/i,
  /you have reached (?:the |your )?(?:message|usage|daily) limit/i,
  /rate limit(?:ed)?/i,
  /try again (?:in |at |after )?d+/i,
  /try again later/i,
  /messages? too frequent/i,
  /(?:message|token) limit (?:reached|exceeded)/i,
  /free tier (?:limit|quota)/i,
  /hit(?:ting)? (?:your |the )?limit/i,
  /upgrade to (?:keep|continue)/i,
];

async function checkRateLimit(page, target) {
  // 1. Check site-specific rate limit selectors
  for (const sel of (target.rateLimitSels || [])) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        const text = (await el.innerText().catch(() => '') || '').trim();
        return text.slice(0, 300) || 'rate limit detected';
      }
    } catch {}
  }
  // 2. Scan body text for regex patterns
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 3000 });
    for (const pat of RATE_LIMIT_PATTERNS) {
      const m = bodyText.match(pat);
      if (m) return m[0];
    }
  } catch {}
  return null;
}

async function checkConversationLimit(page, target) {
  for (const sel of (target.conversationLimitSels || [])) {
    try {
      const el = page.locator(sel).first();
      if (await el.count() > 0 && await el.isVisible().catch(() => false)) {
        const text = (await el.innerText().catch(() => '') || '').trim();
        return text.slice(0, 300) || 'conversation limit detected';
      }
    } catch {}
  }
  return null;
}

async function dismissPopups(page, target) {
  const dismissed = [];
  for (const sel of (target.popupSels || [])) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 });
        dismissed.push(sel);
        await sleep(800);
      }
    } catch {}
  }
  return dismissed;
}

async function checkOverlayBlocking(page) {
  const overlaySels = ['[role="dialog"]', '[role="alertdialog"]', '#portal-root'];
  for (const sel of overlaySels) {
    try {
      const overlay = page.locator(sel).first();
      if (await overlay.count() > 0 && await overlay.isVisible().catch(() => false)) {
        const closeSels = ['button:has-text("Close")', 'button:has-text("Got it")', 'button:has-text("Not now")', 'button:has-text("Maybe later")', 'button:has-text("Dismiss")', 'button:has-text("OK")', 'button:has-text("Cancel")', '[aria-label="Close"]', '[aria-label="Dismiss"]', 'button[aria-label*="close" i]'];
        for (const cs of closeSels) {
          const closeBtn = overlay.locator(cs).first();
          if (await closeBtn.count() > 0) {
            await closeBtn.click({ timeout: 2000 }).catch(() => {});
            await sleep(500);
            return null;
          }
        }
        // Safety net: check dialog text for rate limits
        const dialogText = (await overlay.innerText().catch(() => '') || '').trim();
        if (/out of (?:free )?messages|rate limit|upgrade to keep|hit your.*limit/i.test(dialogText)) {
          return 'rate_limit: ' + dialogText.slice(0, 200);
        }
        if (dialogText.length > 20) return 'Blocking overlay: ' + dialogText.slice(0, 100);
      }
    } catch {}
  }
  return null;
}

async function detectAndDismissPopups(page, target, args, roundTag) {
  // 1. Rate limit check FIRST
  const rateMsg = await checkRateLimit(page, target);
  if (rateMsg) return { blocked: true, reason: 'rate_limit', message: rateMsg };

  // 2. Conversation limit check
  const convMsg = await checkConversationLimit(page, target);
  if (convMsg) return { blocked: true, reason: 'conversation_limit', message: convMsg };

  // 3. Dismiss generic popups
  const dismissed = await dismissPopups(page, target);
  if (dismissed.length > 0) {
    status(args, '  ' + roundTag + target.label + ': Dismissed ' + dismissed.length + ' popup(s)');
  }

  // 4. Check for blocking overlay
  const overlayMsg = await checkOverlayBlocking(page);
  if (overlayMsg) return { blocked: true, reason: 'overlay', message: overlayMsg };

  return { blocked: false, dismissed };
}

// ---- handle continue button during streaming --------------------------------

async function handleContinueButton(page, continueSels) {
  // Smart button detection: scan ALL visible buttons and decide which are safe to click
  // during streaming. Returns true if a button was clicked.
  
  // Keywords that indicate a safe "continue/resume" button
  const SAFE_KEYWORDS = /continue|resume|try again|regenerate|retry|next|proceed|start|generate/i;
  
  // Keywords that indicate a destructive or wrong button (NEVER click these)
  const BLOCKED_KEYWORDS = /stop|cancel|delete|remove|close|dismiss|submit|send|sign|log|upgrade|subscribe|pay|buy|accept|confirm|ok|done|finish|end|archive|save|export|copy|share|edit|settings|back|return|exit|quit/i;
  
  // 1. Try the explicit continueSels first (fast path)
  for (const sel of (continueSels || [])) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 2000 });
        return true;
      }
    } catch {}
  }
  
  // 2. Smart scan: look at ALL visible buttons during streaming
  try {
    const allBtns = await page.locator('button, [role=button]').all();
    for (const btn of allBtns) {
      try {
        if (!(await btn.isVisible().catch(() => false))) continue;
        
        const text = (await btn.evaluate(el => (el.textContent || '').trim()).catch(() => '') || '').toLowerCase();
        const ariaLabel = (await btn.evaluate(el => (el.getAttribute('aria-label') || '').trim()).catch(() => '') || '').toLowerCase();
        const combined = text + ' ' + ariaLabel;
        
        if (!combined.trim()) continue;
        
        // Skip blocked buttons
        if (BLOCKED_KEYWORDS.test(combined)) continue;
        
        // Match safe continue buttons
        if (SAFE_KEYWORDS.test(combined)) {
          await btn.click({ timeout: 2000 });
          return true;
        }
      } catch {}
    }
  } catch {}
  
  return false;
}
// ---- setup persistent popup handlers ----------------------------------------

function setupPersistentHandlers(page, target) {
  // Auto-dismiss portal overlay if it appears
  if (target.label === 'Claude') {
    page.addLocatorHandler(page.locator('#portal-root'), async () => {
      const closeBtn = page.locator('#portal-root button:has-text("Close")').first();
      if (await closeBtn.count() > 0) {
        await closeBtn.click({ timeout: 2000 }).catch(() => {});
      } else {
        const notNow = page.locator('#portal-root button:has-text("Not now")').first();
        if (await notNow.count() > 0) {
          await notNow.click({ timeout: 2000 }).catch(() => {});
        }
      }
    });
  }
  // Generic dialog handler
  page.on('dialog', async (dialog) => {
    console.log('[webQ] Dialog dismissed: ' + dialog.type() + ' - ' + dialog.message());
    await dialog.dismiss().catch(() => {});
  });
}

  // Query a single site with a given prompt. Used for both Round 1 and Round 2.
  // Uses the provided page from the pool (context is the shared BrowserContext)
  async function querySite(page, context, id, target, prompt, args) {
    const roundTag = args._roundTag || '';
    try {
      console.log(`[querySite] ${target.label}: Starting...`);
      status(args, `  ${roundTag}${target.label} — sending query…`);
      console.log(`[querySite] ${target.label}: Navigating to ${target.home}`);
      await page.goto(target.home, { waitUntil: 'domcontentloaded', timeout: 45000 });
      console.log(`[querySite] ${target.label}: Navigation complete`);
    await sleep(2500);
    await dismissWelcome(page, target.welcomeSels);
    await sleep(1000);

    // Start fresh chat
    for (const sel of target.newChatSels) {
      const btn = page.locator(sel).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        await btn.click({ timeout: 3000 }).catch(() => {});
        await sleep(1200);
        break;
      }
    }
    // Keyboard shortcut insurance (e.g. ChatGPT Ctrl+Shift+O) — guarantees a
    // NEW chat even when the home URL reopens the previous conversation.
    for (const combo of target.newChatKeys || []) {
      try { await page.keyboard.press(combo); await sleep(1500); } catch {}
    }
    await dismissWelcome(page, target.welcomeSels);
    await sleep(500);

    // Verify we're in a new conversation (no existing user messages)
    // If old messages exist, the new chat click failed — try harder
    try {
      const oldMsgs = await page.locator('[data-message-author-role="user"], .user-message, [data-testid="user-message"]').count();
      if (oldMsgs > 0) {
        console.log(`[querySite] ${target.label}: Old conversation detected (${oldMsgs} messages), forcing new chat...`);
        // Try clicking any sidebar new chat button
        const sidebarBtns = await page.locator('[class*="sidebar"] button, [class*="nav"] button, [class*="chat-list"] button').all();
        for (const btn of sidebarBtns) {
          try {
            const text = await btn.innerText().catch(() => '');
            const aria = await btn.getAttribute('aria-label').catch(() => '');
            if (/new|create|plus|add/i.test(text + ' ' + aria)) {
              await btn.click({ timeout: 2000 });
              await sleep(1500);
              break;
            }
          } catch {}
        }
        // Final fallback: navigate to home again
        const msgsAfter = await page.locator('[data-message-author-role="user"], .user-message, [data-testid="user-message"]').count();
        if (msgsAfter > 0) {
          console.log(`[querySite] ${target.label}: Still in old conversation, re-navigating...`);
          await page.goto(target.home, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await sleep(3000);
          // Try new chat one more time
          for (const sel of target.newChatSels) {
            const btn2 = page.locator(sel).first();
            if (await btn2.count() > 0 && await btn2.isVisible().catch(() => false)) {
              await btn2.click({ timeout: 3000 }).catch(() => {});
              await sleep(1500);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.log(`[querySite] ${target.label}: New chat verification error: ${e.message}`);
    }

    // Setup persistent popup handlers
    setupPersistentHandlers(page, target);

    // Detect and dismiss popups, check rate limits BEFORE input
    const popupResult = await detectAndDismissPopups(page, target, args, roundTag);
    if (popupResult.blocked) {
      status(args, '  ' + roundTag + target.label + ': BLOCKED — ' + popupResult.reason + ': ' + popupResult.message);
      return { label: target.label, error: popupResult.reason + ': ' + popupResult.message };
    }

    // Login check
    if (await looksLoggedOut(page, target.loggedOutSels)) {
      status(args, `  ${roundTag}${target.label}: NOT SIGNED IN — waiting up to ${args.loginTimeoutSec}s…`);
      const loginDeadline = Date.now() + args.loginTimeoutSec * 1000;
      let signedIn = false;
      while (Date.now() < loginDeadline) {
        await page.waitForTimeout(2500);
        if (!(await looksLoggedOut(page, target.loggedOutSels))) { signedIn = true; break; }
        const box = page.locator(target.inputSels.join(', ')).first();
        if (await box.count() > 0) { signedIn = true; break; }
      }
      if (!signedIn) {
        status(args, `  ${roundTag}${target.label}: skipped (not signed in)`);
        return { label: target.label, skipped: 'not signed in' };
      }
    }

    // DeepSeek needs extra settle time
    if (target.label === 'DeepSeek') await sleep(2000);

    // Wait for any ongoing streaming to finish before typing new prompt
    // If a stop button is visible, the site is still generating a response
    const STREAM_WAIT_TIMEOUT_MS = 60000;
    const streamStart = Date.now();
    for (const sel of (target.stopSels || [])) {
      try {
        const stopBtn = page.locator(sel).first();
        if (await stopBtn.count() > 0 && await stopBtn.isVisible().catch(() => false)) {
          console.log(`[querySite] ${target.label}: Streaming still active, waiting for it to finish...`);
          while (Date.now() - streamStart < STREAM_WAIT_TIMEOUT_MS) {
            await sleep(2000);
            const stillVisible = await stopBtn.isVisible().catch(() => false);
            if (!stillVisible) {
              console.log(`[querySite] ${target.label}: Streaming finished (${Date.now() - streamStart}ms)`);
              await sleep(1500); // Extra settle time after streaming stops
              break;
            }
          }
          break;
        }
      } catch {}
    }

    // Type and send — use loginTimeout if input not found quickly
    const box = await resolveVisibleInput(page, target.inputSels, args.loginTimeoutSec * 1000);
    try { await box.click({ timeout: 10000 }); }
    catch { try { await box.click({ force: true, timeout: 5000 }); } catch {} }
    await sleep(400);

    // Input strategy: clipboard paste (fastest) → insertText → keyboard.type (slow fallback)
    // Clipboard paste handles any size prompt in <1 second regardless of length.
    const INPUT_TIMEOUT_MS = 30000;
    const inputWithTimeout = (action) => Promise.race([
      action(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('input timed out')), INPUT_TIMEOUT_MS)),
    ]);

    let typedOk = false;

    // Strategy 1: Clipboard paste (instant, works on most sites)
    try {
      await inputWithTimeout(async () => {
        // Grant clipboard permissions via CDP
        const cdp = await page.context().newCDPSession(page);
        await cdp.send('Browser.grantPermissions', {
          permissions: ['clipboardReadWrite', 'clipboardSanitizedWrite'],
          origin: page.url(),
        }).catch(() => {});
        // Write to clipboard and paste
        await page.evaluate((text) => navigator.clipboard.writeText(text), prompt);
        await page.keyboard.press('Control+V');
        await cdp.detach().catch(() => {});
      });
      await sleep(800);
      const cur = await composerText(box);
      typedOk = cur.length >= Math.min(prompt.length, 50);
      if (typedOk) console.log(`[querySite] ${target.label}: Clipboard paste OK (${cur.length} chars)`);
    } catch (e) {
      console.log(`[querySite] ${target.label}: Clipboard paste failed: ${e.message}`);
    }

    // Strategy 2: insertText (fast, no delay)
    if (!typedOk) {
      try {
        await inputWithTimeout(() => page.keyboard.insertText(prompt));
        await sleep(600);
        const cur = await composerText(box);
        typedOk = cur.length >= Math.min(prompt.length, 50);
      } catch {}
    }

    // Strategy 3: fill() for textarea elements
    if (!typedOk) {
      try {
        await box.fill(prompt);
        await sleep(600);
        const cur = await composerText(box);
        typedOk = cur.length >= Math.min(prompt.length, 50);
      } catch {}
    }

    // Strategy 4: Slow keyboard.type fallback (last resort, may stall on large prompts)
    if (!typedOk) {
      try { await box.fill(''); } catch {}
      const typeDelay = prompt.length > 20000 ? 2 : prompt.length > 5000 ? 4 : 8;
      console.log(`[querySite] ${target.label}: Falling back to keyboard.type (delay=${typeDelay}ms, ~${(prompt.length * typeDelay / 1000).toFixed(0)}s)...`);
      try {
        await inputWithTimeout(() => page.keyboard.type(prompt, { delay: typeDelay }));
        await sleep(500);
      } catch (err) {
        throw new Error(`input failed (${err.message}) — skipping site`);
      }
    }

    // Submit with verification — composer must clear (proof the message sent)
    const submitted = await submitPrompt(page, box, target);
    if (!submitted) {
      throw new Error('submit failed — composer never cleared');
    }
    await sleep(1500);

    // Wait for answer
    const containerSel = target.bodyFallbackContainer || null;
    const baselineLen = target.bodyFallback
      ? await page.evaluate((cs) => {
          let el = null;
          if (cs) {
            for (const s of cs.split(', ')) {
              const f = document.querySelector(s);
              if (f) { el = f; break; }
            }
          }
          if (!el) el = document.body;
          return (el.innerText || '').length;
        }, containerSel).catch(() => 0)
      : 0;
    // Snapshot any pre-existing answer text (e.g. chatgpt.com reopening the
    // last conversation in Round 2) so the stream waiter can reject it as stale.
    const preText = await page
      .locator(target.answerSels.join(', '))
      .last()
      .innerText({ timeout: 3000 })
      .then((t) => (t || '').trim())
      .catch(() => '');
    const streamResult = await newWaitForStreaming(page, target, {
      startTime: Date.now(),
      timeoutMs: args.answerTimeoutSec * 1000,
      bodyFallback: target.bodyFallback,
      bodyFallbackContainer: containerSel,
      preText,
    });
    const response = streamResult.text || '';

    // Handle rate limit detected during streaming
    if (streamResult.status === 'rate_limited') {
      throw new Error(`rate_limited: ${streamResult.message || 'Messages too frequent. Try again later.'}`);
    }
    if (streamResult.status === 'conversation_limit') {
      throw new Error(`conversation_limit: ${streamResult.message || 'Conversation too long'}`);
    }

    // Reject page-chrome junk accepted by the streaming backstop
    if (response.trim().length < MIN_ACCEPT_CHARS) {
      throw new Error(`answer too short (${response.trim().length} chars, status=${streamResult.status}) — likely page chrome, not a real response`);
    }

    if (args.save) {
      appendFileSync(LIVE_FILE, `\n## ${roundTag}${target.label} — ${new Date().toISOString()}\n${response}\n`, 'utf-8');
    }
    status(args, `  ${roundTag}${target.label}: ✓ ${response.length} chars`);
    return { label: target.label, response };
    } catch (err) {
      status(args, `  ${roundTag}${target.label}: ✗ ${err.message}`);
      await debugShot(page, id);
      return { label: target.label, error: err.message };
    } finally {
      // DO NOT close page - pool manages page lifecycle
    }
}

// ---- output writers --------------------------------------------------------

function writeResultsMD(file, mode, context, prompt, rounds) {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  let entry = `\n---\n\n## Query: ${ts}\n\n`;
  entry += `**Mode:** ${mode || 'default'}\n`;
  entry += `**Context:** ${context?.source || 'none'}\n\n`;
  if (context?.text) entry += `> ${context.text.split('\n').join('\n> ')}\n\n`;
  entry += `**Prompt:** ${prompt}\n\n`;

  rounds.forEach((roundResults, idx) => {
    const n = idx + 1;
    if (n === 1) {
      entry += `## Round 1 — Independent Answers\n\n`;
    } else {
      entry += `## Round ${n} — Cross-Reference Improvement\n\n`;
      entry += `> Each AI was shown all previous answers and asked for the best combined solution (gauntlet iteration against the quality bar).\n\n`;
    }
    for (const r of roundResults) {
      entry += `### ${r.label}\n\n`;
      if (r.error) entry += `> Error: ${r.error}\n\n`;
      else if (r.skipped) entry += `> SKIPPED: ${r.skipped}\n\n`;
      else entry += `${r.response}\n\n`;
    }
  });
  appendFileSync(file, entry, 'utf-8');
}

function writeResultsJSON(file, mode, context, question, rounds, bar) {
  const map = (rs) => (rs || []).map((r) => ({
    site: r.label,
    response: r.response || null,
    error: r.error || null,
    skipped: r.skipped || null,
  }));
  const data = {
    timestamp: new Date().toISOString(),
    mode: mode || 'default',
    context: context?.text || null,
    contextSource: context?.source || null,
    question,
    bar: bar || null,
    finalRound: rounds.length,
    round1: map(rounds[0]),
    round2: map(rounds[1]),
  };
  for (let i = 2; i < rounds.length; i++) {
    data[`round${i + 1}`] = map(rounds[i]);
  }
  data.final = map(rounds[rounds.length - 1]);
  writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

// ---- main ------------------------------------------------------------------

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  if (args.help || !args.query) {
    console.log(
      'Usage: node query.mjs [--query] "your question" [flags]\n\n' +
      'Modes: --mode plan|code|analyze|brainstorm|debug\n' +
      'Flags:\n' +
      '  --sites <list>        Which AIs (default: deepseek,chatgpt,claude,gemini)\n' +
      '  --mode <mode>         Thinking mode (plan/code/analyze/brainstorm/debug)\n' +
      '  --model <name>        DeepSeek model switch\n' +
      '  --profile <path>      Explicit Chromium profile path\n' +
      '  --context <file>      Context block file\n' +
      '  --context-text <str>  Inline context\n' +
      '  --auto-context        Auto-detect from working directory\n' +
      '  --no-synthesis        Skip improvement rounds (independent answers only)\n' +
      '  --rounds <n>          Total rounds (default 2; gauntlet mode: 3+)\n' +
      '  --bar "<text>"        Quality bar the output must beat (gauntlet)\n' +
      '  --critic-gap "<text>" Single biggest gap from the latest critique\n' +
      '  --no-context          Ignore the default context.md (opt out)\n' +
      '  --write-context       Snapshot this project into webQ/context.md\n' +
      '  --json                Write results.json for local model\n' +
      '  --keep-open           Keep browser open (Enter to close)\n' +
      '  --no-save             Don\'t write to results files\n' +
      '  --login-timeout <s>   Per-site login wait (default 120)\n' +
      '  --answer-timeout <s>  Per-site answer wait (default 300)\n' +
      '  --debug               Verbose logging'
    );
    process.exit(args.help ? 0 : 1);
  }

  let ctx = loadContext(args);
  if (args.writeContext) {
    ctx = writeDefaultContext() ?? ctx;
  }
  const outboundPrompt = assemblePrompt(args.mode, ctx, args.query);
  if (ctx.text) console.log(`[webQ] Context: ${ctx.source} (${ctx.text.length} chars)`);
  else console.log('[webQ] No context.');
  if (args.mode) console.log(`[webQ] Mode: ${MODES[args.mode].label}`);

  const sites = args.sites ? args.sites.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_SITES;
  const unknown = sites.filter((s) => !TARGETS[s]);
  if (unknown.length) {
    console.error(`Unknown sites: ${unknown.join(', ')}. Available: ${Object.keys(TARGETS).join(', ')}`);
    process.exit(1);
  }

  if (args.save) {
    writeFileSync(LIVE_FILE, `# webQ live — ${new Date().toISOString()}\nPrompt: ${outboundPrompt}\n`, 'utf-8');
  }

  // Browser setup - single context with page pool
  console.log(`[webQ] Initializing BrowserPool...`);
  const pool = await createBrowserPoolFromArgs(args);
  console.log(`[webQ] BrowserPool ready: 1 context, ${pool.pages.length} pages`);
  console.log('[webQ] Security guards installed (SSRF, navigation policy, DOM sanitization)');

  // Global process timeout — save whatever we have and exit
  const GLOBAL_TIMEOUT_MS = 20 * 60 * 1000; // 20 minutes absolute max
  const globalRounds = [];
  let globalTimedOut = false;
  const globalTimer = setTimeout(async () => {
    globalTimedOut = true;
    console.log('\n[webQ] ⚠ GLOBAL TIMEOUT — saving whatever results we have and exiting...');
    try {
      if (globalRounds.length > 0) {
        writeResultsMD(RESULTS_MD, args.mode, ctx, args.query, globalRounds);
        if (args.jsonOutput) writeResultsJSON(RESULTS_JSON, args.mode, ctx, args.query, globalRounds, args.bar);
        console.log(`[webQ] Partial results saved to ${RESULTS_MD}`);
      }
    } catch (e) { console.log('[webQ] Failed to save partial results:', e.message); }
    try { await pool.close(); } catch {}
    process.exit(1);
  }, GLOBAL_TIMEOUT_MS);
  // Keep the event loop alive for the timer
  if (globalTimer.unref) globalTimer.unref();

  // ---- ROUND 1: Independent answers (parallel across pool) ----
  const r1StartTime = Date.now();
  console.log(`\n[webQ] ROUND 1 — Querying ${sites.length} sites in parallel… (${new Date().toLocaleTimeString()})\n`);
  const r1Args = { ...args, _roundTag: 'R1 ' };
  
  const round1 = await pool.parallelMap(sites, async (page, context, wrapper, siteId) => {
    const target = TARGETS[siteId];
    return await Promise.race([
      querySite(page, context, siteId, target, outboundPrompt, r1Args),
      new Promise((_, reject) => setTimeout(() => reject(new Error('querySite timeout — site unresponsive after 5 minutes')), QUERY_SITE_TIMEOUT_MS))
    ]);
  });
  
  // Convert parallelMap results to expected format
  const round1Results = round1.map(({ item, result, error }) => {
    if (error) return { label: TARGETS[item].label, error: error.message };
    return result;
  });

    const r1Valid = round1Results.filter((r) => !r.error && !r.skipped);
  if (r1Valid.length === 0) {
    console.log('\n[webQ] All sites failed in Round 1. Check login status.');
    await pool.close();
    process.exit(1);
  }

  // Save intermediate results after R1 (in case later rounds fail or timeout)
  const r1Elapsed = ((Date.now() - r1StartTime) / 1000).toFixed(1);
  console.log(`[webQ] R1 complete (${r1Elapsed}s) — saving intermediate results...`);
  const rounds = [round1Results];
  globalRounds.push(...rounds);
  try {
    writeResultsMD(RESULTS_MD, args.mode, ctx, args.query, rounds);
    if (args.jsonOutput) writeResultsJSON(RESULTS_JSON, args.mode, ctx, args.query, rounds, args.bar);
  } catch (e) { console.log('[webQ] Warning: failed to save intermediate results:', e.message); }

  // ---- ARCHIVE ORIGINAL CONTEXT & CREATE NEW CONTEXT WITH ROUND 1 RESULTS ----
  // Save original context.md with timestamp
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const archivedContextFile = path.join(path.dirname(CONTEXT_FILE), `context-${timestamp}.md`);
  try {
    if (existsSync(CONTEXT_FILE)) {
      const originalContext = readFileSmart(CONTEXT_FILE);
      writeFileSync(archivedContextFile, originalContext, 'utf-8');
      console.log(`[webQ] Archived original context → ${archivedContextFile}`);
    }
  } catch (err) {
    console.log(`[webQ] Failed to archive context: ${err.message}`);
  }

  // Keep original context.md intact — R1 answers go into the improvePrompt via history
  console.log('[webQ] Keeping original context.md for Round 2 improve prompt');


  // ---- ROUNDS 2..N: Cross-reference improvement (gauntlet loop, parallel) ----
  const totalRounds = args.synthesis ? Math.max(2, args.rounds) : 1;
  if (totalRounds > 1 && r1Valid.length > 0) {
    for (let r = 2; r <= totalRounds; r++) {
      console.log(`\n[webQ] ROUND ${r}/${totalRounds} — Cross-reference improvement (gauntlet)… (${new Date().toLocaleTimeString()})\n`);
      const history = [];
      rounds.forEach((prevRound, idx) => {
        for (const res of prevRound) {
          if (!res.error && !res.skipped) history.push({ round: idx + 1, label: res.label, response: res.response });
        }
      });


      const improvePrompt = buildImprovePrompt(args.mode, ctx, args.query, args.bar, args.criticGap, history);

      console.log('[webQ] R' + r + ' prompt preview: ' + improvePrompt.slice(0, 500) + '...');
      const roundArgs = { ...args, _roundTag: `R${r} ` };
      const prevLabels = new Set(rounds[rounds.length - 1].filter((res) => !res.error && !res.skipped).map((res) => res.label));
      const roundSites = sites.filter((id) => prevLabels.has(TARGETS[id].label));
      
      // Use pool for parallel execution in subsequent rounds too
      const roundResults = await pool.parallelMap(roundSites, async (page, context, wrapper, siteId) => {
        const target = TARGETS[siteId];
        return await Promise.race([
          querySite(page, context, siteId, target, improvePrompt, roundArgs),
          new Promise((_, reject) => setTimeout(() => reject(new Error('querySite timeout — site unresponsive after 5 minutes')), QUERY_SITE_TIMEOUT_MS))
        ]);
      });
      
      // Convert parallelMap results to expected format
      const roundResultsFormatted = roundResults.map(({ item, result, error }) => {
        if (error) return { label: TARGETS[item].label, error: error.message };
        return result;
      });
      rounds.push(roundResultsFormatted);
      // Save after each round so we never lose progress
      globalRounds.length = 0;
      globalRounds.push(...rounds);
      try {
        writeResultsMD(RESULTS_MD, args.mode, ctx, args.query, rounds);
        if (args.jsonOutput) writeResultsJSON(RESULTS_JSON, args.mode, ctx, args.query, rounds, args.bar);
        console.log(`[webQ] R${r} complete — results saved`);
      } catch (e) { console.log(`[webQ] R${r} complete — save failed: ${e.message}`); }
    }
  }

  // ---- Output ----
  clearTimeout(globalTimer);
  if (globalTimedOut) return; // Already saved and exited

  console.log('[webQ] All rounds complete.');
  if (args.keepOpen) {
    console.log('\n[webQ] Browser kept open — press Enter to close.');
    await new Promise((resolve) => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', () => { rl.close(); resolve(); });
    });
  }
  await pool.close();

  // Final save (overwrite intermediate)
  try {
    writeResultsMD(RESULTS_MD, args.mode, ctx, args.query, rounds);
    console.log(`\n[webQ] Results → ${RESULTS_MD}`);
    if (args.jsonOutput) {
      writeResultsJSON(RESULTS_JSON, args.mode, ctx, args.query, rounds, args.bar);
      console.log(`[webQ] JSON → ${RESULTS_JSON}`);
    }
  } catch (e) { console.log('[webQ] Final save failed:', e.message); }

  // Summary
  console.log('\n[webQ] Summary:');
  rounds.forEach((roundResults, idx) => {
    const n = idx + 1;
    for (const r of roundResults) {
      const status = r.error ? `✗ ${r.error}` : r.skipped ? `⊘ ${r.skipped}` : `✓ ${r.response.length} chars`;
      console.log(`  R${n} ${r.label}: ${status}`);
    }
  });
  status(args, 'Done.');
}

main().catch((err) => {
  console.error('[webQ] fatal:', err);
  process.exit(1);
});
