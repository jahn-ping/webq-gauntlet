import { PolicyViolationError, DisallowedProtocolError, DisallowedDomainError } from './errors.mjs';
import { assertResolvesToPublicIP } from './ssrf-guard.mjs';

// Validate and normalize URL
export function normalizeUrl(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new PolicyViolationError('URL must be a non-empty string', { rawUrl });
  }
  
  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new PolicyViolationError(`Unparseable URL: ${rawUrl}`, { rawUrl });
  }
  
  // Reject embedded credentials
  if (url.username || url.password) {
    throw new PolicyViolationError('URLs with embedded credentials are rejected', {
      hostname: url.hostname,
    });
  }
  
  // Normalize: remove trailing dot, normalize case, remove fragment
  let hostname = url.hostname.toLowerCase();
  if (hostname.endsWith('.')) {
    hostname = hostname.slice(0, -1);
  }
  url.hostname = hostname;
  
  // Remove fragment (not needed for navigation)
  url.hash = '';
  
  return url;
}

// Protocol validation
export function validateProtocol(url, config) {
  const protocol = url.protocol.toLowerCase();
  const allowed = config.allowedProtocols;
  
  if (!allowed.includes(protocol)) {
    throw new DisallowedProtocolError(`Protocol not allowed: ${protocol}`, {
      protocol,
      allowedProtocols: allowed,
      hostname: url.hostname,
    });
  }
  
  // HTTPS enforcement
  if (config.enforceHttps && protocol === 'http:') {
    // Check if HTTP is explicitly allowed for this domain
    const httpAllowed = config.httpAllowlist?.includes(url.hostname) || false;
    if (!httpAllowed) {
      throw new DisallowedProtocolError('HTTPS required, HTTP not allowed', {
        protocol: 'http:',
        hostname: url.hostname,
      });
    }
  }
  
  return true;
}

// Domain validation (exact match only)
export function validateDomain(url, config) {
  const hostname = url.hostname.toLowerCase();
  const allowed = config.allowedDomains;
  
  // Exact match (most secure)
  if (allowed.includes(hostname)) {
    return true;
  }
  
  // Optional: Explicit subdomain matching (only if configured)
  if (config.allowSubdomains) {
    for (const domain of allowed) {
      if (hostname.endsWith(`.${domain}`) || hostname === domain) {
        return true;
      }
    }
  }
  
  throw new DisallowedDomainError(`Hostname not in allowlist: ${hostname}`, {
    hostname,
    allowedDomains: allowed,
  });
}

// Main navigation validation
export async function validateNavigationURL(rawUrl, config) {
  // Step 1: Normalize URL
  const url = normalizeUrl(rawUrl);
  
  // Step 2: Protocol validation
  validateProtocol(url, config);
  
  // Step 3: Domain validation
  validateDomain(url, config);
  
  // Step 4: DNS + SSRF validation
  await assertResolvesToPublicIP(url.hostname, config);
  
  return url;
}