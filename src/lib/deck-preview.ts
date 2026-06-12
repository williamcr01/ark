import { SLIDE_SELECTOR_CHAIN } from '@/lib/deck-slides'

export const PREVIEW_FRAME_WIDTH = 1600
export const PREVIEW_FRAME_HEIGHT = 900
export const PREVIEW_FRAME_ASPECT_RATIO = `${PREVIEW_FRAME_WIDTH} / ${PREVIEW_FRAME_HEIGHT}`

export const DECK_GOTO_MESSAGE_TYPE = 'ark:deck-goto' as const
export const DECK_SLIDE_CHANGE_MESSAGE_TYPE = 'ark:deck-slide-change' as const

const previewFillStyle = `
<style data-ark-preview-fill>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  [data-ark-hidden] {
    display: none !important;
  }

</style>`

const previewNavScript = `
<script data-ark-preview-nav>
(function () {
  var GOTO = ${JSON.stringify(DECK_GOTO_MESSAGE_TYPE)};
  var CHANGE = ${JSON.stringify(DECK_SLIDE_CHANGE_MESSAGE_TYPE)};
  var SELECTORS = ${JSON.stringify([...SLIDE_SELECTOR_CHAIN])};
  var NAV_KEYS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 };

  var slides = [];
  var currentIndex = 0;

  function findSlides() {
    for (var i = 0; i < SELECTORS.length; i++) {
      var found = document.querySelectorAll(SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }

  function showSlide(index) {
    slides = findSlides();

    if (!slides.length) {
      return;
    }

    var nextIndex = Math.max(0, Math.min(slides.length - 1, index));
    currentIndex = nextIndex;

    for (var i = 0; i < slides.length; i++) {
      var slide = slides[i];
      var isActive = i === nextIndex;

      if (isActive) {
        slide.removeAttribute('data-ark-hidden');
        slide.setAttribute('data-ark-active', '');
        slide.classList.add('active', 'is-active');
        slide.setAttribute('aria-hidden', 'false');
        slide.setAttribute('data-active', '');
        slide.style.removeProperty('display');

        if (window.getComputedStyle(slide).display === 'none') {
          slide.style.setProperty('display', 'flex', 'important');
        }
      } else {
        slide.removeAttribute('data-ark-active');
        slide.setAttribute('data-ark-hidden', '');
        slide.classList.remove('active', 'is-active');
        slide.setAttribute('aria-hidden', 'true');
        slide.removeAttribute('data-active');
        slide.style.removeProperty('display');
      }
    }

    if (window.parent !== window) {
      window.parent.postMessage({ type: CHANGE, index: nextIndex }, '*');
    }
  }

  function handleNavKey(event) {
    var delta = NAV_KEYS[event.key];

    if (!delta) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    showSlide(currentIndex + delta);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    var data = event.data;

    if (data && data.type === GOTO && typeof data.index === 'number') {
      showSlide(data.index);
    }
  });

  document.addEventListener('keydown', handleNavKey, true);
  window.addEventListener('keydown', handleNavKey, true);

  function init() {
    showSlide(0);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
</script>`

export function getPreviewHtml(html: string) {
  if (!html) {
    return ''
  }

  let previewHtml = html

  if (/<\/head>/i.test(previewHtml)) {
    previewHtml = previewHtml.replace(/<\/head>/i, `${previewFillStyle}\n</head>`)
  } else {
    previewHtml = `${previewFillStyle}\n${previewHtml}`
  }

  if (/<\/body>/i.test(previewHtml)) {
    return previewHtml.replace(/<\/body>/i, `${previewNavScript}\n</body>`)
  }

  return `${previewHtml}\n${previewNavScript}`
}
