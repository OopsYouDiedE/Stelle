import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { safeErrorMessage } from "../shared/json.js";
import { fail } from "./types.js";
import type { ToolResult } from "./types.js";

export async function validatePublicHttpUrl(url: URL): Promise<ToolResult | undefined> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return fail("ssrf_blocked", "Only HTTP(S) URLs are allowed.");
  if (!host || host.toLowerCase() === "localhost") return fail("ssrf_blocked", "Localhost access is blocked.");

  try {
    // Resolve the host before any fetch-style tool uses it so private, loopback, and
    // mapped-address targets get rejected at the boundary instead of downstream.
    const literalReason = blockedIpReason(host);
    if (isIP(host) && literalReason) return fail("ssrf_blocked", `${literalReason}: ${host}`);
    const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
    for (const addr of addresses) {
      const ip = addr.address;
      const reason = blockedIpReason(ip);
      if (reason) return fail("ssrf_blocked", `${reason}: ${ip}`);
    }
  } catch (e) {
    return fail("dns_failed", `Could not resolve host ${host}: ${safeErrorMessage(e)}`);
  }
  return undefined;
}

function blockedIpReason(ip: string): string | null {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip) ? "Non-public IPv4 access blocked" : null;
  if (version === 6) {
    const mapped = ipv4FromMappedIpv6(ip);
    if (mapped) return isBlockedIpv4(mapped) ? "IPv4-mapped IPv6 access blocked" : null;
    return isBlockedIpv6(ip) ? "Non-public IPv6 access blocked" : null;
  }
  return "Unparseable IP address blocked";
}

function isBlockedIpv4(ip: string): boolean {
  return [
    ["0.0.0.0", 8],
    ["10.0.0.0", 8],
    ["100.64.0.0", 10],
    ["127.0.0.0", 8],
    ["169.254.0.0", 16],
    ["172.16.0.0", 12],
    ["192.0.0.0", 24],
    ["192.0.2.0", 24],
    ["192.168.0.0", 16],
    ["198.18.0.0", 15],
    ["198.51.100.0", 24],
    ["203.0.113.0", 24],
    ["224.0.0.0", 4],
    ["240.0.0.0", 4],
  ].some(([range, bits]) => ipv4InCidr(ip, range as string, bits as number));
}

function isBlockedIpv6(ip: string): boolean {
  const bytes = parseIpv6(ip);
  if (!bytes) return true;
  return [
    ["::", 128],
    ["::1", 128],
    ["::ffff:0:0", 96],
    ["64:ff9b::", 96],
    ["100::", 64],
    ["2001::", 23],
    ["2001:db8::", 32],
    ["2002::", 16],
    ["fc00::", 7],
    ["fe80::", 10],
    ["ff00::", 8],
  ].some(([range, bits]) => ipv6InCidr(bytes, range as string, bits as number));
}

function ipv4InCidr(ip: string, range: string, bits: number): boolean {
  const ipNum = ipv4ToNumber(ip);
  const rangeNum = ipv4ToNumber(range);
  if (ipNum === null || rangeNum === null) return true;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

function ipv4ToNumber(ip: string): number | null {
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!) >>> 0;
}

function ipv4FromMappedIpv6(ip: string): string | null {
  const bytes = parseIpv6(ip);
  if (!bytes) return null;
  const isMapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
  return isMapped ? bytes.slice(12).join(".") : null;
}

function ipv6InCidr(bytes: number[], range: string, bits: number): boolean {
  const rangeBytes = parseIpv6(range);
  if (!rangeBytes) return true;
  let remaining = bits;
  for (let i = 0; i < 16; i++) {
    if (remaining <= 0) return true;
    const take = Math.min(8, remaining);
    const mask = (0xff << (8 - take)) & 0xff;
    if ((bytes[i]! & mask) !== (rangeBytes[i]! & mask)) return false;
    remaining -= take;
  }
  return true;
}

function parseIpv6(ip: string): number[] | null {
  const normalized = ip.toLowerCase();
  const zoneLess = normalized.split("%")[0]!;
  const embeddedMatch = zoneLess.match(/(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let text = zoneLess;
  if (embeddedMatch) {
    const n = ipv4ToNumber(embeddedMatch[2]!);
    if (n === null) return null;
    text = `${embeddedMatch[1]}${((n >>> 16) & 0xffff).toString(16)}:${(n & 0xffff).toString(16)}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":").filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(":").filter(Boolean) : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0 || (halves.length === 1 && left.length !== 8)) return null;

  const groups = [...left, ...Array(fill).fill("0"), ...right];
  if (groups.length !== 8) return null;
  const bytes: number[] = [];
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
    const value = Number.parseInt(group, 16);
    bytes.push((value >> 8) & 0xff, value & 0xff);
  }
  return bytes;
}
