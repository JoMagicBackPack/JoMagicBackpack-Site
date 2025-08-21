// netlify/functions/ebay-listings.js
// Medium path: eBay Browse API + OAuth (client credentials)
// Uses env vars: EBAY_CLIENT_ID, EBAY_CLIENT_SECRET, EBAY_SELLER_USERNAME, EBAY_ENV (PROD/SANDBOX), EBAY_MARKETPLACE (e.g., EBAY_US)

const tokenCache = { token: null, expiresAt: 0 };

async function getAppToken() {
  const now = Date.now();
  if (tokenCache.token && now < tokenCache.expiresAt - 60_000) return tokenCache.token;

  const CLIENT_ID = process.env.EBAY_CLIENT_ID;
  const CLIENT_SECRET = process.env.EBAY_CLIENT_SECRET;
  const ENV = (process.env.EBAY_ENV || "PROD").toUpperCase();

  const tokenURL =
    ENV === "SANDBOX"
      ? "https://api.sandbox.ebay.com/identity/v1/oauth2/token"
      : "https://api.ebay.com/identity/v1/oauth2/token";

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope"
  });

  const r = await fetch(tokenURL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Token request failed: ${r.status} ${msg}`);
  }

  const data = await r.json();
  tokenCache.token = data.access_token;
  tokenCache.expiresAt = Date.now() + data.expires_in * 1000;
  return tokenCache.token;
}

exports.handler = async (event) => {
  try {
    // Inputs (fallbacks come from env)
    const url = new URL(event.rawUrl || `https://x.local${event.path}${event.rawQuery ? "?" + event.rawQuery : ""}`);
    const username =
      url.searchParams.get("username") ||
      process.env.EBAY_SELLER_USERNAME ||
      "jomagicbackpack";
    const limit = parseInt(url.searchParams.get("limit") || "24", 10);

    const ENV = (process.env.EBAY_ENV || "PROD").toUpperCase();
    const endpoint =
      ENV === "SANDBOX"
        ? "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search"
        : "https://api.ebay.com/buy/browse/v1/item_summary/search";

    const token = await getAppToken();

    const apiURL = `${endpoint}?seller_username=${encodeURIComponent(username)}&limit=${limit}`;
    const r = await fetch(apiURL, {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": process.env.EBAY_MARKETPLACE || "EBAY_US",
        "Accept-Language": "en-US"
      }
    });

    if (!r.ok) {
      const txt = await r.text();
      return {
        statusCode: 502,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Browse API failed", status: r.status, details: txt })
      };
    }

    const data = await r.json();
    const items = (data.itemSummaries || []).map((it) => ({
      id: it.itemId,
      title: it.title,
      price: it.price?.value,
      currency: it.price?.currency,
      url: it.itemWebUrl,
      image: it.image?.imageUrl || (it.thumbnailImages?.[0]?.imageUrl ?? ""),
      condition: it.condition
    }));

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
