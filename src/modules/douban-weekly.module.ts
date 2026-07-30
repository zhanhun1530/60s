import { Common } from '../common.ts'

import type { RouterMiddleware } from '@oak/oak'

type DoubanCategory = 'movie' | 'tv_chinese' | 'tv_global' | 'show_chinese' | 'show_global'

interface DoubanRawItem {
  rank: number
  rank_value_changed: number
  trend_up: boolean
  trend_down: boolean
  title: string
  id: string
  rating: {
    value: number
    count: number
  }
  card_subtitle: string
  description: string
  cover_url: string
  url: string
  good_rating_stats: number
  tags: Array<{ name: string; type: string }>
}

interface DoubanWeeklyItem {
  rank: number
  title: string
  id: string
  rating: number
  rating_count: number
  good_rate: number
  trend: 'up' | 'down' | 'equal'
  rank_change: number
  card_subtitle: string
  description: string
  cover: string
  cover_proxy: string
  url: string
  tags: string[]
}

const CATEGORY_CONFIG: Record<DoubanCategory, { collection: string; title: string; emoji: string }> = {
  movie: {
    collection: 'movie_weekly_best',
    title: '一周口碑电影榜',
    emoji: '🎬',
  },
  tv_chinese: {
    collection: 'tv_chinese_best_weekly',
    title: '一周口碑国内剧集榜',
    emoji: '📺',
  },
  tv_global: {
    collection: 'tv_global_best_weekly',
    title: '一周口碑全球剧集榜',
    emoji: '🌍',
  },
  show_chinese: {
    collection: 'show_chinese_best_weekly',
    title: '一周口碑国内综艺榜',
    emoji: '🎤',
  },
  show_global: {
    collection: 'show_global_best_weekly',
    title: '一周口碑全球综艺榜',
    emoji: '🌍',
  },
}

const DOUBAN_BASE_URL = 'https://m.douban.com/rexxar/api/v2/subject_collection'
const DOUBAN_REFERER = 'https://m.douban.com/subject_collection'
const DOUBAN_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

const TREND_SYMBOL: Record<string, string> = {
  up: '↑',
  down: '↓',
  equal: '-',
}

function transformItem(raw: DoubanRawItem): DoubanWeeklyItem {
  const trend = raw.trend_up ? 'up' : raw.trend_down ? 'down' : 'equal'
  return {
    rank: raw.rank,
    title: raw.title,
    id: raw.id,
    rating: raw.rating?.value ?? 0,
    rating_count: raw.rating?.count ?? 0,
    good_rate: raw.good_rating_stats ?? 0,
    trend,
    rank_change: raw.rank_value_changed ?? 0,
    card_subtitle: raw.card_subtitle ?? '',
    description: raw.description ?? '',
    cover: raw.cover_url,
    // cover_proxy: raw.cover_url,
    cover_proxy: raw.cover_url.replace(/https:\/\/img\w*\.doubanio\.com/, 'https://doubanio.viki.moe'),
    url: raw.url,
    tags: (raw.tags ?? []).map((t) => t.name).filter(Boolean),
  }
}

class ServiceDoubanWeekly {
  private cache = new Map<DoubanCategory, { data: DoubanWeeklyItem[]; timestamp: number }>()
  private readonly CACHE_TTL = 60 * 60 * 1000 // 1 hour

  handle(category: DoubanCategory): RouterMiddleware<string> {
    return async (ctx) => {
      const config = CATEGORY_CONFIG[category]
      const data = await this.#fetch(category)

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = `豆瓣${config.title}\n\n${data
            .map((e) => {
              const trend = e.rank_change ? `${TREND_SYMBOL[e.trend]}${Math.abs(e.rank_change)}` : TREND_SYMBOL[e.trend]
              const rating = e.rating ? `⭐${e.rating}` : '暂无评分'
              return `${e.rank}. ${e.title} ${rating} ${trend}\n   ${e.card_subtitle}`
            })
            .join('\n')}\n\n数据来源：豆瓣`
          break

        case 'markdown':
          ctx.response.body = `# ${config.emoji} 豆瓣${config.title}\n\n| 排名 | 名称 | 评分 | 好评率 | 简介 | 趋势 |\n|------|------|------|--------|------|------|\n${data
            .map((e) => {
              const trend = e.rank_change ? `${TREND_SYMBOL[e.trend]}${Math.abs(e.rank_change)}` : TREND_SYMBOL[e.trend]
              const rating = e.rating ? `⭐${e.rating}` : '暂无'
              return `| ${e.rank} | [${e.title}](${e.url}) | ${rating} (${e.rating_count}人) | ${e.good_rate}% | ${e.card_subtitle} | ${trend} |`
            })
            .join('\n')}\n\n*数据来源: 豆瓣*`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson(data)
          break
      }
    }
  }

  async #fetch(category: DoubanCategory): Promise<DoubanWeeklyItem[]> {
    const cached = this.cache.get(category)
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
      return cached.data
    }

    const { collection } = CATEGORY_CONFIG[category]
    const url = `${DOUBAN_BASE_URL}/${collection}/items?start=0&count=10&items_only=1&for_mobile=1`

    const res = await fetch(url, {
      headers: {
        'User-Agent': DOUBAN_UA,
        Referer: DOUBAN_REFERER,
      },
    })

    const json = await res.json()
    const items: DoubanWeeklyItem[] = ((json.subject_collection_items ?? []) as DoubanRawItem[])
      .map(transformItem)
      .sort((a, b) => a.rank - b.rank)

    if (items.length > 0) {
      this.cache.set(category, { data: items, timestamp: Date.now() })
    }

    return items
  }
}

export const serviceDoubanWeekly = new ServiceDoubanWeekly()
