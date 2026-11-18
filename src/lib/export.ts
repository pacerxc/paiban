import type { AppData } from '../types'
import { addDays, formatMonthDay, monthDates, parseISO, weekdayLabel } from './date'
import { isOnLeave, planDay } from './scheduler'

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

function personDayText(data: AppData, personId: string, date: string): string {
  const person = data.people.find((p) => p.id === personId)
  if (!person) return ''
  if (isOnLeave(data, personId, date)) return '假'
  const plan = planDay(data, date)
  if (!plan.working) return '放'
  const postId = plan.byPerson.get(personId)
  if (!postId) return '休'
  return data.posts.find((p) => p.id === postId)?.name ?? '在岗'
}

/** 导出某月「人员 × 日期」排班表 */
export function exportMonthCsv(data: AppData, month: string): void {
  exportDatesCsv(data, monthDates(month), `排班_${month}.csv`, month)
}

/** 导出任意日期区间的「人员 × 日期」排班表 */
export function exportDatesCsv(
  data: AppData,
  dates: string[],
  filename: string,
  title?: string,
): void {
  const people = data.people.filter((p) => p.active).sort((a, b) => a.order - b.order)
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
      const text = personDayText(data, person.id, date)
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

/** 一周排班文本，方便直接发到群里 */
export function weekText(data: AppData, weekStart: string): string {
  const lines = [`【排班】${formatMonthDay(weekStart)} - ${formatMonthDay(addDays(weekStart, 6))}`]
  const personName = new Map(data.people.map((p) => [p.id, p.name]))

  for (let i = 0; i < 7; i++) {
    const date = addDays(weekStart, i)
    const plan = planDay(data, date)
    if (!plan.working) {
      lines.push(`${dayLabel(date)}：放假`)
      continue
    }
    const parts = data.posts
      .map((post) => {
        const names = (plan.byPost.get(post.id) ?? [])
          .map((id) => personName.get(id) ?? '')
          .filter(Boolean)
        return names.length ? `${post.name} ${names.join('、')}` : ''
      })
      .filter(Boolean)
    if (plan.leaveIds.length) {
      parts.push(`休假 ${plan.leaveIds.map((id) => personName.get(id) ?? '').join('、')}`)
    }
    lines.push(`${dayLabel(date)}：${parts.join('；') || '无'}`)
  }

  const weekDates = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const totals = data.people
    .filter((p) => p.active)
    .map((p) => ({
      name: p.name,
      work: weekDates.filter((d) => !isOnLeave(data, p.id, d) && planDay(data, d).byPerson.get(p.id))
        .length,
    }))
    .filter((t) => t.work > 0)
  if (totals.length) {
    lines.push('——')
    lines.push(`本周上班：${totals.map((t) => `${t.name}${t.work}天`).join('，')}`)
  }
  lines.push(`岗位：${data.posts.map((p) => `${p.name}${p.capacity}人`).join('、')}`)

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
