// netlify/functions/ebay-listings.js
// Fetch active listings for a seller using eBay Finding API (no OAuth needed).
// Env vars used: EBAY_CLIENT_ID (App ID), EBAY_SELLER_USERNAME (e.g., "jomagicbackpack")

const https = require("https");
const { URL } = require("url");

// Tiny helper to GET via Node's https (no extra deps)
function httpsGet(urlStr) {
  return new Promise((resolve, reject) => {
    const req = https.get(urlStr, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: data }));
    });
    req.on("error", reject);
    req.end();
  });
}

exports.handler = async (event) => {
  try {
    const APP_ID = process.env.EBAY_CLIENT_ID;
    if (!APP_ID) {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Missing EBAY_CLIENT_ID env var" })
      };
    }

    const defaultSeller = process.env.EBAY_SELLER_USERNAME || "jomagicbackpack";

    // Allow overrides: /.netlify/functions/ebay-listings?username=...&limit=...
    const rawUrl = event.rawUrl || `https://local.test${event.path}${event.rawQuery ? "?" + event.rawQuery : ""}`;
    const urlObj = new URL(rawUrl);
    const seller = (urlObj.searchParams.get("username") || defaultSeller).trim();
    const limit = parseInt(urlObj.searchParams.get("limit") || "24", 10);

    // Build Finding API request
    const endpoint = "https://svcs.ebay.com/services/search/FindingService/v1";
    const params = new URLSearchParams({
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

    const apiUrl = `${endpoint}?${params.toString()}`;

    // Call eBay
    const resp = await httpsGet(apiUrl);
    if (resp.status < 200 || resp.status >= 300) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Finding API HTTP error", status: resp.status, details: resp.body?.slice?.(0, 500) })
      };
    }

    // Parse & shape
    let json;
    try {
      json = JSON.parse(resp.body);
    } catch (e) {
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON from eBay", details: e.message })
      };
    }

    const items =
      json?.findItemsAdvancedResponse?.[0]?.searchResult?.[0]?.item?.map((it) => ({
        id: it?.itemId?.[0],
        title: it?.title?.[0],
        price: it?.sellingStatus?.[0]?.currentPrice?.[0]?.__value__,
        currency: it?.sellingStatus?.[0]?.currentPrice?.[0]?.["@currencyId"],
        url: it?.viewItemURL?.[0],
        image: it?.pictureURLLarge?.[0] || it?.galleryPlusPictureURL?.[0] || it?.galleryURL?.[0] || "",
        condition: it?.condition?.[0]?.conditionDisplayName?.[0] || ""
      })) || [];

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "public, max-age=600"
      },
      body: JSON.stringify({ items })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: err.message })
    };
  }
};
