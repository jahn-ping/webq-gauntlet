import sanitizeHtml from 'sanitize-html';
import { UnsafeContentError, ContentLimitError } from './errors.mjs';

// Strict HTML sanitization options
const STRICT_HTML_OPTIONS = {
  allowedTags: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3'],
  allowedAttributes: {}, // No attributes allowed (kills onerror, href=javascript:, etc.)
  allowedSchemes: [], // No schemes allowed
  disallowedTagsMode: 'discard',
  selfClosing: ['br', 'hr'],
  allowedClasses: {},
  allowDataAttributes: false,
  allowedStyles: {},
};

// Built-in XSS patterns for detection
const XSS_PATTERNS = [
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /javascript:/gi,
  /on\w+\s*=/gi,
  /data:text\/html/gi,
  /&#\d+;/gi,
  /\\u[0-9a-f]{4}/gi,
  /<iframe[^>]*>/gi,
  /<object[^>]*>/gi,
  /<embed[^>]*>/gi,
];

// Detect potential XSS in content
function containsXSSPatterns(content) {
  return XSS_PATTERNS.some(pattern => pattern.test(content));
}

// Sanitize HTML content
export function sanitizeExtractedHtml(html, config) {
  if (typeof html !== 'string') {
    throw new UnsafeContentError('Expected HTML string', { type: typeof html });
  }
  
  if (config && html.length > config.maxResponseSize) {
    throw new ContentLimitError(`HTML exceeds maximum size: ${html.length}`, {
      size: html.length,
      maxSize: config.maxResponseSize,
    });
  }
  
  // Detect XSS patterns for logging (but still sanitize)
  const hadXSS = containsXSSPatterns(html);
  if (hadXSS) {
    // Log this incident - could integrate with logger here
    console.warn('[SECURITY] XSS patterns detected in extracted content');
  }
  
  // Use sanitize-html with strict options
  const options = {
    allowedTags: config?.allowedHtmlTags || STRICT_HTML_OPTIONS.allowedTags,
    allowedAttributes: config?.allowDataAttributes 
      ? { '*': ['data-*'] } 
      : STRICT_HTML_OPTIONS.allowedAttributes,
    allowedSchemes: [],
    disallowedTagsMode: 'discard',
  };
  
  return sanitizeHtml(html, options);
}

// Sanitize plain text content
export function sanitizeExtractedText(text, config) {
  if (typeof text !== 'string') {
    throw new UnsafeContentError('Expected text string', { type: typeof text });
  }
  
  const maxLength = config?.maxExtractedTextLength || 100000;
  
  // Step 1: Normalize Unicode (NFKC)
  let sanitized = text.normalize('NFKC');
  
  // Step 2: Remove control characters (except newline and tab)
  sanitized = sanitized.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  
  // Step 3: Trim
  sanitized = sanitized.trim();
  
  // Step 4: Enforce length limit
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength);
    throw new ContentLimitError(`Text truncated: ${text.length} -> ${maxLength}`, {
      originalLength: text.length,
      truncatedLength: maxLength,
    });
  }
  
  return sanitized;
}

// Extract text safely from page
export async function extractSafeText(page, selector, config) {
  try {
    // Prefer textContent over innerHTML
    const element = await page.locator(selector).first();
    const text = await element.textContent();
    return sanitizeExtractedText(text || '', config);
  } catch (error) {
    throw new UnsafeContentError(`Failed to extract text from selector: ${selector}`, {
      selector,
      error: error.message,
    });
  }
}

// Extract sanitized HTML (use sparingly)
export async function extractSafeHtml(page, selector, config) {
  try {
    const element = await page.locator(selector).first();
    const html = await element.innerHTML();
    return sanitizeExtractedHtml(html, config);
  } catch (error) {
    throw new UnsafeContentError(`Failed to extract HTML from selector: ${selector}`, {
      selector,
      error: error.message,
    });
  }
}