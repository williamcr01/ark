/** Keyboard nudging, transform cancel, parent selection, and shortcuts. */
export const keyboardChunk = `  function finishNudge() {
    if (!nudgeState) {
      return;
    }

    window.clearTimeout(nudgeState.timer);
    var slide = getActiveSlide();

    if (slide && nudgeState.element) {
      applyTransform(
        nudgeState.element,
        slide,
        nudgeState.geometry || normalizeRect(nudgeState.element, slide),
        false,
        'move',
        nudgeState.adopted,
        nudgeState.positionContext,
        nudgeState.cache,
      );
    }

    nudgeState = null;
  }

  function cancelNudge(slide) {
    if (!nudgeState) {
      return false;
    }

    var state = nudgeState;
    nudgeState = null;
    window.clearTimeout(state.timer);
    clearLiveTransform(state.element, state.cache);
    restoreInlineStyle(state.element, state.snapshot);
    cleanupAdoptSideEffects(state.element, state.cache);
    clearGuides();
    postToParent({ type: C.TRANSFORM_CANCEL });

    if (slide) {
      refreshSelectionChrome(selectedElement, slide, currentSlideIndex);
    }

    return true;
  }

  function nudgeSelection(event, slide) {
    if (!selectedElement || selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
      return false;
    }

    if (!nudgeState || nudgeState.element !== selectedElement) {
      finishNudge();
      // Keyboard nudges adopt immediately (one discrete reflow). Pointer drags
      // defer adoption and use transform previews instead.
      var prepared = prepareMove(selectedElement, slide, true);
      nudgeState = {
        element: selectedElement,
        adopted: prepared.adopted,
        geometry: prepared.geometry,
        snapshot: prepared.snapshot,
        positionContext: prepared.positionContext,
        cache: prepared.cache,
        timer: null,
      };
    }

    var geometry = {
      x: nudgeState.geometry.x,
      y: nudgeState.geometry.y,
      width: nudgeState.geometry.width,
      height: nudgeState.geometry.height,
    };
    var slideWidth = nudgeState.cache.logicalSlideWidth || getSlideLogicalWidth(slide);
    var slideHeight = nudgeState.cache.logicalSlideHeight || getSlideLogicalHeight(slide);
    var amount = event.shiftKey ? 10 : 1;

    if (event.key === 'ArrowLeft') geometry.x -= amount / slideWidth;
    if (event.key === 'ArrowRight') geometry.x += amount / slideWidth;
    if (event.key === 'ArrowUp') geometry.y -= amount / slideHeight;
    if (event.key === 'ArrowDown') geometry.y += amount / slideHeight;

    nudgeState.geometry = applyTransform(
      selectedElement,
      slide,
      geometry,
      true,
      'move',
      nudgeState.adopted,
      nudgeState.positionContext,
      nudgeState.cache,
    );
    if (nudgeState.adopted && !nudgeState.layoutCorrectionScheduled) {
      nudgeState.layoutCorrectionScheduled = true;
      var pendingNudgeState = nudgeState;
      window.requestAnimationFrame(function () {
        if (nudgeState !== pendingNudgeState || !pendingNudgeState.geometry) {
          return;
        }

        // Reveal can recenter after adoption changes scrollHeight; converge CSS
        // offsets once so the live nudge matches the intended geometry.
        settleSlideRelativePosition(
          pendingNudgeState.element,
          slide,
          pendingNudgeState.geometry,
          pendingNudgeState.positionContext,
        );
        refreshSelectionChrome(pendingNudgeState.element, slide, currentSlideIndex);
      });
    }
    window.clearTimeout(nudgeState.timer);
    nudgeState.timer = window.setTimeout(finishNudge, 400);
    return true;
  }

  function cancelTransform(slide) {
    if (!transformState) {
      return false;
    }

    cancelTransformRaf();

    if (transformState.element) {
      clearLiveTransform(transformState.element, transformState.cache);
      restoreInlineStyle(transformState.element, transformState.snapshot);
      cleanupAdoptSideEffects(transformState.element, transformState.cache);
    }

    transformState = null;
    clearMarquee();
    clearGuides();
    postToParent({ type: C.TRANSFORM_CANCEL });
    refreshSelectionChrome(selectedElement, slide, currentSlideIndex);
    return true;
  }

  function selectParent(slide) {
    var parent = selectedElement ? selectedElement.parentElement : null;

    while (parent && parent !== slide && !isEditableCandidate(parent, slide)) {
      parent = parent.parentElement;
    }

    var next = parent && parent !== slide ? parent : null;
    setSelectedElement(next, slide, currentSlideIndex);
    postSelection(next, slide, currentSlideIndex);
  }

  function onKeyDown(event) {
    if (textEditElement) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        endTextEdit(false);
        return;
      }

      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown'
      ) {
        event.stopPropagation();
      }

      return;
    }

    if (!enabled || currentTool !== 'select') {
      return;
    }

    var shortcutKey = event.key.toLowerCase();

    if (event.metaKey || event.ctrlKey) {
      var action = null;

      if (shortcutKey === 'z') action = event.shiftKey ? 'redo' : 'undo';
      if (shortcutKey === 'y') action = 'redo';
      if (shortcutKey === 'd' && selectedElement) action = 'duplicate';

      if (action) {
        event.preventDefault();
        event.stopPropagation();

        if (action === 'undo' && cancelNudge(getActiveSlide())) {
          return;
        }

        finishNudge();
        postToParent({ type: C.SHORTCUT, action: action });
        return;
      }
    }

    var slide = getActiveSlide();

    if (event.key === 'Escape' && slide) {
      event.preventDefault();
      event.stopPropagation();

      if (cancelNudge(slide)) {
        return;
      }

      if (!cancelTransform(slide)) {
        selectParent(slide);
      }

      return;
    }

    if (
      slide &&
      (event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown') &&
      nudgeSelection(event, slide)
    ) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if ((event.key === 'Delete' || event.key === 'Backspace') && selectedElement) {
      if (selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      finishNudge();
      postToParent({
        type: C.DELETE_REQUEST,
        elementId: resolveElementId(selectedElement, getActiveSlide(), currentSlideIndex),
        slideIndex: currentSlideIndex,
      });
    }
  }
`
