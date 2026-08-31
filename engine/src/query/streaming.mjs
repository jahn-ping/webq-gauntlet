import { appendFileSync } from 'fs';

const DEFAULT_POLL_MS = 400;
const STABLE_THRESHOLD_MS = 1500;
const CONTINUE_CLICK_COOLDOWN_MS = 4000;

const RATE_LIMIT_PATTERNS = [
  /out of (?:free )?messages/i,
  /you've? used (?:all|your) (?:daily )?messages/i,
  /you have reached (?:the |your )?(?:message|usage|daily) limit/i,
  /rate limit(?:ed)?/i,
  /try again (?:in |at |after )?\d+/i,
  /try again later/i,
  /messages? too frequent/i,
  /(?:message|token) limit (?:reached|exceeded)/i,
  /free tier (?:limit|quota)/i,
  /hit(?:ting)? (?:your |the )?limit/i,
  /upgrade to (?:keep|continue)/i,
];

const DEBUG_LOG = 'C:/cr mod/webq-gauntlet/engine/streaming-debug.log';
function dbg(msg) {
  try { appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

export async function looksLoggedOut(page, loggedOutSels = []) {
  for (const sel of loggedOutSels) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) return true;
    } catch {
      // ignore selectors that fail to evaluate
    }
  }
  return false;
}

export async function dismissWelcome(page, welcomeSels = []) {
  let dismissedAny = false;
  for (const sel of welcomeSels) {
    try {
      const btn = page.locator(sel).first();
      if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
        await btn.click({ timeout: 2000 });
        await page.waitForTimeout(800);
        dismissedAny = true;
      }
    } catch {
      // dialog may already be gone, or selector didn't resolve to a clickable node
    }
  }
  return dismissedAny;
}

export async function detectFirstVisible(page, sels = []) {
  for (const sel of sels) {
    try {
      const el = page.locator(sel).first();
      if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) return el;
    } catch {
      // skip selectors that throw
    }
  }
  return null;
}

export async function detectRateLimit(page, target) {
  // 1. Check site-specific selectors
  const el = await detectFirstVisible(page, target.rateLimitSels || []);
  if (el) {
    try {
      return (await el.innerText()).trim().slice(0, 300);
    } catch {
      return 'rate limit detected';
    }
  }
  // 2. Check for rate limit text in any visible dialog/overlay
  try {
    const overlays = page.locator('[role="dialog"], [role="alertdialog"], [class*="modal"], [class*="overlay"], [class*="popup"]');
    const count = await overlays.count();
    for (let i = 0; i < count; i++) {
      const overlay = overlays.nth(i);
      if (await overlay.isVisible().catch(() => false)) {
        const text = await overlay.innerText().catch(() => '');
        if (/too frequent|rate limit|try again|messages?. limit|out of.*messages/i.test(text)) {
          return text.trim().slice(0, 300);
        }
      }
    }
  } catch {}
  // 3. Scan body text for rate limit patterns
  try {
    const bodyText = await page.locator('body').innerText({ timeout: 2000 });
    for (const pat of RATE_LIMIT_PATTERNS) {
      const m = bodyText.match(pat);
      if (m) return m[0];
    }
  } catch {}
  return null;
}

export async function detectConversationLimit(page, target) {
  const el = await detectFirstVisible(page, target.conversationLimitSels || []);
  if (!el) return null;
  try {
    return (await el.innerText()).trim().slice(0, 300);
  } catch {
    return 'conversation limit detected';
  }
}

export async function clickContinueIfPresent(page, target) {
  const el = await detectFirstVisible(page, target.continueSels || []);
  if (!el) return false;
  try {
    await el.click({ timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

async function isStopVisible(page, stopSels = []) {
  return !!(await detectFirstVisible(page, stopSels));
}

async function readLastAnswerText(page, answerSels = []) {
  for (const sel of answerSels) {
    try {
      const locator = page.locator(sel);
      const count = await locator.count();
      if (count === 0) { dbg(`readLastAnswer: sel="${sel}" count=0`); continue; }
      const text = await locator.nth(count - 1).innerText().catch((e) => { dbg(`readLastAnswer: innerText error: ${e.message}`); return ''; });
      dbg(`readLastAnswer: sel="${sel}" count=${count} textLen=${text.length}`);
      if (text) return text;
    } catch (e) {
      dbg(`readLastAnswer: catch error: ${e.message}`);
    }
  }
  return '';
}

/**
 * Confirms the page is not still mid-response from a PREVIOUS prompt before
 * a new one is sent. Prevents interleaving two prompts on the same tab.
 */
export async function waitForIdle(page, target, { timeoutMs = 20000, pollMs = DEFAULT_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stopVisible = await isStopVisible(page, target.stopSels);
    const continuing = await detectFirstVisible(page, target.continueSels || []);
    if (!stopVisible && !continuing) return true;
    await page.waitForTimeout(pollMs);
  }
  return false;
}

/**
 * Waits for a streamed response to finish. Handles:
 *  - stale leftover text from the previous prompt (via preText)
 *  - mid-response "Continue generating" buttons (auto-clicked)
 *  - rate-limit banners           -> { status: 'rate_limited' }
 *  - conversation-length banners  -> { status: 'conversation_limit' }
 *  - a body-text fallback if answerSels never match
 */
export async function waitForStreaming(page, target, {
  startTime = Date.now(),
  timeoutMs = 120000,
  bodyFallback = false,
  bodyFallbackContainer = null,
  preText = '',
  pollMs = DEFAULT_POLL_MS,
  stableThresholdMs = STABLE_THRESHOLD_MS,
} = {}) {
  const answerSels = target.answerSels || [];
  const stopSels = target.stopSels || [];
  const inputSels = target.inputSels || [];
  dbg(`waitForStreaming START preText=${JSON.stringify(preText.slice(0,100))} answerSels=${JSON.stringify(answerSels)}`);

  let lastText = '';
  let stableStart = null;
  let answerMatched = false;
  let lastContinueClickAt = 0;
  let promptSent = false;

  while (Date.now() - startTime < timeoutMs) {
    const rateLimitMsg = await detectRateLimit(page, target);
    if (rateLimitMsg) return { status: 'rate_limited', text: lastText, message: rateLimitMsg };

    const convLimitMsg = await detectConversationLimit(page, target);
    if (convLimitMsg) return { status: 'conversation_limit', text: lastText, message: convLimitMsg };

    const now = Date.now();
    if (now - lastContinueClickAt > CONTINUE_CLICK_COOLDOWN_MS) {
      const clicked = await clickContinueIfPresent(page, target);
      if (clicked) {
        lastContinueClickAt = now;
        stableStart = null;
        await page.waitForTimeout(pollMs);
        continue;
      }
    }

    let text = '';
    if (answerSels.length) {
      text = await readLastAnswerText(page, answerSels);
    }
    if (!text && bodyFallback) {
      try {
        const container = bodyFallbackContainer
          ? page.locator(bodyFallbackContainer).first()
          : page.locator('body');
        text = (await container.innerText().catch(() => '')) || '';
      } catch {
        text = '';
      }
    }

    // Detect if prompt was actually sent by checking if input field is empty
    if (!promptSent && inputSels.length) {
      try {
        const inputEl = page.locator(inputSels.join(', ')).first();
        if (await inputEl.count() > 0) {
          const inputText = (await inputEl.innerText().catch(() => '')) || (await inputEl.inputValue().catch(() => ''));
          promptSent = !inputText || inputText.trim().length === 0;
          if (promptSent) dbg(`promptSent=true (input empty) at ${now - startTime}ms`);
        } else {
          promptSent = true;
        }
      } catch {
        promptSent = true;
      }
    }

    const stopVisible = await isStopVisible(page, stopSels);
    const elapsed = now - startTime;

    // Phase 1: Wait for prompt to be sent (input field clears)
    if (!promptSent) {
      dbg(`waitingForSend: textLen=${text.length} inputSels=${inputSels.length}`);
      await page.waitForTimeout(pollMs);
      continue;
    }

    // Phase 2: Normal stability tracking
    dbg(`poll elapsed=${elapsed}ms textLen=${text.length} lastTextLen=${lastText.length} stableStart=${stableStart} stopVisible=${stopVisible} answerMatched=${answerMatched} text===last=${text === lastText}`);

    if (text && text === lastText) {
      if (stableStart === null) {
        stableStart = now;
        dbg('stableStart set');
      } else if (now - stableStart >= stableThresholdMs) {
        dbg(`ACCEPTED stable ${(now - stableStart)}ms`);
        return { status: 'complete', text, answerMatched };
      } else if (stopVisible && now - stableStart >= 15000) {
        dbg(`ACCEPTED backstop ${(now - stableStart)}ms`);
        return { status: 'complete', text, answerMatched };
      }
    } else if (text) {
      dbg(`text changed ${lastText.length} -> ${text.length}`);
      lastText = text;
      stableStart = null;
    } else {
      dbg('EMPTY text');
    }

    await page.waitForTimeout(pollMs);
  }

  return { status: 'timeout', text: lastText, answerMatched };
}

export async function waitForLogin(page, target, { loginTimeoutSec = 120, pollMs = 2500 } = {}) {
  const loginDeadline = Date.now() + loginTimeoutSec * 1000;
  while (Date.now() < loginDeadline) {
    await page.waitForTimeout(pollMs);
    if (!(await looksLoggedOut(page, target.loggedOutSels))) return true;
    const box = await detectFirstVisible(page, target.inputSels || []);
    if (box) return true;
  }
  return false;
}
