const API_KEY = process.env.ALPHA_VANTAGE_API_KEY || ''
const BASE = 'https://www.alphavantage.co/query'

export async function getAlphaVantageQuote(symbol: string) {
  if (!API_KEY) return null
  const url = `${BASE}?function=GLOBAL_QUOTE&symbol=${symbol}&apikey=${API_KEY}`
  const res = await fetch(url)
  const data = await res.json() as Record<string, Record<string, string>>
  const q = data['Global Quote']
  if (!q) return null
  return {
    symbol: q['01. symbol'],
    price: parseFloat(q['05. price']),
    change: parseFloat(q['09. change']),
    changePercent: parseFloat(q['10. change percent']?.replace('%', '')),
  }
}
