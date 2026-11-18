import type { AppData } from '../types'
import { addDays, formatMonthDay, monthWeeks } from './date'
import { generateAssignments } from './scheduler'
import { leaveDaysInRange, overlapDays } from './leave'

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
  download(JSON.stringify(data, null, 2), `排班数据_${new Date().toISOString().slice(0, 10)}.json`, 'application/json')
}

export function exportWeekCsv(data: AppData, weekStart: string): void {
  const result = generateAssignments(data, weekStart)
  const postName = new Map(data.posts.map((p) => [p.id, p.name]))
  const people = data.people.filter((p) => p.active).sort((a, b) => a.order - b.order)
  const weekEnd = addDays(weekStart, 6)
  const rows: Array<Array<string | number>> = [['序号', '姓名', '岗位', '本周休假', '休假天数']]

  people.forEach((person, i) => {
    const leaves = data.leaves.filter(
      (l) => l.personId === person.id && overlapDays(l.start, l.end, weekStart, weekEnd) > 0,
    )
    rows.push([
      i + 1,
      person.name,
      postName.get(result.byPerson.get(person.id) ?? '') ?? '待定',
      leaves.map((l) => l.type).join('、'),
      leaveDaysInRange(data.leaves, person.id, weekStart, weekEnd),
    ])
  })

  exportCsv(rows, `排班_${weekStart}.csv`)
}

export function exportMonthCsv(data: AppData, month: string): void {
  const weeks = monthWeeks(month)
  const postName = new Map(data.posts.map((p) => [p.id, p.name]))
  const people = data.people.filter((p) => p.active).sort((a, b) => a.order - b.order)
  const header: Array<string | number> = ['序号', '姓名']
  weeks.forEach((w) => header.push(`${formatMonthDay(w)} 岗位`, '休假天数'))
  header.push('本月休假合计')
  const rows: Array<Array<string | number>> = [header]

  people.forEach((person, i) => {
    const row: Array<string | number> = [i + 1, person.name]
    let total = 0
    weeks.forEach((w) => {
      const result = generateAssignments(data, w)
      const days = leaveDaysInRange(data.leaves, person.id, w, addDays(w, 6))
      total += days
      row.push(postName.get(result.byPerson.get(person.id) ?? '') ?? '待定', days)
    })
    row.push(total)
    rows.push(row)
  })

  exportCsv(rows, `排班_${month}.csv`)
}

export function weekText(data: AppData, weekStart: string): string {
  const result = generateAssignments(data, weekStart)
  const weekEnd = addDays(weekStart, 6)
  const lines = [`【排班】${formatMonthDay(weekStart)} - ${formatMonthDay(weekEnd)}`]

  for (const post of data.posts) {
    const names = (result.byPost.get(post.id) ?? [])
      .map((id) => data.people.find((p) => p.id === id)?.name ?? '')
      .filter(Boolean)
    lines.push(`${post.name}：${names.length ? names.join('、') : '空缺'}`)
  }

  const pending = data.people
    .filter((p) => p.active && !result.byPerson.get(p.id))
    .map((p) => p.name)
  if (pending.length) lines.push(`待定：${pending.join('、')}`)

  const leaves = data.leaves.filter((l) => l.start <= weekEnd && l.end >= weekStart)
  if (leaves.length) {
    lines.push(
      `休假：${leaves
        .map((l) => {
          const name = data.people.find((p) => p.id === l.personId)?.name ?? ''
          return `${name}${l.type}${overlapDays(l.start, l.end, weekStart, weekEnd)}天`
        })
        .join('；')}`,
    )
  }

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
