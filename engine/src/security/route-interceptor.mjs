import { assertResolvesToPublicIP } from './ssrf-guard.mjs';
import { validateDomain } from './navigation-policy.mjs';

// Cache validated hostnames to avoid excessive DNS lookups
const validationCache = new Map();
const CACHE_TTL_MS = 30000; // 30 seconds

function getCacheKey(hostname) {
  return hostname.toLowerCase();
}

function isCachedValid(hostname) {
  const key = getCacheKey(hostname);
  const entry = validationCache.get(key);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    validationCache.delete(key);
    return false;
  }
  return entry.valid;
}

function cacheHostname(hostname, valid) {
  const key = getCacheKey(hostname);
  validationCache.set(key, {
    valid,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Install request interceptor on browser context
export function installNavigationGuard(context, config) {
  context.route('**/*', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const hostname = url.hostname.toLowerCase();
    
    // Step 1: Protocol validation (allow HTTPS only)
    const protocol = url.protocol.toLowerCase();
    if (!config.allowedProtocols.includes(protocol)) {
      await route.abort('blockedbyclient');
      return;
    }
    
    // Step 2: Domain validation for top-level navigation
    if (request.isNavigationRequest()) {
      try {
        // Check if domain is allowed
        validateDomain(url, config);
        // If we got here, domain is valid
      } catch {
        await route.abort('blockedbyclient');
        return;
      }
    }
    
    // Step 3: SSRF check for all requests (cached)
    if (isCachedValid(hostname)) {
      await route.continue();
      return;
    }
    
    try {
      // Validate resolved IP addresses
      await assertResolvesToPublicIP(hostname, config);
      cacheHostname(hostname, true);
      await route.continue();
    } catch {
      cacheHostname(hostname, false);
      await route.abort('blockedbyclient');
    }
  });
}