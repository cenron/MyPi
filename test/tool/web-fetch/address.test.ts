import type { LookupAddress, LookupOptions } from "node:dns";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { assertPublicHost, BLOCKED, isPublicAddress, publicLookup } from "#tool/web-fetch/address";

/** DNS answers by name; a name not listed fails with ENOTFOUND. */
const dns = vi.hoisted(() => new Map<string, string[]>());

const answer = (host: string): LookupAddress[] => {
  const addresses = dns.get(host);
  if (!addresses) throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), { code: "ENOTFOUND" });
  return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

vi.mock("node:dns/promises", () => ({ lookup: async (host: string) => answer(host) }));

vi.mock("node:dns", () => ({
  // The callback form, as undici calls it: `all` gives every address, otherwise the first.
  lookup: (host: string, options: LookupOptions, callback: (...args: unknown[]) => void) => {
    try {
      const all = answer(host);
      if (options.all) return callback(null, all);
      callback(null, all[0]?.address, all[0]?.family);
    } catch (error) {
      callback(error);
    }
  },
}));

beforeEach(() => dns.clear());

describe("isPublicAddress", () => {
  it.each([
    "93.184.215.14",
    "8.8.8.8",
    "1.1.1.1",
    "172.32.0.1", // just past 172.16.0.0/12
    "100.128.0.1", // just past carrier-grade NAT
    "2606:4700:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808", // NAT64 for 8.8.8.8
  ])("is true for %s", (address) => {
    expect(isPublicAddress(address)).toBe(true);
  });

  it.each([
    ["0.0.0.0", "this network"],
    ["10.1.2.3", "private"],
    ["100.64.0.1", "carrier-grade NAT"],
    ["127.0.0.1", "loopback"],
    ["127.255.255.254", "loopback"],
    ["169.254.169.254", "link-local, cloud metadata"],
    ["172.16.0.1", "private"],
    ["172.31.255.255", "private"],
    ["192.0.0.1", "IETF assignments"],
    ["192.0.2.1", "documentation"],
    ["192.168.1.1", "private"],
    ["198.18.0.1", "benchmarking"],
    ["198.51.100.1", "documentation"],
    ["203.0.113.1", "documentation"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "broadcast"],
    ["::", "unspecified"],
    ["::1", "loopback"],
    ["100::1", "discard"],
    ["2001:db8::1", "documentation"],
    ["fc00::1", "unique local"],
    ["fd12:3456::1", "unique local"],
    ["fe80::1", "link-local"],
    ["fec0::1", "site-local"],
    ["ff02::1", "multicast"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["::ffff:7f00:1", "IPv4-mapped loopback, in hex"],
    ["::ffff:10.0.0.1", "IPv4-mapped private"],
    ["64:ff9b::7f00:1", "NAT64 for 127.0.0.1"],
    ["64:ff9b::a9fe:a9fe", "NAT64 for 169.254.169.254"],
    ["64:ff9b::", "NAT64 for 0.0.0.0"],
  ])("is false for %s (%s)", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("is false for a string that isn't an address", () => {
    expect(isPublicAddress("localhost")).toBe(false);
    expect(isPublicAddress("")).toBe(false);
  });

  it("checks an address past NAT64's /96 as plain IPv6", () => {
    expect(isPublicAddress("64:ff9b::1:2:3")).toBe(true);
  });
});

describe("assertPublicHost", () => {
  it("passes a public address and a name that resolves to one", async () => {
    dns.set("example.com", ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]);
    await expect(assertPublicHost("93.184.215.14")).resolves.toBeUndefined();
    await expect(assertPublicHost("example.com")).resolves.toBeUndefined();
  });

  it("refuses a local address, and says how to reach it instead", async () => {
    await expect(assertPublicHost("127.0.0.1")).rejects.toThrow(
      "127.0.0.1 is not a public address. web_fetch only reads public sites; for a local server, use curl in bash.",
    );
  });

  it("takes IPv6 in brackets, as URL.hostname gives it", async () => {
    await expect(assertPublicHost("[::1]")).rejects.toThrow("::1 is not a public address");
    await expect(assertPublicHost("[2606:4700:4700::1111]")).resolves.toBeUndefined();
  });

  it("refuses a name when any address it resolves to is local", async () => {
    dns.set("mixed.example", ["93.184.215.14", "192.168.0.2"]);
    await expect(assertPublicHost("mixed.example")).rejects.toThrow(
      "mixed.example resolves to 192.168.0.2, which is not a public address.",
    );
  });

  it("lets a DNS failure through", async () => {
    await expect(assertPublicHost("nope.example")).rejects.toThrow("getaddrinfo ENOTFOUND nope.example");
  });
});

describe("publicLookup", () => {
  /** Runs publicLookup and resolves with what it calls back with. */
  const lookUp = (host: string, options: LookupOptions) =>
    new Promise<{ error: NodeJS.ErrnoException | null; address: unknown; family: unknown }>((resolve) => {
      publicLookup(host, options, (error, address, family) => resolve({ error, address, family }));
    });

  it("passes through public answers, in either form undici asks for", async () => {
    dns.set("example.com", ["93.184.215.14", "2606:4700:4700::1111"]);
    expect(await lookUp("example.com", { all: true })).toEqual({
      error: null,
      address: [
        { address: "93.184.215.14", family: 4 },
        { address: "2606:4700:4700::1111", family: 6 },
      ],
      family: undefined,
    });
    expect(await lookUp("example.com", {})).toEqual({ error: null, address: "93.184.215.14", family: 4 });
  });

  // DNS rebinding: the name was public when assertPublicHost checked, and local when the connection opens.
  it("fails with BLOCKED when an answer is local", async () => {
    dns.set("rebind.example", ["127.0.0.1"]);
    const { error } = await lookUp("rebind.example", {});
    expect(error?.code).toBe(BLOCKED);
    expect(error?.message).toBe(
      "rebind.example resolves to 127.0.0.1, which is not a public address. web_fetch only reads public sites; " +
        "for a local server, use curl in bash.",
    );
  });

  it("fails when any of several answers is local", async () => {
    dns.set("mixed.example", ["93.184.215.14", "::1"]);
    expect((await lookUp("mixed.example", { all: true })).error?.code).toBe(BLOCKED);
  });

  it("passes a DNS error through", async () => {
    expect((await lookUp("nope.example", {})).error?.code).toBe("ENOTFOUND");
  });
});
