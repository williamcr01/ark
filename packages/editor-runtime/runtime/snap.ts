/** Snapping a moving rect to its neighbours, and drawing the guides for it. */
export const snapChunk = `  function collectSnapRects(slide, excluded) {
    var excludedList = excluded && excluded.length !== undefined ? excluded : excluded ? [excluded] : [];
    var descendants = slide.querySelectorAll('*');
    var candidates = [];

    function isExcluded(candidate) {
      for (var i = 0; i < excludedList.length; i++) {
        var element = excludedList[i];

        if (
          candidate === element ||
          (element && element.contains && element.contains(candidate)) ||
          (element && candidate.contains && candidate.contains(element))
        ) {
          return true;
        }
      }

      return false;
    }

    for (var i = 0; i < descendants.length && candidates.length < 60; i++) {
      var candidate = descendants[i];

      if (!isExcluded(candidate) && isEditableCandidate(candidate, slide)) {
        candidates.push(candidate);
      }
    }

    // ponytail: measure at most 60 objects per gesture; spatial indexing can replace this if large decks need it.
    return candidates.map(function (candidate) { return normalizeRect(candidate, slide); });
  }

  function closestSnap(moving, targets, threshold) {
    var best = null;

    for (var i = 0; i < moving.length; i++) {
      for (var j = 0; j < targets.length; j++) {
        var difference = targets[j] - moving[i];

        if (Math.abs(difference) <= threshold && (!best || Math.abs(difference) < Math.abs(best.difference))) {
          best = { difference: difference, target: targets[j] };
        }
      }
    }

    return best;
  }

  function showGuide(slide, axis, position, cache) {
    var guide = ensureGuide(slide, axis);
    var slideWidth = (cache && cache.logicalSlideWidth) || getSlideLogicalWidth(slide);
    var slideHeight = (cache && cache.logicalSlideHeight) || getSlideLogicalHeight(slide);

    if (axis === 'x') {
      guide.style.left = position * slideWidth + 'px';
      guide.style.top = '0';
      guide.style.width = 1 / editorScale + 'px';
      guide.style.height = '100%';
    } else {
      guide.style.left = '0';
      guide.style.top = position * slideHeight + 'px';
      guide.style.width = '100%';
      guide.style.height = 1 / editorScale + 'px';
    }
  }

  function snapMoveRect(rect, snapRects, slide, disabled, constrainedAxis, cache) {
    // Pure geometry — guide DOM writes happen after the live transform preview
    // so we never force a layout read between snap-guide mutations and gBCR.
    var guides = [];

    if (disabled) {
      return { rect: clampRect(rect), guides: guides };
    }

    var slideRect = (cache && cache.slideRect) || getSlideCoordinateRect(slide);
    var xTargets = [0, 0.5, 1];
    var yTargets = [0, 0.5, 1];

    for (var i = 0; i < snapRects.length; i++) {
      xTargets.push(snapRects[i].x, snapRects[i].x + snapRects[i].width / 2, snapRects[i].x + snapRects[i].width);
      yTargets.push(snapRects[i].y, snapRects[i].y + snapRects[i].height / 2, snapRects[i].y + snapRects[i].height);
    }

    var xSnap = constrainedAxis === 'y' ? null : closestSnap(
      [rect.x, rect.x + rect.width / 2, rect.x + rect.width],
      xTargets,
      6 / editorScale / slideRect.width,
    );
    var ySnap = constrainedAxis === 'x' ? null : closestSnap(
      [rect.y, rect.y + rect.height / 2, rect.y + rect.height],
      yTargets,
      6 / editorScale / slideRect.height,
    );

    if (xSnap) {
      rect.x += xSnap.difference;
      guides.push({ axis: 'x', position: xSnap.target });
    }

    if (ySnap) {
      rect.y += ySnap.difference;
      guides.push({ axis: 'y', position: ySnap.target });
    }

    return { rect: clampRect(rect), guides: guides };
  }

  function applySnapGuides(slide, guides, cache) {
    clearGuides();

    for (var i = 0; i < guides.length; i++) {
      showGuide(slide, guides[i].axis, guides[i].position, cache);
    }
  }

  function ensureMarquee(slide) {
    if (marqueeElement) {
      return marqueeElement;
    }

    marqueeElement = document.createElement('div');
    marqueeElement.setAttribute('data-ark-editor-marquee', 'true');
    marqueeElement.style.position = 'absolute';
    marqueeElement.style.border = '1px dashed #2563eb';
    marqueeElement.style.background = 'rgba(37, 99, 235, 0.08)';
    marqueeElement.style.pointerEvents = 'none';
    marqueeElement.style.zIndex = '9999';
    getSlideCoordinateElement(slide).appendChild(marqueeElement);
    return marqueeElement;
  }

  function updateMarquee(startPoint, endPoint, slide) {
    var marquee = ensureMarquee(slide);
    var slideWidth = getSlideLogicalWidth(slide);
    var slideHeight = getSlideLogicalHeight(slide);
    var rect = clampRect({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    });

    marquee.style.left = rect.x * slideWidth + 'px';
    marquee.style.top = rect.y * slideHeight + 'px';
    marquee.style.width = rect.width * slideWidth + 'px';
    marquee.style.height = rect.height * slideHeight + 'px';

    return rect;
  }

  function finishTextBoxDraw(slide, startPoint, endPoint) {
    var rect = clampRect({
      x: Math.min(startPoint.x, endPoint.x),
      y: Math.min(startPoint.y, endPoint.y),
      width: Math.abs(endPoint.x - startPoint.x),
      height: Math.abs(endPoint.y - startPoint.y),
    });

    // clampRect floors both dimensions to MIN_BOX_SIZE, so a rect still at the
    // minimum on both axes means the pointer never dragged past the threshold:
    // treat it as a plain click and drop a default-sized box centered on the point.
    if (rect.width <= C.MIN_BOX_SIZE && rect.height <= C.MIN_BOX_SIZE) {
      rect = clampRect({
        x: endPoint.x - C.DEFAULT_BOX_WIDTH / 2,
        y: endPoint.y - C.DEFAULT_BOX_HEIGHT / 2,
        width: C.DEFAULT_BOX_WIDTH,
        height: C.DEFAULT_BOX_HEIGHT,
      });
    }

    postToParent({
      type: C.INSERT_REQUEST,
      kind: 'text-box',
      slideIndex: currentSlideIndex,
      geometry: rect,
    });
  }

  function pointerFromCache(clientX, clientY, cache, slide) {
    var slideRect = (cache && cache.slideRect) || getSlideCoordinateRect(slide);

    if (!slideRect.width || !slideRect.height) {
      return { x: 0, y: 0 };
    }

    return {
      x: (clientX - slideRect.left) / slideRect.width,
      y: (clientY - slideRect.top) / slideRect.height,
    };
  }
`
