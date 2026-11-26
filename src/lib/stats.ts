import type { AppData, Pool, TeamId } from '../types'
import { monthDates, parseISO } from './date'
import { planRange } from './scheduler'
import type { PlanType } from './scheduler'
import { buildLedger, expiredQuota } from './leave'

/** 班别：工作日 / 周六值班 / 法定假日值班 / 公休 */
export type ShiftType = 'weekday' | 'saturday' | 'holiday' | 'off'

/** 当天状态：在岗 / 值班 / 休假 / 轮空 / 公休 */
export type DayStatus = 'onduty' | 'duty' | 'leave' | 'idle' | 'off'

export interface PersonMonthStat {
  personId: string
  name: string
  pool: Pool
  teamId: TeamId | null
  /** 在岗天数：当天有岗位的工作日天数 */
  onDutyDays: number
  /** 值班天数：周六 / 法定假日上岗的天数 */
  dutyDays: number
  /** 登记补休天数 */
  makeUpDays: number
  /** 登记调休天数 */
  adjustDays: number
  /** 其他类型休假天数（年假/病假/事假/其他） */
  otherLeaveDays: number
  /** 轮空天数：工作日未排上且未休假 */
  idleDays: number
  /** 公休天数（放假 + 周日） */
  offDays: number
  /** 额度增加：值班 +1 合计 */
  quotaEarned: number
  /** 额度使用：登记调休/补休扣减合计 */
  quotaUsed: number
  /** 额度余额 = quotaEarned - quotaUsed */
  quotaBalance: number
  /** 上月未用完已清零的额度 */
  expiredQuota: number
  /** 欠休天数（余额为负时的绝对值，否则 0） */
  debt: number
}

export interface DayDetail {
  date: string
  /** 班别 */
  shiftType: ShiftType
  /** 班别中文名，例「周六值班」「法定假日值班」「工作日」「公休」 */
  shiftLabel: string
  /** 在岗时的岗位名，否则 null */
  postName: string | null
  /** 状态 */
  status: DayStatus
  /** 休假类型（status 为 leave 时有值） */
  leaveType?: string
  /** 当天额度变动：值班 +1、登记调休/补休 −N、其余 0 */
  quotaDelta: number
  /** 说明，例「周六值班 · 受理」 */
  note: string
}

export interface ShiftStat {
  date: string
  /** 当天值班组 */
  teamId: TeamId | null
  /** 参与人数 */
  headcount: number
  /** 岗位分工，按岗位顺序 */
  assignments: Array<{ postId: string; postName: string; names: string[] }>
  /** 参与人名单（按岗位顺序展开） */
  members: string[]
}

/* ------------------------------------------------------------------ *
 * 班别
 * ------------------------------------------------------------------ */

interface ShiftInfo {
  shiftType: ShiftType
  shiftLabel: string
}

/**
 * 按当天排班类型判定班别。
 *
 * 周六上岗 = 周六值班；其余值班日（法定调休上班日）= 法定假日值班。
 * 口径与台账流水的 reason 一致（leave.ts 的 dutyEntries）。
 */
function shiftInfoOf(date: string, planType: PlanType): ShiftInfo {
  if (planType === 'off') return { shiftType: 'off', shiftLabel: '公休' }
  if (planType === 'weekday') return { shiftType: 'weekday', shiftLabel: '工作日' }
  if (parseISO(date).getDay() === 6) return { shiftType: 'saturday', shiftLabel: '周六值班' }
  return { shiftType: 'holiday', shiftLabel: '法定假日值班' }
}

/* ------------------------------------------------------------------ *
 * 额度
 * ------------------------------------------------------------------ */

/**
 * 某人登记类台账（调休 / 补休等）按日期归集的额度变动。
 *
 * 每条台账条目落在一个日期上，值班 +1 由排班实时推导、不在这里。
 */
function ledgerDeltaByDate(data: AppData, personId: string, dates: string[]): Map<string, number> {
  const inMonth = new Set(dates)
  const map = new Map<string, number>()
  for (const entry of data.ledger) {
    if (entry.personId !== personId) continue
    if (entry.source === 'duty') continue
    if (!inMonth.has(entry.date)) continue
    if (entry.days >= 0) continue
    map.set(entry.date, (map.get(entry.date) ?? 0) + entry.days)
  }
  return map
}

/* ------------------------------------------------------------------ *
 * 按人统计
 * ------------------------------------------------------------------ */

/**
 * 每人当月统计。
 *
 * 口径：
 * - 在岗 = 工作日（周一至周五）有岗位的天数；值班 = 周六与法定假日上岗的天数，两者不重复计
 * - 轮空 = 上班日未排上且未休假；公休 = 放假 + 周日
 * - 额度：值班 1 天 +1，登记调休 / 补休 1 天 −N（沿用 leave.ts 的台账口径）
 */
export function personMonthStats(data: AppData, month: string): PersonMonthStat[] {
  const dates = monthDates(month)
  const plans = planRange(data, dates)
  const people = [...data.people].sort((a, b) => a.order - b.order)

  // 额度：值班 +1 与登记扣减 −N，口径同台账流水（buildLedger）
  const earned = new Map<string, number>()
  const used = new Map<string, number>()
  for (const row of buildLedger(data, dates)) {
    if (row.source === 'duty') {
      earned.set(row.personId, (earned.get(row.personId) ?? 0) + row.days)
      continue
    }
    const amount = Math.abs(Math.min(0, row.days))
    if (amount > 0) used.set(row.personId, (used.get(row.personId) ?? 0) + amount)
  }

  return people.map((person) => {
    let onDutyDays = 0
    let dutyDays = 0
    let makeUpDays = 0
    let adjustDays = 0
    let otherLeaveDays = 0
    let idleDays = 0
    let offDays = 0

    for (const date of dates) {
      const plan = plans.get(date)!
      if (!plan.working) {
        offDays++
        continue
      }
      if (plan.onLeavePersonIds.includes(person.id)) {
        const type = plan.leaveTypeByPerson.get(person.id) ?? '其他'
        if (type === '补休') makeUpDays++
        else if (type === '调休') adjustDays++
        else otherLeaveDays++
        continue
      }
      const postId = plan.byPerson.get(person.id)
      if (!postId) {
        idleDays++
        continue
      }
      if (plan.type === 'duty') dutyDays++
      else onDutyDays++
    }

    const quotaEarned = earned.get(person.id) ?? 0
    const quotaUsed = used.get(person.id) ?? 0
    const quotaBalance = quotaEarned - quotaUsed

    return {
      personId: person.id,
      name: person.name,
      pool: person.pool,
      teamId: person.teamId,
      onDutyDays,
      dutyDays,
      makeUpDays,
      adjustDays,
      otherLeaveDays,
      idleDays,
      offDays,
      quotaEarned,
      quotaUsed,
      quotaBalance,
      expiredQuota: expiredQuota(data, person.id, month),
      debt: quotaBalance < 0 ? -quotaBalance : 0,
    }
  })
}

/* ------------------------------------------------------------------ *
 * 逐日明细
 * ------------------------------------------------------------------ */

/**
 * 某人当月逐日明细。
 *
 * 每天一条：班别、岗位、状态、额度变动与说明。
 */
export function personDayDetails(data: AppData, personId: string, month: string): DayDetail[] {
  const dates = monthDates(month)
  const plans = planRange(data, dates)
  const deltas = ledgerDeltaByDate(data, personId, dates)
  const postNames = new Map(data.posts.map((post) => [post.id, post.name]))

  return dates.map((date) => {
    const plan = plans.get(date)!
    const { shiftType, shiftLabel } = shiftInfoOf(date, plan.type)
    const leaveType = plan.leaveTypeByPerson.get(personId)
    const postId = plan.byPerson.get(personId)
    const postName = postId ? postNames.get(postId) ?? null : null

    let status: DayStatus
    let note: string
    if (!plan.working) {
      status = 'off'
      note = shiftLabel
    } else if (plan.onLeavePersonIds.includes(personId)) {
      status = 'leave'
      note = `${shiftLabel} · ${leaveType ?? '休假'}`
    } else if (postId) {
      status = plan.type === 'duty' ? 'duty' : 'onduty'
      note = `${shiftLabel} · ${postName ?? '在岗'}`
    } else {
      status = 'idle'
      note = `${shiftLabel} · 轮空`
    }

    const quotaDelta = (status === 'duty' ? 1 : 0) + (deltas.get(date) ?? 0)

    const detail: DayDetail = {
      date,
      shiftType,
      shiftLabel,
      postName: status === 'onduty' || status === 'duty' ? postName : null,
      status,
      quotaDelta,
      note,
    }
    if (status === 'leave' && leaveType) detail.leaveType = leaveType
    return detail
  })
}

/* ------------------------------------------------------------------ *
 * 按班统计
 * ------------------------------------------------------------------ */

/**
 * 当月值班日一览（只含周六与法定调休上班日）。
 *
 * 岗位分工按 data.posts 顺序展开，只列当天有人的岗位。
 */
export function shiftStats(data: AppData, month: string): ShiftStat[] {
  const dates = monthDates(month)
  const plans = planRange(data, dates)
  const names = new Map(data.people.map((person) => [person.id, person.name]))

  const rows: ShiftStat[] = []
  for (const date of dates) {
    const plan = plans.get(date)!
    if (plan.type !== 'duty') continue

    const assignments: ShiftStat['assignments'] = []
    const members: string[] = []
    for (const post of data.posts) {
      const ids = plan.byPost.get(post.id) ?? []
      if (ids.length === 0) continue
      const postNames = ids.map((id) => names.get(id) ?? '已删除')
      assignments.push({ postId: post.id, postName: post.name, names: postNames })
      members.push(...postNames)
    }

    rows.push({
      date,
      teamId: plan.dutyTeamId,
      headcount: members.length,
      assignments,
      members,
    })
  }
  return rows
}
