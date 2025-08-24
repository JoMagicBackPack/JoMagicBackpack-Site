=== Filename: netlify/functions/ebay-listings.js ===
/**
 * Netlify Function: ebay-listings
 * Fetch eBay items via the Buy Browse API using OAuth Client Credentials.
 *
 * Query params:
 *  - q: search keywords
 *  - seller: seller username (optional, can be defaulted via env)
 *  - limit: 1..50 (default 12)
 *  - sort: "new" | "price" | "end" (default "new")
 *  - order: "asc" | "desc" (default "desc"; used with sort=price or sort=end)
 *  - next: absolute "next" link returned by eBay (optional, for server-side paging)
 *
 * Required environment variables:
 *  - EBAY_CLIENT_ID
 *  - EBAY_CLIENT_SECRET
 *  - EBAY_ENV = "PRODUCTION" | "SANDBOX" (default "PRODUCTION")
 *  - EBAY_SCOPE (default "https://api.ebay.com/oauth/api_scope")
 *  - EBAY_DEFAULT_SELLER (optional)
 *  - EBAY_DEFAULT_LIMIT (optional, e.g. "12")
 */
const TOKEN_CACHE = { value: null, exp: 0 };

const RESP_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const now = () => Math.floor(Date.now() / 1000);
const env = (k, d) => (process.env[k] ?? d);

const EBAY_ENV = String(env('EBAY_ENV', 'PRODUCTION')).toUpperCase();
const API_HOST = EBAY_ENV === 'SANDBOX'
  ? 'https://api.sandbox.ebay.com'
  : 'https://api.ebay.com';

function createHttpError(status = 500, message = 'Unexpected error', meta = {}) {
  const err = new Error(message);
  err.statusCode = status;
  err.meta = meta;
  return err;
}

async function safeText(res) {
  try { return await res.text(); } catch { return ''; }
}

async function getAccessToken() {
  if (TOKEN_CACHE.value && TOKEN_CACHE.exp > now() + 30) {
    return TOKEN_CACHE.value;
  }
  const id = env('EBAY_CLIENT_ID');
  const secret = env('EBAY_CLIENT_SECRET');
  const scope = env('EBAY_SCOPE', 'https://api.ebay.com/oauth/api_scope');

  if (!id || !secret) {
    throw createHttpError(500, 'Server is missing eBay credentials.');
  }

  const basic = Buffer.from(`${id}:${secret}`).toString('base64');
  const body = new URLSearchParams({ grant_type: 'client_credentials', scope });

  const res = await fetch(`${API_HOST}/identity/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw createHttpError(res.status, `eBay OAuth failed: ${text}`);
  }

  const data = await res.json();
  TOKEN_CACHE.value = data.access_token;
  TOKEN_CACHE.exp = now() + (data.expires_in || 7200);
  return TOKEN_CACHE.value;
}

function normalizeItemSummary(item) {
  const priceObj = item.price || item.currentBidPrice || item.minPrice || null;
  const imageUrl =
    item?.image?.imageUrl ||
    item?.thumbnailImages?.[0]?.imageUrl ||
    item?.image?.url ||
    null;

  const shipping = Array.isArray(item?.shippingOptions) && item.shippingOptions[0]
    ? item.shippingOptions[0]
    : null;

  return {
    id: item.itemId || item.legacyItemId || item.epid || String(item.title || Math.random()),
    title: item.title || '',
    price: priceObj && priceObj.value != null
      ? `${priceObj.currency || 'USD'} ${Number(priceObj.value).toFixed(2)}`
      : null,
    condition: item?.condition || item?.itemGroupType || '—',
    image: imageUrl,
    url: item?.itemWebUrl || item?.itemAffiliateWebUrl || item?.itemHref || null,
    seller: item?.seller?.username || null,
    shipping: shipping ? {
      type: shipping?.shippingServiceType || shipping?.optionType || null,
      cost: shipping?.shippingCost && shipping.shippingCost.value != null
        ? `${shipping.shippingCost.currency || 'USD'} ${Number(shipping.shippingCost.value).toFixed(2)}`
        : (shipping?.shippingCost === 0 ? 'USD 0.00' : null),
    } : null,
    raw: item, // helpful for debugging
  };
}

function buildSearchURL(query) {
  const params = new URLSearchParams();
  const q = (query.q || '').toString().trim();
  const seller = (query.seller || env('EBAY_DEFAULT_SELLER') || '').toString().trim();
  const limit = Number(query.limit || env('EBAY_DEFAULT_LIMIT') || 12);
  const sort = (query.sort || 'new').toString().toLowerCase();
  const order = (query.order || 'desc').toString().toLowerCase();

  if (q) params.set('q', q);
  if (seller) params.set('filter', `seller_username:{${seller}}`);
  params.set('limit', String(Math.max(1, Math.min(limit, 50))));

  // Sort mapping
  if (sort === 'price') {
    params.set('sort', `price ${order === 'asc' ? 'asc' : 'desc'}`);
  } else if (sort === 'end') {
    params.set('sort', `endTime ${order === 'asc' ? 'asc' : 'desc'}`);
  } else {
    params.set('sort', 'newlyListed');
  }

  // limit to purchasable items
  params.append('filter', 'buyingOptions:{FIXED_PRICE|BEST_OFFER|AUCTION}');
  params.set('fieldgroups', 'EXTENDED');

  return `${API_HOST}/buy/browse/v1/item_summary/search?${params.toString()}`;
}

async function searchItems(token, query) {
  // Support server-side "next" link if provided
  const next = (query.next || '').toString().trim();
  const url = next || buildSearchURL(query);

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  });

  if (!res.ok) {
    const text = await safeText(res);
    throw createHttpError(res.status, `eBay Browse search failed: ${text}`);
  }

  const data = await res.json();
  const items = Array.isArray(data.itemSummaries) ? data.itemSummaries.map(normalizeItemSummary) : [];

  return {
    items,
    total: data.total || items.length,
    href: data.href || url,
    next: data.next || null,
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') {
      return { statusCode: 200, headers: RESP_HEADERS, body: '' };
    }
    if (event.httpMethod !== 'GET') {
      return { statusCode: 405, headers: RESP_HEADERS, body: JSON.stringify({ ok:false, error:'Method Not Allowed' }) };
    }

    const qs = event.queryStringParameters || {};
    const token = await getAccessToken();
    const result = await searchItems(token, qs);

    return {
      statusCode: 200,
      headers: RESP_HEADERS,
      body: JSON.stringify({ ok: true, result }),
    };
  } catch (err) {
    const status = err.statusCode || 500;
    return {
      statusCode: status,
      headers: RESP_HEADERS,
      body: JSON.stringify({
        ok: false,
        error: err.message || 'Unexpected error',
        meta: err.meta || null,
      }),
    };
  }
};
