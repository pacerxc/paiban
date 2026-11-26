import type { AppData } from '../types'
import { addDays, formatMonthDay, monthDates, parseISO, weekdayLabel } from './date'
import { planRange } from './scheduler'
import type { DayPlan } from './scheduler'

function download(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function exportCsv(rows: Array<Array<string | number>>, filename: string): void {
  const text = rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
  download('\uFEFF' + text, filename, 'text/csv;charset=utf-8')
}

export function exportJson(data: AppData): void {
  download(
    JSON.stringify(data, null, 2),
    `排班数据_${new Date().toISOString().slice(0, 10)}.json`,
    'application/json',
  )
}

function dayLabel(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()} ${weekdayLabel(date)}`
}

/** 某人在某天的状态文字（依赖已算好的 plan，避免重复排班） */
function personDayText(
  data: AppData,
  personId: string,
  date: string,
  plan: DayPlan,
): string {
  if (plan.onLeavePersonIds.includes(personId)) return '假'
  if (!plan.working) return '放'
  const postId = plan.byPerson.get(personId)
  if (!postId) return '休'
  return data.posts.find((p) => p.id === postId)?.name ?? '在岗'
}

/** 导出某月「人员 × 日期」排班表 */
export function exportMonthCsv(data: AppData, month: string): void {
  exportDatesCsv(data, monthDates(month), `排班_${month}.csv`, month)
}

/**
 * 导出任意日期区间的「人员 × 日期」排班表。
 *
 * 排班只算一遍（planRange），不再逐格重算 —— 原实现是 O(人数 × 天数) 次 planDay。
 */
export function exportDatesCsv(
  data: AppData,
  dates: string[],
  filename: string,
  title?: string,
): void {
  const people = data.people.filter((p) => p.active).sort((a, b) => a.order - b.order)
  const plans = planRange(data, dates)

  const header: Array<string | number> = ['序号', '姓名']
  dates.forEach((date) => header.push(dayLabel(date)))
  header.push('上班天数', '休假天数', '休息天数')

  const rows: Array<Array<string | number>> = []
  if (title) rows.push([`${title} 排班表`])
  rows.push(header)

  people.forEach((person, i) => {
    const row: Array<string | number> = [i + 1, person.name]
    let work = 0
    let leave = 0
    let rest = 0
    dates.forEach((date) => {
      const plan = plans.get(date)!
      const text = personDayText(data, person.id, date, plan)
      if (text === '假') leave++
      else if (text === '休' || text === '放') rest++
      else work++
      row.push(text)
    })
    row.push(work, leave, rest)
    rows.push(row)
  })

  exportCsv(rows, filename)
}

/**
 * 导出岗位表：1:1 复刻实际表。
 *
 * 每周一个块，周一~周六六列；行依次为 值班组长 / 各岗位组；
 * 块末附「调休」块，列出当天不在岗的人。
 */
export function exportPostTableCsv(data: AppData, weekStart: string, filename?: string): void {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    if (parseISO(date).getDay() !== 0) dates.push(date)
  }
  const plans = planRange(data, dates)
  const nameById = new Map(data.people.map((p) => [p.id, p.name]))

  const rows: Array<Array<string | number>> = []
  rows.push([`${data.settings.orgName} 岗位表　${formatMonthDay(weekStart)} - ${formatMonthDay(addDays(weekStart, 6))}`])
  rows.push(['', ...dates.map((date) => dayLabel(date))])
  rows.push(['值班组长', ...dates.map((date) => {
    const plan = plans.get(date)!
    if (!plan.working) return ''
    const leaderId = plan.leaderId
    return leaderId ? (nameById.get(leaderId) ?? '') : '空缺'
  })])

  for (const post of data.posts) {
    if (post.separate) continue
    const slotCount = Math.max(
      ...dates.map((date) => plans.get(date)!.slotCount.get(post.id) ?? 0),
      0,
    )
    for (let slot = 0; slot < slotCount; slot++) {
      rows.push([
        slot === 0 ? post.name : '',
        ...dates.map((date) => {
          const plan = plans.get(date)!
          if (!plan.working) return ''
          const ids = plan.byPost.get(post.id) ?? []
          const personId = ids[slot]
          if (!personId) return ''
          const name = nameById.get(personId) ?? ''
          const isLeader = plan.leaderId === personId
          return isLeader ? `${name}★` : name
        }),
      ])
    }
  }

  // 512 柜台：独立块，不计入大厅岗位
  for (const post of data.posts.filter((p) => p.separate)) {
    const slotCount = Math.max(
      ...dates.map((date) => plans.get(date)!.slotCount.get(post.id) ?? 0),
      0,
    )
    for (let slot = 0; slot < slotCount; slot++) {
      rows.push([
        slot === 0 ? post.name : '',
        ...dates.map((date) => {
          const plan = plans.get(date)!
          if (!plan.working) return ''
          const ids = plan.byPost.get(post.id) ?? []
          const personId = ids[slot]
          if (!personId) return ''
          const name = nameById.get(personId) ?? ''
          return plan.counterLeaderId === personId ? `${name}★` : name
        }),
      ])
    }
  }

  rows.push([
    '调休',
    ...dates.map((date) => {
      const plan = plans.get(date)!
      if (!plan.working) return ''
      const names = plan.onLeavePersonIds
        .map((id) => {
          const type = plan.leaveTypeByPerson.get(id)
          return type ? `${nameById.get(id) ?? ''}(${type})` : (nameById.get(id) ?? '')
        })
        .concat(
          plan.resting
            .filter((id) => !plan.onLeavePersonIds.includes(id))
            .map((id) => nameById.get(id) ?? ''),
        )
      return names.join('、')
    }),
  ])

  exportCsv(rows, filename ?? `岗位表_${weekStart}.csv`)
}

/** 一周排班文本，方便直接发到群里 */
export function weekText(data: AppData, weekStart: string): string {
  const dates: string[] = []
  for (let i = 0; i < 7; i++) dates.push(addDays(weekStart, i))
  const plans = planRange(data, dates)
  const personName = new Map(data.people.map((p) => [p.id, p.name]))

  const lines = [`【排班】${formatMonthDay(weekStart)} - ${formatMonthDay(addDays(weekStart, 6))}`]

  for (const date of dates) {
    const plan = plans.get(date)!
    if (!plan.working) {
      lines.push(`${dayLabel(date)}：放假`)
      continue
    }
    const parts = data.posts
      .map((post) => {
        const names = (plan.byPost.get(post.id) ?? [])
          .map((id) => {
            const name = personName.get(id) ?? ''
            const isLeader = plan.leaderId === id || plan.counterLeaderId === id
            return isLeader ? `${name}★` : name
          })
          .filter(Boolean)
        return names.length ? `${post.name} ${names.join('、')}` : ''
      })
      .filter(Boolean)
    if (plan.onLeavePersonIds.length) {
      parts.push(`休假 ${plan.onLeavePersonIds.map((id) => personName.get(id) ?? '').join('、')}`)
    }
    if (plan.dutyTeamId) {
      parts.push(`值班组 ${plan.dutyTeamId}组`)
    }
    lines.push(`${dayLabel(date)}：${parts.join('；') || '无'}`)
  }

  const totals = data.people
    .filter((p) => p.active)
    .map((p) => ({
      name: p.name,
      work: dates.filter((d) => plans.get(d)!.byPerson.get(p.id)).length,
    }))
    .filter((t) => t.work > 0)
  if (totals.length) {
    lines.push('——')
    lines.push(`本周上班：${totals.map((t) => `${t.name}${t.work}天`).join('，')}`)
  }
  lines.push(
    `岗位：${data.posts
      .map((p) => `${p.name}${p.capacity}人（周六${p.saturdayCapacity}）`)
      .join('、')}`,
  )

  return lines.join('\n')
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      const ok = document.execCommand('copy')
      textarea.remove()
      return ok
    } catch {
      return false
    }
  }
}
