/** Colour sampling, so selection chrome can contrast with whatever is behind it. */
export const surfaceChunk = `  function parseColor(value) {
    var match = String(value || '').match(/rgba?\\(([^)]+)\\)/i);

    if (!match) {
      try {
        var canvas = parseColor.canvas || (parseColor.canvas = document.createElement('canvas'));
        canvas.width = 1;
        canvas.height = 1;
        var context = canvas.getContext && canvas.getContext('2d');

        if (!context) {
          return null;
        }

        context.clearRect(0, 0, 1, 1);
        context.fillStyle = '#010203';
        var sentinel = context.fillStyle;
        context.fillStyle = String(value || '');

        if (context.fillStyle === sentinel) {
          return null;
        }

        context.fillRect(0, 0, 1, 1);
        var pixel = context.getImageData(0, 0, 1, 1).data;
        return { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 };
      } catch (error) {
        return null;
      }
    }

    var parts = match[1].split(/[\\s,\\/]+/).filter(Boolean).map(Number);

    if (parts.length < 3 || parts.some(function (part) { return !Number.isFinite(part); })) {
      return null;
    }

    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function compositeColor(foreground, background) {
    var alpha = foreground.a + background.a * (1 - foreground.a);

    if (!alpha) {
      return { r: 255, g: 255, b: 255, a: 0 };
    }

    return {
      r: (foreground.r * foreground.a + background.r * background.a * (1 - foreground.a)) / alpha,
      g: (foreground.g * foreground.a + background.g * background.a * (1 - foreground.a)) / alpha,
      b: (foreground.b * foreground.a + background.b * background.a * (1 - foreground.a)) / alpha,
      a: alpha,
    };
  }

  function colorSurface(color) {
    var channels = [color.r, color.g, color.b].map(function (channel) {
      var value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
    });
    var luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];

    return luminance >= 0.5 ? 'light' : 'dark';
  }

  function averageGradient(image) {
    var value = String(image || '');

    if (!/gradient\\(/i.test(value)) {
      return null;
    }

    var matches = value.replace(/url\\([^)]*\\)/gi, '').match(/rgba?\\([^)]+\\)/gi) || [];
    var colors = matches.map(parseColor).filter(Boolean);

    if (!colors.length) {
      return null;
    }

    return {
      r: colors.reduce(function (sum, color) { return sum + color.r; }, 0) / colors.length,
      g: colors.reduce(function (sum, color) { return sum + color.g; }, 0) / colors.length,
      b: colors.reduce(function (sum, color) { return sum + color.b; }, 0) / colors.length,
      a: 1,
    };
  }

  function detectSurface(element, slide) {
    var current = element;
    var foreground = null;
    var gradient = null;

    while (current && current.nodeType === 1) {
      var computed = window.getComputedStyle(current);
      var color = parseColor(computed.backgroundColor);

      if (color && color.a > 0) {
        foreground = foreground ? compositeColor(foreground, color) : color;

        if (foreground.a >= 0.99) {
          return colorSurface(foreground);
        }
      }

      if (!gradient && computed.backgroundImage && computed.backgroundImage !== 'none') {
        gradient = averageGradient(computed.backgroundImage);
      }

      current = current.parentElement;
    }

    if (foreground) {
      return colorSurface(compositeColor(foreground, { r: 255, g: 255, b: 255, a: 1 }));
    }

    return gradient ? colorSurface(gradient) : 'light';
  }
`
