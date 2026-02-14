export function isMarketOpen(): boolean {
  const now = new Date()
  const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const day = et.getDay()
  const hours = et.getHours()
  const minutes = et.getMinutes()
  const time = hours * 60 + minutes
  if (day === 0 || day === 6) return false
  return time >= 570 && time <= 960 // 9:30 AM - 4:00 PM ET
}

export function getRefreshInterval(autoRefresh: boolean): number | false {
  if (!autoRefresh) return false
  return isMarketOpen() ? 30_000 : 300_000
}
