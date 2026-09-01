/** Enabling and disabling the editor, shell message dispatch, and bootstrap. */
export const lifecycleChunk = `  function bindListeners() {
    if (listenersBound) {
      return;
    }

    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('pointerup', onPointerUp, true);
    document.addEventListener('pointercancel', onPointerCancel, true);
    document.addEventListener('lostpointercapture', onLostPointerCapture, true);
    document.addEventListener('dblclick', onDoubleClick, true);
    document.addEventListener('keydown', onKeyDown, true);
    listenersBound = true;
  }

  function unbindListeners() {
    if (!listenersBound) {
      return;
    }

    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('pointerup', onPointerUp, true);
    document.removeEventListener('pointercancel', onPointerCancel, true);
    document.removeEventListener('lostpointercapture', onLostPointerCapture, true);
    document.removeEventListener('dblclick', onDoubleClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    listenersBound = false;
  }

  function enableEditor(slideIndex, tool, scale) {
    finishNudge();
    var previousSlide = getActiveSlide();

    if (transformState) {
      if (previousSlide) {
        cancelTransform(previousSlide);
      } else {
        restoreTransformMembers(transformState);
        transformState = null;
        clearEditorOverlays();
      }
    }

    enabled = true;
    if (currentSlideIndex !== slideIndex) {
      clearSelectionStyles();
    }
    currentSlideIndex = slideIndex;
    currentTool = tool || 'select';
    editorScale = Number.isFinite(scale) && scale > 0 ? scale : editorScale;
    ensureEditorStyle();
    bindListeners();
    postToParent({
      type: C.READY,
      slideIndex: currentSlideIndex,
      protocolVersion: C.PROTOCOL_VERSION,
    });
  }

  function disableEditor() {
    enabled = false;

    if (transformState && transformState.element) {
      restoreTransformMembers(transformState);
    }

    transformState = null;
    window.clearTimeout(nudgeState && nudgeState.timer);

    if (nudgeState && nudgeState.element) {
      restoreTransformMembers(nudgeState);
    }

    nudgeState = null;
    endTextEdit(false);
    clearSelectionStyles();
    clearEditorOverlays();
    clearHoverCursor();
    selectedElement = null;
    postToParent({ type: C.SELECTION_CHANGE, selection: null });
    postToParent({ type: C.HOVER, slideIndex: currentSlideIndex, elementId: null });
  }

  function handleShellMessage(data) {
    if (!isRecord(data) || typeof data.type !== 'string' || data.type.indexOf('ark:editor-') !== 0) {
      return;
    }

    try {
      if (data.type === C.ENABLE && typeof data.slideIndex === 'number') {
        enableEditor(data.slideIndex, data.tool, data.scale);
        return;
      }

      if (data.type === C.CONFIGURE && Number.isFinite(data.scale) && data.scale > 0) {
        editorScale = data.scale;

        if (enabled && selectedElement) {
          var configuredSlide = getActiveSlide();

          if (configuredSlide) {
            updateResizeHandles(selectedElement, configuredSlide);
          }
        }

        return;
      }

      if (data.type === C.DISABLE) {
        disableEditor();
        return;
      }

      if (!enabled) {
        return;
      }

      if (data.type === C.TRANSFORM_CANCEL) {
        cancelTransform(getActiveSlide());
        return;
      }

      if (data.type === C.TRANSFORM_END) {
        finishTransform(getActiveSlide(), null);
        return;
      }

      if (
        data.type === C.ASSIGN_ID &&
        typeof data.fromElementId === 'string' &&
        typeof data.toElementId === 'string' &&
        typeof data.slideIndex === 'number'
      ) {
        currentSlideIndex = data.slideIndex;
        var assignSlide = getActiveSlide();

        if (!assignSlide) {
          postError('No active slide found for editor command.', 'missing-slide');
          return;
        }

        var assignTarget = findElementById(data.fromElementId, assignSlide, data.slideIndex);

        if (!assignTarget) {
          postError('Element "' + data.fromElementId + '" was not found.', 'missing-element');
          return;
        }

        assignTarget.setAttribute(C.ELEMENT_ID_ATTR, data.toElementId);

        if (data.managed) {
          assignTarget.setAttribute(C.MANAGED_ATTR, 'true');
        }

        if (selectedElement === assignTarget || isSelectionMember(assignTarget)) {
          postSelection(assignTarget, assignSlide, data.slideIndex);
          refreshSelectionChrome(selectedElement || assignTarget, assignSlide, data.slideIndex);
        }

        return;
      }

      if (data.type === C.CLEAR_SELECTION) {
        var clearSlide = getActiveSlide();

        if (!clearSlide) {
          postError('No active slide found for editor command.', 'missing-slide');
          return;
        }

        setSelectedElement(null, clearSlide, currentSlideIndex);
        postSelection(null, clearSlide, currentSlideIndex);
        return;
      }

      if (data.type === C.SET_TOOL && (data.tool === 'select' || data.tool === 'text' || data.tool === 'insert')) {
        currentTool = data.tool;
        var toolSlide = getActiveSlide();

        if (toolSlide) {
          cancelTransform(toolSlide);
        }

        clearEditorOverlays();
        return;
      }

      if (
        (data.type === C.SELECT ||
          data.type === C.REQUEST_GEOMETRY ||
          data.type === C.START_TEXT_EDIT) &&
        typeof data.elementId === 'string' &&
        typeof data.slideIndex === 'number'
      ) {
        // Update the active slide index before resolving the slide so geometry
        // and selection target the requested slide during rapid navigation.
        currentSlideIndex = data.slideIndex;
        var slide = getActiveSlide();

        if (!slide) {
          postError('No active slide found for editor command.', 'missing-slide');
          return;
        }

        var element = findElementById(data.elementId, slide, data.slideIndex);

        if (!element) {
          postError('Element "' + data.elementId + '" was not found.', 'missing-element');
          return;
        }

        if (data.type === C.SELECT) {
          setSelectedElement(element, slide, data.slideIndex);
          postSelection(element, slide, data.slideIndex);
          return;
        }

        if (data.type === C.REQUEST_GEOMETRY) {
          postGeometryForElement(element, slide, data.slideIndex);
          return;
        }

        if (data.type === C.START_TEXT_EDIT) {
          startTextEditOnElement(element, slide, data.slideIndex);
          return;
        }
      }

      if (data.type === C.CANCEL_TEXT_EDIT) {
        endTextEdit(false);
        return;
      }
    } catch (error) {
      postError(error && error.message ? error.message : String(error), 'editor-runtime');
    }
  }

  // Register before deck-authored listeners. The handlers stay dormant while
  // editing is disabled, preserving normal deck interaction.
  bindListeners();

  document.addEventListener(
    'focusout',
    function (event) {
      if (!textEditElement || event.target !== textEditElement) {
        return;
      }

      endTextEdit(true);
    },
    true,
  );
})();`
