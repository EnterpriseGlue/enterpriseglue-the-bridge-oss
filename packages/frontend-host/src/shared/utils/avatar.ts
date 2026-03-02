export function getInitials(firstName: string | null, lastName: string | null): string {
  const first = (firstName || '').trim().charAt(0).toUpperCase()
  const last = (lastName || '').trim().charAt(0).toUpperCase()
  if (first && last) return first + last
  if (first) return first
  if (last) return last
  return '?'
}

export function getAvatarColor(userId: string): string {
  const colors = [
    '#0f62fe', // Blue
    '#FC5D0D', // Orange
    '#24a148', // Green
    '#8a3ffc', // Purple
    '#fa4d56', // Red
    '#007d79', // Teal
    '#f1c21b', // Yellow
    '#a56eff', // Violet
  ]
  let hash = 0
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}
