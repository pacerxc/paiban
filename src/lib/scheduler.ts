import type { AppData, LeaveRecord, Person, Post, TeamId } from '../types'
import { diffDays, parseISO, startOfWeek, weekIndexOf, weekdayLabel } from './date'
import { holidayState } from './holidays'

/** 当天排班类型 */
export type PlanType =
  /** 周一至周五常规工作日 */
  | 'weekday'
  /** 周六 / 法定调休上班日：按 A、B 值班组整组上岗 */
  | 'duty'
  /** 放假 / 周日公休 */
  | 'off'

export interface DayStateInfo {
  working: boolean
  /** 是否由节假日或手动设置覆盖 */
  overridden: boolean
  /** 当天排班类型 */
  type: PlanType
}

export interface DayPlan {
  date: string
  weekday: number
  working: boolean
  overridden: boolean
  /** 当天排班类型 */
  type: PlanType
  /** personId -> 当天岗位，null 表示不在岗 */
  byPerson: Map<string, string | null>
  byPost: Map<string, string[]>
  /** 当天既没排班也没休假的人（轮空 / 休整） */
  resting: string[]
  /** 当天休假的人（personId） */
  onLeavePersonIds: string[]
  /** 当天是本人「每周固定轮休日」的人（personId） */
  restWeekdayPersonIds: string[]
  /** 当天休假的人 -> 休假类型 */
  leaveTypeByPerson: Map<string, LeaveRecord['type']>
  /** 每个岗位还差几个人（按当天实际位次数计算） */
  vacant: Map<string, number>
  /** 每个岗位当天的实际位次数（浮动岗按当天人数算） */
  slotCount: Map<string, number>
  /** 当天总位次（不含独立岗 512） */
  capacity: number
  /** 当天在岗人数（不含独立岗 512） */
  onDuty: number
  /**
   * 当天核心位次实到人数（不含 512，也不含机动岗与边境证）。
   *
   * 「每日最少在岗 8 人」说的就是这 8 个核心位次（复印1 受理2 校对2 扫描1 填表1 拍照1）；
   * 机动岗是顶缺用的浮动岗，边境证是机动有余力时兼做的，把它算进基数会让缺岗永远看不出来，
   * 所以单独统计。
   */
  coreOnDuty: number
  /** 当天核心位次总数（机动岗、边境证与 512 都不计） */
  coreCapacity: number
  /** 当天值班组长（大厅，不在岗时为 null） */
  leaderId: string | null
  /** 512 柜台组长（不在岗时为 null） */
  counterLeaderId: string | null
  /** 组长位次是否空缺（组长当天不在岗） */
  leaderVacant: boolean
  /** 当天值班组（周六/假日值班的班组） */
  dutyTeamId: TeamId | null
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
  if (override === 'off') return { working: false, overridden: true, type: 'off' }
  if (override === 'work') return { working: true, overridden: true, type: 'weekday' }
  const holiday = holidayState(date)
  if (holiday === 'off') return { working: false, overridden: true, type: 'off' }
  if (holiday === 'work') return { working: true, overridden: true, type: 'duty' }
  const weekday = parseISO(date).getDay()
  if (weekday === 0) return { working: false, overridden: false, type: 'off' }
  if (weekday === 6) return { working: true, overridden: false, type: 'duty' }
  return { working: true, overridden: false, type: 'weekday' }
}

/** 当天是否按周六/值班编制 */
export function isDutyDay(data: AppData, date: string): boolean {
  return dayState(data, date).type === 'duty'
}

/** 该岗位当天的编制（浮动岗返回上限值，实际位次数看 plan.slotCount） */
export function capacityOf(post: Post, date: string, data?: AppData): number {
  const type = data ? dayState(data, date).type : parseISO(date).getDay() === 6 ? 'duty' : 'weekday'
  if (type === 'off') return 0
  return type === 'duty' ? post.saturdayCapacity : post.capacity
}

/* ------------------------------------------------------------------ *
 * 岗位与人员分组
 * ------------------------------------------------------------------ */

/** 独立岗（512 柜台）—— 不计入大厅在岗人数 */
export function separatePosts(data: AppData): Post[] {
  return data.posts.filter((p) => p.separate)
}

/** 大厅岗位（参与在岗人数统计） */
export function hallPosts(data: AppData): Post[] {
  return data.posts.filter((p) => !p.separate)
}

/** 有固定岗人员的岗位 id 集合 */
function fixedPostIds(data: AppData): Set<string> {
  const ids = new Set<string>()
  for (const person of data.people) {
    if (person.active && person.fixedPostId) ids.add(person.fixedPostId)
  }
  return ids
}

/* ------------------------------------------------------------------ *
 * 平日轮转环
 * ------------------------------------------------------------------ */

/**
 * 轮转环的位次表：按岗位顺序展开，每个岗位占 capacity 个位次。
 *
 * 真实班表的位次链是 101 → 102 → 103 → 104 → 105 → 106 → 填表，
 * 正好是「一号台1 受理2 校对2 扫描1 填表1」展开来的 7 个位次。
 */
export function ringSlots(data: AppData): string[] {
  const slots: string[] = []
  for (const post of data.posts) {
    if (!post.ringSlot) continue
    for (let i = 0; i < post.capacity; i++) slots.push(post.id)
  }
  return slots
}

/** 某一周的环状态 */
export interface RingSnapshot {
  /** 环成员，顺序即位次顺序（members[0] 站 101 位，members[6] 站填表位） */
  members: string[]
  /** 机动/候补池，顺序即顶岗优先级 */
  standby: string[]
}

/** 环推进：整体右移一位 —— 机动池队首补进 101 位，填表位的人离环回到池尾 */
function advanceRing(members: string[], standby: string[]): void {
  if (members.length === 0) return
  const out = members.pop()!
  if (standby.length > 0) members.unshift(standby.shift()!)
  standby.push(out)
}

/** 环回退：advanceRing 的逆操作 */
function rewindRing(members: string[], standby: string[]): void {
  if (members.length === 0) return
  const head = members.shift()!
  const tail = standby.pop()
  if (tail !== undefined) members.push(tail)
  standby.unshift(head)
}

const ringCache = new WeakMap<object, Map<number, RingSnapshot>>()

/**
 * 某一日期所在周的环状态。
 *
 * 以 AppData.ring.anchorDate 为基准按周推进：锚点之后的每一周，
 * 7 个位次整体右移一位，101 位由机动池队首补入，填表位的人离环回到池尾。
 */
export function ringAt(data: AppData, date: string): RingSnapshot {
  const anchor = data.ring?.anchorDate ?? data.settings.startDate
  const steps = weekIndexOf(anchor, date)
  let cache = ringCache.get(data)
  if (!cache) {
    cache = new Map()
    ringCache.set(data, cache)
  }
  const hit = cache.get(steps)
  if (hit) return hit

  const members = [...(data.ring?.members ?? [])]
  const standby = [...(data.ring?.standby ?? [])]
  if (steps >= 0) {
    for (let i = 0; i < steps; i++) advanceRing(members, standby)
  } else {
    for (let i = 0; i < -steps; i++) rewindRing(members, standby)
  }
  const snapshot: RingSnapshot = { members, standby }
  cache.set(steps, snapshot)
  return snapshot
}

/** 环成员（按位次顺序） */
export function ringMembers(data: AppData): Person[] {
  const ids = data.ring?.members ?? []
  return ids.map((id) => data.people.find((p) => p.id === id)).filter((p): p is Person => !!p)
}

/** 机动/候补池（按顶岗优先级） */
export function ringStandby(data: AppData): Person[] {
  const ids = data.ring?.standby ?? []
  return ids.map((id) => data.people.find((p) => p.id === id)).filter((p): p is Person => !!p)
}

/** 边境证（107）岗位 */
export function borderPost(data: AppData): Post | undefined {
  return data.posts.find((p) => p.optional && !p.separate)
}

/** 浮动岗（机动）：位次取剩余可用人数 */
function leftoverPost(data: AppData): Post | undefined {
  return hallPosts(data).find((p) => p.flexMode === 'leftover')
}

/* ------------------------------------------------------------------ *
 * 值班班组
 * ------------------------------------------------------------------ */

/** 当天值班的班组：按周隔周交替（A / B / A / B…） */
export function dutyTeamOf(data: AppData, date: string): TeamId {
  const weekIndex = Math.floor(weekIndexOf(data.settings.startDate, date))
  const first = data.settings.firstTeam === 'B' ? 'B' : 'A'
  return weekIndex % 2 === 0 ? first : first === 'A' ? 'B' : 'A'
}

/** 班组成员（按组内顺序） */
export function teamMembers(data: AppData, teamId: TeamId): Person[] {
  const team = data.teams.find((t) => t.id === teamId)
  if (!team) return []
  const list: Person[] = []
  for (const personId of team.memberIds) {
    const person = data.people.find((p) => p.id === personId)
    if (person) list.push(person)
  }
  return list
}

/**
 * B 组值班时从 A 组借的那个人。
 *
 * 借人顺序 = A 组名单顺序，一人一次轮借，循环。
 * 计数器 = startDate 起累计的 B 组值班日序号（周六与法定调休上班日都算）。
 */
export function borrowedFrom(data: AppData, date: string): Person | null {
  if (dutyTeamOf(data, date) !== 'B') return null
  const aMembers = teamMembers(data, 'A')
  if (aMembers.length === 0) return null

  const borrowIndex = countDutyDaysBefore(data, date)
  return aMembers[borrowIndex % aMembers.length] ?? null
}

/** startDate 起、到 date 之前（不含）的 B 组值班日数量 */
function countDutyDaysBefore(data: AppData, date: string): number {
  const start = data.settings.startDate
  let count = 0
  // 以周为单位推进，避免逐日调用 planType 带来的开销
  const startWeek = startOfWeek(start)
  let cursor = startWeek
  let guard = 0
  while (cursor < date && guard < 2000) {
    for (let i = 0; i < 7; i++) {
      const d = addDaysLocal(cursor, i)
      if (d >= date) break
      if (d < start) continue
      if (dayState(data, d).type !== 'duty') continue
      const team = dutyTeamOf(data, d)
      if (team === 'B') count++
    }
    cursor = addDaysLocal(cursor, 7)
    guard++
  }
  return count
}

function addDaysLocal(date: string, days: number): string {
  const d = parseISO(date)
  d.setDate(d.getDate() + days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ------------------------------------------------------------------ *
 * 排班
 * ------------------------------------------------------------------ */

interface Ctx {
  active: Person[]
  leaveSet: Set<string>
  /** 当天不上岗的人 = 休假 + 每周固定轮休 */
  offSet: Set<string>
  /** 当天是本人「每周固定轮休日」的人 */
  restWeekdaySet: Set<string>
  leaveTypeByPerson: Map<string, LeaveRecord['type']>
  onLeavePersonIds: string[]
  byPerson: Map<string, string | null>
  /** 岗位位次：postId -> 已占用的人员 */
  slotOwner: Map<string, string[]>
}

/**
 * 当天轮休的人：固定轮休日落在这一工作日的人。
 *
 * 周六值班与周日公休不排轮休 —— 值班日是整组上岗，轮休只作用于周一至周五。
 */
export function restWeekdayIds(data: AppData, date: string): Set<string> {
  const day = parseISO(date).getDay()
  if (day === 0 || day === 6) return new Set()
  const index = (day + 6) % 7 // 周一 = 0
  const set = new Set<string>()
  for (const person of data.people) {
    if (!person.active) continue
    if (person.restWeekday === null || person.restWeekday === undefined) continue
    if (person.restWeekday === index) set.add(person.id)
  }
  return set
}

/** 把某人放进某个岗位的第一个空位 */
function place(ctx: Ctx, personId: string, postId: string, limit: number): boolean {
  const owners = ctx.slotOwner.get(postId) ?? []
  if (owners.length >= limit) return false
  owners.push(personId)
  ctx.slotOwner.set(postId, owners)
  ctx.byPerson.set(personId, postId)
  return true
}

/** 生成某一天的排班（含手工覆盖与休假） */
export function planDay(data: AppData, date: string): DayPlan {
  const weekday = parseISO(date).getDay()
  const state = dayState(data, date)
  const active = data.people.filter((p) => p.active)

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
  const restWeekdaySet = state.working ? restWeekdayIds(data, date) : new Set<string>()
  const offSet = new Set<string>([...leaveSet, ...restWeekdaySet])

  const ctx: Ctx = {
    active,
    leaveSet,
    offSet,
    restWeekdaySet,
    leaveTypeByPerson,
    onLeavePersonIds,
    byPerson: new Map<string, string | null>(),
    slotOwner: new Map<string, string[]>(),
  }
  for (const person of active) ctx.byPerson.set(person.id, null)

  let dutyTeamId: TeamId | null = null

  if (state.working) {
    if (state.type === 'duty') {
      dutyTeamId = dutyTeamOf(data, date)
      planDutyDay(data, date, ctx)
    } else {
      planWeekday(data, date, ctx)
    }
  }

  // 手工覆盖：整日替换该日的岗位安排（槽位为 null 表示该位次空缺）
  const override = data.dayPlans[date]
  let overriddenPlan = false
  if (override && state.working) {
    overriddenPlan = true
    for (const person of active) ctx.byPerson.set(person.id, null)
    ctx.slotOwner = new Map<string, string[]>()
    const assigned = new Set<string>()
    for (const post of data.posts) {
      const slots = override[post.id] ?? []
      for (const personId of slots) {
        if (!personId || assigned.has(personId)) continue
        const person = active.find((p) => p.id === personId)
        if (!person || ctx.offSet.has(personId)) continue
        assigned.add(personId)
        ctx.byPerson.set(personId, post.id)
        const owners = ctx.slotOwner.get(post.id) ?? []
        owners.push(personId)
        ctx.slotOwner.set(post.id, owners)
      }
    }
  }

  // 休假与轮休优先级最高
  for (const personId of ctx.offSet) ctx.byPerson.set(personId, null)

  const leaderId = resolveLeader(data, date, ctx.byPerson)
  const counterLeaderId = resolveCounterLeader(data, ctx.byPerson)
  const leaderVacant = leaderId === null && state.working

  return buildPlan({
    data,
    date,
    weekday,
    state,
    ctx,
    leaderId,
    counterLeaderId,
    leaderVacant,
    overriddenPlan,
    dutyTeamId,
  })
}

/* ------------------------------------------------------------------ *
 * 工作日：固定岗 + 轮转环 + 机动顶岗
 * ------------------------------------------------------------------ */

function planWeekday(data: AppData, date: string, ctx: Ctx): void {
  const onDuty = ctx.active.filter((p) => !ctx.offSet.has(p.id))

  // 1) 512 柜台：柜台常驻人员全部在 512（独立岗，不计入大厅在岗）
  const counterPost = separatePosts(data)[0]
  if (counterPost) {
    for (const person of onDuty) {
      if (person.pool !== 'counter') continue
      place(ctx, person.id, counterPost.id, counterPost.capacity)
    }
  }

  // 2) 固定岗：真实班表里只有「拍照」是固定岗，缺人时由机动顶上
  //    轮转位次（一号台/受理/校对/扫描/填表）一律由轮转环决定，
  //    把人指到这些位次当固定岗会跟环抢人，直接忽略。
  const fixedPosts = fixedPostIds(data)
  const fixedSlots: string[] = []
  for (const post of data.posts) {
    if (post.separate || post.ringSlot) continue
    if (!fixedPosts.has(post.id)) continue
    for (let i = 0; i < post.capacity; i++) fixedSlots.push(post.id)
  }
  for (const person of onDuty) {
    if (!person.fixedPostId) continue
    const post = data.posts.find((p) => p.id === person.fixedPostId)
    if (!post) continue
    if (post.ringSlot) continue
    place(ctx, person.id, post.id, post.capacity)
  }

  // 3) 环成员按位次落位：members[0] 站 101 位，members[6] 站填表位
  const slots = ringSlots(data)
  const { members, standby } = ringAt(data, date)
  const slotOwner = new Array<string | null>(slots.length).fill(null)
  // 环里没落到位的人（位次被别人占了、或环比位次多）退回机动池顶岗
  const displaced: string[] = []
  members.forEach((personId, i) => {
    if (!personId) return
    if (ctx.offSet.has(personId)) return
    if (ctx.byPerson.get(personId)) return
    if (i >= slots.length) {
      displaced.push(personId)
      return
    }
    const postId = slots[i]
    const post = data.posts.find((p) => p.id === postId)
    const owners = ctx.slotOwner.get(postId) ?? []
    if (post && owners.length >= post.capacity) {
      displaced.push(personId)
      return
    }
    slotOwner[i] = personId
  })

  // 4) 机动池：顶岗优先级 = 环内落不了位的人 → 机动池顺序 → 环外的大厅主班人员
  const ringIds = new Set(members)
  const pool: string[] = []
  for (const id of displaced) {
    if (ctx.offSet.has(id)) continue
    if (ctx.byPerson.get(id)) continue
    if (pool.includes(id)) continue
    pool.push(id)
  }
  for (const id of standby) {
    if (ringIds.has(id)) continue
    pool.push(id)
  }
  for (const person of onDuty) {
    if (person.pool !== 'main') continue
    if (ringIds.has(person.id) || pool.includes(person.id)) continue
    if (ctx.byPerson.get(person.id)) continue
    pool.push(person.id)
  }

  // 5) 边境证（107）：机动有余力时由机动里第一位顶上；用户也可以在班表上拖拽对调
  const border = borderPost(data)

  // 6) 顶岗：环位次的空位在前，固定岗缺岗在后，机动池按顺序出人
  const vacancies: Array<{ postId: string; index: number }> = []
  for (let i = 0; i < slotOwner.length; i++) {
    if (!slotOwner[i]) vacancies.push({ postId: slots[i], index: i })
  }
  for (const postId of fixedSlots) {
    const owners = ctx.slotOwner.get(postId) ?? []
    const need = fixedSlots.filter((x) => x === postId).length
    for (let k = owners.length; k < need; k++) vacancies.push({ postId, index: -1 })
  }

  let cursor = 0
  const takePool = (): string | null => {
    while (cursor < pool.length) {
      const id = pool[cursor++]
      if (ctx.offSet.has(id)) continue
      if (ctx.byPerson.get(id)) continue
      return id
    }
    return null
  }

  for (const vac of vacancies) {
    const personId = takePool()
    if (!personId) break
    if (vac.index >= 0) {
      slotOwner[vac.index] = personId
    } else {
      const owners = ctx.slotOwner.get(vac.postId) ?? []
      owners.push(personId)
      ctx.slotOwner.set(vac.postId, owners)
      ctx.byPerson.set(personId, vac.postId)
    }
  }

  // 写回环位次：每个岗位按位次顺序排列（102 排在 103 前面）
  for (const post of data.posts) {
    if (!post.ringSlot) continue
    const owners: string[] = []
    slots.forEach((postId, i) => {
      if (postId !== post.id) return
      const owner = slotOwner[i]
      if (!owner) return
      owners.push(owner)
      ctx.byPerson.set(owner, post.id)
    })
    ctx.slotOwner.set(post.id, owners)
  }

  // 7) 边境证：机动里第一位有余力的人顶上
  if (border) {
    for (const id of pool) {
      if (ctx.offSet.has(id)) continue
      if (ctx.byPerson.get(id)) continue
      place(ctx, id, border.id, border.capacity)
      break
    }
  }

  // 8) 机动：池里剩下的人待命（对应真实班表的「816 顶班待命」行）
  const floatPost = leftoverPost(data)
  if (floatPost) {
    for (const id of pool) {
      if (ctx.offSet.has(id)) continue
      if (ctx.byPerson.get(id)) continue
      place(ctx, id, floatPost.id, Number.MAX_SAFE_INTEGER)
    }
  }
}

/* ------------------------------------------------------------------ *
 * 周六 / 法定调休上班日：值班组整组上岗
 * ------------------------------------------------------------------ */

/**
 * 周六的 8 个核心位次：按岗位顺序展开 saturdayCapacity。
 *
 * 真实班表的周六编制与工作日一致 —— 复印1 受理2 校对2 扫描1 填表1 拍照1，
 * 不设机动、不设边境证、不开 512 柜台。
 */
function dutySlotList(data: AppData): string[] {
  const slots: string[] = []
  for (const post of data.posts) {
    if (post.separate || post.optional || post.flexMode === 'leftover') continue
    for (let i = 0; i < post.saturdayCapacity; i++) slots.push(post.id)
  }
  return slots
}

function planDutyDay(data: AppData, date: string, ctx: Ctx): void {
  const teamId = dutyTeamOf(data, date)
  const members = teamMembers(data, teamId)
  const onDuty = members.filter((p) => p.active && !ctx.leaveSet.has(p.id))

  // B 组少一人，向 A 组借一个
  const order: Person[] = [...onDuty]
  const borrowed = borrowedFrom(data, date)
  if (
    borrowed &&
    !ctx.leaveSet.has(borrowed.id) &&
    borrowed.active &&
    !order.some((p) => p.id === borrowed.id)
  ) {
    order.push(borrowed)
  }

  const dutySlots = dutySlotList(data)
  const slotOwner = new Array<string | null>(dutySlots.length).fill(null)

  // 1) 固定岗优先（拍照）
  for (const person of order) {
    if (!person.fixedPostId) continue
    const index = dutySlots.findIndex((postId, i) => postId === person.fixedPostId && !slotOwner[i])
    if (index < 0) continue
    slotOwner[index] = person.id
  }

  // 2) 其余人员按组内顺序填剩下的位次
  for (const person of order) {
    if (slotOwner.includes(person.id)) continue
    const index = slotOwner.findIndex((owner) => !owner)
    if (index < 0) break
    slotOwner[index] = person.id
  }

  // 3) 写回位次
  dutySlots.forEach((postId, i) => {
    const owner = slotOwner[i]
    if (!owner) return
    const owners = ctx.slotOwner.get(postId) ?? []
    owners.push(owner)
    ctx.slotOwner.set(postId, owners)
    ctx.byPerson.set(owner, postId)
  })
}

/* ------------------------------------------------------------------ *
 * 值班组长
 * ------------------------------------------------------------------ */

/** 大厅组长池：可以担任大厅值班组长的人（按 leaderOrder 轮值） */
export function leaderPool(data: AppData): Person[] {
  return data.people
    .filter((p) => p.active && p.canLead && p.leaderScope !== 'counter')
    .sort((a, b) => (a.leaderOrder ?? a.order) - (b.leaderOrder ?? b.order))
}

/** 512 柜台组长池 */
export function counterLeaderPool(data: AppData): Person[] {
  return data.people
    .filter((p) => p.active && p.canLead && p.leaderScope === 'counter')
    .sort((a, b) => (a.leaderOrder ?? a.order) - (b.leaderOrder ?? b.order))
}

/**
 * 当天大厅值班组长：
 * 1. 优先取手工指定（dayLeaders）
 * 2. 否则按组长候选顺序「一周一人」—— 按周轮值，跳过当天不在岗的人，
 *    也就是本人休假时由下一位在岗的组长代班（对应真实班表的「某天他人代班」）
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

  const phase = leaderWeekPhase(data, date)
  for (let i = 0; i < pool.length; i++) {
    const candidate = pool[(phase + i) % pool.length]
    if (byPerson.get(candidate.id)) return candidate.id
  }
  return null
}

/** 512 柜台组长：当天在岗的柜台组长 */
export function resolveCounterLeader(
  data: AppData,
  byPerson: Map<string, string | null>,
): string | null {
  const pool = counterLeaderPool(data)
  for (const person of pool) {
    if (byPerson.get(person.id)) return person.id
  }
  return null
}

/** 组长轮值相位：按周推进，一周一人（王玉花 → 杨娟 → 汪甜 循环） */
function leaderWeekPhase(data: AppData, date: string): number {
  const pool = leaderPool(data)
  if (pool.length === 0) return 0
  const weekIndex = Math.floor(weekIndexOf(data.settings.startDate, date))
  return ((weekIndex % pool.length) + pool.length) % pool.length
}

interface BuildArgs {
  data: AppData
  date: string
  weekday: number
  state: DayStateInfo
  ctx: Ctx
  leaderId: string | null
  counterLeaderId: string | null
  leaderVacant: boolean
  overriddenPlan: boolean
  dutyTeamId: TeamId | null
}

function buildPlan(args: BuildArgs): DayPlan {
  const { data, date, state, ctx } = args

  // 岗位人员按「位次顺序」排列 —— 受理岗的第 1 位是 102、第 2 位是 103，
  // 不能按名单顺序排，否则同一岗位的两位次会串位。
  const byPost = new Map<string, string[]>()
  for (const post of data.posts) {
    const owners = ctx.slotOwner.get(post.id) ?? []
    byPost.set(post.id, owners.filter((id) => ctx.byPerson.get(id)))
  }

  // 实际位次数：固定岗用编制，浮动岗按当天实际人数
  const slotCount = new Map<string, number>()
  for (const post of data.posts) {
    const nominal = capacityOf(post, date, data)
    if (post.flexMode === 'available') {
      slotCount.set(post.id, byPost.get(post.id)!.length)
    } else if (post.flexMode === 'leftover') {
      slotCount.set(post.id, byPost.get(post.id)!.length)
    } else {
      slotCount.set(post.id, nominal)
    }
  }

  const vacant = new Map<string, number>()
  for (const post of data.posts) {
    const count = byPost.get(post.id)!.length
    const total = slotCount.get(post.id)!
    vacant.set(post.id, state.working ? Math.max(0, total - count) : 0)
  }

  const resting = ctx.active
    .filter((p) => !ctx.byPerson.get(p.id) && !ctx.leaveSet.has(p.id))
    .map((p) => p.id)

  let onDuty = 0
  let capacity = 0
  let coreOnDuty = 0
  let coreCapacity = 0
  for (const post of data.posts) {
    if (post.separate) continue
    capacity += slotCount.get(post.id)!
    // 核心位次 = 8 个大厅固定编制位次；机动岗与边境证都不计入基数
    if (post.flexMode !== 'leftover' && !post.optional) coreCapacity += slotCount.get(post.id)!
  }
  for (const person of ctx.active) {
    const postId = ctx.byPerson.get(person.id)
    if (!postId) continue
    const post = data.posts.find((p) => p.id === postId)
    if (post?.separate) continue
    onDuty++
    if (post && post.flexMode !== 'leftover' && !post.optional) coreOnDuty++
  }

  return {
    date,
    weekday: args.weekday,
    working: state.working,
    overridden: state.overridden,
    type: state.type,
    byPerson: ctx.byPerson,
    byPost,
    resting,
    onLeavePersonIds: ctx.onLeavePersonIds,
    restWeekdayPersonIds: [...ctx.restWeekdaySet],
    leaveTypeByPerson: ctx.leaveTypeByPerson,
    vacant,
    slotCount,
    capacity,
    onDuty,
    coreOnDuty,
    coreCapacity,
    leaderId: args.leaderId,
    counterLeaderId: args.counterLeaderId,
    leaderVacant: args.leaderVacant,
    dutyTeamId: args.dutyTeamId,
    overriddenPlan: args.overriddenPlan,
  }
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

  // 512 柜台人员：工作日常驻 512，周六/假日随值班组进大厅
  if (person.pool === 'counter') {
    const counterPost = separatePosts(data)[0]
    if (state.type !== 'duty' && counterPost && postId !== counterPost.id) {
      return fail(
        `${person.name} 是 512 柜台人员，工作日固定在 512 柜台`,
        '规则：512 柜台人员工作日只上 512 岗。',
      )
    }
    if (counterPost && postId === counterPost.id && state.type === 'duty') {
      return fail(
        `${person.name} 当天参加值班组上岗，没有 512 柜台`,
        '规则：周六与假日值班日不设 512 柜台。',
      )
    }
  }

  if (person.fixedPostId && person.fixedPostId !== postId) {
    const fixed = data.posts.find((p) => p.id === person.fixedPostId)
    return fail(
      `${person.name} 固定${fixed ? `「${fixed.name}」` : '岗位'}，不能排「${post.name}」`,
      '规则：固定岗位人员只能上本岗。',
    )
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
  const limit = plan.slotCount.get(postId) ?? capacityOf(post, date, data)
  if (occupants.length >= limit) {
    return fail(
      `「${post.name}」已满（编制 ${limit} 人），请直接拖到在岗人员身上对调`,
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

/** 某人在某月的休息天数：公休 + 表内不在岗登记（含年假） */
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

/**
 * 某人某月的值班次数（周六 + 法定调休上班日）。
 *
 * 512 柜台人员周六随值班组上岗同样计入 —— 值班 1 天 = 轮休额度 +1。
 */
export function countDutyDays(data: AppData, personId: string, dates: string[]): number {
  let count = 0
  for (const date of dates) {
    if (dayState(data, date).type !== 'duty') continue
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

    if (plan.coreOnDuty < min) {
      errors++
      alerts.push({
        level: 'error',
        date,
        title: `${shortDate(date)} ${weekdayLabel(date)} 核心位次 ${plan.coreOnDuty}/${plan.coreCapacity}`,
        detail: `低于每日最少在岗 ${min} 人，缺 ${min - plan.coreOnDuty} 人（机动顶岗不计入基数）`,
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

    // 512 柜台缺人：只提示，不计入严重告警（该岗当天无编制则不提示）
    for (const post of separatePosts(data)) {
      const limit = capacityOf(post, date, data)
      if (limit <= 0) continue
      const count = plan.byPost.get(post.id)?.length ?? 0
      if (count < limit) {
        alerts.push({
          level: 'info',
          date,
          title: `${shortDate(date)} ${weekdayLabel(date)} ${post.name} 柜台 ${count} 人`,
          detail: `${post.name}柜台应 ${limit} 人，缺 ${limit - count} 人（不影响大厅在岗人数）`,
        })
      }
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
  return pool[leaderWeekPhase(data, date)].name
}

function shortDate(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
