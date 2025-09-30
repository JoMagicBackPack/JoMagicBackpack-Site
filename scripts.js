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


(async () => {
  try {
    const res = await fetch('/.netlify/functions/ebay-feedback?limit=40');
    const reviews = await res.json();
    const track = document.getElementById('jfTrack');
    const dotsContainer = document.getElementById('jfDots');
    const prev = document.getElementById('jfPrev');
    const next = document.getElementById('jfNext');

    if (!track || !dotsContainer || !prev || !next) return;

    track.innerHTML = '';
    reviews.forEach((review) => {
      const li = document.createElement('li');
      li.className = 'jf-slide';
      const card = document.createElement('div');
      card.className = 'jf-card';
      const quoteEl = document.createElement('p');
      quoteEl.className = 'jf-quote';
      quoteEl.textContent = '"' + review.comment + '"';
      const metaEl = document.createElement('p');
      metaEl.className = 'jf-meta';
      const strong = document.createElement('strong');
      strong.textContent = review.user;
      const span = document.createElement('span');
      span.textContent = ' · ' + review.date;
      metaEl.appendChild(strong);
      metaEl.appendChild(span);
      card.appendChild(quoteEl);
      card.appendChild(metaEl);
      li.appendChild(card);
      track.appendChild(li);
    });

    const slides = Array.from(track.children);

    dotsContainer.innerHTML = '';
    slides.forEach((_, idx) => {
      const dot = document.createElement('button');
      dot.className = 'jf-dot';
      if (idx === 0) dot.classList.add('is-active');
      dot.addEventListener('click', () => {
        currentIndex = idx;
        update();
      });
      dotsContainer.appendChild(dot);
    });

    let currentIndex = 0;

    function update() {
      slides.forEach((slide, index) => {
        if (index === currentIndex) {
          slide.classList.add('is-active');
        } else {
          slide.classList.remove('is-active');
        }
      });
      const dots = dotsContainer.querySelectorAll('.jf-dot');
      dots.forEach((dot, index) => {
        if (index === currentIndex) {
          dot.classList.add('is-active');
        } else {
          dot.classList.remove('is-active');
        }
      });
    }

    prev.addEventListener('click', () => {
      currentIndex = (currentIndex - 1 + slides.length) % slides.length;
      update();
    });

    next.addEventListener('click', () => {
      currentIndex = (currentIndex + 1) % slides.length;
      update();
    });

    setInterval(() => {
      currentIndex = (currentIndex + 1) % slides.length;
      update();
    }, 5000);

    update();
  } catch (err) {
    console.error('Error loading reviews:', err);
  }
})();
