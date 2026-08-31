/**
 * Value parsing for the in-page walk: colours, gradients, lines, shadows.
 *
 * These run inside the render window as plain ES5-ish JavaScript, so the chunk is
 * a string rather than a module. Every reader is defensive about missing values:
 * the same source runs under JSDOM in tests, where computed styles are sparser
 * than in Chromium.
 */
export const valuesChunk = String.raw`
  var COLOR_CONTEXT;

  function colorContext() {
    if (COLOR_CONTEXT !== undefined) return COLOR_CONTEXT;
    try {
      var canvas = document.createElement('canvas');
      COLOR_CONTEXT = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    } catch (error) {
      COLOR_CONTEXT = null;
    }
    return COLOR_CONTEXT;
  }

  function clampChannel(value) {
    if (!isFinite(value)) return 0;
    return Math.max(0, Math.min(255, Math.round(value)));
  }

  function toHex(r, g, b) {
    var value = (clampChannel(r) << 16) | (clampChannel(g) << 8) | clampChannel(b);
    return ('000000' + value.toString(16)).slice(-6).toUpperCase();
  }

  function parseColorLiteral(raw) {
    var value = String(raw).trim();

    var hex = /^#([0-9a-f]{3,8})$/i.exec(value);
    if (hex) {
      var digits = hex[1];
      if (digits.length === 3 || digits.length === 4) {
        var expanded = '';
        for (var i = 0; i < digits.length; i++) expanded += digits[i] + digits[i];
        digits = expanded;
      }
      if (digits.length !== 6 && digits.length !== 8) return null;
      return {
        color: digits.slice(0, 6).toUpperCase(),
        alpha: digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1,
      };
    }

    var rgb = /^rgba?\(([^)]+)\)$/i.exec(value);
    if (rgb) {
      var parts = rgb[1].split(/[,\/\s]+/).filter(Boolean);
      if (parts.length < 3) return null;
      var alpha = 1;
      if (parts.length > 3) {
        alpha = parts[3].indexOf('%') >= 0 ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        if (!isFinite(alpha)) alpha = 1;
      }
      return {
        color: toHex(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])),
        alpha: Math.max(0, Math.min(1, alpha)),
      };
    }

    return null;
  }

  /**
   * Normalise any CSS colour to hex plus alpha. Computed styles are usually
   * already rgb()/rgba(), but a canvas round-trip resolves the rest - named
   * colours, and the wide-gamut syntaxes Chromium may hand back. Two sentinels
   * catch a value the canvas rejected, which would otherwise read as black.
   */
  function normalizeColor(value) {
    if (!value) return null;
    var raw = String(value).trim();
    if (!raw || raw === 'none' || raw === 'transparent') return null;

    var direct = parseColorLiteral(raw);
    if (direct) return direct;

    var context = colorContext();
    if (!context) return null;

    try {
      context.fillStyle = '#000000';
      context.fillStyle = raw;
      var resolved = context.fillStyle;
      context.fillStyle = '#FFFFFF';
      context.fillStyle = raw;
      if (context.fillStyle !== resolved) return null;
      return parseColorLiteral(String(resolved));
    } catch (error) {
      return null;
    }
  }

  function px(value) {
    var parsed = parseFloat(value);
    return isFinite(parsed) ? parsed : 0;
  }

  /** Split on top-level commas, so the commas inside rgba() stay put. */
  function splitTopLevel(value) {
    var parts = [];
    var depth = 0;
    var current = '';

    for (var i = 0; i < value.length; i++) {
      var character = value[i];
      if (character === '(') depth++;
      if (character === ')') depth--;
      if (character === ',' && depth === 0) {
        parts.push(current);
        current = '';
        continue;
      }
      current += character;
    }
    if (current.trim()) parts.push(current);

    return parts.map(function (part) { return part.trim(); }).filter(Boolean);
  }

  var GRADIENT_SIDE_ANGLES = {
    'to top': 0,
    'to right': 90,
    'to bottom': 180,
    'to left': 270,
    'to top right': 45,
    'to right top': 45,
    'to bottom right': 135,
    'to right bottom': 135,
    'to bottom left': 225,
    'to left bottom': 225,
    'to top left': 315,
    'to left top': 315,
  };

  /**
   * Parse a single linear-gradient into stops. Radial, conic, and repeating
   * gradients have no OOXML equivalent and return null so the caller rasterizes.
   */
  function parseLinearGradient(value) {
    var match = /^linear-gradient\(([\s\S]*)\)$/i.exec(String(value).trim());
    if (!match) return null;

    var parts = splitTopLevel(match[1]);
    if (!parts.length) return null;

    // CSS defaults to "to bottom" when no direction is given.
    var angle = 180;
    var head = parts[0].toLowerCase();
    if (/^-?[\d.]+deg$/.test(head)) {
      angle = parseFloat(head);
      parts.shift();
    } else if (/^to\s/.test(head)) {
      var named = GRADIENT_SIDE_ANGLES[head.replace(/\s+/g, ' ')];
      if (named === undefined) return null;
      angle = named;
      parts.shift();
    }
    if (parts.length < 2) return null;

    var stops = [];
    for (var i = 0; i < parts.length; i++) {
      var stop = parts[i];
      var position = null;
      var positionMatch = /\s(-?[\d.]+)%$/.exec(stop);
      if (positionMatch) {
        position = parseFloat(positionMatch[1]);
        stop = stop.slice(0, positionMatch.index);
      }
      var color = normalizeColor(stop.trim());
      if (!color) return null;
      stops.push({
        color: color.color,
        alpha: color.alpha,
        position: position === null ? (i / (parts.length - 1)) * 100 : position,
      });
    }

    return { type: 'gradient', angle: ((angle % 360) + 360) % 360, stops: stops };
  }

  var NO_FILL = { type: 'none' };

  function readFill(style) {
    var image = style.backgroundImage;
    if (image && image !== 'none') {
      var layers = splitTopLevel(image);
      // Only a single linear-gradient layer maps; anything stacked does not.
      if (layers.length === 1) {
        var gradient = parseLinearGradient(layers[0]);
        if (gradient) return gradient;
      }
      return null;
    }

    var color = normalizeColor(style.backgroundColor);
    if (!color || color.alpha === 0) return NO_FILL;
    return { type: 'solid', color: color.color, alpha: color.alpha };
  }

  function borderDash(styleName) {
    if (styleName === 'dashed') return 'dash';
    if (styleName === 'dotted') return 'dot';
    return 'solid';
  }

  /**
   * OOXML gives a shape one outline, so only a border that is uniform on all
   * four sides survives. A partial border (an underline rule, a left accent bar)
   * is reported so the caller can keep it as its own thin shape.
   */
  function readLine(style) {
    var widths = [
      px(style.borderTopWidth),
      px(style.borderRightWidth),
      px(style.borderBottomWidth),
      px(style.borderLeftWidth),
    ];
    var visible = widths.filter(function (width) { return width > 0; });
    if (!visible.length) return { line: null, partial: false };

    var uniform =
      widths[0] === widths[1] && widths[1] === widths[2] && widths[2] === widths[3];
    if (!uniform) return { line: null, partial: true };

    var styleName = style.borderTopStyle;
    if (!styleName || styleName === 'none' || styleName === 'hidden') {
      return { line: null, partial: false };
    }

    var color = normalizeColor(style.borderTopColor);
    if (!color || color.alpha === 0) return { line: null, partial: false };

    return {
      line: {
        color: color.color,
        width: widths[0],
        dash: borderDash(styleName),
        alpha: color.alpha,
      },
      partial: false,
    };
  }

  /** First outer box-shadow only; OOXML carries one shadow per shape. */
  function readShadow(style) {
    var value = style.boxShadow;
    if (!value || value === 'none') return null;

    var first = splitTopLevel(value)[0];
    if (!first || /(^|\s)inset(\s|$)/.test(first)) return null;

    var color = null;
    var rest = first;
    var colorMatch = /^(rgba?\([^)]*\)|#[0-9a-f]{3,8})\s*/i.exec(first);
    if (colorMatch) {
      color = normalizeColor(colorMatch[1]);
      rest = first.slice(colorMatch[0].length);
    } else {
      var trailing = /\s(rgba?\([^)]*\)|#[0-9a-f]{3,8})$/i.exec(first);
      if (trailing) {
        color = normalizeColor(trailing[1]);
        rest = first.slice(0, trailing.index);
      }
    }
    if (!color || color.alpha === 0) return null;

    var lengths = rest.trim().split(/\s+/).map(px);
    if (lengths.length < 2) return null;

    return {
      color: color.color,
      alpha: color.alpha,
      offsetX: lengths[0],
      offsetY: lengths[1],
      blur: lengths.length > 2 ? lengths[2] : 0,
    };
  }
`
