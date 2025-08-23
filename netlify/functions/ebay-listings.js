/**
 * Netlify Function: ebay-listings
 * --------------------------------
 * Returns JSON shaped for the front-end carousel:
 *   { products: [{ id, title, price, currency, url, img }, ...] }
 *
 * Uses eBay Trading API (GetMyeBaySelling) with a USER TOKEN (v^1.1...).
 * No app/secret headers needed for Auth'n'Auth when a valid user token is provided.
 *
 * ENV VARS (set in Netlify -> Site config -> Environment):
 *   EBAY_USER_TOKEN  (preferred)  - your long user token
 *   EBAY_AUTH_TOKEN  (fallback)   - supported for compatibility
 *   EBAY_SITE_ID     (optional)   - default "0" (US)
 */

const API_URL = "https://api.ebay.com/ws/api.dll";
const SITE_ID = process.env.EBAY_SITE_ID || "0"; // 0 = US
const COMPAT_LEVEL = "1203";                     // current Trading API compat
const PAGE_SIZE_TRADING = 200;                   // Trading API max per page
const MAX_TOTAL = 600;                           // hard cap returned to client

exports.handler = async (event) => {
  try {
    const token = process.env.EBAY_USER_TOKEN || process.env.EBAY_AUTH_TOKEN;
    if (!token) {
      return json({ error: "Missing EBAY_USER_TOKEN (or EBAY_AUTH_TOKEN) env var" }, 500);
    }

    const limitParam = (event.queryStringParameters?.limit || "").toLowerCase();
    const limit = limitParam === "all"
      ? MAX_TOTAL
      : clampInt(parseInt(limitParam || "24", 10), 1, MAX_TOTAL);

    const items = await fetchActiveListings(token, limit);

    // Shape for the front-end carousel
    const products = items.slice(0, limit).map((it) => ({
      id: it.id,
      title: it.title,
      price: it.price,
      currency: it.currency || "USD",
      url: it.url || `https://www.ebay.com/itm/${it.id}`,
      img: it.image
    }));

    return json({ products });
  } catch (err) {
    console.error("ebay-listings error:", err);
    return json({ error: err.message || "Unhandled error" }, 500);
  }
};

/** ----------------- Helpers ------------------ */

function json(data, status = 200) {
  return {
    statusCode: status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(data),
  };
}

function clampInt(n, min, max) {
  if (!Number.isFinite(n)) return min;
  return Math.min(Math.max(n, min), max);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function match1(re, s) { const m = re.exec(s); return m ? m[1] : undefined; }
function toInt(s) { const n = parseInt(s, 10); return Number.isFinite(n) ? n : null; }
function decodeHtml(s) {
  if (s == null) return s;
  return String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

/**
 * Fetch active listings using Trading API with pagination.
 * Returns lightweight objects: { id, title, price, currency, url, image }
 */
async function fetchActiveListings(token, limit) {
  let page = 1;
  let totalPages = null;
  const out = [];

  while (out.length < limit) {
    const entriesPerPage = Math.min(PAGE_SIZE_TRADING, limit - out.length);

    const bodyXml = `<?xml version="1.0" encoding="utf-8"?>
      <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
        <RequesterCredentials>
          <eBayAuthToken>${escapeXml(token)}</eBayAuthToken>
        </RequesterCredentials>
        <ActiveList>
          <Include>true</Include>
          <Pagination>
            <EntriesPerPage>${entriesPerPage}</EntriesPerPage>
            <PageNumber>${page}</PageNumber>
          </Pagination>
        </ActiveList>
        <DetailLevel>ReturnAll</DetailLevel>
        <WarningLevel>High</WarningLevel>
      </GetMyeBaySellingRequest>`;

    const resp = await fetch(API_URL, {
      method: "POST",
      headers: {
        "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
        "X-EBAY-API-SITEID": SITE_ID,
        "X-EBAY-API-COMPATIBILITY-LEVEL": COMPAT_LEVEL,
        "Content-Type": "text/xml",
      },
      body: bodyXml,
    });

    const text = await resp.text();
    console.log(`[TRADING p${page}] status=${resp.status} bodyLen=${text.length}`);
    if (!resp.ok) throw new Error(`Trading API HTTP ${resp.status}`);

    // Determine total pages (first pass)
    if (totalPages == null) {
      totalPages = toInt(match1(/<TotalNumberOfPages>(\d+)<\/TotalNumberOfPages>/, text)) || 1;
    }

    // Extract <Item> blocks
    const reItem = /<Item>([\s\S]*?)<\/Item>/g;
    let m;
    while ((m = reItem.exec(text))) {
      const x = m[1];
      out.push({
        id: match1(/<ItemID>(.*?)<\/ItemID>/, x),
        title: decodeHtml(match1(/<Title>(.*?)<\/Title>/, x)),
        price: match1(/<CurrentPrice[^>]*>(.*?)<\/CurrentPrice>/, x),
        currency: match1(/<CurrentPrice[^>]*currencyID="(.*?)"/, x),
        url: decodeHtml(match1(/<ViewItemURL>(.*?)<\/ViewItemURL>/, x)),
        image:
          decodeHtml(match1(/<GalleryURL>(.*?)<\/GalleryURL>/, x)) ||
          decodeHtml(match1(/<PictureURL>(.*?)<\/PictureURL>/, x)),
      });
      if (out.length >= limit) break;
    }

    const gotFullPage = out.length % entriesPerPage === 0; // rough check
    if (page >= totalPages || !gotFullPage || out.length >= limit) break;
    page += 1;
    if (page > 50) break; // safety stop
  }

  return out;
}
