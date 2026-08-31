/**
 * Geometry and visibility for the in-page walk.
 *
 * Everything is measured against the slide's own box, so a deck that centres
 * with flex, grid, or absolute positioning all land the same way: the walk reads
 * the rendered result and never re-implements CSS layout.
 */
export const geometryChunk = String.raw`
  function slideCoordinateElement(slide) {
    return (slide.closest && slide.closest('.reveal .slides')) || slide;
  }

  function slideBox(slide) {
    return slideCoordinateElement(slide).getBoundingClientRect();
  }

  function readRotation(style) {
    var transform = style.transform;
    if (!transform || transform === 'none') return 0;
    if (typeof DOMMatrix === 'undefined') return 0;

    try {
      var matrix = new DOMMatrix(transform);
      var degrees = (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI;
      if (!isFinite(degrees) || Math.abs(degrees) < 0.01) return 0;
      return Math.round(degrees * 100) / 100;
    } catch (error) {
      return 0;
    }
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  /**
   * The element's box in slide coordinates.
   *
   * getBoundingClientRect reports the axis-aligned bounds, which for a rotated
   * element is larger than the element itself. When there is a rotation, recover
   * the unrotated box from the layout size around the same centre - that is the
   * box PowerPoint wants, with the angle applied separately.
   */
  function readRect(element, slide, style) {
    var origin = slideBox(slide);
    var box = element.getBoundingClientRect();
    var rotation = readRotation(style);

    if (!rotation) {
      return {
        x: round(box.left - origin.left),
        y: round(box.top - origin.top),
        width: round(box.width),
        height: round(box.height),
      };
    }

    var width = element.offsetWidth || box.width;
    var height = element.offsetHeight || box.height;
    var centerX = box.left + box.width / 2 - origin.left;
    var centerY = box.top + box.height / 2 - origin.top;

    return {
      x: round(centerX - width / 2),
      y: round(centerY - height / 2),
      width: round(width),
      height: round(height),
      rotation: rotation,
    };
  }

  function hasArea(rect) {
    return rect.width > 0.5 && rect.height > 0.5;
  }

  /** Entirely outside the slide frame; clipped away and not worth exporting. */
  function isOffSlide(rect) {
    return (
      rect.x + rect.width <= 0 ||
      rect.y + rect.height <= 0 ||
      rect.x >= FRAME_WIDTH ||
      rect.y >= FRAME_HEIGHT
    );
  }

  var SKIPPED_TAGS = {
    script: true,
    style: true,
    template: true,
    link: true,
    meta: true,
    title: true,
    noscript: true,
    head: true,
  };

  function isSkippedTag(element) {
    return SKIPPED_TAGS[element.tagName.toLowerCase()] === true;
  }

  function isHidden(element, style) {
    if (style.display === 'none' || style.visibility === 'hidden') return true;
    if (style.visibility === 'collapse') return true;
    var opacity = parseFloat(style.opacity);
    if (isFinite(opacity) && opacity <= 0.01) return true;
    if (element.hasAttribute && element.hasAttribute('hidden')) return true;
    return false;
  }

  function readInset(style) {
    return {
      top: round(px(style.paddingTop) + px(style.borderTopWidth)),
      right: round(px(style.paddingRight) + px(style.borderRightWidth)),
      bottom: round(px(style.paddingBottom) + px(style.borderBottomWidth)),
      left: round(px(style.paddingLeft) + px(style.borderLeftWidth)),
    };
  }

  function radiusValue(raw, basis) {
    var value = String(raw || '').trim().split(/\s+/)[0];
    if (!value) return 0;
    if (value.indexOf('%') >= 0) {
      var percent = parseFloat(value);
      return isFinite(percent) ? (percent / 100) * basis : 0;
    }
    return px(value);
  }

  /**
   * Corner radius in px. Computed longhands keep a percentage as written, so it
   * is resolved here against the shorter side - the same basis CSS uses.
   */
  function readRadius(style, rect) {
    var basis = Math.min(rect.width, rect.height);
    var radii = [
      radiusValue(style.borderTopLeftRadius, basis),
      radiusValue(style.borderTopRightRadius, basis),
      radiusValue(style.borderBottomRightRadius, basis),
      radiusValue(style.borderBottomLeftRadius, basis),
    ];
    var largest = Math.max.apply(null, radii);
    return largest > 0 ? largest : radiusValue(style.borderRadius, basis);
  }

  function pseudoPaints(element, selector) {
    var style;
    try {
      style = window.getComputedStyle(element, selector);
    } catch (error) {
      return false;
    }
    if (!style) return false;

    var content = style.content;
    if (!content || content === 'none' || content === 'normal') return false;
    // Real generated text always paints.
    if (content !== '""' && content !== "''") return true;

    // An empty pseudo still paints when it has a box with a fill or a border.
    if (px(style.width) <= 0 || px(style.height) <= 0) return false;
    var background = normalizeColor(style.backgroundColor);
    if (background && background.alpha > 0) return true;
    if (style.backgroundImage && style.backgroundImage !== 'none') return true;
    return px(style.borderTopWidth) > 0;
  }

  /**
   * The CSS feature that stops this element from being rebuilt natively, or null.
   * These have no OOXML equivalent, so the element flattens to a picture and the
   * walk does not descend into it.
   */
  function unsupportedReason(element, style) {
    if (style.backdropFilter && style.backdropFilter !== 'none') return 'backdrop-filter';
    if (style.webkitBackdropFilter && style.webkitBackdropFilter !== 'none') {
      return 'backdrop-filter';
    }
    if (style.filter && style.filter !== 'none') return 'filter';
    if (style.mixBlendMode && style.mixBlendMode !== 'normal') return 'mix-blend-mode';
    if (style.clipPath && style.clipPath !== 'none') return 'clip-path';
    if (style.maskImage && style.maskImage !== 'none') return 'mask-image';
    if (style.webkitMaskImage && style.webkitMaskImage !== 'none') return 'mask-image';

    var image = style.backgroundImage;
    if (image && image !== 'none') {
      var layers = splitTopLevel(image);
      if (layers.length > 1) return 'layered background';
      if (layers[0].indexOf('url(') !== 0 && !parseLinearGradient(layers[0])) {
        return 'background-image';
      }
    }

    if (pseudoPaints(element, '::before') || pseudoPaints(element, '::after')) {
      return 'generated content';
    }

    return null;
  }
`
