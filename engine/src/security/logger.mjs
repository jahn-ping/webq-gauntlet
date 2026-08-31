export const SecurityEventTypes = {
  NAVIGATION_ALLOWED: 'navigation_allowed',
  NAVIGATION_BLOCKED: 'navigation_blocked',
  SSRF_BLOCKED: 'ssrf_blocked',
  DNS_FAILURE: 'dns_failure',
  REDIRECT_BLOCKED: 'redirect_blocked',
  CONTENT_SANITIZED: 'content_sanitized',
  XSS_DETECTED: 'xss_detected',
  CONTENT_TRUNCATED: 'content_truncated',
};

export class SecurityAuditLogger {
  constructor(options = {}) {
    this.logLevel = options.logLevel || 'info';
    this.logToConsole = options.logToConsole !== false;
    this.alertOnHighSeverity = options.alertOnHighSeverity !== false;
  }
  
  logEvent(event) {
    const { type, severity = 'medium', metadata = {}, action, timestamp = new Date().toISOString() } = event;
    
    // Sanitize metadata to remove sensitive information
    const sanitizedMetadata = this.sanitizeMetadata(metadata);
    
    const logEntry = {
      timestamp,
      type,
      severity,
      action: action || 'unknown',
      metadata: sanitizedMetadata,
    };
    
    if (this.logToConsole) {
      if (severity === 'high') {
        console.error('[SECURITY]', JSON.stringify(logEntry, null, 2));
      } else if (severity === 'medium') {
        console.warn('[SECURITY]', JSON.stringify(logEntry, null, 2));
      } else {
        console.info('[SECURITY]', JSON.stringify(logEntry, null, 2));
      }
    }
    
    // TODO: Send to external logging service
    // TODO: Send alerts for high severity events
    
    return logEntry;
  }
  
  sanitizeMetadata(metadata) {
    const sanitized = { ...metadata };
    // Remove sensitive fields
    const sensitiveFields = ['password', 'secret', 'token', 'key', 'credential'];
    for (const field of sensitiveFields) {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    }
    // Sanitize URLs (remove credentials)
    if (sanitized.url || sanitized.rawUrl) {
      const urlStr = sanitized.url || sanitized.rawUrl;
      try {
        const url = new URL(urlStr);
        if (url.username || url.password) {
          sanitized.url = `${url.protocol}//${url.hostname}${url.pathname}`;
        }
      } catch {
        // Keep as-is if not parseable
      }
    }
    return sanitized;
  }
}

// Singleton logger instance
let loggerInstance = null;

export function getSecurityLogger() {
  if (!loggerInstance) {
    loggerInstance = new SecurityAuditLogger();
  }
  return loggerInstance;
}