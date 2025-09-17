const fetch = require('node-fetch');
const { parseStringPromise } = require('xml2js');

const EBAY_APP_ID = process.env.EBAY_APP_ID;
const EBAY_CERT_ID = process.env.EBAY_CERT_ID;
const EBAY_DEV_ID = process.env.EBAY_DEV_ID;
const EBAY_USER_TOKEN = process.env.EBAY_USER_TOKEN;

exports.handler = async (event) => {
  const limit = parseInt(event.queryStringParameters?.limit) || 20;
  const xmlBody = `<?xml version="1.0" encoding="utf-8"?>
<GetFeedbackRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials>
    <eBayAuthToken>${EBAY_USER_TOKEN}</eBayAuthToken>
  </RequesterCredentials>
  <Pagination>
    <EntriesPerPage>${limit}</EntriesPerPage>
    <PageNumber>1</PageNumber>
  </Pagination>
  <DetailLevel>ReturnAll</DetailLevel>
  <FeedbackType>FeedbackReceived</FeedbackType>
</GetFeedbackRequest>`;
  try {
    const response = await fetch('https://api.ebay.com/ws/api.dll', {
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
    const xml = await response.text();
    const json = await parseStringPromise(xml, { explicitArray: false });
    const details = json.GetFeedbackResponse.FeedbackDetailArray?.FeedbackDetail || [];
    const feedbacks = Array.isArray(details) ? details : [details];
    const result = feedbacks.map(fb => ({
      comment: fb.CommentText,
      user: fb.CommentingUser,
      date: fb.CommentTime
    })).slice(0, limit);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result)
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message })
    };
  }
};
