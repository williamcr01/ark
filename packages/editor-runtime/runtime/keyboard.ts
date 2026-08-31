/** Keyboard nudging, transform cancel, parent selection, and shortcuts. */
export const keyboardChunk = `  function finishNudge() {
    if (!nudgeState) {
      return;
    }

    window.clearTimeout(nudgeState.timer);
    var slide = getActiveSlide();

    if (slide && nudgeState.element) {
      if (nudgeState.members && nudgeState.members.length > 1) {
        var pending = transformState;
        transformState = {
          kind: 'move',
          element: nudgeState.element,
          members: nudgeState.members,
          startGeometry: nudgeState.startGeometry || nudgeState.geometry,
          adopted: nudgeState.adopted,
          positionContext: nudgeState.positionContext,
          cache: nudgeState.cache,
          lastGeometry: nudgeState.geometry,
        };
        commitGroupMove(transformState, slide);
        transformState = pending;
      } else {
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
    restoreTransformMembers(state);
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

    if (isSelectionUnsafe()) {
      postError(
        'Move, nudge, and delete need every selected element to be unlocked and not nested.',
        'mixed-selection',
      );
      return false;
    }

    if (!nudgeState || nudgeState.element !== selectedElement) {
      finishNudge();
      // Keyboard nudges adopt immediately (one discrete reflow). Pointer drags
      // defer adoption and use transform previews instead.
      var prepared = prepareMove(selectedElement, slide, true);
      var members = [];

      if (selectedElements.length > 1) {
        for (var ni = 0; ni < selectedElements.length; ni++) {
          var memberPrepared = selectedElements[ni] === selectedElement
            ? prepared
            : prepareMove(selectedElements[ni], slide, true);
          members.push({
            element: selectedElements[ni],
            startGeometry: memberPrepared.geometry,
            snapshot: memberPrepared.snapshot,
            adopted: memberPrepared.adopted,
            logicalWidth: memberPrepared.logicalWidth,
            positionContext: memberPrepared.positionContext,
            cache: memberPrepared.cache,
            lastGeometry: memberPrepared.geometry,
          });
        }
      }

      nudgeState = {
        element: selectedElement,
        adopted: prepared.adopted,
        geometry: prepared.geometry,
        startGeometry: prepared.geometry,
        snapshot: prepared.snapshot,
        positionContext: prepared.positionContext,
        cache: prepared.cache,
        members: members,
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

    if (nudgeState.members && nudgeState.members.length > 1) {
      nudgeState.geometry = applyGroupMove(
        {
          element: nudgeState.element,
          members: nudgeState.members,
          startGeometry: nudgeState.startGeometry,
          adopted: nudgeState.adopted,
          positionContext: nudgeState.positionContext,
          cache: nudgeState.cache,
        },
        slide,
        geometry,
        true,
      );
    } else {
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
    }
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
    restoreTransformMembers(transformState);
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
        if (selectedElements.length > 1) {
          setSelectedElement(null, slide, currentSlideIndex);
          postSelection(null, slide, currentSlideIndex);
        } else {
          selectParent(slide);
        }
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
      if (isSelectionUnsafe() || selectedElement.getAttribute(C.LOCKED_ATTR) === 'true') {
        if (selectedElements.length > 1) {
          event.preventDefault();
          event.stopPropagation();
          postError(
            'Move, nudge, and delete need every selected element to be unlocked and not nested.',
            'mixed-selection',
          );
        }

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
