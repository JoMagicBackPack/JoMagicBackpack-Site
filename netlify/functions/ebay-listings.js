// netlify/functions/ebay-listings.js

const fetch = require("node-fetch");

exports.handler = async (event, context) => {
  try {
    // Get variables from Netlify env
    const appId = process.env.EBAY_APP_ID;
    const seller = process.env.EBAY_SELLER_USER || "jomagicbackpack";
    const env = process.env.EBAY_ENV || "PRODUCTION"; // "SANDBOX" or "PRODUCTION"

    const token = process.env.EBAY_OAUTH_TOKEN; // make sure this is set in Netlify
    const endpoint =
      env === "SANDBOX"
        ? "https://api.sandbox.ebay.com/buy/browse/v1/item_summary/search"
        : "https://api.ebay.com/buy/browse/v1/item_summary/search";

    // Allow ?q= query or default to seller items
    const url = new URL(endpoint);
    if (event.queryStringParameters.q) {
      url.searchParams.set("q", event.queryStringParameters.q);
    } else {
      url.searchParams.set("seller", seller);
    }
    url.searchParams.set("limit", "10");

    // Call eBay API
    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        "X-EBAY-C-MARKETPLACE-ID": "EBAY_US",
        "Accept-Language": "en-US",
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return {
        statusCode: response.status,
        body: JSON.stringify({ error }),
      };
    }

    const data = await response.json();
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
