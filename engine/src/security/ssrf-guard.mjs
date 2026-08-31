import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { SSRFError } from './errors.mjs';
import { Address4, Address6 } from 'ip-address';

// Comprehensive IPv4 blocklist
const BLOCKED_V4_RANGES = [
  // Loopback
  '127.0.0.0/8',
  // Private networks
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  // Link-local (includes cloud metadata 169.254.169.254)
  '169.254.0.0/16',
  // Carrier-grade NAT
  '100.64.0.0/10',
  // Unspecified/current network
  '0.0.0.0/8',
  // Multicast
  '224.0.0.0/4',
  // Reserved
  '240.0.0.0/4',
  // TEST-NET ranges
  '192.0.2.0/24',
  '198.51.100.0/24',
  '203.0.113.0/24',
  // Benchmarking
  '198.18.0.0/15',
];

// Comprehensive IPv6 blocklist
const BLOCKED_V6_RANGES = [
  '::1/128',          // Loopback
  'fc00::/7',          // Unique Local
  'fe80::/10',         // Link Local
  'ff00::/8',          // Multicast
  '2001:db8::/32',     // Documentation
  '::ffff:0:0/96',     // IPv4-mapped IPv6 (covers all v4 addresses)
];

// Cloud metadata endpoints (additional explicit block)
const METADATA_IPS = new Set([
  '169.254.169.254',
  '169.254.169.255',
  'fd00:ec2::254',
  'metadata.google.internal',
  'metadata',
]);

// Check if IP is in CIDR range (supports both IPv4 and IPv6)
// Uses ip-address library for proper CIDR matching
function ipInCidr(ip, cidr) {
  const [network, prefix] = cidr.split('/');
  const prefixLength = parseInt(prefix);
  
  if (isIP(ip) === 4) {
    const ipObj = new Address4(ip);
    const networkObj = new Address4(network);
    return ipObj.isInSubnet(networkObj, prefixLength);
  } else if (isIP(ip) === 6) {
    const ipObj = new Address6(ip);
    const networkObj = new Address6(network);
    return ipObj.isInSubnet(networkObj, prefixLength);
  }
  return false;
}

// Check if IP is blocked
function isBlockedIP(ip, config) {
  const version = isIP(ip);
  
  if (version === 4) {
    // Check metadata endpoints first
    if (config.blockMetadataEndpoints && METADATA_IPS.has(ip)) {
      return true;
    }
    if (config.blockLoopback && BLOCKED_V4_RANGES.some(c => ipInCidr(ip, c))) {
      return true;
    }
    return false;
  }
  
  if (version === 6) {
    if (config.blockLoopback && BLOCKED_V6_RANGES.some(c => ipInCidr(ip, c))) {
      return true;
    }
    return false;
  }
  
  // Invalid IP
  return true;
}

// Resolve hostname and validate all addresses
export async function assertResolvesToPublicIP(hostname, config) {
  let records;
  try {
    records = await dns.lookup(hostname, { 
      all: true, 
      verbatim: true,
      family: 0, // Both IPv4 and IPv6
    });
  } catch (err) {
    // DNS failure = fail closed
    throw new SSRFError(`DNS resolution failed for ${hostname}: ${err.message}`, {
      hostname,
      dnsError: err.message,
    });
  }
  
  if (records.length === 0) {
    throw new SSRFError(`No DNS records found for ${hostname}`, { hostname });
  }
  
  // Validate EVERY resolved address
  for (const record of records) {
    const { address } = record;
    if (isBlockedIP(address, config)) {
      throw new SSRFError(
        `${hostname} resolves to disallowed address ${address}`,
        { hostname, address }
      );
    }
  }
  
  return records.map(r => r.address);
}