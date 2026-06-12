import 'dotenv/config'

import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import express, { type Request, type Response } from 'express'

const app = express()
const port = Number(process.env.PORT ?? 8787)
const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini'

app.use(express.json({ limit: '4mb' }))

type GenerateRequest = {
  prompt?: string
  currentHtml?: string | null
}

const deckSystemPrompt = `You are Ark, an expert presentation designer and front-end engineer.

Create polished PowerPoint-like slide decks as a single self-contained HTML document.

Hard requirements:
- Return only the complete HTML document. Do not wrap it in markdown fences.
- Include <!DOCTYPE html>, <html>, <head>, and <body>.
- Use inline CSS inside a <style> tag. Do not require Tailwind, npm packages, external JavaScript, or build tooling.
- The deck must work inside an iframe via srcdoc and as a downloaded .html file.
- Design for a 16:9 presentation viewport.
- Set html and body to width: 100%; height: 100%; margin: 0; overflow: hidden.
- Make the active slide fill the viewport exactly: width: 100vw; height: 100vh.
- Make each slide a clearly separated <section class="slide"> with useful semantic content. Do not nest slide sections inside other slide sections.
- Put all slides in the DOM at once. Do not inject slides dynamically.
- Keep copy concise, presentation-grade, and visually scannable.
- Use a coherent visual system: typography, spacing, color palette, hierarchy, and slide rhythm.
- Avoid generic AI filler, fake citations, lorem ipsum, and vague business jargon.
- If the user asks for edits and current HTML is provided, revise the deck and return the full updated HTML document.

Preview modes:
- Default (no marker): Ark preview strips deck scripts and injects its own navigation shim. Shell arrow keys and thumbnails work without deck JavaScript. Uploaded decks without an Ark marker always use this path.
- Full-JS (explicit opt-in only): set data-ark-deck="nav" on <html> when the deck owns navigation, or data-ark-preview="full-js" for libraries/charts without nav ownership. Ark runs deck JavaScript and injects only a thin bridge. Preview is download-like but not identical (sandbox may block history.replaceState, storage, popups, etc.).
- Thumbnails always strip scripts and remain static.

When including navigation script (data-ark-deck="nav"), follow this exact pattern:
- Use zero-based slide index, clamp in setSlide.
- Listen for document CustomEvent "ark:deck-goto" with detail.index from the Ark bridge.
- Dispatch document CustomEvent "ark:deck-slide-change" with detail.index on every slide change. Do not call window.parent.postMessage.
- Avoid history.replaceState / history.pushState for slide URLs (they fail in sandboxed preview); use in-memory index only.
- Update standard HUD IDs when present: currentSlide, totalSlides, progressBar, prevSlide, nextSlide.

Canonical navigation script:

<html data-ark-deck="nav">
...
<script>
(() => {
  const slides = [...document.querySelectorAll('section.slide')];
  const currentEl = document.getElementById('currentSlide');
  const totalEl = document.getElementById('totalSlides');
  const progressEl = document.getElementById('progressBar');
  const prevEl = document.getElementById('prevSlide');
  const nextEl = document.getElementById('nextSlide');
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  let index = 0;

  function setSlide(nextIndex) {
    index = Math.max(0, Math.min(slides.length - 1, nextIndex));
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle('active', active);
      slide.setAttribute('aria-hidden', String(!active));
    });
    if (currentEl) currentEl.textContent = pad(index + 1);
    if (totalEl) totalEl.textContent = pad(slides.length);
    if (progressEl) progressEl.style.width = \`\${((index + 1) / slides.length) * 100}%\`;
    if (prevEl) prevEl.disabled = index === 0;
    if (nextEl) nextEl.disabled = index === slides.length - 1;
    document.dispatchEvent(new CustomEvent('ark:deck-slide-change', { detail: { index } }));
  }

  document.addEventListener('ark:deck-goto', (e) => setSlide(e.detail.index));
  if (prevEl) prevEl.addEventListener('click', () => setSlide(index - 1));
  if (nextEl) nextEl.addEventListener('click', () => setSlide(index + 1));
  setSlide(0);
})();
</script>

External JavaScript libraries (e.g. Chart.js, reveal.js via CDN script tags) are allowed when data-ark-deck="nav" or data-ark-preview="full-js" is set. Prefer self-contained inline scripts for navigation.

Safety and portability:
- Do not include analytics, tracking, forms, or nested iframes.
- External fonts or CSS imports are allowed only if the deck still looks good without them.`

const buildPrompt = ({ prompt, currentHtml }: { prompt: string; currentHtml: string }) => {
  if (currentHtml.trim()) {
    return `The user wants to revise the existing Ark HTML deck.

User instruction:
${prompt}

Current full HTML deck:
${currentHtml}

Return the complete revised HTML document only.`
  }

  return `Create a new complete Ark HTML slide deck from this user request:

${prompt}

Return the complete HTML document only.`
}

const extractHtmlDocument = (text: string) => {
  const withoutFence = text
    .replace(/^```(?:html)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()

  const doctypeIndex = withoutFence.search(/<!doctype html>/i)
  if (doctypeIndex >= 0) {
    return withoutFence.slice(doctypeIndex).trim()
  }

  const htmlIndex = withoutFence.search(/<html[\s>]/i)
  if (htmlIndex >= 0) {
    return `<!DOCTYPE html>\n${withoutFence.slice(htmlIndex).trim()}`
  }

  return withoutFence
}

const isHtmlDocument = (html: string) =>
  /<!doctype html>/i.test(html) && /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)

app.get('/api/health', (_request: Request, response: Response) => {
  response.json({ ok: true, model })
})

app.post('/api/generate', async (request: Request<unknown, unknown, GenerateRequest>, response: Response) => {
  const prompt = request.body.prompt?.trim() ?? ''
  const currentHtml = request.body.currentHtml ?? ''

  if (!process.env.OPENAI_API_KEY) {
    response.status(500).json({
      error: 'Missing OPENAI_API_KEY. Add it to .env and restart the dev server.',
    })
    return
  }

  if (!prompt) {
    response.status(400).json({ error: 'Prompt is required.' })
    return
  }

  try {
    const result = await generateText({
      model: openai(model),
      system: deckSystemPrompt,
      prompt: buildPrompt({ prompt, currentHtml }),
      maxOutputTokens: 12_000,
      temperature: 0.7,
    })

    const html = extractHtmlDocument(result.text)

    if (!isHtmlDocument(html)) {
      response.status(502).json({
        error: 'The model did not return a complete HTML document. Try again with a more specific prompt.',
      })
      return
    }

    response.json({ html })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown generation error.'
    response.status(500).json({ error: message })
  }
})

app.listen(port, () => {
  console.log(`Ark API server listening on http://localhost:${port}`)
})
