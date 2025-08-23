// Netlify Function: /.netlify/functions/ebay-listings
// Returns up to ?limit=N of your active eBay listings.
// Chooses an API automatically based on which env var you configured.
// Env vars (set in Netlify → Site configuration → Environment variables):
//   EBAY_SELLER_USERNAME   (required)
//   EBAY_APP_BEARER        (Browse API; preferred)           OR
//   EBAY_USER_TOKEN        (Trading API; legacy)             OR
//   EBAY_APP_ID            (Finding API; simplest, no token)
// Optional:
//   EBAY_SITE_ID           (default 0 = US)
//   EBAY_DELIVERY_COUNTRY  (e.g., "US" for Browse filter)
//   EBAY_LOG_VERBOSE       ("1" to log full responses lengths/statuses)

const DEFAULT_LIMIT = 12;
const siteId = process.env.EBAY_SITE_ID || "0";
const seller = process.env.EBAY_SELLER_USERNAME;

const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const fail = (message, status = 500, extra = {}) => {
  console.error("EBAY-LISTINGS ERROR:", message, extra);
  return ok({ error: message, ...extra }, status);
};

export default async (req, ctx) => {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(+url.searchParams.get("limit") || DEFAULT_LIMIT, 50));
    const q = url.searchParams.get("q") || ""; // optional keyword

    if (!seller) return fail("Missing EBAY_SELLER_USERNAME", 500);

    // Strategy selection (prefer Browse if provided)
    const hasBrowse = !!process.env.EBAY_APP_BEARER;
    const hasTrading = !!process.env.EBAY_USER_TOKEN;
    const hasFinding = !!process.env.EBAY_APP_ID;

    if (hasBrowse) return await viaBrowseAPI({ q, limit });
    if (hasTrading) return await viaTradingAPI({ q, limit });
    if (hasFinding) return await viaFindingAPI({ q, limit });

    return fail("No eBay credentials configured. Set EBAY_APP_BEARER or EBAY_USER_TOKEN or EBAY_APP_ID.");
  } catch (err) {
    return fail(err.message || "Unhandled error");
  }
};

// -----------------------------
// IMPLEMENTATIONS
// -----------------------------

async function viaBrowseAPI({ q, limit }) {
  // eBay Buy Browse API (Production)
  const bearer = process.env.EBAY_APP_BEARER;
  const deliveryCountry = process.env.EBAY_DELIVERY_COUNTRY || "US";

  // Browse supports filtering — many integrations use seller filter.
  // If your account name has spaces, keep it exactly as on eBay.
  const query = new URLSearchParams({
    q: q || "*",
    limit: String(limit),
  });

  // Use filter by seller username (works in Browse search)
  // Docs pattern: filter=seller:<USERNAME>
  query.append("filter", `seller:${seller}`);
  query.append("deliveryCountry", deliveryCountry);

  const endpoint = `https://api.ebay.com/buy/browse/v1/item_summary/search?${query.toString()}`;

  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
  });

  const text = await resp.text();
  logVerbose("BROWSE", resp.status, text.length);

  // 401/403 → wrong/expired token type
  if (!resp.ok) return fail("Browse request failed", resp.status, { endpoint, status: resp.status, body: safeBody(text) });

  const data = JSON.parse(text);
  const items = (data.itemSummaries || []).map(normalizeBrowseItem);
  return ok({ source: "browse", count: items.length, items });
}

function normalizeBrowseItem(it) {
  return {
    id: it.itemId,
    title: it.title,
    price: it.price?.value,
    currency: it.price?.currency,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl,
    url: it.itemWebUrl,
    condition: it.condition,
    location: it.itemLocation?.country || it.itemLocation?.postalCode,
  };
}

async function viaTradingAPI({ q, limit }) {
  // eBay Trading API (GetMyeBaySelling)
  // Requires the long Auth’n’Auth user token (v^1.1…)
  const token = process.env.EBAY_USER_TOKEN;

  // We can optionally filter by keyword in title using GetMyeBaySelling? Not directly.
  // To keep this simple and robust, we fetch ActiveList and truncate to `limit`.
  const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials><eBayAuthToken>${escapeXml(token)}</eBayAuthToken></RequesterCredentials>
      <ActiveList>
        <Include>true</Include>
        <Pagination>
          <EntriesPerPage>${limit}</EntriesPerPage>
          <PageNumber>1</PageNumber>
        </Pagination>
        <IncludeNotes>false</IncludeNotes>
      </ActiveList>
      <DetailLevel>ReturnAll</DetailLevel>
      <WarningLevel>High</WarningLevel>
    </GetMyeBaySellingRequest>`;

  const resp = await fetch("https://api.ebay.com/ws/api.dll", {
    method: "POST",
    headers: {
      "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
      "X-EBAY-API-SITEID": siteId,
      "X-EBAY-API-COMPATIBILITY-LEVEL": "1203",
      "Content-Type": "text/xml",
    },
    body,
  });

  const text = await resp.text();
  logVerbose("TRADING", resp.status, text.length);

  if (!resp.ok) return fail("Trading request failed", resp.status, { status: resp.status, body: safeBody(text) });

  // Minimal XML parse without deps:
  const items = [];
  const itemRegex = /<Item>([\s\S]*?)<\/Item>/g;
  let m;
  while ((m = itemRegex.exec(text)) && items.length < DEFAULT_LIMIT) {
    const chunk = m[1];
    items.push({
      id: pick(/<ItemID>(.*?)<\/ItemID>/, chunk),
      title: pick(/<Title>(.*?)<\/Title>/, chunk),
      price: pick(/<CurrentPrice[^>]*>(.*?)<\/CurrentPrice>/, chunk),
      currency: pick(/<CurrentPrice[^>]*currencyID="(.*?)"/, chunk),
      url: pick(/<ListingDetails>[\s\S]*?<ViewItemURL>(.*?)<\/ViewItemURL>/, chunk),
      image: pick(/<GalleryURL>(.*?)<\/GalleryURL>/, chunk),
      condition: pick(/<ConditionDisplayName>(.*?)<\/ConditionDisplayName>/, chunk),
    });
  }
  return ok({ source: "trading", count: items.length, items });
}

async function viaFindingAPI({ q, limit }) {
  // eBay Finding API — no user token required (uses App ID)
  const appId = process.env.EBAY_APP_ID;
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsAdvanced",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "paginationInput.entriesPerPage": String(limit),
    keywords: q || "",
    "sortOrder": "StartTimeNewest",
  });
  // Filter by seller
  params.append("itemFilter(0).name", "Seller");
  params.append("itemFilter(0).value(0)", seller);

  const endpoint = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
  const resp = await fetch(endpoint);
  const text = await resp.text();
  logVerbose("FINDING", resp.status, text.length);

  if (!resp.ok) return fail("Finding request failed", resp.status, { status: resp.status, body: safeBody(text) });

  const data = JSON.parse(text);
  const searchRes = data.findItemsAdvancedResponse?.[0];
  const ack = searchRes?.ack?.[0];
  if (ack !== "Success") return fail("Finding API not successful", 500, { ack, body: safeBody(text) });

  const itemsRaw = searchRes.searchResult?.[0]?.item || [];
  const items = itemsRaw.map((it) => ({
    id: it.itemId?.[0],
    title: it.title?.[0],
    price: it.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
    currency: it.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
    url: it.viewItemURL?.[0],
    image: it.galleryURL?.[0],
    location: it.location?.[0],
  }));

  return ok({ source: "finding", count: items.length, items });
}

// -----------------------------
// helpers
// -----------------------------
function logVerbose(source, status, length) {
  if (process.env.EBAY_LOG_VERBOSE === "1") {
    console.log(`[${source}] status=${status} bodyLen=${length}`);
  } else {
    console.log(`[${source}] status=${status}`);
  }
}
function safeBody(text, max = 800) {
  return (text || "").slice(0, max);
}
function pick(re, s) {
  const m = re.exec(s);
  return m ? decodeHtml(m[1]) : undefined;
}
function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
function decodeHtml(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}
