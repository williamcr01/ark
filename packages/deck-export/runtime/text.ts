/**
 * Text extraction for the in-page walk.
 *
 * A text node in the scene corresponds to one block element whose children are
 * only inline formatting. Inline descendants become runs inside a paragraph
 * rather than separate boxes, which is what keeps a styled sentence editable as
 * a single sentence in PowerPoint.
 */
export const textChunk = String.raw`
  var INLINE_TAGS = {
    a: true, abbr: true, b: true, bdi: true, bdo: true, cite: true, code: true,
    data: true, dfn: true, em: true, i: true, kbd: true, mark: true, q: true,
    s: true, samp: true, small: true, span: true, strong: true, sub: true,
    sup: true, time: true, u: true, var: true, wbr: true, br: true,
  };

  var LIST_TAGS = { ul: true, ol: true };

  function isInlineElement(element, style) {
    if (INLINE_TAGS[element.tagName.toLowerCase()] === true) return true;
    var display = style.display || '';
    return display.indexOf('inline') === 0 && display !== 'inline-block';
  }

  /**
   * True when every child is text or inline formatting, so the element's whole
   * subtree is one block of prose.
   */
  function isTextLeaf(element) {
    var children = element.children || [];
    for (var i = 0; i < children.length; i++) {
      var child = children[i];
      if (isSkippedTag(child)) continue;
      var childStyle = window.getComputedStyle(child);
      if (isHidden(child, childStyle)) continue;
      if (!isInlineElement(child, childStyle)) return false;
      if (!isTextLeaf(child)) return false;
    }
    return true;
  }

  function hasVisibleText(element) {
    var text = element.textContent || '';
    return text.replace(/\s+/g, '').length > 0;
  }

  function readAlign(style) {
    var align = (style.textAlign || '').toLowerCase();
    if (align === 'center') return 'center';
    if (align === 'right' || align === 'end') return 'right';
    if (align === 'justify') return 'justify';
    return 'left';
  }

  function readLineSpacing(style) {
    var lineHeight = parseFloat(style.lineHeight);
    if (!isFinite(lineHeight) || lineHeight <= 0) return undefined;
    return round(lineHeight * 0.75);
  }

  function readFontWeight(style) {
    var numeric = parseInt(style.fontWeight, 10);
    if (isFinite(numeric)) return numeric;

    var keyword = String(style.fontWeight || '').toLowerCase();
    if (keyword === 'bold' || keyword === 'bolder') return 700;
    if (keyword === 'lighter') return 300;
    return 400;
  }

  function runFromStyle(text, style, link) {
    var weight = readFontWeight(style);

    var color = normalizeColor(style.color) || { color: '000000', alpha: 1 };
    var decoration = (style.textDecorationLine || style.textDecoration || '').toLowerCase();
    var spacing = parseFloat(style.letterSpacing);
    var fontSize = parseFloat(style.fontSize);

    return {
      text: text,
      bold: weight >= 600,
      italic: style.fontStyle === 'italic' || style.fontStyle === 'oblique',
      underline: decoration.indexOf('underline') >= 0,
      strike: decoration.indexOf('line-through') >= 0,
      color: color.color,
      alpha: color.alpha,
      // Raw CSS stack: the host maps it through the font registry so the
      // typeface lookup has one implementation, in TypeScript.
      fontFace: style.fontFamily || '',
      fontSize: round((isFinite(fontSize) ? fontSize : 16) * 0.75),
      charSpacing: isFinite(spacing) ? round(spacing * 0.75) : 0,
      link: link || undefined,
      sourceWeight: weight,
    };
  }

  function collapseText(value, whiteSpace) {
    if (whiteSpace && whiteSpace.indexOf('pre') === 0) return value;
    return value.replace(/\s+/g, ' ');
  }

  /**
   * Walk one block element into paragraphs. A <br> starts a new paragraph, which
   * is how PowerPoint represents a hard line break inside a text box.
   */
  function collectParagraphs(element, baseBullet) {
    var style = window.getComputedStyle(element);
    var align = readAlign(style);
    var lineSpacing = readLineSpacing(style);
    var paragraphs = [];
    var runs = [];

    function flush() {
      var kept = [];
      for (var i = 0; i < runs.length; i++) {
        if (runs[i].text !== '') kept.push(runs[i]);
      }
      if (!kept.length) return;

      kept[0].text = kept[0].text.replace(/^ +/, '');
      kept[kept.length - 1].text = kept[kept.length - 1].text.replace(/ +$/, '');
      if (kept.length === 1 && kept[0].text === '') {
        runs = [];
        return;
      }

      var paragraph = { runs: kept, align: align };
      if (lineSpacing !== undefined) paragraph.lineSpacing = lineSpacing;
      if (baseBullet) paragraph.bullet = baseBullet;
      paragraphs.push(paragraph);
      runs = [];
    }

    function visit(node, inheritedStyle, link) {
      if (node.nodeType === 3) {
        var text = collapseText(node.nodeValue || '', inheritedStyle.whiteSpace);
        if (text === '') return;
        runs.push(runFromStyle(text, inheritedStyle, link));
        return;
      }
      if (node.nodeType !== 1) return;
      if (isSkippedTag(node)) return;

      var tag = node.tagName.toLowerCase();
      if (tag === 'br') {
        flush();
        return;
      }

      var nodeStyle = window.getComputedStyle(node);
      if (isHidden(node, nodeStyle)) return;

      var nodeLink = link;
      if (tag === 'a') {
        var href = node.getAttribute('href');
        if (href) nodeLink = href;
      }

      var children = node.childNodes;
      for (var i = 0; i < children.length; i++) visit(children[i], nodeStyle, nodeLink);
    }

    var childNodes = element.childNodes;
    for (var i = 0; i < childNodes.length; i++) visit(childNodes[i], style, null);
    flush();

    return paragraphs;
  }

  function listBulletType(listElement) {
    return listElement.tagName.toLowerCase() === 'ol' ? 'number' : 'bullet';
  }

  /** Nesting depth of a list inside other lists, for the bullet indent level. */
  function listLevel(listElement, slide) {
    var level = 0;
    var parent = listElement.parentElement;
    while (parent && parent !== slide) {
      if (LIST_TAGS[parent.tagName.toLowerCase()] === true) level++;
      parent = parent.parentElement;
    }
    return level;
  }

  /**
   * A list becomes one text box whose paragraphs are its items, so PowerPoint
   * gets real bullets. Only when every item is plain prose - an item holding
   * cards or images falls back to the ordinary walk.
   */
  function collectListParagraphs(listElement, slide) {
    var items = [];
    var children = listElement.children || [];
    for (var i = 0; i < children.length; i++) {
      if (children[i].tagName.toLowerCase() === 'li') items.push(children[i]);
    }
    if (!items.length) return null;

    var bullet = { type: listBulletType(listElement), level: listLevel(listElement, slide) };
    var paragraphs = [];

    for (var j = 0; j < items.length; j++) {
      var item = items[j];
      if (!isTextLeaf(item)) return null;
      var itemStyle = window.getComputedStyle(item);
      if (isHidden(item, itemStyle)) continue;
      var itemParagraphs = collectParagraphs(item, bullet);
      for (var k = 0; k < itemParagraphs.length; k++) paragraphs.push(itemParagraphs[k]);
    }

    return paragraphs.length ? paragraphs : null;
  }
`
