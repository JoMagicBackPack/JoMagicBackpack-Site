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
  // Later we’ll plug in live eBay reviews again.
}
