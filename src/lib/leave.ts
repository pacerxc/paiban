import type { AppData, LeaveRecord, LedgerEntry, LedgerSource } from '../types'
import { diffDays, monthDates, parseISO } from './date'
import { dayState, isOnLeave, planDay } from './scheduler'

/** 两个日期区间重叠的天数（含首尾） */
export function overlapDays(aStart: string, aEnd: string, bStart: string, bEnd: string): number {
  const start = aStart > bStart ? aStart : bStart
  const end = aEnd < bEnd ? aEnd : bEnd
  if (start > end) return 0
  return diffDays(start, end) + 1
}

/** 某人在指定区间内的休假天数 */
export function leaveDaysInRange(
  leaves: LeaveRecord[],
  personId: string,
  start: string,
  end: string,
): number {
  return leaves
    .filter((l) => l.personId === personId)
    .reduce((sum, l) => sum + overlapDays(l.start, l.end, start, end), 0)
}

export function leaveTotalDays(leaves: LeaveRecord[], personId: string, type: LeaveRecord['type']): number {
  return leaves
    .filter((l) => l.personId === personId && l.type === type)
    .reduce((sum, l) => sum + diffDays(l.start, l.end) + 1, 0)
}

/* ------------------------------------------------------------------ *
 * 调休台账
 * ------------------------------------------------------------------ */

/** 台账流水的一行：值班自动 +1 与登记 −N 合并后展示 */
export interface LedgerRow {
  id: string
  personId: string
  date: string
  /** 正数为增加额度，负数为使用/扣减 */
  days: number
  reason: string
  source: LedgerSource
}

export const SOURCE_LABEL: Record<LedgerSource, string> = {
  duty: '值班',
  leave: '休假自动',
  manual: '手动',
}

/**
 * 值班流水：值班 1 天 = 轮休额度 +1。
 *
 * 值班日 = 周六 + 法定调休上班日（按 A/B 值班组上岗的那些天）。
 * 由排班实时推导，而不是写死条目 —— 调整排班后额度自动跟着变，
 * 不会因为反复写台账而重复累加。512 柜台人员周六随值班组上岗同样计入。
 */
export function dutyEntries(data: AppData, dates: string[]): LedgerRow[] {
  const rows: LedgerRow[] = []
  for (const date of dates) {
    if (dayState(data, date).type !== 'duty') continue
    const plan = planDay(data, date)
    if (!plan.working) continue
    const isSaturday = parseISO(date).getDay() === 6
    for (const personId of plan.byPerson.keys()) {
      if (!plan.byPerson.get(personId)) continue
      rows.push({
        id: `duty_${date}_${personId}`,
        personId,
        date,
        days: 1,
        reason: isSaturday ? '周六值班' : '法定假日值班',
        source: 'duty',
      })
    }
  }
  return rows
}

/** 登记类流水：休假自动生成的扣减 + 手动调整 */
export function registeredEntries(data: AppData, dates?: string[]): LedgerEntry[] {
  const set = dates ? new Set(dates) : null
  return data.ledger.filter((e) => (set ? set.has(e.date) : true))
}

/** 合并后的台账流水（按日期倒序） */
export function buildLedger(data: AppData, dates: string[]): LedgerRow[] {
  const rows: LedgerRow[] = [
    ...dutyEntries(data, dates),
    ...registeredEntries(data, dates).map((e) => ({
      id: e.id,
      personId: e.personId,
      date: e.date,
      days: e.days,
      reason: e.reason,
      source: e.source,
    })),
  ]
  rows.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : b.date.localeCompare(a.date)))
  return rows
}

/** 某人在指定日期范围内的调休余额：值班 +1 − 登记轮休 N */
export function ledgerBalance(
  data: AppData,
  personId: string,
  dates?: string[],
): number {
  const rows = buildLedger(data, dates ?? [])
  return rows.filter((r) => r.personId === personId).reduce((sum, r) => sum + r.days, 0)
}

/** 某人在指定日期范围内的值班次数与登记天数 */
export function dutySummary(
  data: AppData,
  personId: string,
  dates: string[],
): { duty: number; used: number; balance: number } {
  const rows = buildLedger(data, dates).filter((r) => r.personId === personId)
  const duty = rows.filter((r) => r.source === 'duty').reduce((sum, r) => sum + r.days, 0)
  const used = rows
    .filter((r) => r.source !== 'duty')
    .reduce((sum, r) => sum + Math.abs(Math.min(0, r.days)), 0)
  return { duty, used, balance: duty - used }
}

/** 登记调休/补休应写入台账的扣减天数；年假等不影响调休额度 */
export function ledgerDaysForLeave(type: LeaveRecord['type'], days: number): number | null {
  if (type === '调休' || type === '补休') return -days
  return null
}

/** 上一个月的月份字符串（2026-11 -> 2026-10） */
export function previousMonth(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`
}

/**
 * 上个月未用完的轮休额度（已按规则清零，不结转）。
 *
 * 规则：轮休额度必须当月用完，月末未使用部分作废。
 */
export function expiredQuota(data: AppData, personId: string, month: string): number {
  const last = previousMonth(month)
  const dates = monthDates(last)
  return Math.max(0, ledgerBalance(data, personId, dates))
}

/** 某人某月是否休假（含调休/年假等所有类型） */
export function hasLeaveInMonth(data: AppData, personId: string, month: string): boolean {
  return data.leaves.some(
    (l) => l.personId === personId && l.start.slice(0, 7) <= month && l.end.slice(0, 7) >= month,
  )
}

/** 某人某月的休息天数明细（用于月休统计口径核对） */
export function restBreakdown(
  data: AppData,
  personId: string,
  dates: string[],
): { sunday: number; offDuty: number; leave: number } {
  let sunday = 0
  let offDuty = 0
  let leave = 0
  for (const date of dates) {
    const plan = planDay(data, date)
    if (!plan.working) {
      sunday++
      continue
    }
    if (plan.onLeavePersonIds.includes(personId)) {
      leave++
      continue
    }
    if (!plan.byPerson.get(personId)) offDuty++
  }
  return { sunday, offDuty, leave }
}

export { isOnLeave }
