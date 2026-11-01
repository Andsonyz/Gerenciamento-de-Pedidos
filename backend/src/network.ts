import { BlockList, isIP } from "node:net";
export function privateAddress(address: string | undefined, subnets?: string[]): boolean {
  const ip = address?.replace(/^::ffff:/, "") ?? "";
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (!isIP(ip)) return false;
  const privateNetworks = new BlockList();
  privateNetworks.addSubnet("10.0.0.0", 8, "ipv4");
  privateNetworks.addSubnet("172.16.0.0", 12, "ipv4");
  privateNetworks.addSubnet("192.168.0.0", 16, "ipv4");
  privateNetworks.addSubnet("fc00::", 7, "ipv6");
  privateNetworks.addSubnet("fe80::", 10, "ipv6");
  if (!privateNetworks.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4")) return false;
  const list = new BlockList();
  for (const subnet of subnets ?? ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"]) {
    const [network, prefix] = subnet.split("/");
    if (!network || prefix === undefined || !isIP(network) || !/^\d+$/.test(prefix))
      throw new Error("ALLOWED_SUBNETS deve conter redes CIDR válidas.");
    list.addSubnet(network, Number(prefix), isIP(network) === 6 ? "ipv6" : "ipv4");
  }
  return list.check(ip, isIP(ip) === 6 ? "ipv6" : "ipv4");
}
