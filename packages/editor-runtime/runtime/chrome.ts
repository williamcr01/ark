/** Selection chrome: marquee, resize handles, snap guides, hover cursor. */
export const chromeChunk = `  function clearMarquee() {
    if (marqueeElement && marqueeElement.parentElement) {
      marqueeElement.parentElement.removeChild(marqueeElement);
    }

    marqueeElement = null;
  }

  function clearResizeHandles() {
    for (var i = 0; i < resizeHandles.length; i++) {
      if (resizeHandles[i].parentElement) {
        resizeHandles[i].parentElement.removeChild(resizeHandles[i]);
      }
    }

    resizeHandles = [];
  }

  function clearGuides() {
    for (var i = 0; i < guideElements.length; i++) {
      // ensureGuide writes by axis index (x=0, y=1); a y-only snap leaves a hole at 0.
      if (!guideElements[i]) {
        continue;
      }

      guideElements[i].style.display = 'none';
    }
  }

  function destroyGuides() {
    for (var i = 0; i < guideElements.length; i++) {
      if (!guideElements[i]) {
        continue;
      }

      if (guideElements[i].parentElement) {
        guideElements[i].parentElement.removeChild(guideElements[i]);
      }
    }

    guideElements = [];
  }

  function ensureGuide(slide, axis) {
    var index = axis === 'x' ? 0 : 1;
    var guide = guideElements[index];

    if (!guide) {
      guide = document.createElement('div');
      guide.setAttribute('data-ark-editor-guide', 'true');
      guide.style.position = 'absolute';
      guide.style.pointerEvents = 'none';
      guide.style.background = '#ef4444';
      guide.style.zIndex = '10001';
      guideElements[index] = guide;
    }

    if (guide.parentElement !== getSlideCoordinateElement(slide)) {
      getSlideCoordinateElement(slide).appendChild(guide);
    }

    guide.style.display = 'block';
    return guide;
  }

  function clearHoverCursor() {
    if (hoveredElement) {
      hoveredElement.removeAttribute('data-ark-editor-movable');
    }

    hoveredElement = null;
  }

  function setHoverCursor(element) {
    if (hoveredElement === element) {
      return false;
    }

    clearHoverCursor();
    hoveredElement = element;

    if (hoveredElement && hoveredElement.getAttribute(C.LOCKED_ATTR) !== 'true') {
      hoveredElement.setAttribute('data-ark-editor-movable', 'true');
    }

    return true;
  }

  function ensureEditorStyle() {
    if (editorStyle && editorStyle.parentElement) {
      return;
    }

    editorStyle = document.createElement('style');
    editorStyle.setAttribute('data-ark-editor', 'true');
    editorStyle.textContent = '[data-ark-editor-movable="true"],[data-ark-editor-movable="true"] *{cursor:move!important}';
    (document.head || document.documentElement).appendChild(editorStyle);
  }

  function clearEditorOverlays() {
    clearMarquee();
    clearResizeHandles();
    destroyGuides();
  }

  function updateResizeHandles(element, slide, geometry, cache) {
    if (!element || !slide || element.getAttribute(C.LOCKED_ATTR) === 'true') {
      clearResizeHandles();
      return;
    }

    var rect = geometry || normalizeRect(element, slide);
    var overlayRoot = getSlideCoordinateElement(slide);
    var handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    var cursors = { nw: 'nwse-resize', n: 'ns-resize', ne: 'nesw-resize', e: 'ew-resize', se: 'nwse-resize', s: 'ns-resize', sw: 'nesw-resize', w: 'ew-resize' };
    var slideWidth = (cache && cache.logicalSlideWidth) || getSlideLogicalWidth(slide);
    var slideHeight = (cache && cache.logicalSlideHeight) || getSlideLogicalHeight(slide);

    if (resizeHandles.length !== handles.length || resizeHandles[0].parentElement !== overlayRoot) {
      clearResizeHandles();

      for (var i = 0; i < handles.length; i++) {
        var handle = document.createElement('div');
        var dot = document.createElement('div');
        handle.setAttribute('data-ark-editor-handle', handles[i]);
        handle.style.position = 'absolute';
        handle.style.zIndex = '10000';
        handle.style.pointerEvents = 'auto';
        handle.style.boxSizing = 'border-box';
        handle.style.cursor = cursors[handles[i]];
        dot.style.position = 'absolute';
        dot.style.left = '50%';
        dot.style.top = '50%';
        dot.style.transform = 'translate(-50%, -50%)';
        dot.style.background = '#ffffff';
        dot.style.border = 1 / editorScale + 'px solid #6b7280';
        dot.style.borderRadius = '50%';
        dot.style.boxShadow = '0 1px ' + 3 / editorScale + 'px rgba(0, 0, 0, 0.45)';
        dot.style.pointerEvents = 'none';
        handle.appendChild(dot);
        overlayRoot.appendChild(handle);
        resizeHandles.push(handle);
      }
    }

    for (var j = 0; j < resizeHandles.length; j++) {
      var hitSize = 18 / editorScale;
      var visualSize = 10 / editorScale;
      resizeHandles[j].style.width = hitSize + 'px';
      resizeHandles[j].style.height = hitSize + 'px';
      resizeHandles[j].firstChild.style.width = visualSize + 'px';
      resizeHandles[j].firstChild.style.height = visualSize + 'px';
      resizeHandles[j].firstChild.style.borderWidth = 1 / editorScale + 'px';
      positionResizeHandle(resizeHandles[j], handles[j], rect, slideWidth, slideHeight);
    }
  }

  function positionResizeHandle(handle, kind, rect, slideWidth, slideHeight) {
    var left = rect.x * slideWidth;
    var top = rect.y * slideHeight;
    var width = rect.width * slideWidth;
    var height = rect.height * slideHeight;
    var size = 18 / editorScale;

    if (kind.indexOf('n') !== -1) {
      handle.style.top = top - size / 2 + 'px';
    } else if (kind.indexOf('s') !== -1) {
      handle.style.top = top + height - size / 2 + 'px';
    } else {
      handle.style.top = top + height / 2 - size / 2 + 'px';
    }

    if (kind.indexOf('w') !== -1) {
      handle.style.left = left - size / 2 + 'px';
    } else if (kind.indexOf('e') !== -1) {
      handle.style.left = left + width - size / 2 + 'px';
    } else {
      handle.style.left = left + width / 2 - size / 2 + 'px';
    }
  }

  function refreshSelectionChrome(element, slide, slideIndex) {
    if (
      selectedElements.length !== 1 ||
      !element ||
      element.getAttribute(C.LOCKED_ATTR) === 'true'
    ) {
      clearResizeHandles();
    } else {
      updateResizeHandles(element, slide);
    }

    for (var i = 0; i < selectedElements.length; i++) {
      postGeometryForElement(selectedElements[i], slide, slideIndex);
    }

    if (!selectedElements.length && element) {
      postGeometryForElement(element, slide, slideIndex);
    }
  }

  function clearSelectionStyles() {
    for (var i = 0; i < selectedElements.length; i++) {
      selectedElements[i].removeAttribute('data-ark-editor-selected');
    }

    selectedElements = [];
    selectedElement = null;
  }

  function isSelectionMember(element) {
    return selectedElements.indexOf(element) !== -1;
  }

  function isSelectionUnsafe() {
    if (!selectedElements.length) {
      return false;
    }

    for (var i = 0; i < selectedElements.length; i++) {
      if (selectedElements[i].getAttribute(C.LOCKED_ATTR) === 'true') {
        return true;
      }

      for (var j = 0; j < selectedElements.length; j++) {
        if (i !== j && selectedElements[i].contains(selectedElements[j])) {
          return true;
        }
      }
    }

    return false;
  }

  function setSelectedElements(elements, primary, slide, slideIndex) {
    if (nudgeState && (!primary || nudgeState.element !== primary)) {
      finishNudge();
    }

    clearSelectionStyles();
    selectedElements = elements ? elements.slice() : [];
    selectedElement = primary || null;

    for (var i = 0; i < selectedElements.length; i++) {
      selectedElements[i].setAttribute(
        'data-ark-editor-selected',
        selectedElements[i] === selectedElement ? 'primary' : '',
      );
    }

    if (selectedElement && slide) {
      refreshSelectionChrome(selectedElement, slide, slideIndex);
    } else {
      clearEditorOverlays();
    }
  }

  function setSelectedElement(element, slide, slideIndex) {
    setSelectedElements(element ? [element] : [], element, slide, slideIndex);
  }

  function toggleSelectedElement(element, slide, slideIndex) {
    if (!element || !slide) {
      return;
    }

    for (var i = 0; i < selectedElements.length; i++) {
      if (!slide.contains(selectedElements[i])) {
        // Stale members from another slide: reject the add and keep the current set.
        return;
      }
    }

    if (isSelectionMember(element)) {
      var remaining = [];

      for (var j = 0; j < selectedElements.length; j++) {
        if (selectedElements[j] !== element) {
          remaining.push(selectedElements[j]);
        }
      }

      var nextPrimary =
        element === selectedElement ? remaining[remaining.length - 1] || null : selectedElement;
      setSelectedElements(remaining, nextPrimary, slide, slideIndex);
      return;
    }

    if (selectedElements.length >= C.MAX_SELECTIONS) {
      postError('You can select up to 32 elements.', 'selection-cap');
      return;
    }

    setSelectedElements(selectedElements.concat([element]), element, slide, slideIndex);
  }

  function postSelection(element, slide, slideIndex) {
    if (!element || !selectedElement) {
      postToParent({ type: C.SELECTION_CHANGE, selection: null });
      return;
    }

    var infos = [];

    for (var i = 0; i < selectedElements.length; i++) {
      infos.push(buildSelection(selectedElements[i], slide, slideIndex));
    }

    postToParent({
      type: C.SELECTION_CHANGE,
      selection: buildSelection(selectedElement, slide, slideIndex),
      selections: infos,
    });
  }

  function findElementById(elementId, slide, slideIndex) {
    var byAttr = slide.querySelector('[' + C.ELEMENT_ID_ATTR + '="' + elementId.replace(/"/g, '') + '"]');

    if (byAttr) {
      return byAttr;
    }

    if (elementId.indexOf(C.TRANSIENT_PREFIX) !== 0) {
      return null;
    }

    var suffix = elementId.slice(C.TRANSIENT_PREFIX.length);
    var dashIndex = suffix.indexOf('-');

    if (dashIndex === -1) {
      return null;
    }

    var path = suffix.slice(dashIndex + 1);

    var indices = path.split('.').map(function (part) {
      return Number.parseInt(part, 10);
    });
    var current = slide;

    for (var i = 0; i < indices.length; i++) {
      if (!current || !current.children || !current.children[indices[i]]) {
        return null;
      }

      current = current.children[indices[i]];
    }

    return current;
  }

  function postGeometryForElement(element, slide, slideIndex) {
    postToParent({
      type: C.GEOMETRY,
      elementId: resolveElementId(element, slide, slideIndex),
      slideIndex: slideIndex,
      geometry: normalizeRect(element, slide),
      zIndex: readZIndex(element),
      slideBounds: normalizeSlideBounds(slide),
      surface: detectSurface(element, slide),
    });
  }
`
