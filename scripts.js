// ----- rotating quotes -----
const quotes = [
  "Curiosity packed, wonder unpacked.",
  "No algorithms, just instinct.",
  "A place for the curious and the uncommon.",
  "Handpicked oddities, packed with care.",
];
let i = 0;
const quoteEl = document.getElementById("quote");
if (quoteEl) {
  setInterval(() => {
    i = (i + 1) % quotes.length;
    quoteEl.textContent = "“" + quotes[i] + "”";
  }, 4000);
}

// ----- reviews carousel -----
(async () => {
  try {
    const DESIRED_COUNT = 30;
    const res = await fetch(`/.netlify/functions/ebay-feedback?limit=${DESIRED_COUNT}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error("Bad payload");

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
      unique.push({ comment, user, date });
      if (unique.length >= DESIRED_COUNT) break;
    }

    unique.sort((a, b) => Date.parse(b.date) - Date.parse(a.date));

    const track = document.getElementById("jfTrack");
    const dotsContainer = document.getElementById("jfDots");
    const prev = document.getElementById("jfPrev");
    const next = document.getElementById("jfNext");
    if (!track || !dotsContainer || !prev || !next) return;

    track.innerHTML = "";
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
      pMeta.textContent = `${review.user} · ${review.date}`;
      card.appendChild(pQuote);
      card.appendChild(pMeta);
      li.appendChild(card);
      track.appendChild(li);
    });

    const slides = Array.from(track.children);

    const MAX_DOTS = 12;
    dotsContainer.innerHTML = "";
    slides.forEach((_, idx) => {
      if (idx >= MAX_DOTS) return;
      const dot = document.createElement("button");
      dot.className = "jf-dot";
      if (idx === 0) dot.classList.add("is-active");
      dot.addEventListener("click", () => {
        currentIndex = idx;
        update();
      });
      dotsContainer.appendChild(dot);
    });

    let currentIndex = 0;
    function update() {
      slides.forEach((s, i) => s.classList.toggle("is-active", i === currentIndex));
      dotsContainer.querySelectorAll(".jf-dot").forEach((d, i) =>
        d.classList.toggle("is-active", i === currentIndex)
      );
    }
    prev.addEventListener("click", () => { currentIndex = (currentIndex - 1 + slides.length) % slides.length; update(); });
    next.addEventListener("click", () => { currentIndex = (currentIndex + 1) % slides.length; update(); });
    if (slides.length > 1) setInterval(() => { currentIndex = (currentIndex + 1) % slides.length; update(); }, 5000);
    update();
  } catch (err) {
    console.error("Error loading reviews:", err);
  }
})();
