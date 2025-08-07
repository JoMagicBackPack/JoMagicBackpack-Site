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
