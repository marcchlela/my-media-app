/* ==========================================================================
   carousel.js — syncs the "Now Showing" hero dots with horizontal scroll.
   Clicking a dot scrolls to the corresponding lit-frame; scrolling updates
   which dot is active.
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  const carousel = document.getElementById('hero-carousel');
  const dotsWrap = document.getElementById('hero-dots');
  if (!carousel || !dotsWrap) return;

  const frames = Array.from(carousel.querySelectorAll('.lit-frame'));
  const dots = Array.from(dotsWrap.querySelectorAll('.hero-dot'));
  if (!frames.length || !dots.length) return;

  dots.forEach((dot, i) => {
    dot.addEventListener('click', () => {
      const target = frames[i];
      if (!target) return;
      carousel.scrollTo({
        left: target.offsetLeft - 24,
        behavior: 'smooth'
      });
    });
  });

  let scrollTimeout;
  carousel.addEventListener('scroll', () => {
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      const scrollCenter = carousel.scrollLeft + carousel.clientWidth / 2;
      let closestIndex = 0;
      let closestDist = Infinity;
      frames.forEach((frame, i) => {
        const frameCenter = frame.offsetLeft + frame.offsetWidth / 2;
        const dist = Math.abs(frameCenter - scrollCenter);
        if (dist < closestDist) { closestDist = dist; closestIndex = i; }
      });
      dots.forEach((d, i) => d.classList.toggle('is-active', i === closestIndex));
    }, 80);
  });
});
