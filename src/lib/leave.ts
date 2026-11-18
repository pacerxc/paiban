import type { LeaveRecord, LedgerEntry } from '../types'
import { diffDays } from './date'

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

/** 台账余额：正数为剩余可休，负数为欠休 */
export function ledgerBalance(ledger: LedgerEntry[], personId: string): number {
  return ledger.filter((e) => e.personId === personId).reduce((sum, e) => sum + e.days, 0)
}
