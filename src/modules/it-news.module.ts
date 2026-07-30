import { Common, dayjs, TZ_SHANGHAI } from '../common.ts'
import { load } from 'cheerio'
import type { RouterMiddleware } from '@oak/oak'

const RSS_URL = 'https://www.ithome.com/rss/'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
const CACHE_TTL_MS = 10 * 60 * 1000 // 10 分钟

interface ITNewsItem {
  title: string
  link: string
  description: string
  created: string
  created_at: number
}

interface ITNewsRankItem {
  title: string
  link: string
}

interface ITNewsRank {
  type: 'day' | 'week' | 'month'
  list: ITNewsRankItem[]
}

interface CacheEntry {
  items: ITNewsItem[]
  timestamp: number
}

interface RankCacheEntry {
  ranks: ITNewsRank[]
  timestamp: number
}

class ServiceITNews {
  #cache: CacheEntry | null = null
  #rankCache: RankCacheEntry | null = null

  handle(): RouterMiddleware<'/it-news'> {
    return async (ctx) => {
      let limit = Number.parseInt(ctx.request.url.searchParams.get('limit') || '') || DEFAULT_LIMIT
      limit = Math.min(limit, MAX_LIMIT)
      const items = (await this.#fetch()).slice(0, limit)

      switch (ctx.state.encoding) {
        case 'text': {
          ctx.response.body = `实时 IT 资讯\n\n${items.map((e, idx) => `${idx + 1}. ${e.title}`).join('\n')}`
          break
        }

        case 'markdown': {
          ctx.response.body = `# 实时 IT 资讯\n\n${items
            .map(
              (e, idx) =>
                `### ${idx + 1}. [${e.title}](${e.link})\n\n${e.description ? `${e.description}\n\n` : ''}**发布时间**：${e.created}\n\n---\n`,
            )
            .join('\n')}`
          break
        }

        case 'json':
        default: {
          ctx.response.body = Common.buildJson(items)
          break
        }
      }
    }
  }

  handleRank(): RouterMiddleware<'/it-news'> {
    return async (ctx) => {
      const rankType = ctx.request.url.searchParams.get('type') || 'day'
      const ranks = await this.#fetchRanks()
      const found = ranks.find((r) => r.type === rankType)

      if (!found) {
        ctx.response.status = 400
        ctx.response.body = Common.buildJson({ error: 'Invalid rank type. Must be one of "day", "week", or "month".' })
        return
      }

      switch (ctx.state.encoding) {
        case 'text': {
          ctx.response.body = `IT 之家${rankType === 'day' ? '日' : rankType === 'week' ? '周' : '月'}榜\n\n${
            found.list.map((e, idx) => `${idx + 1}. ${e.title}`).join('\n') ?? ''
          }`
          break
        }

        case 'markdown': {
          ctx.response.body = `# IT 之家${rankType === 'day' ? '日' : rankType === 'week' ? '周' : '月'}榜\n\n${
            found.list.map((e, idx) => `${idx + 1}. [${e.title}](${e.link})`).join('\n\n') ?? ''
          }`
          break
        }

        case 'json':
        default: {
          ctx.response.body = Common.buildJson(found.list || [])
          break
        }
      }
    }
  }

  async #fetchRanks(): Promise<ITNewsRank[]> {
    if (this.#rankCache && Date.now() - this.#rankCache.timestamp < CACHE_TTL_MS) {
      return this.#rankCache.ranks
    }

    const html = await (await fetch('https://www.ithome.com/', { headers: { 'User-Agent': Common.chromeUA } })).text()
    const $ = load(html)
    const ranksWrap = $('#rank')

    const parseList = (selector: string): ITNewsRankItem[] => {
      const items: ITNewsRankItem[] = []
      ranksWrap
        .find(selector)
        .find('li')
        .each((_, el) => {
          const a = $(el).find('a').first()
          const title = a.attr('title') || a.text().trim()
          const link = a.attr('href') || ''
          if (title && link) items.push({ title, link })
        })

      return items
    }

    const ranks: ITNewsRank[] = [
      { type: 'day', list: parseList('#d-1') },
      { type: 'week', list: parseList('#d-2') },
      { type: 'month', list: parseList('#d-3') },
    ]

    this.#rankCache = { ranks, timestamp: Date.now() }
    return ranks
  }

  async #fetch(): Promise<ITNewsItem[]> {
    if (this.#cache && Date.now() - this.#cache.timestamp < CACHE_TTL_MS) {
      return this.#cache.items
    }

    const response = await fetch(RSS_URL, {
      headers: { 'User-Agent': Common.chromeUA },
    })

    if (!response.ok) {
      if (this.#cache) return this.#cache.items
      throw new Error(`HTTP ${response.status}`)
    }

    const xml = await response.text()
    const items = this.#parseRSS(xml)

    this.#cache = { items, timestamp: Date.now() }
    return items
  }

  #parseRSS(xml: string): ITNewsItem[] {
    const $ = load(xml, { xmlMode: true })
    const items: ITNewsItem[] = []

    $('item').each((_, el) => {
      const title = $(el).find('title').first().text().trim()
      const link = $(el).find('link').first().text().trim()
      const description = ($(el).find('description').first().text() ?? '').replace(/<[^>]+>/g, '').trim()
      const pubDateRaw = $(el).find('pubDate').first().text().trim()
      const created_at = pubDateRaw ? new Date(pubDateRaw).getTime() : Date.now()
      const created = dayjs(created_at).tz(TZ_SHANGHAI).format('YYYY-MM-DD HH:mm:ss')

      if (title && link) {
        items.push({
          title,
          description: description.length >= 360 ? description.slice(0, 360) + '...' : description,
          link,
          created,
          created_at,
        })
      }
    })

    return items
  }
}

export const serviceITNews = new ServiceITNews()
