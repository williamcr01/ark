/**
 * The tree walk that turns one rendered slide into scene nodes.
 *
 * The shape of the recursion is the whole design: an element that paints a box
 * contributes a shape and then recurses, an element whose subtree is only prose
 * contributes one text box and stops, and an element using CSS with no OOXML
 * equivalent contributes a raster region and stops. Descending no further is
 * what keeps a flattened element from taking the rest of the slide with it.
 */
export const walkChunk = String.raw`
  function readZIndex(style, inherited) {
    var value = parseInt(style.zIndex, 10);
    return isFinite(value) ? value : inherited;
  }

  function imageSizing(style) {
    var fit = style.objectFit;
    if (fit === 'cover' || fit === 'fill') return fit;
    return 'contain';
  }

  /**
   * Inline an image as a data URI. A data: source passes straight through;
   * anything else is redrawn through a canvas, capped near its displayed size so
   * a large source does not bloat the deck.
   */
  function imageDataUri(element, rect) {
    var source = element.getAttribute && element.getAttribute('src');
    if (source && source.indexOf('data:') === 0) return source;

    var naturalWidth = element.naturalWidth || element.width || 0;
    var naturalHeight = element.naturalHeight || element.height || 0;
    if (!naturalWidth || !naturalHeight) return null;

    try {
      var limit = Math.max(1, Math.ceil(Math.max(rect.width, rect.height) * 2));
      var scale = Math.min(1, limit / Math.max(naturalWidth, naturalHeight));
      var canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(naturalHeight * scale));
      var context = canvas.getContext('2d');
      if (!context) return null;
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    } catch (error) {
      return null;
    }
  }

  function canvasDataUri(element) {
    try {
      return element.toDataURL ? element.toDataURL('image/png') : null;
    } catch (error) {
      return null;
    }
  }

  function tableCells(row) {
    var cells = [];
    var children = row.children || [];
    for (var i = 0; i < children.length; i++) {
      var tag = children[i].tagName.toLowerCase();
      if (tag === 'td' || tag === 'th') cells.push(children[i]);
    }
    return cells;
  }

  function readTable(element, slide, rect) {
    var rowElements = element.rows || [];
    if (!rowElements.length) return null;

    var rows = [];
    var rowHeights = [];
    var columnWidths = [];

    for (var r = 0; r < rowElements.length; r++) {
      var rowElement = rowElements[r];
      var rowStyle = window.getComputedStyle(rowElement);
      if (isHidden(rowElement, rowStyle)) continue;

      var cells = tableCells(rowElement);
      if (!cells.length) continue;

      var row = [];
      for (var c = 0; c < cells.length; c++) {
        var cell = cells[c];
        var cellStyle = window.getComputedStyle(cell);
        var cellFill = readFill(cellStyle);
        var cellRect = readRect(cell, slide, cellStyle);
        var colSpan = cell.colSpan || 1;

        row.push({
          paragraphs: collectParagraphs(cell, null),
          colSpan: colSpan,
          rowSpan: cell.rowSpan || 1,
          fill: cellFill && cellFill.type !== 'none' ? cellFill : undefined,
          header: cell.tagName.toLowerCase() === 'th',
        });

        if (rows.length === 0) {
          var columnWidth = cellRect.width / colSpan;
          for (var s = 0; s < colSpan; s++) columnWidths.push(columnWidth);
        }
      }

      rowHeights.push(readRect(rowElement, slide, rowStyle).height);
      rows.push(row);
    }

    if (!rows.length) return null;

    return {
      kind: 'table',
      rect: rect,
      rows: rows,
      columnWidths: columnWidths,
      rowHeights: rowHeights,
    };
  }

  function shapeKind(rect, radius) {
    if (radius <= 0) return 'rect';
    if (radius >= Math.min(rect.width, rect.height) / 2 - 0.5) return 'ellipse';
    return 'roundRect';
  }

  function createContext() {
    return { entries: [], order: 0, warnings: {} };
  }

  function warn(context, code, message) {
    var existing = context.warnings[code];
    if (existing) {
      existing.count++;
      return;
    }
    context.warnings[code] = { code: code, message: message, count: 1 };
  }

  function emit(context, node, z) {
    context.entries.push({ z: z, order: context.order++, node: node });
  }

  function emitRaster(context, rect, reason, z) {
    emit(context, { kind: 'raster', rect: rect, reason: reason }, z);
    warn(context, 'raster:' + reason, reason + ' has no PowerPoint equivalent; flattened to a picture.');
  }

  var RASTER_TAGS = { svg: true, video: true, iframe: true, object: true, embed: true };

  function walk(element, slide, context, inheritedZ) {
    if (isSkippedTag(element)) return;

    var style = window.getComputedStyle(element);
    if (isHidden(element, style)) return;

    var rect = readRect(element, slide, style);
    if (!hasArea(rect) || isOffSlide(rect)) return;

    var z = readZIndex(style, inheritedZ);
    var tag = element.tagName.toLowerCase();

    var reason = unsupportedReason(element, style);
    if (reason) {
      emitRaster(context, rect, reason, z);
      return;
    }

    if (tag === 'img') {
      var data = imageDataUri(element, rect);
      if (data) {
        emit(context, {
          kind: 'image',
          rect: rect,
          data: data,
          sizing: imageSizing(style),
          alt: (element.getAttribute && element.getAttribute('alt')) || '',
        }, z);
      } else {
        emitRaster(context, rect, 'unreadable image', z);
      }
      return;
    }

    if (tag === 'canvas') {
      var canvasData = canvasDataUri(element);
      if (canvasData) {
        emit(context, {
          kind: 'image',
          rect: rect,
          data: canvasData,
          sizing: 'fill',
          alt: (element.getAttribute && element.getAttribute('aria-label')) || '',
        }, z);
        warn(context, 'canvas', 'Canvas content exports as a picture, not an editable chart.');
      } else {
        emitRaster(context, rect, 'canvas', z);
      }
      return;
    }

    if (RASTER_TAGS[tag] === true) {
      emitRaster(context, rect, tag, z);
      return;
    }

    if (tag === 'table') {
      var table = readTable(element, slide, rect);
      if (table) {
        emit(context, table, z);
        return;
      }
    }

    var fill = readFill(style);
    if (fill === null) {
      emitRaster(context, rect, 'background-image', z);
      return;
    }
    if (fill.type === 'gradient' && element.setAttribute) {
      element.setAttribute(FILL_CAPTURE_ATTR, '');
    }

    var lineInfo = readLine(style);
    if (lineInfo.partial) {
      warn(context, 'partial-border', 'A border on some sides only exports as a full outline.');
    }
    var shadow = readShadow(style);
    var paintsBox = fill.type !== 'none' || lineInfo.line !== null || shadow !== null;

    if (LIST_TAGS[tag] === true) {
      var listParagraphs = collectListParagraphs(element, slide);
      if (listParagraphs) {
        emit(context, {
          kind: 'text',
          rect: rect,
          paragraphs: listParagraphs,
          inset: readInset(style),
          lineCount: countRenderedLines(element),
          fill: fill.type !== 'none' ? fill : undefined,
          line: lineInfo.line || undefined,
          shadow: shadow || undefined,
        }, z);
        return;
      }
    }

    if (isTextLeaf(element) && hasVisibleText(element)) {
      var paragraphs = collectParagraphs(element, null);
      if (paragraphs.length) {
        emit(context, {
          kind: 'text',
          rect: rect,
          paragraphs: paragraphs,
          inset: readInset(style),
          lineCount: countRenderedLines(element),
          fill: fill.type !== 'none' ? fill : undefined,
          line: lineInfo.line || undefined,
          shadow: shadow || undefined,
        }, z);
        return;
      }
    }

    if (paintsBox) {
      var radius = readRadius(style, rect);
      emit(context, {
        kind: 'shape',
        rect: rect,
        shape: shapeKind(rect, radius),
        radius: radius,
        fill: fill,
        line: lineInfo.line || undefined,
        shadow: shadow || undefined,
      }, z);
    }

    var children = element.children || [];
    for (var i = 0; i < children.length; i++) walk(children[i], slide, context, z);
  }

  /**
   * The slide's own background, falling back through body and html - a deck that
   * paints its backdrop on <body> still gets the right slide fill.
   */
  function readBackground(slide) {
    var candidates = [slide, document.body, document.documentElement];
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      var fill = readFill(window.getComputedStyle(candidates[i]));
      if (fill && fill.type !== 'none') return fill;
    }
    return { type: 'none' };
  }

  function activeSlideElement() {
    for (var i = 0; i < SLIDE_SELECTORS.length; i++) {
      var found = document.querySelectorAll(SLIDE_SELECTORS[i]);
      if (!found.length) continue;

      for (var j = 0; j < found.length; j++) {
        var candidate = found[j];
        var style = window.getComputedStyle(candidate);
        if (isHidden(candidate, style)) continue;
        var box = candidate.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) return candidate;
      }
    }
    return document.body;
  }

  function extractScene(index) {
    var slide = activeSlideElement();
    var context = createContext();

    var children = slide.children || [];
    for (var i = 0; i < children.length; i++) walk(children[i], slide, context, 0);

    context.entries.sort(function (a, b) {
      return a.z - b.z || a.order - b.order;
    });

    var warnings = [];
    for (var code in context.warnings) {
      if (Object.prototype.hasOwnProperty.call(context.warnings, code)) {
        warnings.push(context.warnings[code]);
      }
    }

    return {
      index: index,
      background: readBackground(slide),
      nodes: context.entries.map(function (entry) { return entry.node; }),
      notes: null,
      warnings: warnings,
    };
  }
`
