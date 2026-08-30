/** Finding slides and elements, and describing a selection to the shell. */
export const selectionChunk = `  function findSlides() {
    var revealSlides = document.querySelector('.reveal .slides');

    if (revealSlides) {
      var flattened = [];
      var horizontal = Array.prototype.filter.call(revealSlides.children, function (element) {
        return element.tagName && element.tagName.toLowerCase() === 'section';
      });

      horizontal.forEach(function (section) {
        var vertical = Array.prototype.filter.call(section.children, function (element) {
          return element.tagName && element.tagName.toLowerCase() === 'section';
        });
        Array.prototype.push.apply(flattened, vertical.length ? vertical : [section]);
      });

      if (flattened.length) {
        return flattened;
      }
    }

    for (var i = 0; i < C.SELECTORS.length; i++) {
      var found = document.querySelectorAll(C.SELECTORS[i]);

      if (found.length) {
        return Array.prototype.slice.call(found);
      }
    }

    return [];
  }

  function getActiveSlide() {
    var slides = findSlides();

    return slides[clampIndex(currentSlideIndex, slides.length)] || null;
  }

  function getElementPath(element, slide) {
    var path = [];
    var current = element;

    while (current && current !== slide) {
      var parent = current.parentElement;

      if (!parent) {
        break;
      }

      var index = Array.prototype.indexOf.call(parent.children, current);
      path.unshift(index);
      current = parent;
    }

    return path.join('.');
  }

  function resolveElementId(element, slide, slideIndex) {
    var nativeId = element.getAttribute(C.ELEMENT_ID_ATTR);

    if (nativeId && nativeId.trim()) {
      return nativeId.trim();
    }

    return C.TRANSIENT_PREFIX + slideIndex + '-' + getElementPath(element, slide);
  }

  function isUnsafeTag(tag) {
    return (
      tag === 'script' ||
      tag === 'style' ||
      tag === 'iframe' ||
      tag === 'form' ||
      tag === 'input' ||
      tag === 'textarea' ||
      tag === 'select'
    );
  }

  function isEditableCandidate(element, slide) {
    if (!element || element === slide || !slide.contains(element)) {
      return false;
    }

    var tag = element.tagName.toLowerCase();

    if (isUnsafeTag(tag)) {
      return false;
    }

    if (tag === 'aside' && element.classList.contains('notes')) {
      return false;
    }

    if (
      element.closest(
        '[data-ark-editor-handle], [data-ark-editor-marquee], [data-ark-editor-guide], [' +
          C.SPACER_ATTR +
          ']',
      )
    ) {
      return false;
    }

    var bounds = element.getBoundingClientRect();

    if (!bounds.width || !bounds.height) {
      return false;
    }

    if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
      return true;
    }

    if (element.hasAttribute(C.ELEMENT_ID_ATTR)) {
      return true;
    }

    if (
      element.getAttribute(C.EDITABLE_ATTR) === C.TEXT_BOX_EDITABLE ||
      element.classList.contains(C.TEXT_BOX_CLASS)
    ) {
      return true;
    }

    return (
      tag === 'h1' ||
      tag === 'h2' ||
      tag === 'h3' ||
      tag === 'h4' ||
      tag === 'h5' ||
      tag === 'h6' ||
      tag === 'p' ||
      tag === 'li' ||
      tag === 'button' ||
      tag === 'figcaption' ||
      tag === 'span' ||
      tag === 'img' ||
      tag === 'svg' ||
      tag === 'div' ||
      tag === 'section' ||
      tag === 'ul' ||
      tag === 'ol' ||
      tag === 'table' ||
      tag === 'blockquote' ||
      tag === 'pre' ||
      tag === 'figure' ||
      tag === 'a' ||
      tag === 'hr'
    );
  }

  function findManagedAncestor(element, slide) {
    var current = element;

    while (current && current !== slide) {
      if (current.nodeType === 1 && isManagedElement(current) && isEditableCandidate(current, slide)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function findEditableTarget(node, slide) {
    var current = node;

    while (current && current !== slide) {
      if (current.nodeType === 1 && isEditableCandidate(current, slide)) {
        var managedAncestor = findManagedAncestor(current, slide);

        // First click selects a managed group; later clicks stay drilled into it
        // (or deepen) while selection remains inside the group. Text boxes stay
        // one object because their child stores the editable text.
        var drilled =
          managedAncestor === selectedElement ||
          (selectedElement && managedAncestor && managedAncestor.contains(selectedElement));

        return managedAncestor && (isTextBox(managedAncestor) || !drilled)
          ? managedAncestor
          : current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function readTextPreview(element) {
    var text = (element.textContent || '').replace(/\\s+/g, ' ').trim();

    if (!text && element.getAttribute('alt')) {
      text = element.getAttribute('alt') || '';
    }

    return text || null;
  }

  function isTextEditableTag(tag) {
    return C.INLINE_TEXT_TAGS.indexOf(tag) !== -1;
  }

  function postTextEditState(active, elementId, slideIndex) {
    if (active) {
      postToParent({
        type: C.TEXT_EDIT_STATE,
        active: true,
        elementId: elementId,
        slideIndex: slideIndex,
      });
      return;
    }

    postToParent({ type: C.TEXT_EDIT_STATE, active: false });
  }

  function readImageFit(element) {
    if (!isImageElement(element)) {
      return null;
    }

    var stored = element.getAttribute('data-ark-fit');

    if (stored === 'contain' || stored === 'cover' || stored === 'fill') {
      return stored;
    }

    var computed = window.getComputedStyle(element).objectFit;

    if (computed === 'cover' || computed === 'fill') {
      return computed;
    }

    return 'contain';
  }

  function readTextStyle(element) {
    if (isImageElement(element)) {
      return null;
    }

    var target = getTextEditTarget(element) || element;
    var computed = window.getComputedStyle(target);
    var fontSize = Number.parseFloat(computed.fontSize);
    var lineHeight = Number.parseFloat(computed.lineHeight);

    if (!Number.isFinite(fontSize)) {
      return null;
    }

    return {
      fontSize: fontSize,
      fontWeight: String(computed.fontWeight || '400'),
      color: String(computed.color || ''),
      textAlign: String(computed.textAlign || ''),
      lineHeight: Number.isFinite(lineHeight) ? lineHeight : null,
    };
  }

  function readImageNaturalSize(element) {
    if (
      element.tagName.toLowerCase() === 'img' &&
      element.naturalWidth > 0 &&
      element.naturalHeight > 0
    ) {
      return { width: element.naturalWidth, height: element.naturalHeight };
    }

    return null;
  }

  function buildSelection(element, slide, slideIndex) {
    return {
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      slideId: slide.getAttribute('data-ark-slide-id') || null,
      tagName: element.tagName.toLowerCase(),
      locked: element.getAttribute(C.LOCKED_ATTR) === 'true',
      managed: isManagedElement(element),
      editableKind: element.getAttribute(C.EDITABLE_ATTR) || null,
      textPreview: readTextPreview(element),
      imageFit: readImageFit(element),
      surface: detectSurface(element, slide),
      geometryEditable: canEditInspectorGeometry(element, slide),
      role: element.getAttribute(C.ROLE_ATTR) || null,
      textStyle: readTextStyle(element),
      imageNaturalSize: readImageNaturalSize(element),
    };
  }
`
