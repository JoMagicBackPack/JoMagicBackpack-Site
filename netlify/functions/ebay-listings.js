// Netlify Function: /.netlify/functions/ebay-listings
// Returns up to ?limit=N of your active eBay listings.
// It auto-selects an API based on which env vars are present.
// Order of preference: Trading (EBAY_USER_TOKEN) → Browse (EBAY_APP_BEARER) → Finding (EBAY_APP_ID)

const DEFAULT_LIMIT = 12;

// ----- Small helpers -----
const ok = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const fail = (message, status = 500, extra = {}) => {
  console.error("EBAY-LISTINGS ERROR:", message, extra);
  return ok({ error: message, ...extra }, status);
};

const siteId = process.env.EBAY_SITE_ID || "0";          // 0 = US
const seller = process.env.EBAY_SELLER_USERNAME || "";   // your eBay username

export default async (req, ctx) => {
  try {
    const url = new URL(req.url);
    const limit = Math.max(1, Math.min(+url.searchParams.get("limit") || DEFAULT_LIMIT, 50));
    const q = url.searchParams.get("q") || "";

    if (!seller) return fail("Missing EBAY_SELLER_USERNAME");

    const hasTrading = !!process.env.EBAY_USER_TOKEN;   // v^1.1… token
    const hasBrowse  = !!process.env.EBAY_APP_BEARER;   // OAuth APP Bearer (JWT)
    const hasFinding = !!process.env.EBAY_APP_ID;       // App ID only

    if (hasTrading) return await viaTradingAPI({ q, limit });
    if (hasBrowse)  return await viaBrowseAPI({ q, limit });
    if (hasFinding) return await viaFindingAPI({ q, limit });

    return fail("No eBay credentials found. Set EBAY_USER_TOKEN or EBAY_APP_BEARER or EBAY_APP_ID.");
  } catch (err) {
    return fail(err.message || "Unhandled error");
  }
};

// =========================
// Trading API (Auth’n’Auth USER token: v^1.1…)
// =========================
async function viaTradingAPI({ q, limit }) {
  const token = process.env.EBAY_USER_TOKEN;
  const body = `<?xml version="1.0" encoding="utf-8"?>
    <GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
      <RequesterCredentials><eBayAuthToken>${escapeXml(token)}</eBayAuthToken></RequesterCredentials>
      <ActiveList>
        <Include>true</Include>
        <Pagination>
          <EntriesPerPage>${limit}</EntriesPerPage>
          <PageNumber>1</PageNumber>
        </Pagination>
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
  console.log("[TRADING] status=", resp.status, "bodyLen=", text.length);

  if (!resp.ok) return fail("Trading request failed", resp.status, { body: safeBody(text) });

  // very light XML parsing (no deps)
  const items = [];
  const itemRe = /<Item>([\s\S]*?)<\/Item>/g;
  let m;
  while ((m = itemRe.exec(text)) && items.length < DEFAULT_LIMIT) {
    const chunk = m[1];
    items.push({
      id: pick(/<ItemID>(.*?)<\/ItemID>/, chunk),
      title: pick(/<Title>(.*?)<\/Title>/, chunk),
      price: pick(/<CurrentPrice[^>]*>(.*?)<\/CurrentPrice>/, chunk),
      currency: pick(/<CurrentPrice[^>]*currencyID="(.*?)"/, chunk),
      url: pick(/<ViewItemURL>(.*?)<\/ViewItemURL>/, chunk),
      image: pick(/<GalleryURL>(.*?)<\/GalleryURL>/, chunk),
      condition: pick(/<ConditionDisplayName>(.*?)<\/ConditionDisplayName>/, chunk),
    });
  }

  // 🔎 LOG RIGHT BEFORE RETURN
  console.log("EBAY RESPONSE (TRADING) count=", items.length, "items=", JSON.stringify(items, null, 2));

  return ok({ source: "trading", count: items.length, items });
}

// =========================
// Browse API (OAuth APP Bearer token)
// =========================
async function viaBrowseAPI({ q, limit }) {
  const bearer = process.env.EBAY_APP_BEARER;
  const deliveryCountry = process.env.EBAY_DELIVERY_COUNTRY || "US";

  const params = new URLSearchParams({
    q: q || "*",
    limit: String(limit),
  });
  params.append("filter", `seller:${seller}`);
  params.append("deliveryCountry", deliveryCountry);

  const endpoint = `https://api.ebay.com/buy/browse/v1/item_summary/search?${params.toString()}`;
  const resp = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${bearer}`,
      "Content-Type": "application/json",
    },
  });

  const text = await resp.text();
  console.log("[BROWSE] status=", resp.status, "bodyLen=", text.length);

  if (!resp.ok) return fail("Browse request failed", resp.status, { body: safeBody(text), endpoint });

  const data = JSON.parse(text);
  const items = (data.itemSummaries || []).map((it) => ({
    id: it.itemId,
    title: it.title,
    price: it.price?.value,
    currency: it.price?.currency,
    image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl,
    url: it.itemWebUrl,
    condition: it.condition,
    location: it.itemLocation?.country || it.itemLocation?.postalCode,
  }));

  // 🔎 LOG RIGHT BEFORE RETURN
  console.log("EBAY RESPONSE (BROWSE) count=", items.length, "items=", JSON.stringify(items, null, 2));

  return ok({ source: "browse", count: items.length, items });
}

// =========================
async function viaFindingAPI({ q, limit }) {
  const appId = process.env.EBAY_APP_ID;
  const params = new URLSearchParams({
    "OPERATION-NAME": "findItemsAdvanced",
    "SERVICE-VERSION": "1.13.0",
    "SECURITY-APPNAME": appId,
    "RESPONSE-DATA-FORMAT": "JSON",
    "paginationInput.entriesPerPage": String(limit),
    keywords: q || "",
    sortOrder: "StartTimeNewest",
  });
  params.append("itemFilter(0).name", "Seller");
  params.append("itemFilter(0).value(0)", seller);

  const endpoint = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
  const resp = await fetch(endpoint);
  const text = await resp.text();
  console.log("[FINDING] status=", resp.status, "bodyLen=", text.length);

  if (!resp.ok) return fail("Finding request failed", resp.status, { body: safeBody(text) });

  const data = JSON.parse(text);
  const res = data.findItemsAdvancedResponse?.[0];
  if (res?.ack?.[0] !== "Success") return fail("Finding API not successful", 500, { body: safeBody(text) });

  const raw = res.searchResult?.[0]?.item || [];
  const items = raw.map((it) => ({
    id: it.itemId?.[0],
    title: it.title?.[0],
    price: it.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
    currency: it.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
    url: it.viewItemURL?.[0],
    image: it.galleryURL?.[0],
    location: it.location?.[0],
  }));

  // 🔎 LOG RIGHT BEFORE RETURN
  console.log("EBAY RESPONSE (FINDING) count=", items.length, "items=", JSON.stringify(items, null, 2));

  return ok({ source: "finding", count: items.length, items });
}

// ===== Utilities =====
function safeBody(text, max = 1200) {
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
