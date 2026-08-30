/** Pointer event handling and the rAF-batched transform flush. */
export const pointerChunk = `  function cancelTransformRaf() {
    if (!transformState || !transformState.rafId) {
      return;
    }

    window.cancelAnimationFrame(transformState.rafId);
    transformState.rafId = 0;
  }

  function flushTransformPointer(slide) {
    if (!transformState || !transformState.pendingPointer) {
      return;
    }

    var pointer = transformState.pendingPointer;
    transformState.pendingPointer = null;
    transformState.rafId = 0;
    var cache = transformState.cache;

    if (transformState.kind === 'draw') {
      updateMarquee(
        transformState.startPoint,
        pointerFromCache(pointer.clientX, pointer.clientY, cache, slide),
        slide,
      );
      return;
    }

    if (transformState.kind === 'move' && transformState.element) {
      var point = pointerFromCache(pointer.clientX, pointer.clientY, cache, slide);
      var deltaX = point.x - transformState.startPoint.x;
      var deltaY = point.y - transformState.startPoint.y;
      var constrainedAxis = null;
      var slideRect = cache.slideRect;

      if (!transformState.started) {
        if (
          Math.abs(deltaX * slideRect.width) < 2 / editorScale &&
          Math.abs(deltaY * slideRect.height) < 2 / editorScale
        ) {
          return;
        }

        // Authored-transform moves use the left/top preview path, so adopt at
        // the drag threshold to freeze width before absolute positioning.
        if (transformState.adopted && !cache.liveTransform) {
          adoptMove(
            transformState.element,
            slide,
            transformState.startGeometry,
            transformState.logicalWidth,
            transformState.positionContext,
            cache,
          );
        }

        transformState.started = true;
      }

      if (pointer.shiftKey) {
        if (Math.abs(deltaX) >= Math.abs(deltaY)) {
          deltaY = 0;
          constrainedAxis = 'x';
        } else {
          deltaX = 0;
          constrainedAxis = 'y';
        }
      }

      var snapped = snapMoveRect({
        x: transformState.startGeometry.x + deltaX,
        y: transformState.startGeometry.y + deltaY,
        width: transformState.startGeometry.width,
        height: transformState.startGeometry.height,
      }, transformState.snapRects, slide, pointer.altKey, constrainedAxis, cache);
      transformState.lastGeometry = applyTransform(
        transformState.element,
        slide,
        snapped.rect,
        true,
        'move',
        transformState.adopted,
        transformState.positionContext,
        cache,
      );
      applySnapGuides(slide, snapped.guides, cache);
      return;
    }

    if (transformState.kind === 'resize' && transformState.element && transformState.handle) {
      var resizePoint = pointerFromCache(pointer.clientX, pointer.clientY, cache, slide);
      var resizeDeltaX = resizePoint.x - transformState.startPoint.x;
      var resizeDeltaY = resizePoint.y - transformState.startPoint.y;
      var resizeSlideRect = cache.slideRect;

      if (!transformState.started) {
        if (
          Math.abs(resizeDeltaX * resizeSlideRect.width) < 2 / editorScale &&
          Math.abs(resizeDeltaY * resizeSlideRect.height) < 2 / editorScale
        ) {
          return;
        }

        if (transformState.adopted) {
          adoptMove(
            transformState.element,
            slide,
            transformState.startGeometry,
            transformState.logicalWidth,
            transformState.positionContext,
            cache,
          );
        }

        transformState.started = true;
      }

      var resized = resizeRectWithHandle(
        transformState.startGeometry,
        transformState.handle,
        pointer,
        slide,
        transformState.element,
      );
      transformState.lastGeometry = applyTransform(
        transformState.element,
        slide,
        resized,
        true,
        'resize',
        transformState.adopted,
        transformState.positionContext,
        cache,
      );
    }
  }

  function scheduleTransformFlush(slide) {
    if (!transformState || transformState.rafId) {
      return;
    }

    var pending = transformState;
    transformState.rafId = window.requestAnimationFrame(function () {
      if (transformState !== pending) {
        return;
      }

      flushTransformPointer(slide);
    });
  }

  function flushHover() {
    hoverRafId = 0;
    var hover = pendingHover;
    pendingHover = null;

    if (!hover || !enabled || textEditElement || transformState) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    var target = findEditableTarget(hover.eventTarget, slide);

    if (!setHoverCursor(target)) {
      return;
    }

    postToParent({
      type: C.HOVER,
      slideIndex: currentSlideIndex,
      elementId: target ? resolveElementId(target, slide, currentSlideIndex) : null,
      geometry: target ? normalizeRect(target, slide) : undefined,
      slideBounds: target ? normalizeSlideBounds(slide) : undefined,
      surface: target ? detectSurface(target, slide) : undefined,
    });
  }

  function onPointerMove(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    if (transformState && transformState.pointerId === event.pointerId) {
      transformState.pendingPointer = {
        clientX: event.clientX,
        clientY: event.clientY,
        altKey: event.altKey,
        shiftKey: event.shiftKey,
      };
      scheduleTransformFlush(slide);
      return;
    }

    if (transformState) {
      return;
    }

    pendingHover = { eventTarget: event.target };

    if (!hoverRafId) {
      hoverRafId = window.requestAnimationFrame(flushHover);
    }
  }

  function captureTransformPointer(slide, pointerId) {
    if (typeof slide.setPointerCapture !== 'function') {
      return;
    }

    try {
      slide.setPointerCapture(pointerId);
    } catch (error) {
      // Pointer capture can fail if the pointer ended before the handler ran.
    }
  }

  function onPointerDown(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    finishNudge();

    if (currentTool === 'text') {
      event.preventDefault();
      event.stopPropagation();
      clearEditorOverlays();
      setSelectedElement(null, slide, currentSlideIndex);
      postSelection(null, slide, currentSlideIndex);
      transformState = {
        kind: 'draw',
        pointerId: event.pointerId,
        startPoint: pointerToNormalized(event.clientX, event.clientY, slide),
        cache: {
          slideRect: getSlideCoordinateRect(slide),
          logicalSlideWidth: getSlideLogicalWidth(slide),
          logicalSlideHeight: getSlideLogicalHeight(slide),
        },
        pendingPointer: null,
        rafId: 0,
      };
      captureTransformPointer(slide, event.pointerId);
      ensureMarquee(slide);
      return;
    }

    if (currentTool !== 'select') {
      return;
    }

    var handle = findResizeHandle(event.target);

    if (handle && selectedElement && selectedElement.getAttribute(C.LOCKED_ATTR) !== 'true') {
      event.preventDefault();
      event.stopPropagation();
      // Defer adoption until the pointer moves past the click threshold so a
      // press-and-release on a handle does not persist position:absolute.
      var preparedResize = prepareMove(selectedElement, slide, false);
      transformState = {
        kind: 'resize',
        pointerId: event.pointerId,
        handle: handle,
        element: selectedElement,
        startPoint: pointerFromCache(event.clientX, event.clientY, preparedResize.cache, slide),
        startGeometry: preparedResize.geometry,
        snapshot: preparedResize.snapshot,
        adopted: preparedResize.adopted,
        logicalWidth: preparedResize.logicalWidth,
        positionContext: preparedResize.positionContext,
        cache: Object.assign(preparedResize.cache, {
          // Resize writes left/top/width; never use compositor translate preview.
          liveTransform: false,
        }),
        started: false,
        pendingPointer: null,
        rafId: 0,
      };
      captureTransformPointer(slide, event.pointerId);
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      // Empty slide / non-editable chrome: deselect like PowerPoint.
      event.preventDefault();
      event.stopPropagation();
      setSelectedElement(null, slide, currentSlideIndex);
      postSelection(null, slide, currentSlideIndex);
      postToParent({
        type: C.HOVER,
        slideIndex: currentSlideIndex,
        elementId: null,
      });
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    var editOnClick = target === selectedElement && isTextEditableElement(target);
    setSelectedElement(target, slide, currentSlideIndex);
    postSelection(target, slide, currentSlideIndex);

    if (target.getAttribute(C.LOCKED_ATTR) !== 'true') {
      var prepared = prepareMove(target, slide, false);
      transformState = {
        kind: 'move',
        pointerId: event.pointerId,
        element: target,
        startPoint: pointerFromCache(event.clientX, event.clientY, prepared.cache, slide),
        startGeometry: prepared.geometry,
        snapshot: prepared.snapshot,
        adopted: prepared.adopted,
        logicalWidth: prepared.logicalWidth,
        positionContext: prepared.positionContext,
        cache: Object.assign(prepared.cache, {
          // Use compositor previews unless a stylesheet-authored transform
          // cannot be safely composed through an inline translate. Inline
          // transforms (including the CSS none keyword) are restored/composed by the cache.
          liveTransform:
            !prepared.cache.authoredTransform ||
            Boolean(
              prepared.cache.liveTransformBase &&
                !isNonComposableTransform(prepared.cache.liveTransformBase),
            ),
        }),
        started: false,
        snapRects: collectSnapRects(slide, target),
        editOnClick: editOnClick,
        pendingPointer: null,
        rafId: 0,
      };
      captureTransformPointer(slide, event.pointerId);
    }
  }

  function finishTransform(slide, pointer) {
    if (!transformState) {
      return false;
    }

    cancelTransformRaf();
    var lastPointer = pointer || transformState.pendingPointer;

    // Flush needs a live slide (showGuide → getSlideCoordinateElement). Restore
    // the snapshot when the slide is gone instead of flushing into null.
    if (!slide) {
      if (transformState.element) {
        clearLiveTransform(transformState.element, transformState.cache);
        restoreInlineStyle(transformState.element, transformState.snapshot);
        cleanupAdoptSideEffects(transformState.element, transformState.cache);
      }

      transformState = null;
      clearEditorOverlays();
      postToParent({ type: C.TRANSFORM_CANCEL });
      return true;
    }

    if (pointer) {
      transformState.pendingPointer = pointer;
      flushTransformPointer(slide);
    } else if (transformState.pendingPointer) {
      flushTransformPointer(slide);
    }

    if (transformState.kind === 'draw') {
      // Outside release without a tracked pointer has no meaningful end point —
      // discard the marquee rather than inserting a default-size box.
      if (!lastPointer) {
        clearMarquee();
        transformState = null;
        return true;
      }

      var endPoint = pointerFromCache(
        lastPointer.clientX,
        lastPointer.clientY,
        transformState.cache,
        slide,
      );
      finishTextBoxDraw(slide, transformState.startPoint, endPoint);
      clearMarquee();
      transformState = null;
      return true;
    }

    if (
      (transformState.kind === 'move' || transformState.kind === 'resize') &&
      transformState.element
    ) {
      if (!transformState.started) {
        var editOnClick = transformState.kind === 'move' && transformState.editOnClick;
        var clickedElement = transformState.element;
        transformState = null;

        if (editOnClick) {
          startTextEditOnElement(clickedElement, slide, currentSlideIndex);
        }

        return true;
      }

      var finalGeometry = transformState.lastGeometry || normalizeRect(transformState.element, slide);

      // Always emit a commit (even for a no-op drag) so the shell clears
      // transformPreview / isTransformingRef; empty patch ops are a no-op.
      applyTransform(
        transformState.element,
        slide,
        finalGeometry,
        false,
        transformState.kind,
        transformState.adopted,
        transformState.positionContext,
        transformState.cache,
      );
      clearGuides();
      transformState = null;
      return true;
    }

    transformState = null;
    return true;
  }

  function onPointerUp(event) {
    if (!enabled || !transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    finishTransform(getActiveSlide(), {
      clientX: event.clientX,
      clientY: event.clientY,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
    });
  }

  function onPointerCancel(event) {
    if (!transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    var slide = getActiveSlide();

    if (slide) {
      cancelTransform(slide);
      return;
    }

    cancelTransformRaf();

    if (transformState.element) {
      clearLiveTransform(transformState.element, transformState.cache);
      restoreInlineStyle(transformState.element, transformState.snapshot);
      cleanupAdoptSideEffects(transformState.element, transformState.cache);
    }

    transformState = null;
    clearEditorOverlays();
    postToParent({ type: C.TRANSFORM_CANCEL });
  }

  function onLostPointerCapture(event) {
    if (!transformState || transformState.pointerId !== event.pointerId) {
      return;
    }

    // Crossing a sandboxed iframe boundary can drop capture. If the gesture
    // already moved, treat that as commit; otherwise cancel like a click.
    if (transformState.started) {
      finishTransform(getActiveSlide(), null);
      return;
    }

    onPointerCancel(event);
  }

  function onDoubleClick(event) {
    if (!enabled || textEditElement) {
      return;
    }

    var slide = getActiveSlide();

    if (!slide) {
      return;
    }

    var target = findEditableTarget(event.target, slide);

    if (!target) {
      return;
    }

    var directTarget = event.target;

    if (
      !isTextBox(target) &&
      directTarget &&
      directTarget.nodeType === 1 &&
      isEditableCandidate(directTarget, slide)
    ) {
      target = directTarget;
    }

    var editableTarget = getTextEditTarget(target);
    var tag = editableTarget ? editableTarget.tagName.toLowerCase() : '';

    if (!editableTarget || (!isTextEditableTag(tag) && !isTextBox(target))) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    setSelectedElement(target, slide, currentSlideIndex);
    postSelection(target, slide, currentSlideIndex);
    startTextEditOnElement(target, slide, currentSlideIndex);
  }
`
