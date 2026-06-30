export function downloadHtml(html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ark-presentation-${new Date().toISOString().slice(0, 10)}.html`
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export function isHtmlDeckFile(file: File) {
  return (
    file.type === 'text/html' ||
    file.name.toLowerCase().endsWith('.html') ||
    file.name.toLowerCase().endsWith('.htm')
  )
}

export function isCompleteHtmlDeck(html: string) {
  return /<html[\s>]/i.test(html) && /<body[\s>]/i.test(html)
}
