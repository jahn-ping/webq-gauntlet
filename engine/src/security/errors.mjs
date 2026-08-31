// Base security error
export class SecurityError extends Error {
  constructor(message, code, severity = 'medium', metadata = {}) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
    this.severity = severity;
    this.metadata = metadata;
    this.timestamp = new Date().toISOString();
  }
}

// Specific security errors
export class SSRFError extends SecurityError {
  constructor(message, metadata = {}) {
    super(message, 'SSRF_ERROR', 'high', metadata);
    this.name = 'SSRFError';
  }
}

export class PolicyViolationError extends SecurityError {
  constructor(message, metadata = {}) {
    super(message, 'POLICY_VIOLATION', 'medium', metadata);
    this.name = 'PolicyViolationError';
  }
}

export class InvalidUrlError extends PolicyViolationError {
  constructor(message, metadata = {}) {
    super(message, { ...metadata, reason: 'INVALID_URL' });
    this.name = 'InvalidUrlError';
  }
}

export class DisallowedProtocolError extends PolicyViolationError {
  constructor(message, metadata = {}) {
    super(message, { ...metadata, reason: 'DISALLOWED_PROTOCOL' });
    this.name = 'DisallowedProtocolError';
  }
}

export class DisallowedDomainError extends PolicyViolationError {
  constructor(message, metadata = {}) {
    super(message, { ...metadata, reason: 'DISALLOWED_DOMAIN' });
    this.name = 'DisallowedDomainError';
  }
}

export class RedirectLimitError extends PolicyViolationError {
  constructor(message, metadata = {}) {
    super(message, { ...metadata, reason: 'REDIRECT_LIMIT' });
    this.name = 'RedirectLimitError';
  }
}

export class UnsafeContentError extends SecurityError {
  constructor(message, metadata = {}) {
    super(message, 'UNSAFE_CONTENT', 'medium', metadata);
    this.name = 'UnsafeContentError';
  }
}

export class ContentLimitError extends SecurityError {
  constructor(message, metadata = {}) {
    super(message, 'CONTENT_LIMIT', 'low', metadata);
    this.name = 'ContentLimitError';
  }
}