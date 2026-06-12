export const DECK_KEYDOWN_MESSAGE_TYPE = 'ark:deck-keydown' as const

const previewFillStyle = `
<style data-ark-preview-fill>
  html,
  body {
    width: 100% !important;
    height: 100% !important;
    margin: 0 !important;
    padding: 0 !important;
    overflow: hidden !important;
  }

  *,
  *::before,
  *::after {
    box-sizing: border-box;
  }

</style>`

const previewBridgeScript = `
<script data-ark-preview-bridge>
(function () {
  var MESSAGE_TYPE = ${JSON.stringify(DECK_KEYDOWN_MESSAGE_TYPE)};

  window.addEventListener('message', function (event) {
    if (event.source !== window.parent) {
      return;
    }

    var data = event.data;

    if (!data || data.type !== MESSAGE_TYPE) {
      return;
    }

    var init = {
      key: data.key,
      code: data.code,
      bubbles: true,
      cancelable: true,
    };

    document.dispatchEvent(new KeyboardEvent('keydown', init));
    window.dispatchEvent(new KeyboardEvent('keydown', init));
  });
})();
</script>`

export function getPreviewHtml(html: string) {
  if (!html) {
    return ''
  }

  let previewHtml = html

  if (/<\/head>/i.test(previewHtml)) {
    previewHtml = previewHtml.replace(/<\/head>/i, `${previewFillStyle}\n</head>`)
  } else {
    previewHtml = `${previewFillStyle}\n${previewHtml}`
  }

  if (/<\/body>/i.test(previewHtml)) {
    return previewHtml.replace(/<\/body>/i, `${previewBridgeScript}\n</body>`)
  }

  return `${previewHtml}\n${previewBridgeScript}`
}
