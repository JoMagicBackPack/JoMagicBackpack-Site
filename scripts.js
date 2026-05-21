// Year in footer
const y = document.getElementById('y');
if (y) y.textContent = new Date().getFullYear();

// Friendly demo reviews so you see content
const reviewList = document.getElementById('reviewList');
if (reviewList) {
  reviewList.innerHTML = `
    <li>“Great seller. Fast shipping. A+”</li>
    <li>“Exactly as described—thank you!”</li>
    <li>“Packed with care. Will buy again.”</li>
  `;
}

// --- AUTOMATIC EBAY FETCH CODE ---
// Connected to Jo'Magic Backpack eBay Store
const ebaySellerID = 'jomagicbackpack'; 
const rssUrl = `https://www.ebay.com/sch/i.html?_ssn=${ebaySellerID}&_rss=1`;
const apiUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`;

fetch(apiUrl)
  .then(response => response.json())
  .then(data => {
    const carousel = document.querySelector('.carousel');
    
    // If the carousel exists and we successfully got items from eBay
    if (carousel && data.items && data.items.length > 0) {
      carousel.innerHTML = ''; // Clear out the placeholder items
      
      data.items.forEach(item => {
        // Build the HTML for each live eBay item
        const itemHTML = `
          <div class="carousel-item">
            <a href="${item.link}" target="_blank" rel="noopener noreferrer" style="text-decoration: none; color: inherit;">
              <img src="${item.thumbnail || 'https://via.placeholder.com/250x200?text=Image+Not+Found'}" alt="JoMagic eBay Item">
              <h3 style="font-size: 1rem; margin-top: 10px;">${item.title}</h3>
            </a>
          </div>
        `;
        carousel.innerHTML += itemHTML; // Add the live item to the carousel
      });
    }
  })
  .catch(error => console.error('Error fetching eBay items:', error));