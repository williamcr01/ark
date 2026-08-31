/** Applying a move or resize to an element, live and on commit. */
export const transformChunk = `  function isNonComposableTransform(value) {
    return /^(none|initial|inherit|unset|revert|revert-layer)$/i.test((value || '').trim());
  }

  function clearLiveTransform(element, cache) {
    // Only clear transforms we applied for the gesture preview — restore any
    // authored inline transform we composed with during the drag.
    if (!element.hasAttribute('data-ark-editor-live-transform')) {
      return;
    }

    element.style.transform = (cache && cache.liveTransformBase) || '';
    element.style.willChange = '';
    element.removeAttribute('data-ark-editor-live-transform');
  }

  function applyLiveMovePreview(element, slide, geometry, startGeometry, positionContext, cache, silent) {
    var rect = clampRect(geometry);
    var slideRect = cache.slideRect;
    var dx = (rect.x - startGeometry.x) * slideRect.width / positionContext.scaleX;
    var dy = (rect.y - startGeometry.y) * slideRect.height / positionContext.scaleY;
    var composedBase = cache.liveTransformBase && !isNonComposableTransform(cache.liveTransformBase)
      ? cache.liveTransformBase
      : '';
    var base = composedBase ? ' ' + composedBase : '';
    element.setAttribute('data-ark-editor-live-transform', '');
    element.style.willChange = 'transform';
    element.style.transform = 'translate(' + dx + 'px, ' + dy + 'px)' + base;
    if (!silent) {
      postToParent({
        type: C.TRANSFORM_PREVIEW,
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: rect,
        zIndex: cache.zIndex,
        slideBounds: cache.slideBounds,
      });
      updateResizeHandles(element, slide, rect, cache);
    }
    return rect;
  }

  function applyTransform(element, slide, geometry, preview, mode, adopted, positionContext, cache, silent) {
    var slideRect = (cache && cache.slideRect) || getSlideCoordinateRect(slide);
    var rect = clampRect(geometry);

    if (!slideRect.width || !slideRect.height) {
      return rect;
    }

    if (preview && mode === 'move' && cache && cache.liveTransform && cache.startGeometry) {
      return applyLiveMovePreview(
        element,
        slide,
        rect,
        cache.startGeometry,
        positionContext,
        cache,
        silent,
      );
    }

    clearLiveTransform(element, cache);

    var spacerFootprint = cache && cache.spacerFootprint ? cache.spacerFootprint : null;

    if (adopted && !preview) {
      adoptMove(element, slide, rect, cache && cache.logicalWidth, positionContext, cache);
      spacerFootprint = (cache && cache.spacerFootprint) || spacerFootprint;
      // Flow removal shifts containing-block geometry; remeasure without the
      // pre-adopt margin cache (adopt zeroes margins). Keep spacerFootprint for
      // the commit payload after nulling the layout cache.
      cache = null;
    }

    element.style.position = 'absolute';
    var cssPosition = preview
      ? setSlideRelativePosition(element, slide, rect, positionContext, cache)
      : settleSlideRelativePosition(element, slide, rect, positionContext, cache);

    // A pure move must not touch the element size. Only rewrite width/height
    // during a resize, otherwise elements sized with an explicit height would
    // silently change dimensions when merely repositioned.
    if (mode !== 'move') {
      var containingScale = positionContext
        ? { x: positionContext.scaleX, y: positionContext.scaleY }
        : readContainingBlockScale(element, slide);
      element.style.width = rect.width * slideRect.width / containingScale.x + 'px';

      if (isImageElement(element)) {
        element.style.height = rect.height * slideRect.height / containingScale.y + 'px';
        element.style.minHeight = '';
      } else {
        element.style.minHeight = rect.height * slideRect.height / containingScale.y + 'px';
        element.style.height = '';
      }
    }

    if (preview) {
      if (!silent) {
        postToParent({
          type: C.TRANSFORM_PREVIEW,
          elementId: resolveElementId(element, slide, currentSlideIndex),
          slideIndex: currentSlideIndex,
          geometry: rect,
          zIndex: cache && cache.zIndex != null ? cache.zIndex : readZIndex(element),
          slideBounds: (cache && cache.slideBounds) || normalizeSlideBounds(slide),
        });
        updateResizeHandles(element, slide, rect, cache);
      }
    } else {
      var logicalSlideWidth = (cache && cache.logicalSlideWidth) || getSlideLogicalWidth(slide);
      var logicalSlideHeight = (cache && cache.logicalSlideHeight) || getSlideLogicalHeight(slide);
      var commitPayload = {
        elementId: resolveElementId(element, slide, currentSlideIndex),
        slideIndex: currentSlideIndex,
        geometry: rect,
        zIndex: readZIndex(element),
        slideBounds: normalizeSlideBounds(slide),
        adopted: adopted ? true : undefined,
        cssX: cssPosition.x,
        cssY: cssPosition.y,
        cssWidth: adopted || mode !== 'move'
          ? readLogicalWidth(element, slide) / logicalSlideWidth
          : undefined,
        cssHeight: mode !== 'move'
          ? readLogicalHeight(element, slide) / logicalSlideHeight
          : undefined,
        slideWidth: logicalSlideWidth,
        slideHeight: logicalSlideHeight,
        spacer: adopted && spacerFootprint ? spacerFootprint : undefined,
      };

      if (cache) {
        cache.commitPayload = commitPayload;
      }

      if (!silent) {
        var postedCommit = { type: C.TRANSFORM_COMMIT };
        for (var commitKey in commitPayload) {
          if (Object.prototype.hasOwnProperty.call(commitPayload, commitKey)) {
            postedCommit[commitKey] = commitPayload[commitKey];
          }
        }

        if (
          transformState &&
          transformState.members &&
          transformState.members.length > 1 &&
          element === transformState.element
        ) {
          var companions = [];

          for (var m = 0; m < transformState.members.length; m++) {
            var memberPayload =
              transformState.members[m].cache && transformState.members[m].cache.commitPayload;

            if (memberPayload && transformState.members[m].element !== element) {
              companions.push(memberPayload);
            }
          }

          if (companions.length) {
            postedCommit.companions = companions;
          }
        }

        postToParent(postedCommit);
        refreshSelectionChrome(element, slide, currentSlideIndex);
      }
    }

    return rect;
  }

  function resizeRectWithHandle(startGeometry, handle, pointer, slide, element) {
    var start = clampRect(startGeometry);
    var current = pointerToNormalized(pointer.clientX, pointer.clientY, slide);
    var rect = {
      x: start.x,
      y: start.y,
      width: start.width,
      height: start.height,
    };

    if (handle.indexOf('e') !== -1) {
      rect.width = Math.max(C.MIN_BOX_SIZE, current.x - start.x);
    }

    if (handle.indexOf('s') !== -1) {
      rect.height = Math.max(C.MIN_BOX_SIZE, current.y - start.y);
    }

    if (handle.indexOf('w') !== -1) {
      rect.width = Math.max(C.MIN_BOX_SIZE, start.x + start.width - current.x);
      rect.x = current.x;
    }

    if (handle.indexOf('n') !== -1) {
      rect.height = Math.max(C.MIN_BOX_SIZE, start.y + start.height - current.y);
      rect.y = current.y;
    }

    var cornerHandle = handle.length === 2;

    if (element && (isImageElement(element) || (pointer.shiftKey && cornerHandle))) {
      var aspectRatio = isImageElement(element)
        ? getImageAspectRatio(element)
        : start.width / Math.max(start.height, C.MIN_BOX_SIZE) *
          getSlideCoordinateRect(slide).width / getSlideCoordinateRect(slide).height;
      var locked = applyImageAspectRatio(rect, aspectRatio, slide, start);

      if (handle.indexOf('w') !== -1) {
        locked.x = start.x + start.width - locked.width;
      }

      if (handle.indexOf('n') !== -1) {
        locked.y = start.y + start.height - locked.height;
      }

      return locked;
    }

    return clampRect(rect);
  }

  function findResizeHandle(target) {
    if (!target || !target.getAttribute) {
      return null;
    }

    if (target.getAttribute('data-ark-editor-handle')) {
      return target.getAttribute('data-ark-editor-handle');
    }

    return null;
  }

  function snapshotInlineStyle(element) {
    return {
      hadStyle: element.hasAttribute('style'),
      style: element.getAttribute('style') || '',
    };
  }

  function restoreInlineStyle(element, snapshot) {
    if (!snapshot) {
      return;
    }

    if (snapshot.hadStyle) {
      element.setAttribute('style', snapshot.style);
    } else {
      element.removeAttribute('style');
    }
  }

  function findContainingBlock(element, slide) {
    if (element.offsetParent) {
      return element.offsetParent;
    }

    var parent = element.parentElement;

    while (parent) {
      var style = window.getComputedStyle(parent);

      if (
        (style.position && style.position !== 'static') ||
        (style.transform && style.transform !== 'none')
      ) {
        return parent;
      }

      parent = parent.parentElement;
    }

    return document.documentElement || slide;
  }

  function readLogicalWidth(element, slide) {
    if (element.offsetWidth) {
      return element.offsetWidth;
    }

    if (element.style.width && /px$/i.test(element.style.width)) {
      return Number.parseFloat(element.style.width) || 0;
    }

    var scale = readContainingBlockScale(element, slide).x;
    return element.getBoundingClientRect().width / scale;
  }

  function readLogicalHeight(element, slide) {
    if (element.offsetHeight) {
      return element.offsetHeight;
    }

    if (element.style.height && /px$/i.test(element.style.height)) {
      return Number.parseFloat(element.style.height) || 0;
    }

    if (element.style.minHeight && /px$/i.test(element.style.minHeight)) {
      return Number.parseFloat(element.style.minHeight) || 0;
    }

    var scale = readContainingBlockScale(element, slide).y;
    return element.getBoundingClientRect().height / scale;
  }

  function readPositionContext(element, slide) {
    var containingBlock = findContainingBlock(element, slide);
    var blockRect = containingBlock.getBoundingClientRect();
    var blockWidth = containingBlock.offsetWidth;
    var blockHeight = containingBlock.offsetHeight;
    var scaleRect = blockRect;

    if (containingBlock === slide && (!blockRect.width || !blockRect.height)) {
      scaleRect = getSlideCoordinateRect(slide);
      blockWidth = getSlideLogicalWidth(slide);
      blockHeight = getSlideLogicalHeight(slide);
    }

    return {
      containingBlock: containingBlock,
      scaleX: (blockWidth ? scaleRect.width / blockWidth : 1) || 1,
      scaleY: (blockHeight ? scaleRect.height / blockHeight : 1) || 1,
    };
  }

  function readContainingBlockScale(element, slide) {
    var context = readPositionContext(element, slide);
    return { x: context.scaleX, y: context.scaleY };
  }

  function restoreTransformMembers(state) {
    if (!state) {
      return;
    }

    var members = state.members && state.members.length ? state.members : null;

    if (members) {
      for (var i = 0; i < members.length; i++) {
        clearLiveTransform(members[i].element, members[i].cache);
        restoreInlineStyle(members[i].element, members[i].snapshot);
        cleanupAdoptSideEffects(members[i].element, members[i].cache);
      }

      return;
    }

    if (state.element) {
      clearLiveTransform(state.element, state.cache);
      restoreInlineStyle(state.element, state.snapshot);
      cleanupAdoptSideEffects(state.element, state.cache);
    }
  }

  function applyGroupMove(state, slide, snappedRect, preview) {
    var deltaX = snappedRect.x - state.startGeometry.x;
    var deltaY = snappedRect.y - state.startGeometry.y;
    var members = state.members && state.members.length ? state.members : null;
    var primaryRect = applyTransform(
      state.element,
      slide,
      snappedRect,
      preview,
      'move',
      state.adopted,
      state.positionContext,
      state.cache,
      false,
    );

    if (!members) {
      return primaryRect;
    }

    for (var i = 0; i < members.length; i++) {
      if (members[i].element === state.element) {
        members[i].lastGeometry = primaryRect;
        continue;
      }

      members[i].lastGeometry = applyTransform(
        members[i].element,
        slide,
        {
          x: members[i].startGeometry.x + deltaX,
          y: members[i].startGeometry.y + deltaY,
          width: members[i].startGeometry.width,
          height: members[i].startGeometry.height,
        },
        preview,
        'move',
        members[i].adopted,
        members[i].positionContext,
        members[i].cache,
        true,
      );
    }

    return primaryRect;
  }

  function commitGroupMove(state, slide) {
    var members = state.members && state.members.length ? state.members : null;
    var finalGeometry = state.lastGeometry || normalizeRect(state.element, slide);

    if (members) {
      var deltaX = finalGeometry.x - state.startGeometry.x;
      var deltaY = finalGeometry.y - state.startGeometry.y;

      for (var i = 0; i < members.length; i++) {
        if (members[i].element === state.element) {
          continue;
        }

        applyTransform(
          members[i].element,
          slide,
          members[i].lastGeometry || {
            x: members[i].startGeometry.x + deltaX,
            y: members[i].startGeometry.y + deltaY,
            width: members[i].startGeometry.width,
            height: members[i].startGeometry.height,
          },
          false,
          'move',
          members[i].adopted,
          members[i].positionContext,
          members[i].cache,
          true,
        );
      }
    }

    applyTransform(
      state.element,
      slide,
      finalGeometry,
      false,
      state.kind,
      state.adopted,
      state.positionContext,
      state.cache,
      false,
    );
  }
`
