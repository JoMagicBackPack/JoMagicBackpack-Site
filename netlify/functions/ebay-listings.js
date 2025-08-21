// netlify/functions/ebay-listings.js
// eBay Finding API (no OAuth). Minimal deps, rate-limit friendly.
// Env vars required in Netlify:
//   EBAY_CLIENT_ID        -> your eBay App ID (a.k.a. Client ID)
//   EBAY_SELLER_USERNAME  -> your seller username (e.g., "jomagicbackpack")

const https = require("https");
const { URL } = require("url");

// Tiny HTTPS GET helper (no external packages)
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

// Simple in-memory cache (lives for the lifetime of the function instance)
let CACHE = { items: [], at: 0 }; // at = timestamp (ms)
const CACHE_MS = 10 * 60 * 1000;   // 10 minutes

exports.handler = async (event) => {
  try {
    const APP_ID = process.env.EBAY_CLIENT_ID;
    if (!APP_ID) {
      return json(500, { error: "Missing EBAY_CLIENT_ID env var in Netlify" });
    }
    const DEFAULT_SELLER = (process.env.EBAY_SELLER_USERNAME || "jomagicbackpack").trim();

    // Read query params (supports ?q=keywords, ?username=, ?limit=)
    const rawUrl = event.rawUrl || `https://local.test${event.path}${event.rawQuery ? "?" + event.rawQuery : ""}`;
    const u = new URL(rawUrl);
    const keywords = (u.searchParams.get("q") || "").trim();         // optional search words
    const seller   = (u.searchParams.get("username") || DEFAULT_SELLER).trim();
    const limit    = Math.max(1, Math.min(50, parseInt(u.searchParams.get("limit") || "24", 10)));

    // Serve cached data if it's fresh
    if (Date.now() - CACHE.at < CACHE_MS && CACHE.items.length) {
      return json(200, { items: CACHE.items, cached: true });
    }

    // Build Finding API call
    // Always filter by Seller. If keywords provided, add them too.
    const endpoint = "https://svcs.ebay.com/services/search/FindingService/v1";
    const sp = new URLSearchParams({
      "OPERATION-NAME": "findItemsAdvanced",
      "SERVICE-VERSION": "1.0.0",
      "SECURITY-APPNAME": APP_ID,
      "RESPONSE-DATA-FORMAT": "JSON",
      "REST-PAYLOAD": "true",
      "paginationInput.entriesPerPage": String(limit),
      "itemFilter(0).name": "Seller",
      "itemFilter(0).value(0)": seller,
      "outputSelector(0)": "SellerInfo",
      "outputSelector(1)": "PictureURLLarge",
      "sortOrder": "StartTimeNewest"
    });
    if (keywords) sp.set("keywords", keywords);

    const apiUrl = `${endpoint}?${sp.toString()}`;

    const resp = await httpsGet(apiUrl);
    if (resp.status < 200 || resp.status >= 300) {
      // Rate limited? Serve last good cache if we have it.
      if (String(resp.body).includes("RateLimiter") && CACHE.items.length) {
        return json(200, { items: CACHE.items, rateLimited: true, cached: true });
      }
      return json(502, { error: "Finding API HTTP error", status: resp.status, details: String(resp.body).slice(0, 400) });
    }

    let data;
    try { data = JSON.parse(resp.body); }
    catch (e) { return json(502, { error: "Invalid JSON from eBay", details: e.message }); }

    const rawItems = data?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    const items = rawItems.map((it) => ({
      id: it?.itemId?.[0],
      title: it?.title?.[0],
      price: it?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
      currency: it?.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
      url: it?.viewItemURL?.[0],
      image: it?.pictureURLLarge?.[0] || it?.galleryPlusPictureURL?.[0] || it?.galleryURL?.[0] || "",
      condition: it?.condition?.[0]?.conditionDisplayName?.[0] || ""
    }));

    // Update cache on success (even if empty)
    CACHE = { items, at: Date.now() };

    return json(200, { items });
  } catch (err) {
    // Last-resort fallback: serve cache if we have it
    if (CACHE.items.length) return json(200, { items: CACHE.items, cached: true, error: err.message });
    return json(500, { error: err.message });
  }
};

// Helper to return JSON responses
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json",
      "cache-control": statusCode === 200 ? "public, max-age=300" : "no-store"
    },
    body: JSON.stringify(obj)
  };
}
