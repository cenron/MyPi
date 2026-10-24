import { lookup as lookupCallback } from "node:dns";
import { lookup } from "node:dns/promises";
import { BlockList, isIP, type LookupFunction } from "node:net";

/** The error code `publicLookup` fails with, so `fetchPage` can tell a blocked address from a network failure. */
export const BLOCKED = "EBLOCKED";

/**
 * IPv4 ranges that aren't on the public internet: "this network", private networks, carrier-grade NAT, loopback,
 * link-local (cloud metadata services live at 169.254.169.254), IETF protocol assignments, documentation,
 * benchmarking, multicast, and reserved, including broadcast.
 */
const IPV4_RANGES: [string, number][] = [
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
];

/**
 * IPv6 ranges that aren't on the public internet: unspecified, loopback, discard, documentation, unique local,
 * link-local, the old site-local, and multicast.
 */
const IPV6_RANGES: [string, number][] = [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of IPV4_RANGES) NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of IPV6_RANGES) NOT_PUBLIC.addSubnet(network, prefix, "ipv6");

/** NAT64's well-known prefix: on an IPv6-only network, `64:ff9b::a.b.c.d` reaches the IPv4 address a.b.c.d. */
const NAT64 = "64:ff9b::";

/**
 * True for an address on the public internet. False for anything in the ranges above, and for a string that isn't
 * an IP address at all. IPv4-mapped IPv6 (`::ffff:127.0.0.1`) is checked against the IPv4 ranges by `BlockList`
 * itself, and a NAT64 address by the IPv4 address it carries.
 */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  if (family === 4) return !NOT_PUBLIC.check(address, "ipv4");
  const target = nat64Target(address);
  if (target) return isPublicAddress(target);
  return !NOT_PUBLIC.check(address, "ipv6");
}

/**
 * Throws unless `hostname` (as `URL.hostname` gives it, with IPv6 in brackets) is public: the address itself, or
 * every address DNS returns for the name. One local answer is enough to refuse, since an attacker's DNS can mix them.
 */
export async function assertPublicHost(hostname: string): Promise<void> {
  const host = hostname.startsWith("[") ? hostname.slice(1, -1) : hostname;
  if (isIP(host)) {
    if (!isPublicAddress(host)) throw new Error(notPublic(host));
    return;
  }

  const addresses = await lookup(host, { all: true, verbatim: true });
  const blocked = addresses.find(({ address }) => !isPublicAddress(address));
  if (blocked) throw new Error(notPublic(host, blocked.address));
}

/**
 * A DNS lookup for undici's connector that fails with `BLOCKED` on any address that isn't public. It runs when the
 * connection opens, so a second DNS answer can't swap in a local address after `assertPublicHost` passed (DNS
 * rebinding). Addresses written as IPs in the URL never reach a lookup; `assertPublicHost` covers those.
 */
export const publicLookup: LookupFunction = (hostname, options, callback) => {
  lookupCallback(hostname, options, (error, address, family) => {
    if (error) return callback(error, address, family);
    const addresses = typeof address === "string" ? [{ address }] : address;
    const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
    if (!blocked) return callback(null, address, family);
    callback(Object.assign(new Error(notPublic(hostname, blocked.address)), { code: BLOCKED }), address, family);
  });
};

/** The IPv4 address inside a NAT64 address (`64:ff9b::7f00:1` is 127.0.0.1), or `undefined` for any other. */
function nat64Target(address: string): string | undefined {
  // The URL parser writes IPv6 in its shortest form, so the prefix always reads `64:ff9b::`.
  const normal = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  if (!normal.startsWith(NAT64)) return undefined;
  const groups = normal.slice(NAT64.length).split(":").filter(Boolean);
  if (groups.length > 2) return undefined;
  const [high = "0", low = "0"] = groups.length === 2 ? groups : ["0", groups[0] ?? "0"];
  const value = ((Number.parseInt(high, 16) << 16) | Number.parseInt(low, 16)) >>> 0;
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/** Why `host` can't be fetched, with the way around it for the model. */
function notPublic(host: string, address = host) {
  return (
    `${host === address ? host : `${host} resolves to ${address}, which`} is not a public address. web_fetch only ` +
    "reads public sites; for a local server, use curl in bash."
  );
}
