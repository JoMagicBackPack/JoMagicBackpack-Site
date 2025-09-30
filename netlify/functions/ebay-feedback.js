// Netlify function: returns up to `limit` distinct seller feedback entries
// Usage: /.netlify/functions/ebay-feedback?limit=30
const { parseStringPromise } = require('xml2js');

// Required env vars (Netlify -> Site settings -> Environment):
// EBAY_APP_ID, EBAY_CERT_ID, EBAY_DEV_ID, EBAY_USER_TOKEN
const EBAY_APP_ID   = process.env.EBAY_APP_ID;
const EBAY_CERT_ID  = process.env.EBAY_CERT_ID;
const EBAY_DEV_ID   = process.env.EBAY_DEV_ID;
const EBAY_USER_TOKEN = process.env.EBAY_USER_TOKEN;

exports.handler = async (event) => {
  try {
    const LIMIT = Math.min(parseInt(event.queryStringParameters?.limit || '30', 10), 50);
    const ENTRIES_PER_PAGE = Math.min(LIMIT, 25); // Trading API practical page size ~25
    let page = 1;
    const out = [];
    const seen = new Set();

    while (out.length < LIMIT && page <= 10) { // hard stop to avoid infinite loops
      const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Pagination>
    <EntriesPerPage>${ENTRIES_PER_PAGE}</EntriesPerPage>
    <PageNumber>${page}</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
  <FeedbackType>FeedbackReceivedAsSeller</FeedbackType>
</GetFeedbackRequest>`.trim();

      const res = await fetch('https://api.ebay.com/ws/api.dll', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-DEV-NAME': EBAY_DEV_ID,
          'X-EBAY-API-APP-NAME': EBAY_APP_ID,
          'X-EBAY-API-CERT-NAME': EBAY_CERT_ID,
          'X-EBAY-API-CALL-NAME': 'GetFeedback',
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-COMPATIBILITY-LEVEL': '967'
        },
        body: xmlBody
      });

      if (!res.ok) {
        const t = await res.text();
        throw new Error(`eBay API ${res.status}: ${t}`);
      }

      const xml = await res.text();
      const json = await parseStringPromise(xml, { explicitArray: false });

      const raw = json?.GetFeedbackResponse?.FeedbackDetailArray?.FeedbackDetail ?? [];
      const entries = Array.isArray(raw) ? raw : (raw ? [raw] : []);

      // Collect distinct entries
      for (const fb of entries) {
        if (!fb?.CommentText) continue;
        const item = {
          comment: fb.CommentText,
          user: fb.CommentingUser,
          date: fb.CommentTime,
          rating: fb.CommentType,        // Positive | Neutral | Negative
          itemTitle: fb.ItemTitle || '',
          itemID: fb.ItemID || ''
        };
        const key = `${item.comment}::${item.user}::${item.date}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push(item);
        }
        if (out.length >= LIMIT) break;
      }

      // Stop if the page returned fewer than requested (no more pages)
      if (entries.length < ENTRIES_PER_PAGE) break;
      page += 1;
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(out.slice(0, LIMIT))
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
