/** Adopting unmanaged content into absolute layout without reflowing the slide. */
export const adoptChunk = `  function setSlideRelativePosition(element, slide, geometry, positionContext, cache) {
    var slideRect = (cache && cache.slideRect) || getSlideCoordinateRect(slide);
    var context = positionContext || readPositionContext(element, slide);
    var containingBlock = context.containingBlock;
    var blockRect = (cache && cache.blockRect) || containingBlock.getBoundingClientRect();
    var scaleX = context.scaleX;
    var scaleY = context.scaleY;
    var marginLeft = cache && cache.marginLeft != null
      ? cache.marginLeft
      : Number.parseFloat(window.getComputedStyle(element).marginLeft) || 0;
    var marginTop = cache && cache.marginTop != null
      ? cache.marginTop
      : Number.parseFloat(window.getComputedStyle(element).marginTop) || 0;
    var targetLeft = slideRect.left + geometry.x * slideRect.width;
    var targetTop = slideRect.top + geometry.y * slideRect.height;
    var left = (targetLeft - blockRect.left) / scaleX - (containingBlock.clientLeft || 0) +
      (containingBlock.scrollLeft || 0) - marginLeft;
    var top = (targetTop - blockRect.top) / scaleY - (containingBlock.clientTop || 0) +
      (containingBlock.scrollTop || 0) - marginTop;
    var logicalSlideWidth = (cache && cache.logicalSlideWidth) || getSlideLogicalWidth(slide);
    var logicalSlideHeight = (cache && cache.logicalSlideHeight) || getSlideLogicalHeight(slide);

    element.style.left = left + 'px';
    element.style.top = top + 'px';
    return {
      x: left / logicalSlideWidth,
      y: top / logicalSlideHeight,
    };
  }

  function settleSlideRelativePosition(element, slide, geometry, positionContext, cache) {
    var position = setSlideRelativePosition(element, slide, geometry, positionContext, cache);
    var reveal = window.Reveal;

    if (
      getSlideCoordinateElement(slide) === slide ||
      !reveal ||
      typeof reveal.layout !== 'function'
    ) {
      return position;
    }

    // Reveal centers each section from its scrollHeight. Absolute children can
    // change that height, so converge the local CSS offset before persisting.
    // Only runs on commit/nudge finish — not during transform-preview frames.
    for (var i = 0; i < 6; i++) {
      reveal.layout();
      position = setSlideRelativePosition(element, slide, geometry, positionContext);
    }

    return position;
  }

  function refreshPositionCache(cache, element, slide, positionContext) {
    if (!cache) {
      return;
    }

    cache.marginLeft = 0;
    cache.marginTop = 0;
    cache.blockRect = positionContext.containingBlock.getBoundingClientRect();
    cache.slideRect = getSlideCoordinateRect(slide);
    cache.slideBounds = normalizeSlideBounds(slide);
  }

  function measureAdoptSpacer(element, slide) {
    var computed = window.getComputedStyle(element);
    var display = computed.display || 'block';

    if (display === 'inline') {
      display = 'inline-block';
    }

    var width = readLogicalWidth(element, slide);
    var height = readLogicalHeight(element, slide);

    if (!width || !height) {
      return null;
    }

    return {
      width: width,
      height: height,
      marginTop: Math.max(0, Number.parseFloat(computed.marginTop) || 0),
      marginRight: Math.max(0, Number.parseFloat(computed.marginRight) || 0),
      marginBottom: Math.max(0, Number.parseFloat(computed.marginBottom) || 0),
      marginLeft: Math.max(0, Number.parseFloat(computed.marginLeft) || 0),
      display: display,
    };
  }

  function removeAdoptSpacer(cache) {
    if (!cache || !cache.spacerElement) {
      return;
    }

    var spacer = cache.spacerElement;

    if (spacer.parentNode) {
      spacer.parentNode.removeChild(spacer);
    }

    cache.spacerElement = null;
  }

  function cleanupAdoptSideEffects(element, cache) {
    removeAdoptSpacer(cache);

    if (
      element &&
      cache &&
      cache.stampedTransientId &&
      element.getAttribute(C.ELEMENT_ID_ATTR) === cache.stampedTransientId
    ) {
      element.removeAttribute(C.ELEMENT_ID_ATTR);
      cache.stampedTransientId = null;
    }
  }

  function ensureElementIdBeforeAdopt(element, slide, cache) {
    // Path-based transient ids shift when the spacer is inserted as a previous
    // sibling. Stamp the pre-adopt id so selection/commit stay aligned with the
    // server's pre-spacer HTML. Cancel clears this stamp if we created it.
    var existing = element.getAttribute(C.ELEMENT_ID_ATTR);

    if (existing && existing.trim()) {
      return existing.trim();
    }

    var stamped = resolveElementId(element, slide, currentSlideIndex);
    element.setAttribute(C.ELEMENT_ID_ATTR, stamped);

    if (cache) {
      cache.stampedTransientId = stamped;
    }

    return stamped;
  }

  function insertAdoptSpacer(element, slide, cache) {
    if (!cache) {
      return;
    }

    if (cache.spacerElement && cache.spacerElement.isConnected) {
      return;
    }

    var previous = element.previousElementSibling;

    if (
      previous &&
      previous.getAttribute &&
      previous.getAttribute(C.SPACER_ATTR) === 'true'
    ) {
      cache.spacerElement = previous;
      if (!cache.spacerFootprint) {
        cache.spacerFootprint = {
          width: Number.parseFloat(previous.style.width) || 0,
          height: Number.parseFloat(previous.style.height) || 0,
          marginTop: Number.parseFloat(previous.style.marginTop) || 0,
          marginRight: Number.parseFloat(previous.style.marginRight) || 0,
          marginBottom: Number.parseFloat(previous.style.marginBottom) || 0,
          marginLeft: Number.parseFloat(previous.style.marginLeft) || 0,
          display: previous.style.display || 'block',
        };
      }
      return;
    }

    var footprint = cache.spacerFootprint || measureAdoptSpacer(element, slide);

    if (!footprint || !element.parentNode) {
      return;
    }

    var forId = ensureElementIdBeforeAdopt(element, slide, cache);
    cache.spacerFootprint = footprint;
    var spacer = document.createElement('div');
    spacer.setAttribute(C.SPACER_ATTR, 'true');
    spacer.setAttribute('aria-hidden', 'true');

    if (forId) {
      spacer.setAttribute(C.SPACER_FOR_ATTR, forId);
    }

    spacer.style.visibility = 'hidden';
    spacer.style.pointerEvents = 'none';
    spacer.style.flex = '0 0 auto';
    spacer.style.display = footprint.display;
    spacer.style.boxSizing = 'border-box';
    spacer.style.width = footprint.width + 'px';
    spacer.style.height = footprint.height + 'px';
    spacer.style.margin =
      footprint.marginTop +
      'px ' +
      footprint.marginRight +
      'px ' +
      footprint.marginBottom +
      'px ' +
      footprint.marginLeft +
      'px';
    element.parentNode.insertBefore(spacer, element);
    cache.spacerElement = spacer;
  }

  function adoptMove(element, slide, geometry, logicalWidth, positionContext, cache) {
    // Preserve the in-flow footprint so siblings (and Reveal scrollHeight) do
    // not collapse when this element leaves normal flow.
    insertAdoptSpacer(element, slide, cache);
    element.style.position = 'absolute';
    element.style.margin = '0px';
    element.style.boxSizing = 'border-box';
    element.style.width = (logicalWidth || (cache && cache.logicalWidth) || readLogicalWidth(element, slide)) + 'px';
    // Adoption zeroes margins and can shift containing-block geometry.
    refreshPositionCache(cache, element, slide, positionContext);
    setSlideRelativePosition(element, slide, geometry, positionContext, cache);
  }

  function prepareMove(element, slide, activate) {
    var geometry = normalizeRect(element, slide);
    var snapshot = snapshotInlineStyle(element);
    var computed = window.getComputedStyle(element);
    var adopted = computed.position !== 'absolute';
    var logicalWidth = readLogicalWidth(element, slide);
    var positionContext = readPositionContext(element, slide);
    var authoredTransform = computed.transform && computed.transform !== 'none';
    var cache = {
      startGeometry: geometry,
      slideRect: getSlideCoordinateRect(slide),
      slideBounds: normalizeSlideBounds(slide),
      blockRect: positionContext.containingBlock.getBoundingClientRect(),
      logicalSlideWidth: getSlideLogicalWidth(slide),
      logicalSlideHeight: getSlideLogicalHeight(slide),
      logicalWidth: logicalWidth,
      zIndex: readZIndex(element),
      marginLeft: Number.parseFloat(computed.marginLeft) || 0,
      marginTop: Number.parseFloat(computed.marginTop) || 0,
      authoredTransform: authoredTransform,
      // Compose live translate() with any inline authored transform so moves
      // stay on the compositor even for translate(-50%, -50%) elements.
      liveTransformBase: element.style.transform || '',
    };

    // Resize still needs absolute layout for edge math; moves stay in-flow and
    // use transform previews until commit so siblings do not reflow mid-drag.
    if (adopted && activate === true) {
      adoptMove(element, slide, geometry, logicalWidth, positionContext, cache);
    }

    return {
      geometry: geometry,
      snapshot: snapshot,
      adopted: adopted,
      logicalWidth: logicalWidth,
      positionContext: positionContext,
      cache: cache,
    };
  }
`
