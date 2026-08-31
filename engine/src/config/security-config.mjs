import { z } from 'zod';

// Security configuration schema — validated at startup
export const SecurityConfigSchema = z.object({
  // Protocol enforcement
  allowedProtocols: z.array(z.enum(['https:', 'http:'])).default(['https:']),
  enforceHttps: z.boolean().default(true),
  
  // Domain allowlist (exact matches only — no wildcards for security)
  allowedDomains: z.array(z.string()).min(1),
  
  // IP blocking
  blockPrivateNetworks: z.boolean().default(true),
  blockLoopback: z.boolean().default(true),
  blockLinkLocal: z.boolean().default(true),
  blockMetadataEndpoints: z.boolean().default(true),
  blockMulticast: z.boolean().default(true),
  blockReserved: z.boolean().default(true),
  
  // Navigation limits
  maxRedirects: z.number().int().positive().max(20).default(5),
  maxNavigationTime: z.number().positive().default(30000),
  maxResponseSize: z.number().positive().default(10 * 1024 * 1024), // 10MB
  
  // Content extraction
  maxExtractedTextLength: z.number().positive().default(100000),
  stripHtml: z.boolean().default(true),
  
  // Sanitization
  allowedHtmlTags: z.array(z.string()).default([
    'p', 'br', 'strong', 'em', 'code', 'pre', 
    'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3'
  ]),
  allowedHtmlAttributes: z.array(z.string()).default([]), // Empty = no attributes
  allowDataAttributes: z.boolean().default(false),
});

// Parse and validate configuration
export const DEFAULT_SECURITY_CONFIG = SecurityConfigSchema.parse({
  allowedProtocols: ['https:'],
  enforceHttps: true,
  allowedDomains: [
    'chat.deepseek.com',
    'chatgpt.com',
    'claude.ai',
    'gemini.google.com',
  ],
  blockPrivateNetworks: true,
  blockLoopback: true,
  blockLinkLocal: true,
  blockMetadataEndpoints: true,
  maxRedirects: 5,
  maxNavigationTime: 30000,
  maxResponseSize: 10 * 1024 * 1024,
  maxExtractedTextLength: 100000,
  stripHtml: true,
  allowedHtmlTags: ['p', 'br', 'strong', 'em', 'code', 'pre', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3'],
  allowedHtmlAttributes: [],
});

export function validateSecurityConfig(config) {
  return SecurityConfigSchema.parse(config);
}