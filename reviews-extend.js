// This script ensures the reviews carousel has at least the desired number of slides
// by duplicating existing slides when there are not enough. It runs after the DOM
// has loaded and assumes the main carousel has already inserted the initial
// review elements into the `.jfTrack` container.

document.addEventListener('DOMContentLoaded', () => {
  const track = document.getElementById('jfTrack');
  const dotsContainer = document.getElementById('jfDots');
  if (!track || !dotsContainer) return;
  let slides = Array.from(track.children);
  const desiredCount = 30;
  // If there are fewer slides than desired, duplicate the existing slides
  if (slides.length > 0 && slides.length < desiredCount) {
    let clones = [];
    // Continue cloning the original set of slides until we have enough
    while (clones.length < desiredCount) {
      clones = clones.concat(slides.map((slide) => slide.cloneNode(true)));
    }
    // Append only as many clones as needed to reach the desired count
    clones.slice(0, desiredCount - slides.length).forEach((clone) => {
      track.appendChild(clone);
    });
    // Update the slides array to reflect the new elements
    slides = Array.from(track.children);
    // Recreate the dots to match the updated number of slides
    dotsContainer.innerHTML = '';
    slides.forEach(() => {
      const dot = document.createElement('li');
      dot.className = 'jf-dot';
      dotsContainer.appendChild(dot);
    });
  }
});
