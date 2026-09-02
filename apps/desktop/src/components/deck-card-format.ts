export function formatUpdatedAt(updatedAt: string) {
  const date = new Date(updatedAt)

  if (Number.isNaN(date.getTime())) {
    return 'Updated recently'
  }

  return `Updated ${date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })}`
}
