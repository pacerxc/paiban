const pad = (n: number) => String(n).padStart(2, '0')

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseISO(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(iso: string, n: number): string {
  const d = parseISO(iso)
  d.setDate(d.getDate() + n)
  return toISO(d)
}

/** 返回所在周的周一 */
export function startOfWeek(iso: string): string {
  const d = parseISO(iso)
  const weekday = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - weekday)
  return toISO(d)
}

export function endOfWeek(iso: string): string {
  return addDays(startOfWeek(iso), 6)
}

/** b - a 的天数 */
export function diffDays(a: string, b: string): number {
  const ms = parseISO(b).getTime() - parseISO(a).getTime()
  return Math.round(ms / 86400000)
}

/** 距离轮转起始周相差多少周 */
export function weekIndexOf(startDate: string, weekStart: string): number {
  const a = parseISO(startOfWeek(startDate)).getTime()
  const b = parseISO(startOfWeek(weekStart)).getTime()
  return Math.round((b - a) / (7 * 86400000))
}

export function formatMonthDay(iso: string): string {
  const d = parseISO(iso)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

export function formatDateRange(start: string, end: string): string {
  return `${formatMonthDay(start)} - ${formatMonthDay(end)}`
}

export function currentMonth(): string {
  return toISO(new Date()).slice(0, 7)
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`
}

/** 某个月覆盖到的所有周（周一为每周起点） */
export function monthWeeks(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const first = `${month}-01`
  const last = `${month}-${pad(new Date(y, m, 0).getDate())}`
  const weeks: string[] = []
  let cur = startOfWeek(first)
  while (cur <= last) {
    weeks.push(cur)
    cur = addDays(cur, 7)
  }
  return weeks
}

export function weekdayLabel(iso: string): string {
  return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][parseISO(iso).getDay()]
}

/** 某个月的全部日期（1 号到月末） */
export function monthDates(month: string): string[] {
  const [y, m] = month.split('-').map(Number)
  const total = new Date(y, m, 0).getDate()
  return Array.from({ length: total }, (_, i) => `${month}-${pad(i + 1)}`)
}
