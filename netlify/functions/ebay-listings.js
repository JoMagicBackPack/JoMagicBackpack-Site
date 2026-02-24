/**
 * Updated eBay listings function with fallback.
 *
 * This version attempts to use the new eBay Buy Browse API if both
 * `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET` environment variables are
 * present. If the secret is missing or the Browse API call fails, it
 * falls back to the legacy Finding API, which requires only the App ID.
 *
 * To use this file in your Netlify project, replace the existing
 * `netlify/functions/ebay-listings.js` with the contents of this file.
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
  const id = env('EBAY_CLIENT_ID');
  const secret = env('EBAY_CLIENT_SECRET');
  if (!id || !secret) {
    throw createHttpError(500, 'Server is missing eBay credentials.');
  }
  if (TOKEN_CACHE.value && TOKEN_CACHE.exp > now() + 30) {
    return TOKEN_CACHE.value;
  }
  const scope = env('EBAY_SCOPE', 'https://api.ebay.com/oauth/api_scope');
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
    raw: item,
  };
}

function normalizeFindingItem(item) {
  const id = item.itemId && item.itemId[0];
  const title = item.title && item.title[0];
  const galleryURL = item.galleryURL && item.galleryURL[0];
  const viewItemURL = item.viewItemURL && item.viewItemURL[0];
  const sellingStatus = item.sellingStatus && item.sellingStatus[0];
  const convertedCurrentPrice = sellingStatus && sellingStatus.currentPrice && sellingStatus.currentPrice[0];
  const price = convertedCurrentPrice ? `${convertedCurrentPrice['@currencyId']} ${convertedCurrentPrice['__value__']}` : null;
  const condition = item.condition && item.condition[0] && item.condition[0].conditionDisplayName && item.condition[0].conditionDisplayName[0];
  const sellerInfo = item.sellerInfo && item.sellerInfo[0];
  const seller = sellerInfo && sellerInfo.sellerUserName && sellerInfo.sellerUserName[0];
  const shippingInfo = item.shippingInfo && item.shippingInfo[0];
  let shipping = null;
  if (shippingInfo) {
    const shippingServiceCost = shippingInfo.shippingServiceCost && shippingInfo.shippingServiceCost[0];
    if (shippingServiceCost) {
      const cost = shippingServiceCost['__value__'];
      const currency = shippingServiceCost['@currencyId'] || 'USD';
      shipping = { type: null, cost: `${currency} ${Number(cost).toFixed(2)}` };
    }
  }
  return {
    id: id || String(title || Math.random()),
    title: title || '',
    price: price,
    condition: condition || '—',
    image: galleryURL || null,
    url: viewItemURL || null,
    seller: seller || null,
    shipping: shipping,
    raw: item,
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
  if (sort === 'price') {
    params.set('sort', `price ${order === 'asc' ? 'asc' : 'desc'}`);
  } else if (sort === 'end') {
    params.set('sort', `endTime ${order === 'asc' ? 'asc' : 'desc'}`);
  } else {
    params.set('sort', 'newlyListed');
  }
  params.append('filter', 'buyingOptions:{FIXED_PRICE|BEST_OFFER|AUCTION}');
  params.set('fieldgroups', 'EXTENDED');
  return `${API_HOST}/buy/browse/v1/item_summary/search?${params.toString()}`;
}

async function searchItemsBrowse(token, query) {
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

async function searchItemsFinding(query) {
  const appId = env('EBAY_CLIENT_ID');
  if (!appId) {
    throw createHttpError(500, 'Server is missing eBay App ID for Finding API.');
  }
  const keywords = (query.q || '').toString().trim();
  const seller = (query.seller || env('EBAY_DEFAULT_SELLER') || '').toString().trim();
  const limit = Number(query.limit || env('EBAY_DEFAULT_LIMIT') || 12);
  const entriesPerPage = Math.max(1, Math.min(limit, 100));
  const sort = (query.sort || 'new').toString().toLowerCase();
  const order = (query.order || 'desc').toString().toLowerCase();
  let sortOrder;
  if (sort === 'price') {
    sortOrder = order === 'asc' ? 'PricePlusShippingLowest' : 'PricePlusShippingHighest';
  } else if (sort === 'end') {
    sortOrder = order === 'asc' ? 'EndTimeSoonest' : 'EndTimeSoonest';
  } else {
    sortOrder = 'StartTimeNewest';
  }
  const params = new URLSearchParams();
  params.set('OPERATION-NAME', 'findItemsAdvanced');
  params.set('SERVICE-VERSION', '1.0.0');
  params.set('SECURITY-APPNAME', appId);
  params.set('RESPONSE-DATA-FORMAT', 'JSON');
  params.set('REST-PAYLOAD', '');
  if (keywords) params.set('keywords', keywords);
  params.set('paginationInput.entriesPerPage', String(entriesPerPage));
  params.set('sortOrder', sortOrder);
  if (seller) {
    params.set('itemFilter.name', 'Seller');
    params.set('itemFilter.value', seller);
  }
  const url = `https://svcs.ebay.com/services/search/FindingService/v1?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    const text = await safeText(res);
    throw createHttpError(res.status, `eBay Finding API failed: ${text}`);
  }
  const data = await res.json();
  const results = data.findItemsAdvancedResponse && data.findItemsAdvancedResponse[0];
  const searchResult = results && results.searchResult && results.searchResult[0];
  const itemsArr = searchResult && searchResult.item ? searchResult.item : [];
  const items = itemsArr.map(normalizeFindingItem);
  return { items, total: Number(searchResult && searchResult['@count'] || items.length), href: url, next: null };
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
    // Determine whether to use Browse or Finding API
    let result;
    try {
      // Attempt Browse API if client secret is provided
      const token = await getAccessToken();
      result = await searchItemsBrowse(token, qs);
    } catch (err) {
      // Fall back to Finding API if missing credentials or Browse fails
      result = await searchItemsFinding(qs);
    }
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
