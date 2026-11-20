import type { AppData, LeaveRecord, Person, Post } from '../types'
import { diffDays, parseISO, startOfWeek, weekIndexOf, weekdayLabel } from './date'
import { holidayState } from './holidays'

export interface DayStateInfo {
  working: boolean
  /** 是否由节假日或手动设置覆盖 */
  overridden: boolean
}

export interface DayPlan {
  date: string
  weekday: number
  working: boolean
  overridden: boolean
  /** personId -> 当天岗位，null 表示不在岗 */
  byPerson: Map<string, string | null>
  byPost: Map<string, string[]>
  /** 当天既没排班也没休假的人（轮空 / 支援组工作日不进本班表） */
  resting: string[]
  /** 当天休假的人（personId） */
  onLeavePersonIds: string[]
  /** 当天休假的人 -> 休假类型 */
  leaveTypeByPerson: Map<string, LeaveRecord['type']>
  /** 每个岗位还差几个人 */
  vacant: Map<string, number>
  /** 当天总位次 */
  capacity: number
  /** 当天在岗人数 */
  onDuty: number
  /** 当天值班组长（不在岗时为 null） */
  leaderId: string | null
  /** 组长位次是否空缺（组长当天不在岗） */
  leaderVacant: boolean
  /** 当天是否使用了手工覆盖 */
  overriddenPlan: boolean
}

/* ------------------------------------------------------------------ *
 * 休假索引（避免每次线性扫全表）
 * ------------------------------------------------------------------ */

const leaveIndexCache = new WeakMap<object, Map<string, LeaveRecord[]>>()

function leaveIndex(data: AppData): Map<string, LeaveRecord[]> {
  let index = leaveIndexCache.get(data.leaves as unknown as object)
  if (!index) {
    index = new Map()
    for (const leave of data.leaves) {
      const list = index.get(leave.personId) ?? []
      list.push(leave)
      index.set(leave.personId, list)
    }
    leaveIndexCache.set(data.leaves as unknown as object, index)
  }
  return index
}

export function isOnLeave(data: AppData, personId: string, date: string): boolean {
  const list = leaveIndex(data).get(personId)
  if (!list || list.length === 0) return false
  for (const leave of list) {
    if (leave.start <= date && leave.end >= date) return true
  }
  return false
}

export function leaveOf(data: AppData, personId: string, date: string): LeaveRecord | undefined {
  const list = leaveIndex(data).get(personId)
  if (!list) return undefined
  for (const leave of list) {
    if (leave.start <= date && leave.end >= date) return leave
  }
  return undefined
}

/** 某人某月的休假记录 */
export function leavesInMonth(data: AppData, month: string): LeaveRecord[] {
  return data.leaves.filter((l) => l.start.slice(0, 7) <= month && l.end.slice(0, 7) >= month)
}

/* ------------------------------------------------------------------ *
 * 单日状态
 * ------------------------------------------------------------------ */

export function dayState(data: AppData, date: string): DayStateInfo {
  const override = data.days[date]
  if (override) return { working: override === 'work', overridden: true }
  const holiday = holidayState(date)
  if (holiday) return { working: holiday === 'work', overridden: true }
  return { working: parseISO(date).getDay() !== 0, overridden: false }
}

/** 当天是否按周六编制 */
function isSaturdayPlan(date: string): boolean {
  return parseISO(date).getDay() === 6
}

/** 该岗位当天的编制 */
export function capacityOf(post: Post, date: string): number {
  return isSaturdayPlan(date) ? post.saturdayCapacity : post.capacity
}

/** 该岗位是否允许支援组顶岗 */
function canTake(person: Person, postId: string, date: string): boolean {
  if (person.pool === 'support' && !isSaturdayPlan(date)) return false
  if (person.fixedPostId) return person.fixedPostId === postId
  if (person.allowedPostIds) return person.allowedPostIds.includes(postId)
  return true
}

function expandSlots(posts: Post[], date: string): string[] {
  const slots: string[] = []
  for (const post of posts) {
    const cap = capacityOf(post, date)
    for (let i = 0; i < cap; i++) slots.push(post.id)
  }
  return slots
}

/* ------------------------------------------------------------------ *
 * 排班
 * ------------------------------------------------------------------ */

/** 生成某一天的排班（含手工覆盖与休假） */
export function planDay(data: AppData, date: string): DayPlan {
  const weekday = parseISO(date).getDay()
  const state = dayState(data, date)
  const saturday = isSaturdayPlan(date)
  const active = data.people
    .filter((p) => p.active)
    .sort((a, b) => a.order - b.order)
  const mains = active.filter((p) => p.pool === 'main')
  const supports = active.filter((p) => p.pool === 'support')

  const onLeavePersonIds: string[] = []
  const leaveTypeByPerson = new Map<string, LeaveRecord['type']>()
  for (const person of active) {
    const leave = leaveOf(data, person.id, date)
    if (leave) {
      onLeavePersonIds.push(person.id)
      leaveTypeByPerson.set(person.id, leave.type)
    }
  }
  const leaveSet = new Set(onLeavePersonIds)

  const byPerson = new Map<string, string | null>()
  for (const person of active) byPerson.set(person.id, null)

  const posts = data.posts
  const slots = expandSlots(posts, date)
  const weekIndex = Math.floor(weekIndexOf(data.settings.startDate, date))
  const dayIndex = diffDays(startOfWeek(data.settings.startDate), date)

  if (!state.working) {
    return buildPlan({
      data,
      date,
      weekday,
      state,
      active,
      byPerson,
      onLeavePersonIds,
      leaveTypeByPerson,
      leaveSet,
      slots,
      leaderId: null,
      leaderVacant: false,
      overriddenPlan: false,
    })
  }

  // 可用主班（排除请假的）
  const availableMains = mains.filter((p) => !leaveSet.has(p.id))
  // 支援组：周六按甲乙隔周选一组，工作日不进本班表
  const supportCount = saturday ? Math.max(0, data.settings.supportSlots) : 0
  const crew: 'A' | 'B' = data.settings.crewAlternate ? (weekIndex % 2 === 0 ? 'A' : 'B') : 'A'
  const availableSupports = supports
    .filter((p) => !leaveSet.has(p.id))
    .filter((p) => !p.crew || p.crew === crew)
    .sort((a, b) => a.order - b.order)
  const supportPicks = availableSupports.slice(0, supportCount)

  // 固定岗优先锁定
  const slotOwner = new Array<string | null>(slots.length).fill(null)
  const lockedPeople = new Set<string>()

  const lockToPost = (personId: string, postId: string): boolean => {
    const si = slots.findIndex((slotPost, index) => slotPost === postId && slotOwner[index] === null)
    if (si < 0) return false
    slotOwner[si] = personId
    lockedPeople.add(personId)
    return true
  }

  for (const person of availableMains) {
    if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
  }
  for (const person of supportPicks) {
    if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
  }

  // 支援组占用靠后的位次（辅助性岗位），按组内顺序轮换
  const supportSlotIndexes: number[] = []
  if (supportPicks.length > 0) {
    for (let i = slots.length - 1; i >= 0 && supportSlotIndexes.length < supportPicks.length; i--) {
      if (slotOwner[i] === null) supportSlotIndexes.push(i)
    }
    supportSlotIndexes.sort((a, b) => a - b)
    supportPicks.forEach((person, i) => {
      const si = supportSlotIndexes[i]
      if (si !== undefined) {
        slotOwner[si] = person.id
        lockedPeople.add(person.id)
      }
    })
  }

  // 其余人员按相位轮转填满剩余位次；相位随日期推进（每天顺移一位，每周额外顺移一位）
  const pool = availableMains.filter((p) => !lockedPeople.has(p.id))
  const freeSlots: number[] = []
  slots.forEach((_, index) => {
    if (slotOwner[index] === null) freeSlots.push(index)
  })
  if (pool.length > 0 && freeSlots.length > 0) {
    const phase = ((dayIndex + weekIndex) % pool.length + pool.length) % pool.length
    const count = Math.min(pool.length, freeSlots.length)
    // 先挑出当天轮休的人：间隔取，避免出现连休三天再连上四天
    const restCount = pool.length - count
    const step = restCount > 0 ? Math.max(1, Math.floor(pool.length / restCount)) : 1
    const resting = new Set<string>()
    for (let k = 0; k < restCount; k++) {
      resting.add(pool[(phase + k * step) % pool.length].id)
    }
    // 其余的人整体顺移补位：第 i 位次由顺移后第 i 个人补
    let slot = 0
    for (let i = 0; i < pool.length && slot < count; i++) {
      const person = pool[(phase + i) % pool.length]
      if (resting.has(person.id)) continue
      slotOwner[freeSlots[slot]] = person.id
      slot++
    }
  }

  // 岗位受限的人可能落到不允许的岗位，改用匹配算法兜底
  // 注意：没排上的人属于正常轮休，不算违规
  const violates = pool.some((person) => {
    const si = slotOwner.findIndex((owner) => owner === person.id)
    if (si < 0) return false
    return !canTake(person, slots[si], date)
  })

  if (violates) {
    slotOwner.fill(null)
    lockedPeople.clear()

    for (const person of availableMains) {
      if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
    }
    for (const person of supportPicks) {
      if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
    }
    if (supportPicks.length > 0) {
      const indexes: number[] = []
      for (let i = slots.length - 1; i >= 0 && indexes.length < supportPicks.length; i--) {
        if (slotOwner[i] === null) indexes.push(i)
      }
      indexes.sort((a, b) => a - b)
      supportPicks.forEach((person, i) => {
        const si = indexes[i]
        if (si !== undefined) {
          slotOwner[si] = person.id
          lockedPeople.add(person.id)
        }
      })
    }

    const rest = availableMains.filter((p) => !lockedPeople.has(p.id))
    const candidates: number[][] = rest.map((person) => {
      const list: number[] = []
      for (let si = 0; si < slots.length; si++) {
        if (slotOwner[si] !== null && lockedPeople.has(slotOwner[si]!)) continue
        if (canTake(person, slots[si], date)) list.push(si)
      }
      return list
    })

    const tryAssign = (ri: number, visited: boolean[]): boolean => {
      for (const si of candidates[ri]) {
        if (visited[si]) continue
        visited[si] = true
        const owner = slotOwner[si]
        if (owner === null) {
          slotOwner[si] = rest[ri].id
          return true
        }
        if (!lockedPeople.has(owner)) {
          const ownerIndex = rest.findIndex((p) => p.id === owner)
          if (ownerIndex >= 0 && tryAssign(ownerIndex, visited)) {
            slotOwner[si] = rest[ri].id
            return true
          }
        }
      }
      return false
    }

    rest.forEach((_, ri) => {
      if (lockedPeople.has(rest[ri].id)) return
      tryAssign(ri, new Array(slots.length).fill(false))
    })
  }

  slots.forEach((postId, si) => {
    const owner = slotOwner[si]
    if (owner) byPerson.set(owner, postId)
  })

  // 手工覆盖：整日替换该日的岗位安排（槽位为 null 表示该位次空缺）
  const override = data.dayPlans[date]
  let overriddenPlan = false
  if (override) {
    overriddenPlan = true
    for (const person of active) byPerson.set(person.id, null)
    const assigned = new Set<string>()
    for (const post of posts) {
      const slots = override[post.id] ?? []
      for (const personId of slots) {
        if (!personId || assigned.has(personId)) continue
        const person = active.find((p) => p.id === personId)
        if (!person || leaveSet.has(personId)) continue
        assigned.add(personId)
        byPerson.set(personId, post.id)
      }
    }
  }

  // 休假优先级最高
  for (const personId of leaveSet) byPerson.set(personId, null)

  const leaderId = resolveLeader(data, date, byPerson)
  const leaderVacant = leaderId === null

  return buildPlan({
    data,
    date,
    weekday,
    state,
    active,
    byPerson,
    onLeavePersonIds,
    leaveTypeByPerson,
    leaveSet,
    slots,
    leaderId,
    leaderVacant,
    overriddenPlan,
  })
}

interface BuildArgs {
  data: AppData
  date: string
  weekday: number
  state: DayStateInfo
  active: Person[]
  byPerson: Map<string, string | null>
  onLeavePersonIds: string[]
  leaveTypeByPerson: Map<string, LeaveRecord['type']>
  leaveSet: Set<string>
  slots: string[]
  leaderId: string | null
  leaderVacant: boolean
  overriddenPlan: boolean
}

function buildPlan(args: BuildArgs): DayPlan {
  const { data, date, weekday, state, active, byPerson, leaveSet, slots } = args

  const byPost = new Map<string, string[]>()
  for (const post of data.posts) byPost.set(post.id, [])
  for (const person of active) {
    const postId = byPerson.get(person.id)
    if (postId && byPost.has(postId)) byPost.get(postId)!.push(person.id)
  }

  const vacant = new Map<string, number>()
  for (const post of data.posts) {
    const count = byPost.get(post.id)!.length
    vacant.set(post.id, state.working ? Math.max(0, capacityOf(post, date) - count) : 0)
  }

  const resting = active
    .filter((p) => !byPerson.get(p.id) && !leaveSet.has(p.id))
    .map((p) => p.id)

  let onDuty = 0
  for (const person of active) {
    if (byPerson.get(person.id)) onDuty++
  }

  return {
    date,
    weekday,
    working: state.working,
    overridden: state.overridden,
    byPerson,
    byPost,
    resting,
    onLeavePersonIds: args.onLeavePersonIds,
    leaveTypeByPerson: args.leaveTypeByPerson,
    vacant,
    capacity: state.working ? slots.length : 0,
    onDuty,
    leaderId: args.leaderId,
    leaderVacant: args.leaderVacant,
    overriddenPlan: args.overriddenPlan,
  }
}

/* ------------------------------------------------------------------ *
 * 值班组长
 * ------------------------------------------------------------------ */

/** 组长池：可以担任值班组长的人 */
export function leaderPool(data: AppData): Person[] {
  return data.people
    .filter((p) => p.active && p.canLead)
    .sort((a, b) => a.order - b.order)
}

/**
 * 当天值班组长：
 * 1. 优先取手工指定（dayLeaders）
 * 2. 否则按组长池轮值（相位每天推进），跳过当天不在岗的人，顺延到下一位在岗组长
 * 3. 若当天没有任何在岗组长则返回 null（触发「组长位次空缺」告警）
 */
export function resolveLeader(
  data: AppData,
  date: string,
  byPerson: Map<string, string | null>,
): string | null {
  const pool = leaderPool(data)
  if (pool.length === 0) return null

  const manual = data.dayLeaders[date]
  if (manual && byPerson.has(manual)) return byPerson.get(manual) ? manual : null

  const phase = leaderPhase(data, date)
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(phase + i) % pool.length]
    if (byPerson.get(candidate.id)) return candidate.id
  }
  return null
}

/** 组长轮值相位 */
function leaderPhase(data: AppData, date: string): number {
  const pool = leaderPool(data)
  if (pool.length === 0) return 0
  const dayIndex = diffDays(startOfWeek(data.settings.startDate), date)
  const weekIndex = Math.floor(weekIndexOf(data.settings.startDate, date))
  return (((dayIndex + weekIndex) % pool.length) + pool.length) % pool.length
}

/* ------------------------------------------------------------------ *
 * 校验
 * ------------------------------------------------------------------ */

export interface CheckResult {
  ok: boolean
  text?: string
  rule?: string
}

const OK: CheckResult = { ok: true }

function fail(text: string, rule: string): CheckResult {
  return { ok: false, text, rule }
}

/** 校验某人某天能否排到某岗位 */
export function checkPersonPost(
  data: AppData,
  personId: string,
  postId: string,
  date: string,
): CheckResult {
  const person = data.people.find((p) => p.id === personId)
  if (!person) return fail('人员不存在', '')
  if (!person.active) return fail(`${person.name} 已停用，不能排班`, '规则：停用人员不参与排班。')

  const state = dayState(data, date)
  if (!state.working) {
    return fail(`${date} 已设为放假，全员不排班`, '规则：放假当天不安排任何岗位。')
  }

  const leave = leaveOf(data, personId, date)
  if (leave) {
    return fail(
      `${person.name} 当天${leave.type}（${leave.start} ~ ${leave.end}），不能排班`,
      '规则：休假期间不排班。',
    )
  }

  const post = data.posts.find((p) => p.id === postId)
  if (!post) return fail('岗位不存在', '规则：只能排到已设置的岗位。')

  if (person.pool === 'support' && !isSaturdayPlan(date)) {
    return fail(
      `${person.name} 是支援组，平时在 512 柜台，不进本班表`,
      '规则：支援组只在周六顶岗。',
    )
  }

  if (person.fixedPostId) {
    if (person.fixedPostId !== postId) {
      const fixed = data.posts.find((p) => p.id === person.fixedPostId)
      return fail(
        `${person.name} 固定${fixed ? `「${fixed.name}」` : '岗位'}，不能排「${post.name}」`,
        '规则：固定岗位人员只能上本岗。',
      )
    }
    return OK
  }

  if (person.allowedPostIds && !person.allowedPostIds.includes(postId)) {
    const names = person.allowedPostIds
      .map((id) => data.posts.find((p) => p.id === id)?.name)
      .filter(Boolean)
      .join('、')
    return fail(
      `${person.name} 只允许排「${names}」，不能排「${post.name}」`,
      '规则：个人岗位限制。',
    )
  }

  return OK
}

/** 校验两人当天对调 */
export function checkSwap(data: AppData, date: string, aId: string, bId: string): CheckResult {
  if (aId === bId) return OK
  const a = data.people.find((p) => p.id === aId)
  const b = data.people.find((p) => p.id === bId)
  if (!a || !b) return fail('人员不存在', '')

  const plan = planDay(data, date)
  const postA = plan.byPerson.get(aId)
  const postB = plan.byPerson.get(bId)

  const leaveB = leaveOf(data, bId, date)
  if (leaveB) {
    return fail(`${b.name} 当天${leaveB.type}，不能对调`, '规则：休假期间不排班。')
  }
  if (!postA) {
    return fail(`${a.name} 当天不在岗，无法对调`, '规则：只有当天在岗的两人才能对调。')
  }
  if (!postB) {
    return fail(`${b.name} 当天不在岗，无法对调`, '规则：只有当天在岗的两人才能对调。')
  }

  const checkA = checkPersonPost(data, aId, postB, date)
  if (!checkA.ok) return checkA
  const checkB = checkPersonPost(data, bId, postA, date)
  if (!checkB.ok) return checkB
  return OK
}

/** 校验某人当天移动到某岗位（目标需有空位） */
export function checkMove(data: AppData, date: string, personId: string, postId: string): CheckResult {
  const plan = planDay(data, date)
  const current = plan.byPerson.get(personId)
  if (current === postId) return OK

  const base = checkPersonPost(data, personId, postId, date)
  if (!base.ok) return base

  const post = data.posts.find((p) => p.id === postId)
  if (!post) return fail('岗位不存在', '')
  const occupants = (plan.byPost.get(postId) ?? []).filter((id) => id !== personId)
  if (occupants.length >= capacityOf(post, date)) {
    return fail(
      `「${post.name}」已满（需 ${capacityOf(post, date)} 人），请直接拖到在岗人员身上对调`,
      '规则：岗位人数不能超编。',
    )
  }
  return OK
}

/* ------------------------------------------------------------------ *
 * 统计
 * ------------------------------------------------------------------ */

/** 某人在某月的上班天数 */
export function countWorkDays(data: AppData, personId: string, dates: string[]): number {
  return dates.reduce((sum, date) => {
    if (isOnLeave(data, personId, date)) return sum
    const plan = planDay(data, date)
    return plan.byPerson.get(personId) ? sum + 1 : sum
  }, 0)
}

/** 某人在某月的休息天数：周日公休 + 表内不在岗登记（含年假） */
export function countRestDays(data: AppData, personId: string, dates: string[]): number {
  let rest = 0
  for (const date of dates) {
    const plan = planDay(data, date)
    if (!plan.working) {
      rest++
      continue
    }
    if (!plan.byPerson.get(personId)) rest++
  }
  return rest
}

/** 某人在某月的周六值班次数（支援组不计调休额度） */
export function countDutySaturdays(data: AppData, personId: string, dates: string[]): number {
  const person = data.people.find((p) => p.id === personId)
  if (!person || person.pool !== 'main') return 0
  let count = 0
  for (const date of dates) {
    if (!isSaturdayPlan(date)) continue
    if (isOnLeave(data, personId, date)) continue
    const plan = planDay(data, date)
    if (plan.byPerson.get(personId)) count++
  }
  return count
}

/** 生成一段时间内每一天的排班 */
export function planRange(data: AppData, dates: string[]): Map<string, DayPlan> {
  const map = new Map<string, DayPlan>()
  for (const date of dates) map.set(date, planDay(data, date))
  return map
}

/* ------------------------------------------------------------------ *
 * 告警
 * ------------------------------------------------------------------ */

export type AlertLevel = 'error' | 'warn' | 'info'

export interface ShiftAlert {
  level: AlertLevel
  title: string
  detail: string
  date?: string
}

export interface AlertSummary {
  alerts: ShiftAlert[]
  errors: number
  warnings: number
}

/** 生成一段时间内的告警 */
export function buildAlerts(data: AppData, dates: string[]): AlertSummary {
  const alerts: ShiftAlert[] = []
  const min = data.settings.minDailyHeadcount
  let errors = 0
  let warnings = 0

  for (const date of dates) {
    const plan = planDay(data, date)
    if (!plan.working) continue

    if (plan.onDuty < min) {
      errors++
      alerts.push({
        level: 'error',
        date,
        title: `${shortDate(date)} ${weekdayLabel(date)} 在岗 ${plan.onDuty} 人`,
        detail: `低于每日最少在岗 ${min} 人，缺 ${min - plan.onDuty} 人`,
      })
    }

    if (plan.leaderVacant) {
      warnings++
      const leaderName = manualOrPickedLeaderName(data, date)
      alerts.push({
        level: 'warn',
        date,
        title: `${shortDate(date)} ${weekdayLabel(date)} 组长位次空缺`,
        detail: leaderName
          ? `值班组长${leaderName}当天不在岗，无人顶班`
          : '当天没有在岗的组长，需指定代理组长',
      })
    }
  }

  return { alerts, errors, warnings }
}

/** 当天应到的组长名字（即便当天不在岗） */
export function manualOrPickedLeaderName(data: AppData, date: string): string | null {
  const manual = data.dayLeaders[date]
  if (manual) {
    const person = data.people.find((p) => p.id === manual)
    return person?.name ?? null
  }
  const pool = leaderPool(data)
  if (pool.length === 0) return null
  return pool[leaderPhase(data, date)].name
}

function shortDate(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
