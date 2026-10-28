import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logosDir = path.resolve(__dirname, "../public/logos");
const navLinksPath = path.resolve(__dirname, "../components/NavLinks.tsx");

test("verifies all 36 local broker SVG logos exist on disk", () => {
  const requiredLogos = [
    // Top 25 Crypto Exchanges
    "binance", "coinbase", "kraken", "bybit", "okx", "kucoin", "bitfinex", "htx",
    "gateio", "bitstamp", "gemini", "mexc", "bitget", "cryptocom", "deribit",
    "upbit", "bithumb", "coincheck", "poloniex", "phemex", "bingx", "whitebit",
    "bitmart", "lbank", "etoro",
    // Top 6 Forex Brokers
    "oanda", "ig", "forexcom", "pepperstone", "icmarkets", "fxcm",
    // Top 5 Prime Brokers
    "goldmansachs", "morganstanley", "ibkr", "jpmorgan", "barclays"
  ];

  assert.ok(fs.existsSync(logosDir), "public/logos directory must exist");

  for (const id of requiredLogos) {
    const filePath = path.join(logosDir, `${id}.svg`);
    assert.ok(fs.existsSync(filePath), `Logo SVG for '${id}' must exist at ${filePath}`);
    const content = fs.readFileSync(filePath, "utf-8");
    assert.ok(content.includes("<svg"), `Logo file '${id}.svg' must be a valid SVG`);
  }
});

test("NavLinks.tsx contains broker integrations route with LIVE badge", () => {
  assert.ok(fs.existsSync(navLinksPath), "NavLinks.tsx must exist");
  const content = fs.readFileSync(navLinksPath, "utf-8");
  assert.ok(content.includes("/broker-integrations"), "NavLinks.tsx must reference /broker-integrations");
  assert.ok(content.includes("Brokers"), "NavLinks.tsx must have 'Brokers' label");
  assert.ok(content.includes("'LIVE'"), "NavLinks.tsx must have 'LIVE' badge");
});
