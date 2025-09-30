// ----- rotating quotes (unchanged) -----
const quotes = [
  "Curiosity packed, wonder unpacked.",
  "No algorithms, just instinct.",
  "A place for the curious and the uncommon.",
  "Handpicked oddities, packed with care.",
];
let i = 0;
const quoteEl = document.getElementById("quote");
setInterval(() => {
  i = (i + 1) % quotes.length;
  quoteEl.textContent = "“" + quotes[i] + "”";
}, 4000);

// ----- reviews carousel (rewritten) -----
(async () => {
  try {
    // Ask the backend for as many as you want (backend now paginates & returns seller-only)
    const DESIRED_COUNT = 30;
    const res = await fetch(`/.netlify/functions/ebay-feedback?limit=${DESIRED_COUNT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();

    // Basic guards
    if (!Array.isArray(raw)) throw new Error("Bad payload: expected array");

    // Front-end safety de-dup (backend already tries, but belt & suspenders)
    const seen = new Set();
    const unique = [];
    for (const r of raw) {
      const comment = (r.comment || "").trim();
      const user = (r.user || r.fromUser || "").trim();
      const date = (r.date || "").trim();
      if (!comment) continue;
      const key = `${comment}::${user}::${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push({ comment, user, date, rating: r.rating || "", itemTitle: r.itemTitle || "", itemID: r.itemID || "" });
      if (unique.length >= DESIRED_COUNT) break;
    }

    // Sort newest first if dates parse
    unique.sort((a, b) => {
      const da = Date.parse(a.date || "");
      const db = Date.parse(b.date || "");
      if (isNaN(da) && isNaN(db)) return 0;
      if (isNaN(da)) return 1;
      if (isNaN(db)) return -1;
      return db - da;
    });

    // Build DOM (keeps your existing structure/classes)
    const track = document.getElementById("jfTrack");
    const dotsContainer = document.getElementById("jfDots");
    const prev = document.getElementById("jfPrev");
    const next = document.getElementById("jfNext");
    if (!track || !dotsContainer || !prev || !next) return;

    track.innerHTML = "";
    const formatter = new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric" });

    unique.forEach((review) => {
      const li = document.createElement("li");
      li.className = "jf-slide";

      const card = document.createElement("div");
      card.className = "jf-card";

      const pQuote = document.createElement("p");
      pQuote.className = "jf-quote";
      pQuote.textContent = `“${review.comment}”`;

      const pMeta = document.createElement("p");
      pMeta.className = "jf-meta";

      const strong = document.createElement("strong");
      strong.textContent = review.user || "eBay buyer";

      const span = document.createElement("span");
      // Pretty date if parseable; else use raw
      let niceDate = review.date;
      const parsed = Date.parse(review.date || "");
      if (!isNaN(parsed)) niceDate = formatter.format(new Date(parsed));
      span.textContent = niceDate ? ` · ${niceDate}` : "";

      pMeta.appendChild(strong);
      pMeta.appendChild(span);

      card.appendChild(pQuote);
      card.appendChild(pMeta);
      li.appendChild(card);
      track.appendChild(li);
    });

    // ...after: const slides = Array.from(track.children);

const MAX_DOTS = 12; // cap dots for mobile sanity

dotsContainer.innerHTML = '';
slides.forEach((_, idx) => {
  if (idx >= MAX_DOTS) return; // don't render more than MAX_DOTS
  const dot = document.createElement('button');
  dot.className = 'jf-dot';
  if (idx === 0) dot.classList.add('is-active');
  dot.addEventListener('click', () => {
    currentIndex = Math.min(idx, slides.length - 1);
    update();
  });
  dotsContainer.appendChild(dot);
});

    let currentIndex = 0;

    function update() {
      slides.forEach((slide, index) => {
        slide.classList.toggle("is-active", index === currentIndex);
      });
      const dots = dotsContainer.querySelectorAll(".jf-dot");
      dots.forEach((dot, index) => {
        dot.classList.toggle("is-active", index === currentIndex);
      });
    }

    prev.addEventListener("click", () => {
      currentIndex = (currentIndex - 1 + slides.length) % slides.length;
      update();
    });

    next.addEventListener("click", () => {
      currentIndex = (currentIndex + 1) % slides.length;
      update();
    });

    if (slides.length > 1) {
      setInterval(() => {
        currentIndex = (currentIndex + 1) % slides.length;
        update();
      }, 5000);
    }

    update();
  } catch (err) {
    console.error("Error loading reviews:", err);
  }
})();
