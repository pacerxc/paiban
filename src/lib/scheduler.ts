import type { AppData, LeaveRecord, Person, Post } from '../types'
import { parseISO, weekIndexOf, weekdayLabel } from './date'

export interface DayStateInfo {
  working: boolean
  /** 是否由节假日手动设置覆盖 */
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
  /** 当天既没排班也没休假的人（轮空 / 只排周六的人） */
  resting: string[]
  /** 当天休假的人 */
  leaveIds: string[]
  /** 每个岗位还差几个人 */
  vacant: Map<string, number>
}

export function isOnLeave(data: AppData, personId: string, date: string): boolean {
  return data.leaves.some(
    (l) => l.personId === personId && l.start <= date && l.end >= date,
  )
}

function leaveOf(data: AppData, personId: string, date: string): LeaveRecord | undefined {
  return data.leaves.find((l) => l.personId === personId && l.start <= date && l.end >= date)
}

export function dayState(data: AppData, date: string): DayStateInfo {
  const weekday = parseISO(date).getDay()
  const override = data.days[date]
  if (override) return { working: override === 'work', overridden: true }
  return { working: weekday !== 0, overridden: false }
}

/** 该人员的岗位限制是否允许某岗位 */
function canTake(person: Person, postId: string, weekday: number): boolean {
  if (person.saturdayOnly && weekday !== 6) return false
  if (person.fixedPostId) return person.fixedPostId === postId
  if (person.allowedPostIds) return person.allowedPostIds.includes(postId)
  return true
}

function expandSlots(posts: Post[]): string[] {
  const slots: string[] = []
  for (const post of posts) {
    const cap = Math.max(0, Math.floor(post.capacity))
    for (let i = 0; i < cap; i++) slots.push(post.id)
  }
  return slots
}

/** 生成某一天的排班（含手动调整与休假覆盖） */
export function planDay(data: AppData, date: string): DayPlan {
  const weekday = parseISO(date).getDay()
  const state = dayState(data, date)
  const active = data.people
    .filter((p) => p.active)
    .sort((a, b) => a.order - b.order)

  const byPerson = new Map<string, string | null>()
  const leaveIds: string[] = []
  const leaveSet = new Set<string>()
  for (const person of active) {
    if (isOnLeave(data, person.id, date)) {
      leaveIds.push(person.id)
      leaveSet.add(person.id)
    }
  }

  if (!state.working) {
    for (const person of active) byPerson.set(person.id, null)
    return buildPlan(data, date, weekday, state, active, byPerson, leaveIds, leaveSet)
  }

  const posts = data.posts
  const slots = expandSlots(posts)
  const regulars = active.filter((p) => !p.saturdayOnly)
  const saturdayPeople = active.filter((p) => p.saturdayOnly)
  const weekIndex = Math.floor(weekIndexOf(data.settings.startDate, date))

  const availableRegulars = regulars.filter((p) => !leaveSet.has(p.id))

  // 周六：从周六专属人员里轮 1 人上岗，并让 1 名常规人员轮休
  let weekendPick: Person | null = null
  let restPickId: string | null = null
  if (weekday === 6 && saturdayPeople.length > 0) {
    const pool = saturdayPeople.filter((p) => !leaveSet.has(p.id))
    if (pool.length > 0) weekendPick = pool[((weekIndex % pool.length) + pool.length) % pool.length]
    if (weekendPick && availableRegulars.length > 0) {
      const rest =
        availableRegulars[((weekIndex % availableRegulars.length) + availableRegulars.length) % availableRegulars.length]
      restPickId = rest.id
    }
  }

  // 常规人员在岗顺序中的位次，用于每周整体顺移
  const rank = new Map<string, number>()
  regulars.forEach((p, i) => rank.set(p.id, i))
  saturdayPeople.forEach((p, i) => rank.set(p.id, i))

  const assignList: Person[] = []
  if (weekendPick) assignList.push(weekendPick)
  // 休假人员也参与占位，最后再移除，避免一个人休假导致整张表大幅错位
  for (const person of regulars) {
    if (person.id !== restPickId) assignList.push(person)
  }

  const slotOwner: Array<number | null> = new Array(slots.length).fill(null)
  const locked = new Set<number>()

  const lockToPost = (personId: string, postId: string | null): boolean => {
    const ai = assignList.findIndex((p) => p.id === personId)
    if (ai < 0) return false
    const si = slots.findIndex(
      (slotPost, index) => slotPost === postId && slotOwner[index] === null,
    )
    if (si < 0) return false
    slotOwner[si] = ai
    locked.add(ai)
    return true
  }

  const lockWeekendPick = (): void => {
    if (!weekendPick) return
    const allowed = weekendPick.allowedPostIds
      ? weekendPick.allowedPostIds
          .map((id) => posts.find((p) => p.id === id))
          .filter((p): p is Post => !!p && p.capacity > 0)
      : posts.filter((p) => p.capacity > 0)
    if (allowed.length === 0) return
    const preferred = allowed[((weekIndex % allowed.length) + allowed.length) % allowed.length]
    lockToPost(weekendPick.id, preferred.id)
  }

  // 周六专属人员优先锁定到「填表 / 一号台」等允许岗位，并按周轮换
  lockWeekendPick()
  // 固定岗位人员锁定在本岗
  for (const person of assignList) {
    if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
  }

  // 其余人员按顺序依次占用剩下的岗位，每周整体顺移一位
  const freeSlots = slots.map((_, index) => index).filter((index) => slotOwner[index] === null)
  const flexible = assignList.map((_, index) => index).filter((index) => !locked.has(index))
  if (freeSlots.length > 0) {
    flexible.forEach((ai, order) => {
      const pos =
        freeSlots[(((order + weekIndex) % freeSlots.length) + freeSlots.length) % freeSlots.length]
      slotOwner[pos] = ai
    })
  }

  // 有人被「只能上某些岗」限制时，改用匹配算法兜底
  const violates = flexible.some((ai) => {
    const person = assignList[ai]
    const si = slotOwner.findIndex((owner) => owner === ai)
    return si < 0 || !canTake(person, slots[si], weekday)
  })

  if (violates) {
    slotOwner.fill(null)
    locked.clear()
    lockWeekendPick()
    for (const person of assignList) {
      if (person.fixedPostId) lockToPost(person.id, person.fixedPostId)
    }

    const cycle = slots.length || 1
    const candidates: number[][] = assignList.map((person) => {
      const base = rank.get(person.id) ?? 0
      const preferredSlot = (((base + weekIndex) % cycle) + cycle) % cycle
      const list: number[] = []
      for (let d = 0; d < slots.length; d++) {
        const si = (preferredSlot + d) % slots.length
        if (slotOwner[si] !== null && locked.has(slotOwner[si]!)) continue
        if (canTake(person, slots[si], weekday)) list.push(si)
      }
      return list
    })

    const tryAssign = (ai: number, visited: boolean[]): boolean => {
      for (const si of candidates[ai]) {
        if (visited[si]) continue
        visited[si] = true
        const owner = slotOwner[si]
        if (owner === null) {
          slotOwner[si] = ai
          return true
        }
        if (!locked.has(owner) && tryAssign(owner, visited)) {
          slotOwner[si] = ai
          return true
        }
      }
      return false
    }

    assignList.forEach((_, ai) => {
      if (locked.has(ai)) return
      tryAssign(ai, new Array(slots.length).fill(false))
    })
  }

  for (const person of active) byPerson.set(person.id, null)
  slots.forEach((postId, si) => {
    const ai = slotOwner[si]
    if (ai !== null) byPerson.set(assignList[ai].id, postId)
  })

  // 手动调整只影响当天
  const prefix = `${date}|`
  for (const [key, postId] of Object.entries(data.dayPosts)) {
    if (!key.startsWith(prefix)) continue
    const personId = key.slice(prefix.length)
    if (!byPerson.has(personId)) continue
    if (postId === '') byPerson.set(personId, null)
    else if (posts.some((p) => p.id === postId)) byPerson.set(personId, postId)
  }

  // 休假优先级最高
  for (const personId of leaveSet) byPerson.set(personId, null)

  return buildPlan(data, date, weekday, state, active, byPerson, leaveIds, leaveSet)
}

function buildPlan(
  data: AppData,
  date: string,
  weekday: number,
  state: DayStateInfo,
  active: Person[],
  byPerson: Map<string, string | null>,
  leaveIds: string[],
  leaveSet: Set<string>,
): DayPlan {
  const byPost = new Map<string, string[]>()
  for (const post of data.posts) byPost.set(post.id, [])
  for (const person of active) {
    const postId = byPerson.get(person.id)
    if (postId && byPost.has(postId)) byPost.get(postId)!.push(person.id)
  }

  const vacant = new Map<string, number>()
  for (const post of data.posts) {
    const count = byPost.get(post.id)!.length
    vacant.set(post.id, state.working ? Math.max(0, post.capacity - count) : 0)
  }

  const resting = active
    .filter((p) => !byPerson.get(p.id) && !leaveSet.has(p.id))
    .map((p) => p.id)

  return {
    date,
    weekday,
    working: state.working,
    overridden: state.overridden,
    byPerson,
    byPost,
    resting,
    leaveIds,
    vacant,
  }
}

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

  if (person.saturdayOnly && parseISO(date).getDay() !== 6) {
    return fail(
      `${person.name} 只排周六，不能排到${weekdayLabel(date)}`,
      '规则：周六专属人员只在周六上班。',
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
    return fail(
      `${b.name} 当天${leaveB.type}，不能对调`,
      '规则：休假期间不排班。',
    )
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
  if (occupants.length >= post.capacity) {
    return fail(
      `「${post.name}」已满（需 ${post.capacity} 人），请直接拖到在岗人员身上对调`,
      '规则：岗位人数不能超编。',
    )
  }
  return OK
}

/** 某人在某月的上班天数 */
export function countWorkDays(data: AppData, personId: string, dates: string[]): number {
  return dates.reduce((sum, date) => {
    if (isOnLeave(data, personId, date)) return sum
    const plan = planDay(data, date)
    return plan.byPerson.get(personId) ? sum + 1 : sum
  }, 0)
}

/** 生成一段时间内每一天的排班 */
export function planRange(data: AppData, dates: string[]): Map<string, DayPlan> {
  const map = new Map<string, DayPlan>()
  for (const date of dates) map.set(date, planDay(data, date))
  return map
}
