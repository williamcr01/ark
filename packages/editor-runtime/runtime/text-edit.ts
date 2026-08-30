/** Inline text editing: starting, committing, and cancelling an edit. */
export const textEditChunk = `  function endTextEdit(commit) {
    if (!textEditElement) {
      return;
    }

    var slide = getActiveSlide();
    var element = textEditElement;
    var slideIndex = currentSlideIndex;
    var savedOriginalText = originalTextBeforeEdit;

    if (!commit && originalTextBeforeEdit !== null) {
      element.textContent = originalTextBeforeEdit;
    }

    textEditElement.removeAttribute('contenteditable');
    textEditElement.removeAttribute('data-ark-editor-text-edit');

    if (commit && slide) {
      postToParent({
        type: C.TEXT_COMMIT,
        elementId: resolveElementId(element, slide, slideIndex),
        slideIndex: slideIndex,
        slideId: slide.getAttribute('data-ark-slide-id') || null,
        text: element.textContent || '',
        originalText: savedOriginalText || '',
      });
    }

    postTextEditState(false);
    originalTextBeforeEdit = null;
    textEditElement = null;
  }

  function startTextEditOnElement(element, slide, slideIndex) {
    var target = getTextEditTarget(element);

    if (!target) {
      postError('Element is not text-editable.', 'non-text-element');
      return;
    }

    if (element.getAttribute(C.LOCKED_ATTR) === 'true') {
      postError('Element is locked.', 'locked-element');
      return;
    }

    var tag = target.tagName.toLowerCase();

    if (!isTextEditableTag(tag) && !isTextBox(element)) {
      postError('Element is not text-editable.', 'non-text-element');
      return;
    }

    endTextEdit(false);
    clearHoverCursor();
    clearEditorOverlays();
    textEditElement = target;
    originalTextBeforeEdit = target.textContent || '';
    target.setAttribute('contenteditable', 'true');
    target.setAttribute('data-ark-editor-text-edit', '');
    target.focus();

    try {
      var selection = window.getSelection();

      if (selection) {
        var range = document.createRange();
        range.selectNodeContents(target);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    } catch (error) {
      // Ignore selection failures in older browsers.
    }

    postTextEditState(
      true,
      resolveElementId(element, slide, slideIndex),
      slideIndex,
    );
  }
`
