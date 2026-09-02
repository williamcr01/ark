export const arkManagedDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <h1 data-ark-id="ark-el-title" data-ark-editable="true" data-ark-role="title">Opening</h1>
    <p
      data-ark-id="ark-el-body"
      data-ark-managed="true"
      data-ark-editable="true"
      data-ark-role="body"
      style="position: absolute; left: 48px; top: 120px; width: 640px; height: 80px; z-index: 2;"
    >Managed body copy</p>
    <p data-ark-id="ark-el-locked" data-ark-locked="true">Do not edit</p>
    <aside class="notes">Speaker only</aside>
  </section>
  <section class="slide" data-ark-slide-id="ark-slide-second">
    <h2 data-ark-id="ark-el-title-2" data-ark-editable="true">Second slide</h2>
  </section>
</body>
</html>`

export const arkManagedLinkDeck = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Managed Link Deck</title>
  <style>section.slide { width: 100vw; height: 100vh; }</style>
</head>
<body>
  <section class="slide" data-ark-slide-id="ark-slide-title">
    <a
      data-ark-id="ark-el-link"
      data-ark-managed="true"
      data-ark-editable="true"
      href="/internal/link"
      style="position: absolute; left: 48px; top: 220px; width: 420px; z-index: 3;"
    >Managed link</a>
  </section>
</body>
</html>`

export const inlineSvgDeck = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><title>SVG</title></head>
<body>
  <section class="slide">
    <svg data-ark-id="ark-el-svg" style="left: 200px" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" /></svg>
  </section>
</body>
</html>`

export const tinyPngDataUrl =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
