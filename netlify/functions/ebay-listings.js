// /.netlify/functions/ebay-listings.js
import fs from "fs/promises";

const APP_ID = process.env.EBAY_APP_ID;
const TTL_MS = 30 * 60 * 1000;
const CACHE_FILE = "/tmp/ebay_cache.json";

const ok = (body) => ({
  statusCode: 200,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "public, max-age=60",
    "access-control-allow-origin": "*",
  },
  body: JSON.stringify(body),
});
const err = (status, message) => ({
  statusCode: status,
  headers: { "content-type": "application/json; charset=utf-8" },
  body: JSON.stringify({ error: message }),
});

async function readCache(){ try{ return JSON.parse(await fs.readFile(CACHE_FILE, "utf8")); } catch { return null; } }
async function writeCache(payload){ try{ await fs.writeFile(CACHE_FILE, JSON.stringify(payload), "utf8"); } catch {} }

export const handler = async (event) => {
  if (!APP_ID) return err(500, "Missing EBAY_APP_ID env var");

  const url = new URL(event.rawUrl);
  const seller = url.searchParams.get("seller") || "JoMagicBackpack";
  const limit  = Math.max(1, Math.min(48, Number(url.searchParams.get("limit") || 12)));
  const q      = url.searchParams.get("q") || "";
  const force  = url.searchParams.get("force") === "1";
  const debug  = url.searchParams.get("debug") === "1";

  // serve cache if fresh
  const cached = await readCache();
  const now = Date.now();
  if (!force && cached && (now - new Date(cached.cachedAt).getTime()) < TTL_MS) {
    return ok({ ...cached, fromCache: true });
  }

  // POST to FindingService
  const endpoint = "https://svcs.ebay.com/services/search/FindingService/v1";
  const body = {
    findItemsAdvancedRequest: {
      keywords: q || undefined,
      itemFilter: [{ name: "Seller", value: [seller] }],
      paginationInput: { entriesPerPage: limit, pageNumber: 1 },
      sortOrder: "BestMatch",
      outputSelector: ["PictureURLLarge", "SellerInfo", "StoreInfo"],
    },
  };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-EBAY-SOA-OPERATION-NAME": "findItemsAdvanced",
        "X-EBAY-SOA-SERVICE-VERSION": "1.13.0",
        "X-EBAY-SOA-REQUEST-DATA-FORMAT": "JSON",
        "X-EBAY-SOA-RESPONSE-DATA-FORMAT": "JSON",
        "X-EBAY-SOA-SECURITY-APPNAME": APP_ID,
        "X-EBAY-SOA-GLOBAL-ID": "EBAY-US",
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    if (!res.ok) {
      if (debug) return err(res.status, `HTTP ${res.status}: ${text.slice(0,800)}`);
      throw new Error(`eBay HTTP ${res.status}`);
    }

    const json = JSON.parse(text);
    if (debug) return ok({ raw: json }); // quick peek if you need it

    const apiErr = json?.findItemsAdvancedResponse?.[0]?.errorMessage;
    if (apiErr) {
      const msg = apiErr?.[0]?.error?.[0]?.message?.[0] || "eBay error";
      throw new Error(msg);
    }

    const items = json?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item || [];
    const products = items.map(it => {
      const priceObj = it?.sellingStatus?.[0]?.currentPrice?.[0] || {};
      const raw = it?.pictureURLLarge?.[0] || it?.galleryURL?.[0] || "";
      const img = raw.replace(/s-l(?:64|75|96|140)\b/, "s-l500");
      return {
        id: it.itemId?.[0],
        title: it.title?.[0] || "",
        price: priceObj.__value__ || "",
        currency: priceObj["@currencyId"] || "",
        url: it.viewItemURL?.[0] || "#",
        img,
      };
    }).filter(p => p.id && p.title && p.url);

    const payload = { products, cachedAt: new Date().toISOString() };
    await writeCache(payload);
    return ok(payload);

  } catch (e) {
    if (cached) return ok({ ...cached, stale: true });
    return err(500, String(e));
  }
};
