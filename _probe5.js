"use strict";
// Network-layer probe: is the ~10.6s failure DNS, TCP/TLS connect, or HTTP?
const dns = require("node:dns");
const tls = require("node:tls");
const { loadLocalEnv } = require("./lib/load-env");
loadLocalEnv(__dirname);

const HOST = "integrate.api.nvidia.com";
const KEY = process.env.NVIDIA_API_KEY;

console.log("node:", process.version);
try { console.log("undici:", require.resolve("undici")); } catch { console.log("undici: NOT AVAILABLE"); }
console.log("proxy env:", process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || "none");

function tlsOnce(i) {
  return new Promise((resolve) => {
    const a = Date.now();
    dns.lookup(HOST, { all: true }, (err, records) => {
      const dnsMs = Date.now() - a;
      const dnsInfo = err ? `DNS-ERR ${err.code}` : (records || []).map((r) => `${r.family}:${r.address}`).join(",");
      const b = Date.now();
      const skt = tls.connect({ host: HOST, port: 443, servername: HOST }, () => {
        console.log(`tls#${i} dns=${dnsMs}ms [${dnsInfo}] tls=${Date.now() - b}ms ok`);
        skt.destroy();
        resolve();
      });
      skt.setTimeout(30_000, () => { console.log(`tls#${i} dns=${dnsMs}ms TIMEOUT`); skt.destroy(); resolve(); });
      skt.on("error", (e) => { console.log(`tls#${i} dns=${dnsMs}ms [${dnsInfo}] tls-ERR ${e.code} after ${Date.now() - b}ms`); skt.destroy(); resolve(); });
    });
  });
}

async function getModels(i) {
  const a = Date.now();
  try {
    const res = await fetch(`https://${HOST}/v1/models`, { headers: { Authorization: `Bearer ${KEY}` } });
    const json = await res.json().catch(() => null);
    console.log(`models#${i} status=${res.status} headers=${Date.now() - a}ms total=${Date.now() - a}ms count=${json?.data?.length ?? "-"}`);
  } catch (e) {
    console.log(`models#${i} FAILED after ${Date.now() - a}ms :: ${e.name} ${e.cause?.code || e.cause?.message || e.message}`);
  }
}

(async () => {
  for (let i = 1; i <= 3; i += 1) await tlsOnce(i);
  for (let i = 1; i <= 3; i += 1) await getModels(i);
})();
