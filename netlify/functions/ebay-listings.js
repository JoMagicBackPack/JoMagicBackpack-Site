// netlify/functions/ebay-listings.js
// Fetch active eBay listings via Trading API (Auth'n'Auth user token).
// Env required: EBAY_USER_TOKEN

const EBAY_TRADING_ENDPOINT = 'https://api.ebay.com/ws/api.dll';
// A modern compatibility level that works fine for GetMyeBaySelling.
const EBAY_COMPAT_LEVEL = '1147';

function httpRes(status, bodyObj) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Allow your site to fetch this from the browser
      'Access-Control-Allow-Origin': '*',
      // Cache at edge for 5 min; browsers for 60s
      'Cache-Control': 'public, max-age=60, s-maxage=300',
    },
    body: JSON.stringify(bodyObj),
  };
}

// very small XML helpers (no external deps)
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
    if (!token) {
      return httpRes(500, { error: 'Missing EBAY_USER_TOKEN env var.' });
    }

    // Respect ?limit= (default 48, hard max 400)
    const urlParams = new URLSearchParams(event.queryStringParameters || {});
    const requested = Math.min(
      Math.max(parseInt(urlParams.get('limit') || '48', 10) || 48, 1),
      400
    );

    let page = 1;
    const perPage = 100; // Trading API max entries/page for ActiveList is 200; 100 keeps payload modest.
    const items = [];

    // Loop until we collect requested items or run out
    while (items.length < requested) {
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${token}</eBayAuthToken>
  </RequesterCredentials>
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

      if (!res.ok) {
        return httpRes(res.status, { error: 'Trading API error', status: res.status });
      }

      // Basic API ack/error check
      const ack = getTag(bodyText, 'Ack') || getTag(bodyText, 'ack');
      if (/^Failure$/i.test(ack)) {
        const shortMsg = getTag(bodyText, 'ShortMessage');
        const longMsg = getTag(bodyText, 'LongMessage');
        return httpRes(500, { error: 'eBay Failure', shortMsg, longMsg });
      }

      // Extract <Item>...</Item> blocks from <ActiveList>
      const activeBlock = getTag(bodyText, 'ActiveList');
      if (!activeBlock) break;

      const itemMatches = activeBlock.match(/<Item>([\s\S]*?)<\/Item>/gi) || [];
      for (const block of itemMatches) {
        // Fields we want
        const id = getTag(block, 'ItemID');
        const title = getTag(block, 'Title');
        const price = getTag(block, 'CurrentPrice');
        const currency =
          getAttr(block, 'CurrentPrice', 'currencyID') ||
          getAttr(block, 'ConvertedCurrentPrice', 'currencyID') ||
          'USD';
        // Prefer canonical URL; fallback to ListingDetails.ViewItemURL or ViewItemURL
        const url =
          getTag(block, 'ViewItemURLForNaturalSearch') ||
          getTag(block, 'ViewItemURL') ||
          getTag(getTag(block, 'ListingDetails') || '', 'ViewItemURL') ||
          '';

        // Image: try GalleryURL, then first PictureURL
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
          image: to500(image),
        });

        if (items.length >= requested) break;
      }

      // Stop if this page returned fewer than perPage
      if (itemMatches.length < perPage) break;
      page += 1;
      if (page > 50) break; // safety guard
    }

    return httpRes(200, {
      source: 'trading',
      count: items.length,
      items,
    });
  } catch (err) {
    console.error('Function error:', err);
    return httpRes(500, { error: 'Server error', message: String(err?.message || err) });
  }
};
