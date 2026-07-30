import { Common, dayjs, TZ_SHANGHAI } from '../common.ts'

import type { RouterMiddleware } from '@oak/oak'

class ServiceTodayInHistory {
  private cache = new Map<string, HistoryItem[]>()

  handle(): RouterMiddleware<'/today_in_history'> {
    return async (ctx) => {
      const date = ctx.request.url.searchParams.get('date')
      const data = await this.#fetch(date ?? undefined)

      switch (ctx.state.encoding) {
        case 'text':
          ctx.response.body = `历史上的今天 (${data.date})\n\n${data.items
            .map((e, idx) => `${idx + 1}. ${e.title} (${e.year} 年)`)
            .join('\n')}`
          break

        case 'markdown':
          ctx.response.body = `# 历史上的今天 (${data.date})\n\n${data.items
            .map((e, idx) => `### ${idx + 1}. [${e.title}](${e.link}) \`${e.year} 年\`\n\n${e.description}\n\n---\n`)
            .join('\n')}`
          break

        case 'json':
        default:
          ctx.response.body = Common.buildJson(data)
          break
      }
    }
  }

  async #fetch(date = dayjs().tz(TZ_SHANGHAI).toISOString()) {
    type AnyObject<T = any> = Record<number | string | symbol, T>

    const now = dayjs(date).tz(TZ_SHANGHAI)
    const todayField = now.format('MMDD')
    const monthAndDay = now.format('M-D')

    if (this.cache.has(monthAndDay)) {
      return {
        date: monthAndDay,
        month: now.month() + 1,
        day: now.date(),
        items: this.cache.get(monthAndDay)!.map((e) => ({
          title: e.title,
          year: e.year,
          description: e.desc,
          event_type: e.type,
          link: e.link,
        })),
      }
    }

    const res = await fetch(this.getHistoryApi(now.month() + 1))
    const monthEvents: AnyObject<AnyObject<AnyObject[]>> = await res.json()
    const todayEvents = monthEvents?.[String(now.format('MM'))]?.[todayField] ?? []

    todayEvents.sort((a, b) => a.year - b.year)

    const modifiedTodayEvents = todayEvents.map((e) => {
      let desc = this.transformChars(e.desc as string)

      if (!desc.endsWith('.') && !desc.endsWith('。')) desc += '...'

      return {
        title: this.transformChars(e.title as string),
        year: e.year as string,
        date: monthAndDay,
        desc: desc,
        type: e.type as 'birth' | 'death' | 'event',
        link: e.link as string,
      }
    })

    this.cache.set(monthAndDay, modifiedTodayEvents)

    return {
      date: monthAndDay,
      month: now.month() + 1,
      day: now.date(),
      items: modifiedTodayEvents.map((e) => {
        return {
          title: e.title,
          year: e.year,
          description: e.desc,
          event_type: e.type,
          link: e.link,
        }
      }),
    }
  }

  private getHistoryApi = (month = dayjs().tz(TZ_SHANGHAI).month() + 1) => {
    const filename = `${String(month).padStart(2, '0')}.json`
    return `https://baike.baidu.com/cms/home/eventsOnHistory/${filename}`
  }

  private transformChars = (text: string) => {
    return text.replace(/<.*?>/g, '').replace(/&#(\d+);/g, (_, $1) => String.fromCharCode($1))
  }
}

export const serviceTodayInHistory = new ServiceTodayInHistory()

interface HistoryItem {
  title: string
  year: string
  date: string
  desc: string
  type: 'birth' | 'death' | 'event'
  link: string
}
