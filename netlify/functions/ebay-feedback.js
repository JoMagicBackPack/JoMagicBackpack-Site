// netlify/functions/ebay-feedback.js
// Usage: /.netlify/functions/ebay-feedback?limit=30
const { parseStringPromise } = require('xml2js');

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_DEV_ID  = process.env.EBAY_DEV_ID;
const EBAY_USER_TOKEN = process.env.EBAY_USER_TOKEN;

exports.handler = async (event) => {
  try {
    const LIMIT = Math.min(parseInt(event.queryStringParameters?.limit || '30', 10), 50);
    const ENTRIES_PER_PAGE = Math.min(LIMIT, 25);
    let page = 1;
    const out = [];
    const seen = new Set();
    let totalPages = null;

    while (out.length < LIMIT) {
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

      // total pages (if provided)
      const pr = json?.GetFeedbackResponse?.PaginationResult;
      if (pr?.TotalNumberOfPages) {
        const n = parseInt(pr.TotalNumberOfPages, 10);
        if (!isNaN(n)) totalPages = n;
      }

      const raw = json?.GetFeedbackResponse?.FeedbackDetailArray?.FeedbackDetail ?? [];
      const entries = Array.isArray(raw) ? raw : (raw ? [raw] : []);

      for (const fb of entries) {
        const comment = (fb?.CommentText || '').trim();
        if (!comment) continue;
        const user = (fb?.CommentingUser || '').trim();
        const date = (fb?.CommentTime || '').trim();
        const itemTitle = fb?.ItemTitle || '';
        const itemID = fb?.ItemID || '';
        const rating = fb?.CommentType || ''; // Positive/Neutral/Negative

        const key = `${comment}::${user}::${date}`;
        if (seen.has(key)) continue;
        seen.add(key);

        out.push({ comment, user, date, rating, itemTitle, itemID });
        if (out.length >= LIMIT) break;
      }

      // stop if we've reached the end
      const reachedLastPage = totalPages ? page >= totalPages : entries.length < ENTRIES_PER_PAGE;
      if (out.length >= LIMIT || reachedLastPage) break;

      page += 1;
      if (page > 50) break; // hard safety cap
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
