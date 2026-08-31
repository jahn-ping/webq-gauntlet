import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * Best-effort, cross-platform check for whether a Chromium/Chrome process is
 * already running. Used only to decide whether it's safe to copy profile
 * files (copying from a live, locked profile can produce corrupt cookie DBs).
 * Never throws — returns false on any detection failure.
 */
export async function isChromiumProcessRunning(names = ['chrome.exe', 'chromium.exe', 'chrome', 'chromium']) {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        'tasklist /FI "IMAGENAME eq chrome.exe" /FI "IMAGENAME eq chromium.exe"'
      );
      const lower = stdout.toLowerCase();
      return names.some((n) => lower.includes(n.toLowerCase()));
    }
    const { stdout } = await execAsync('ps -A -o comm=');
    const lower = stdout.toLowerCase();
    return names.some((n) => lower.includes(n.toLowerCase()));
  } catch {
    return false;
  }
}
