// landing.js: the landing page's key-tag entrance animation, a subtle
// post-landing mouse tilt on desktop, and the hero background carousel.

// --- Hero image carousel: crossfades between .hero-slide layers, dots are
// clickable and also stay in sync with autoplay. ---
const heroSlides = document.querySelectorAll('.hero-slide');
const heroDots = document.querySelectorAll('.hero-dot');
const HERO_SLIDE_INTERVAL_MS = 5000;
let heroSlideIndex = 0;
let heroTimer = null;

function showHeroSlide(index) {
  heroSlideIndex = (index + heroSlides.length) % heroSlides.length;
  heroSlides.forEach((slide, i) => slide.classList.toggle('is-active', i === heroSlideIndex));
  heroDots.forEach((dot, i) => dot.classList.toggle('is-active', i === heroSlideIndex));
}

function startHeroAutoplay() {
  stopHeroAutoplay();
  heroTimer = setInterval(() => showHeroSlide(heroSlideIndex + 1), HERO_SLIDE_INTERVAL_MS);
}

function stopHeroAutoplay() {
  if (heroTimer) clearInterval(heroTimer);
}

if (heroSlides.length > 1) {
  heroDots.forEach((dot) => {
    dot.addEventListener('click', () => {
      showHeroSlide(Number(dot.getAttribute('data-slide')));
      startHeroAutoplay(); // reset the timer so it doesn't jump right after a manual click
    });
  });

  startHeroAutoplay();

  // Pause while the tab isn't visible, no point crossfading off-screen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopHeroAutoplay();
    else startHeroAutoplay();
  });
}

const keyBoard = document.querySelector('.key-board');

// Don't start the fly-in until the page has actually finished loading
// (background photo decoded, fonts swapped in), so the cards appear once
// everything else is visually settled, not mid-layout-shift.
function startEntrance() {
  if (keyBoard) keyBoard.classList.add('is-ready');
}

Promise.all([
  new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', resolve, { once: true });
  }),
  document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve(),
]).then(startEntrance);

// Safety net: if something (a slow image, a font hiccup) holds this up
// longer than a visitor will realistically wait, show the cards anyway.
setTimeout(startEntrance, 2500);

// Bonus: once the cards have landed, the whole stack gently tilts toward
// the mouse, like looking at real keys on a hook from a slightly different
// angle. Skipped on touch devices, since there's no hover there.
if (keyBoard && window.matchMedia('(pointer: fine)').matches) {
  const hero = document.querySelector('.landing-hero');

  hero?.addEventListener('mousemove', (e) => {
    const rect = hero.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5; // -0.5 to 0.5
    const y = (e.clientY - rect.top) / rect.height - 0.5;

    const maxTilt = 6; // degrees, kept subtle
    keyBoard.style.transform = `rotateX(${(-y * maxTilt).toFixed(2)}deg) rotateY(${(x * maxTilt).toFixed(2)}deg)`;
  });

  hero?.addEventListener('mouseleave', () => {
    keyBoard.style.transform = 'rotateX(0deg) rotateY(0deg)';
  });
}
