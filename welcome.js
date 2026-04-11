/**
 * @param {{
 *   trackId: string;
 *   viewportId: string;
 *   titleId: string;
 *   descId: string;
 *   stepPillId: string | null;
 *   prevId: string;
 *   nextId: string;
 *   dotsId: string;
 *   stepPillPrefix: string;
 *   dotAriaLabel: (index: number) => string;
 *   dotsGroupAriaLabel?: string;
 * }} cfg
 */
function initCarousel(cfg) {
  const track = document.getElementById(cfg.trackId);
  const viewport = document.getElementById(cfg.viewportId);
  const titleEl = document.getElementById(cfg.titleId);
  const descEl = document.getElementById(cfg.descId);
  const stepPill = cfg.stepPillId ? document.getElementById(cfg.stepPillId) : null;
  const prevBtn = document.getElementById(cfg.prevId);
  const nextBtn = document.getElementById(cfg.nextId);
  const dotsRoot = document.getElementById(cfg.dotsId);
  if (!track || !viewport || !titleEl || !descEl || !prevBtn || !nextBtn || !dotsRoot) return;

  const slides = track.querySelectorAll('.carousel-slide');
  const n = slides.length;
  if (n === 0) return;

  let index = 0;
  let touchStartX = null;

  function setSlide(i) {
    index = ((i % n) + n) % n;
    track.style.transform = `translateX(-${index * 100}%)`;
    const slide = slides[index];
    titleEl.textContent = slide.dataset.title || '';
    descEl.textContent = slide.dataset.desc || '';
    if (stepPill) {
      stepPill.textContent = `${cfg.stepPillPrefix} ${index + 1} of ${n}`;
    }
    dotsRoot.querySelectorAll('button').forEach((dot, j) => {
      dot.setAttribute('aria-selected', j === index ? 'true' : 'false');
    });
  }

  dotsRoot.setAttribute('role', 'group');
  dotsRoot.setAttribute('aria-label', cfg.dotsGroupAriaLabel || 'Choose slide');

  for (let j = 0; j < n; j++) {
    const dot = document.createElement('button');
    dot.type = 'button';
    dot.setAttribute('aria-label', cfg.dotAriaLabel(j));
    dot.addEventListener('click', () => setSlide(j));
    dotsRoot.appendChild(dot);
  }

  prevBtn.addEventListener('click', () => setSlide(index - 1));
  nextBtn.addEventListener('click', () => setSlide(index + 1));

  viewport.addEventListener(
    'touchstart',
    (e) => {
      touchStartX = e.changedTouches[0].screenX;
    },
    { passive: true }
  );
  viewport.addEventListener(
    'touchend',
    (e) => {
      if (touchStartX == null) return;
      const dx = e.changedTouches[0].screenX - touchStartX;
      touchStartX = null;
      if (dx > 48) setSlide(index - 1);
      else if (dx < -48) setSlide(index + 1);
    },
    { passive: true }
  );

  setSlide(0);
}

document.getElementById('open-extensions-page')?.addEventListener('click', () => {
  const id = chrome.runtime.id;
  chrome.tabs.create({ url: `chrome://extensions/?id=${encodeURIComponent(id)}` }, () => {
    if (chrome.runtime.lastError) {
      console.warn(chrome.runtime.lastError.message);
    }
  });
});

async function openExtensionPanel() {
  try {
    await chrome.action.openPopup();
  } catch (e) {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 500,
      height: 720,
      focused: true,
    });
  }
}

document.querySelectorAll('.js-open-extension').forEach((btn) => {
  btn.addEventListener('click', () => {
    openExtensionPanel();
  });
});

initCarousel({
  trackId: 'pin-carousel-track',
  viewportId: 'pin-carousel-viewport',
  titleId: 'pin-carousel-title',
  descId: 'pin-carousel-desc',
  stepPillId: 'pin-carousel-step',
  prevId: 'pin-carousel-prev',
  nextId: 'pin-carousel-next',
  dotsId: 'pin-carousel-dots',
  stepPillPrefix: 'Way',
  dotAriaLabel: (j) => `Way ${j + 1}`,
  dotsGroupAriaLabel: 'Choose pin method',
});

initCarousel({
  trackId: 'carousel-track',
  viewportId: 'carousel-viewport',
  titleId: 'carousel-title',
  descId: 'carousel-desc',
  stepPillId: 'carousel-step',
  prevId: 'carousel-prev',
  nextId: 'carousel-next',
  dotsId: 'carousel-dots',
  stepPillPrefix: 'Step',
  dotAriaLabel: (j) => `Slide ${j + 1}`,
  dotsGroupAriaLabel: 'Choose usage step',
});
