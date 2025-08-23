// netlify/functions/ebay-listings.js
// Fetch active eBay listings via Trading API (Auth'n'Auth user token).
// Env required: EBAY_USER_TOKEN  (falls back to EBAY_AUTH_TOKEN)

const EBAY_TRADING_ENDPOINT = 'https://api.ebay.com/ws/api.dll';
const EBAY_COMPAT_LEVEL = '1147'; // works well for GetMyeBaySelling

function httpRes(status, bodyObj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',       // allow browser fetch from your site
      'Cache-Control': 'public, max-age=60, s-maxage=300', // browser 60s, edge 5m
    },
    body: JSON.stringify(bodyObj),
  };
}

// tiny XML helpers (no deps)
function getTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}
function getAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*\\b${attr}="([^"]+)"[^>]*>`, 'i'));
  return m ? m[1] : '';
}
function to500(url) {
  return (url || '').replace(/s-l\d+\.jpg/i, 's-l500.jpg');
}

exports.handler = async (event) => {
  try {
    const token = process.env.EBAY_USER_TOKEN || process.env.EBAY_AUTH_TOKEN;
    if (!token) return httpRes(500, { error: 'Missing EBAY_USER_TOKEN env var.' });

    // ?limit= (default 48, max 400)
    const qs = new URLSearchParams(event.queryStringParameters || {});
    const requested = Math.min(Math.max(parseInt(qs.get('limit') || '48', 10) || 48, 1), 400);

    let page = 1;
    const perPage = 100;            // keep payloads modest
    const items = [];

    while (items.length < requested) {
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <ActiveList>
    <Include>true</Include>
    <Pagination>
      <EntriesPerPage>${perPage}</EntriesPerPage>
      <PageNumber>${page}</PageNumber>
    </Pagination>
  </ActiveList>
  <ErrorLanguage>en_US</ErrorLanguage>
  <WarningLevel>Low</WarningLevel>
</GetMyeBaySellingRequest>`;

      const res = await fetch(EBAY_TRADING_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-CALL-NAME': 'GetMyeBaySelling',
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-COMPATIBILITY-LEVEL': EBAY_COMPAT_LEVEL,
        },
        body: xmlBody,
      });

      const bodyText = await res.text();
      console.log(`[TRADING] status=${res.status} bodyLen=${bodyText.length}`);

      if (!res.ok) return httpRes(res.status, { error: 'Trading API error', status: res.status });

      const ack = getTag(bodyText, 'Ack') || getTag(bodyText, 'ack');
      if (/^Failure$/i.test(ack)) {
        const shortMsg = getTag(bodyText, 'ShortMessage');
        const longMsg  = getTag(bodyText, 'LongMessage');
        return httpRes(500, { error: 'eBay Failure', shortMsg, longMsg });
      }

      const activeBlock = getTag(bodyText, 'ActiveList');
      if (!activeBlock) break;

      const blocks = activeBlock.match(/<Item>([\s\S]*?)<\/Item>/gi) || [];
      for (const block of blocks) {
        const id    = getTag(block, 'ItemID');
        const title = getTag(block, 'Title');
        const price = getTag(block, 'CurrentPrice');
        const currency =
          getAttr(block, 'CurrentPrice', 'currencyID') ||
          getAttr(block, 'ConvertedCurrentPrice', 'currencyID') ||
          'USD';
        const url =
          getTag(block, 'ViewItemURLForNaturalSearch') ||
          getTag(block, 'ViewItemURL') ||
          getTag(getTag(block, 'ListingDetails') || '', 'ViewItemURL') ||
          '';
        let image =
          getTag(block, 'GalleryURL') ||
          (getTag(block, 'PictureDetails').match(/<PictureURL>[\s\S]*?<\/PictureURL>/i)?.[0] || '')
            .replace(/<\/?PictureURL>/gi, '') ||
          '';

        items.push({
          id,
          title,
          price: price || '',
          currency,
          url,
          img: to500(image), // <-- return as `img` for the front-end
        });

        if (items.length >= requested) break;
      }

      if (blocks.length < perPage) break; // last page
      page += 1;
      if (page > 50) break;               // safety guard
    }

    // Return the exact shape index.html expects
    return httpRes(200, {
      source: 'trading',
      count: items.length,
      products: items,   // <-- key the site reads
    });
  } catch (err) {
    console.error('Function error:', err);
    return httpRes(500, { error: 'Server error', message: String(err?.message || err) });
  }
};
