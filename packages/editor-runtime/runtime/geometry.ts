/** Slide coordinate space: normalising, clamping, and classifying elements. */
export const geometryChunk = `  function getSlideCoordinateElement(slide) {
    return slide.closest('.reveal .slides') || slide;
  }

  function getSlideCoordinateRect(slide) {
    return getSlideCoordinateElement(slide).getBoundingClientRect();
  }

  function getSlideLogicalWidth(slide) {
    var coordinateElement = getSlideCoordinateElement(slide);
    return coordinateElement.offsetWidth || getSlideCoordinateRect(slide).width;
  }

  function getSlideLogicalHeight(slide) {
    var coordinateElement = getSlideCoordinateElement(slide);
    return coordinateElement.offsetHeight || getSlideCoordinateRect(slide).height;
  }

  function canEditInspectorGeometry(element, slide) {
    var context = readPositionContext(element, slide);

    return (
      context.containingBlock === slide &&
      Math.abs(getSlideLogicalWidth(slide) - C.SLIDE_REFERENCE_WIDTH) < 0.5 &&
      Math.abs(getSlideLogicalHeight(slide) - C.SLIDE_REFERENCE_HEIGHT) < 0.5
    );
  }

  function normalizeRect(element, slide) {
    var slideRect = getSlideCoordinateRect(slide);
    var elementRect = element.getBoundingClientRect();

    if (!slideRect.width || !slideRect.height) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    return {
      x: (elementRect.left - slideRect.left) / slideRect.width,
      y: (elementRect.top - slideRect.top) / slideRect.height,
      width: elementRect.width / slideRect.width,
      height: elementRect.height / slideRect.height,
    };
  }

  function normalizeSlideBounds(slide) {
    var viewport = document.documentElement.getBoundingClientRect();
    var slideRect = getSlideCoordinateRect(slide);

    if (!viewport.width || !viewport.height || !slideRect.width || !slideRect.height) {
      return { x: 0, y: 0, width: 1, height: 1 };
    }

    return {
      x: (slideRect.left - viewport.left) / viewport.width,
      y: (slideRect.top - viewport.top) / viewport.height,
      width: slideRect.width / viewport.width,
      height: slideRect.height / viewport.height,
    };
  }

  function readZIndex(element) {
    var value = window.getComputedStyle(element).zIndex;
    var parsed = Number.parseInt(value, 10);

    return Number.isFinite(parsed) ? parsed : null;
  }

  function clampUnit(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(1, value));
  }

  function clampRect(rect) {
    var width = Math.max(C.MIN_BOX_SIZE, clampUnit(rect.width));
    var height = Math.max(C.MIN_BOX_SIZE, clampUnit(rect.height));
    var x = clampUnit(rect.x);
    var y = clampUnit(rect.y);

    return {
      x: Math.min(x, Math.max(0, 1 - width)),
      y: Math.min(y, Math.max(0, 1 - height)),
      width: width,
      height: height,
    };
  }

  function pointerToNormalized(clientX, clientY, slide) {
    var slideRect = getSlideCoordinateRect(slide);

    if (!slideRect.width || !slideRect.height) {
      return { x: 0, y: 0 };
    }

    return {
      x: clampUnit((clientX - slideRect.left) / slideRect.width),
      y: clampUnit((clientY - slideRect.top) / slideRect.height),
    };
  }

  function isTextBox(element) {
    if (!element) {
      return false;
    }

    return (
      element.getAttribute(C.EDITABLE_ATTR) === C.TEXT_BOX_EDITABLE ||
      element.classList.contains(C.TEXT_BOX_CLASS)
    );
  }

  function isImageElement(element) {
    if (!element) {
      return false;
    }

    var tag = element.tagName.toLowerCase();

    return (
      tag === 'img' ||
      tag === 'svg' ||
      tag === 'picture' ||
      element.getAttribute(C.EDITABLE_ATTR) === 'image'
    );
  }

  function getImageAspectRatio(element) {
    var stored = element.getAttribute('data-ark-aspect-ratio');
    var parsed = stored ? Number.parseFloat(stored) : NaN;

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    if (element.naturalWidth && element.naturalHeight) {
      return element.naturalWidth / element.naturalHeight;
    }

    var bounds = element.getBoundingClientRect();

    if (bounds.width > 0 && bounds.height > 0) {
      return bounds.width / bounds.height;
    }

    return 1;
  }

  function applyImageAspectRatio(rect, aspectRatio, slide, start) {
    var slideRect = getSlideCoordinateRect(slide);

    if (!slideRect.width || !slideRect.height || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
      return rect;
    }

    var slideAspect = slideRect.width / slideRect.height;
    var widthDelta = Math.abs(rect.width - start.width);
    var heightDelta = Math.abs(rect.height - start.height);

    if (heightDelta > widthDelta) {
      rect.width = rect.height * aspectRatio / slideAspect;
    } else {
      rect.height = rect.width * slideAspect / aspectRatio;
    }

    return clampRect(rect);
  }

  function isManagedElement(element) {
    if (!element) {
      return false;
    }

    if (element.getAttribute(C.MANAGED_ATTR) === 'true' || isTextBox(element)) {
      return true;
    }

    var style = window.getComputedStyle(element);
    return style.position === 'absolute' && style.left !== 'auto' && style.top !== 'auto';
  }

  function getTextEditTarget(element) {
    if (!element) {
      return null;
    }

    if (isTextBox(element)) {
      var child = element.querySelector('p, h1, h2, h3, h4, h5, h6, span, li, blockquote, figcaption');

      return child || element;
    }

    return element;
  }

  function isTextEditableElement(element) {
    var target = getTextEditTarget(element);
    var tag = target ? target.tagName.toLowerCase() : '';

    return Boolean(target && (isTextEditableTag(tag) || isTextBox(element)));
  }
`
