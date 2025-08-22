// /.netlify/functions/ebay-listings.js
// Caches eBay Finding API results to avoid rate limits.
// - Writes/reads a cache file in /tmp (persists for the life of the server instance)
// - Serves stale cache if eBay rate-limits or errors
// - Add ?force=1 to bypass cache manually

import fs from "fs/promises";
import path from "path";


const APP_ID = process.env.EBAY_APP_ID;      // Netlify env var: your eBay AppID (Client ID)
const TTL_MS = 30 * 60 * 1000;               // refresh every 30 minutes
const CACHE_FILE = "/tmp/ebay_cache.json";   // temp file cache

const ok = (body) => ({
  statusCode: 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",   // browsers cache for 60s
    "access-control-allow-origin": "*"
  },
  body: JSON.stringify(body)
});

const err = (status, message) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ error: message })
});

async function readCache() {
  try {
    const txt = await fs.readFile(CACHE_FILE, "utf8");
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

async function writeCache(payload) {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8");
  } catch { /* ignore */ }
}

export const handler = async (event) => {
  if (!APP_ID) return err(500, "Missing EBAY_APP_ID env var");

  const url = new URL(event.rawUrl);
  const seller = url.searchParams.get("seller") || "JoMagicBackpack";
  const limit  = Math.max(1, Math.min(48, Number(url.searchParams.get("limit") || 12)));
  const q      = url.searchParams.get("q") || "";
  const force  = url.searchParams.get("force") === "1";

  // 1) Serve fresh-enough cache unless force=1
  const cached = await readCache();
  const now = Date.now();
  if (!force && cached && (now - new Date(cached.cachedAt).getTime()) < TTL_MS) {
    return ok({ ...cached, fromCache: true });
  }

  // 2) Call eBay (single request, normalized output)
  const endpoint = "https://svcs.ebay.com/services/search/FindingService/v1";
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsAdvanced",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": APP_ID,
    "RESPONSE-DATA-FORMAT": "JSON",
    "REST-PAYLOAD": "true",
    "siteid": "0",
    "paginationInput.entriesPerPage": String(limit),
    "sortOrder": "BestMatch",
    ...(q ? { keywords: q } : {}),
    "itemFilter(0).name": "Seller",
    "itemFilter(0).value(0)": seller,
    "outputSelector(0)": "PictureURLLarge",
    "outputSelector(1)": "SellerInfo",
    "outputSelector(2)": "StoreInfo"
  });

  try {
    const res = await fetch(`${endpoint}?${params}`);
    if (!res.ok) throw new Error(`eBay HTTP ${res.status}`);
    const json = await res.json();

    // If eBay returns an "errorMessage" block, treat as failure
    const apiError = json?.findItemsAdvancedResponse?.[0]?.errorMessage;
    if (apiError) throw new Error(apiError[0]?.error?.[0]?.message?.[0] || "eBay error");

    const items = json?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    const products = items.map(it => {
      const priceObj = it?.sellingStatus?.[0]?.currentPrice?.[0] || {};
      const raw = it?.pictureURLLarge?.[0] || it?.galleryURL?.[0] || "";
      const img = raw.replace(/s-l(?:64|75|96|140)\b/, "s-l500"); // upsize tiny thumbs
      return {
        id: it.itemId?.[0],
        title: it.title?.[0] || "",
        price: priceObj.__value__ || "",
        currency: priceObj["@currencyId"] || "",
        url: it.viewItemURL?.[0] || "#",
        img
      };
    }).filter(p => p.id && p.title && p.url);

    const payload = { products, cachedAt: new Date().toISOString() };
    await writeCache(payload);
    return ok(payload);

  } catch (e) {
    // 3) On rate-limit or any error, serve stale cache if we have it
    if (cached) {
      return ok({ ...cached, stale: true });
    }
    return err(500, String(e));
  }
};
