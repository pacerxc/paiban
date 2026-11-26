/**
 * 排班规则校验引擎
 *
 * 逐条检查 v4 排班规则，输出违规清单。
 *
 * 判断一律基于「最终生效的安排」—— 即 planDay 的结果：
 * 它已经处理了 dayPlans 手工覆盖（优先于自动排班）与休假优先级，
 * 这里不再另起一套推导。
 */
import type { AppData, Person, Post } from '../types'
import type { DayPlan } from './scheduler'
import { parseISO, weekdayLabel } from './date'
import { capacityOf, leaveOf, planDay } from './scheduler'

/** 违规级别：error = 排班本身有错；warn = 当天还能排下去，但需要留意 */
export type RuleLevel = 'error' | 'warn'

export interface RuleViolation {
  level: RuleLevel
  /** 违规发生的日期 */
  date: string
  /** 相关人员 id（可选） */
  personId?: string
  /** 相关岗位 id（可选） */
  postId?: string
  /** 一行摘要，例：「11/26 周三 · 颜贞贞 → 一号台」 */
  title: string
  /** 违反的规则，例：「固定岗位人员只能上本岗。」 */
  rule: string
  /** 怎么改，例：「换回「照相」岗，或到「人员」页取消她的固定岗设置。」 */
  fix: string
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 「11/26」 */
function shortDate(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/** 「11/26 周三」 */
function dayLabel(date: string): string {
  return `${shortDate(date)} ${weekdayLabel(date)}`
}

/** 岗位名 */
function postNameOf(posts: Map<string, Post>, postId: string): string {
  return posts.get(postId)?.name ?? postId
}

/** 人名 */
function personNameOf(people: Map<string, Person>, personId: string): string {
  return people.get(personId)?.name ?? personId
}

/** 有固定岗人员的岗位 id 集合 */
function fixedPostIds(data: AppData): Set<string> {
  const ids = new Set<string>()
  for (const person of data.people) {
    if (person.active && person.fixedPostId) ids.add(person.fixedPostId)
  }
  return ids
}

/**
 * 值班日（周六 / 法定调休）大厅的位次总数。
 *
 * 真实班表的周六编制与工作日一致：复印1 受理2 校对2 扫描1 填表1 拍照1 = 8 个位次，
 * 不设机动、不设边境证、不开 512 柜台。
 */
function dutyHallSlots(data: AppData): number {
  let total = 0
  for (const post of data.posts) {
    if (post.separate) continue
    total += post.saturdayCapacity
  }
  return total
}

/** 轮转环应有的位次数：参与轮转的岗位按编制展开 */
function ringSlotCount(data: AppData): number {
  let total = 0
  for (const post of data.posts) {
    if (!post.ringSlot) continue
    total += post.capacity
  }
  return total
}

/* ------------------------------------------------------------------ *
 * 逐人检查
 * ------------------------------------------------------------------ */

interface Context {
  data: AppData
  date: string
  plan: DayPlan
  label: string
  people: Map<string, Person>
  posts: Map<string, Post>
  add: (v: RuleViolation) => void
  /** 配置类问题只提示一次 */
  reported: boolean
}

/** 休假期间不排班 */
function checkLeave(ctx: Context): void {
  const { date, plan, label, people, posts, add } = ctx
  for (const [personId, leaveType] of plan.leaveTypeByPerson) {
    const postId = plan.byPerson.get(personId)
    if (!postId) continue
    const name = personNameOf(people, personId)
    const leave = leaveOf(ctx.data, personId, date)
    const span = leave ? `（${leave.start} ~ ${leave.end}）` : ''
    add({
      level: 'error',
      date,
      personId,
      postId,
      title: `${label} · ${name} → ${postNameOf(posts, postId)}（当天${leaveType}）`,
      rule: '休假期间不排班。',
      fix: `${name}当天${leaveType}${span}，应从当天排班里撤下，或换人顶上。`,
    })
  }
}

/** 逐人核对：停用、固定岗、512 柜台、个人岗位限制 */
function checkPeople(ctx: Context): void {
  const { date, plan, label, people, posts, add } = ctx
  for (const [personId, postId] of plan.byPerson) {
    if (!postId) continue
    const person = people.get(personId)
    const name = person?.name ?? personId
    const title = `${label} · ${name} → ${postNameOf(posts, postId)}`

    // 停用人员不参与排班
    if (!person || !person.active) {
      add({
        level: 'error',
        date,
        personId,
        postId,
        title,
        rule: '停用人员不参与排班。',
        fix: `在「人员」页把${name}恢复为在职，或把她从当天排班中移除。`,
      })
      continue
    }

    // 固定岗位人员只能上本岗
    if (person.fixedPostId && person.fixedPostId !== postId) {
      add({
        level: 'error',
        date,
        personId,
        postId,
        title,
        rule: '固定岗位人员只能上本岗。',
        fix: `换回「${postNameOf(posts, person.fixedPostId)}」岗，或到「人员」页取消${name}的固定岗设置。`,
      })
    }

    // 轮休日不上岗
    if (plan.restWeekdayPersonIds.includes(personId)) {
      add({
        level: 'error',
        date,
        personId,
        postId,
        title: `${title}（当天是${name}的轮休日）`,
        rule: '每周固定轮休日不上岗。',
        fix: `把${name}从当天排班里撤下，或到「人员」页改掉她的固定轮休日。`,
      })
    }

    // 512 柜台人员工作日只上 512 岗
    if (person.pool === 'counter' && plan.type === 'weekday') {
      const post = posts.get(postId)
      if (post && !post.separate) {
        add({
          level: 'error',
          date,
          personId,
          postId,
          title,
          rule: '512 柜台人员工作日只上 512 岗。',
          fix: `把${name}调回 512 柜台，或到「人员」页调整她的岗位归属。`,
        })
      }
    }

    // 周六与法定假日值班日不设 512 柜台
    if (person.pool === 'counter' && plan.type === 'duty') {
      const post = posts.get(postId)
      if (post?.separate) {
        add({
          level: 'error',
          date,
          personId,
          postId,
          title,
          rule: '周六与法定假日值班日不设 512 柜台。',
          fix: `值班日不设 512 柜台，把${name}安排到值班组的大厅岗位。`,
        })
      }
    }

    // 个人岗位限制
    if (person.allowedPostIds && !person.allowedPostIds.includes(postId)) {
      const allowed = person.allowedPostIds
        .map((id) => posts.get(id)?.name)
        .filter(Boolean)
        .join('、')
      add({
        level: 'error',
        date,
        personId,
        postId,
        title,
        rule: '个人岗位限制。',
        fix: `${name}只允许上「${allowed}」，换到允许的岗位，或到「人员」页放宽她的岗位限制。`,
      })
    }
  }
}

/**
 * 手工覆盖的原始槽位检查。
 *
 * planDay 会把休假中、已停用的人从覆盖里过滤掉，但班表上显示的就是这份覆盖，
 * 所以这里直接看原始数据，把「休假期间仍被排班」「停用人员仍被排班」
 * 「一人一天两个岗」如实报出来，而不是被 plan 的过滤掩盖掉。
 */
function checkOverrideSlots(ctx: Context): void {
  const { date, label, people, posts, data, add } = ctx
  const override = data.dayPlans[date]
  if (!override) return

  const seen = new Map<string, string[]>()
  for (const [postId, slots] of Object.entries(override)) {
    if (!posts.has(postId)) continue
    for (const personId of slots) {
      if (!personId) continue
      const list = seen.get(personId) ?? []
      list.push(postId)
      seen.set(personId, list)

      const person = people.get(personId)
      const name = person?.name ?? personId
      const postLabel = postNameOf(posts, postId)
      const title = `${label} · ${name} → ${postLabel}`

      // 停用人员不参与排班
      if (!person || !person.active) {
        add({
          level: 'error',
          date,
          personId,
          postId,
          title,
          rule: '停用人员不参与排班。',
          fix: `在「人员」页把${name}恢复为在职，或把她从当天排班中移除。`,
        })
      }

      // 休假期间不排班
      const leave = leaveOf(data, personId, date)
      if (leave) {
        add({
          level: 'error',
          date,
          personId,
          postId,
          title: `${title}（当天${leave.type}）`,
          rule: '休假期间不排班。',
          fix: `${name}当天${leave.type}，应从当天排班里撤下，或换人顶上。`,
        })
      }
    }
  }

  // 一人一天只上一个岗位
  for (const [personId, postIds] of seen) {
    if (postIds.length <= 1) continue
    const name = personNameOf(people, personId)
    const names = postIds.map((id) => postNameOf(posts, id)).join('、')
    add({
      level: 'error',
      date,
      personId,
      postId: postIds[0],
      title: `${label} · ${name} 同时出现在 ${names}`,
      rule: '一人一天只上一个岗位。',
      fix: `${name}一天只能上一个岗位，从多余的岗位上撤下来。`,
    })
  }
}

/* ------------------------------------------------------------------ *
 * 逐岗 / 逐日检查
 * ------------------------------------------------------------------ */

/** 一人一天只上一个岗位 */
function checkDuplicatePost(ctx: Context): void {
  const { date, plan, label, people, posts, add } = ctx
  const seen = new Map<string, string[]>()
  for (const [postId, personIds] of plan.byPost) {
    for (const personId of personIds) {
      const list = seen.get(personId) ?? []
      list.push(postId)
      seen.set(personId, list)
    }
  }
  for (const [personId, postIds] of seen) {
    if (postIds.length <= 1) continue
    const names = postIds.map((id) => postNameOf(posts, id)).join('、')
    add({
      level: 'error',
      date,
      personId,
      postId: postIds[0],
      title: `${label} · ${personNameOf(people, personId)} 同时出现在 ${names}`,
      rule: '一人一天只上一个岗位。',
      fix: `${personNameOf(people, personId)}一天只能上一个岗位，从多余的岗位上撤下来。`,
    })
  }
}

/** 岗位人数不能超编 */
function checkOverCapacity(ctx: Context): void {
  const { date, plan, label, posts, add } = ctx
  for (const [postId, personIds] of plan.byPost) {
    const slots = plan.slotCount.get(postId) ?? 0
    if (personIds.length <= slots) continue
    const name = postNameOf(posts, postId)
    add({
      level: 'error',
      date,
      postId,
      title: `${label} · ${name} ${personIds.length} 人（编制 ${slots} 人）`,
      rule: '岗位人数不能超编。',
      fix: `「${name}」编制 ${slots} 人，多出来的人换到机动岗或其他空位。`,
    })
  }
}

/** 每日最少在岗人数（不含 512 柜台与机动岗）；值班日由 checkDutySlots 单独报，避免同一问题重复提示 */
function checkHeadcount(ctx: Context, min: number): void {
  const { date, plan, label, add } = ctx
  if (plan.type === 'duty') return
  if (plan.coreOnDuty >= min) return
  add({
    level: 'error',
    date,
    title: `${label} · 大厅核心位次只到 ${plan.coreOnDuty} 人`,
    rule: `每日最少在岗 ${min} 人。`,
    fix: `再安排 ${min - plan.coreOnDuty} 人到大厅核心岗位（当前 ${plan.coreOnDuty}/${plan.coreCapacity}），机动顶岗不计入基数。`,
  })
}

/** 工作日固定岗应满编，缺岗需由机动顶上 */
function checkFixedPostFull(ctx: Context, fixedPosts: Set<string>): void {
  const { date, plan, label, add } = ctx
  if (plan.type !== 'weekday') return
  for (const post of ctx.data.posts) {
    if (post.separate || !fixedPosts.has(post.id)) continue
    const slots = plan.slotCount.get(post.id) ?? 0
    const count = plan.byPost.get(post.id)?.length ?? 0
    if (count >= slots) continue
    add({
      level: 'warn',
      date,
      postId: post.id,
      title: `${label} · ${post.name} 缺 ${slots - count} 人`,
      rule: '工作日固定岗应满编，缺岗需由机动顶上。',
      fix: `从机动岗调一人顶上「${post.name}」。`,
    })
  }
}

/** 周六与法定假日应整组上岗 */
function checkDutySlots(ctx: Context, dutySlots: number): void {
  const { date, plan, label, add } = ctx
  if (plan.type !== 'duty' || dutySlots <= 0) return
  if (plan.onDuty >= dutySlots) return
  add({
    level: 'error',
    date,
    title: `${label} · 值班只到 ${plan.onDuty} 人`,
    rule: `周六与法定假日应整组上岗 ${dutySlots} 个位次。`,
    fix: `值班组全员上岗，或向另一个值班组借人补齐 ${dutySlots - plan.onDuty} 个位次。`,
  })
}

/** 当天需有值班组长在岗 */
function checkLeader(ctx: Context): void {
  const { date, plan, label, add } = ctx
  if (!plan.leaderVacant) return
  add({
    level: 'warn',
    date,
    title: `${label} · 值班组长空缺`,
    rule: '当天需有值班组长在岗。',
    fix: '指定一位在岗的值班组长，或调整当天排班让组长在岗。',
  })
}

/** 512 柜台应常驻 */
function checkCounterStaffing(ctx: Context): void {
  const { date, plan, label, data, add } = ctx
  for (const post of data.posts) {
    if (!post.separate) continue
    const limit = capacityOf(post, date, data)
    if (limit <= 0) continue
    const count = plan.byPost.get(post.id)?.length ?? 0
    if (count >= limit) continue
    add({
      level: 'warn',
      date,
      postId: post.id,
      title: `${label} · ${post.name} 柜台 ${count} 人`,
      rule: `${post.name} 柜台应常驻 ${limit} 人。`,
      fix: `补 ${limit - count} 人到 ${post.name} 柜台，或调整柜台人员的休假安排。`,
    })
  }
}

/**
 * 轮转环人数不足：环上的人少了，机动池要补的位次就多。
 *
 * 这是配置层面的问题，只在区间内第一个上班日提示一次。
 */
function checkRingStaffing(ctx: Context, expected: number): void {
  const { date, label, data, add } = ctx
  if (ctx.reported) return
  const count = data.ring?.members.length ?? 0
  if (count >= expected) return
  ctx.reported = true
  add({
    level: 'warn',
    date,
    title: `${label} · 轮转环只有 ${count} 人（应为 ${expected} 人）`,
    rule: '轮转环应按位次配满，缺的人由机动池顶上。',
    fix: `到「人员」页的「平日轮转环」补齐 ${expected - count} 人，或从机动池里把队首的人拖进环内。`,
  })
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */

/**
 * 检查给定日期区间内的全部规则，返回违规清单（按日期升序、同日按级别排）。
 */
export function checkRules(data: AppData, dates: string[]): RuleViolation[] {
  const violations: RuleViolation[] = []
  const people = new Map(data.people.map((p) => [p.id, p]))
  const posts = new Map(data.posts.map((p) => [p.id, p]))
  const fixedPosts = fixedPostIds(data)
  const min = data.settings.minDailyHeadcount
  const dutySlots = dutyHallSlots(data)
  const ringSlots = ringSlotCount(data)

  const add = (v: RuleViolation): void => {
    violations.push(v)
  }

  for (const date of dates) {
    const plan = planDay(data, date)
    if (!plan.working) continue

    const ctx: Context = {
      data,
      date,
      plan,
      label: dayLabel(date),
      people,
      posts,
      add,
      reported: false,
    }

    checkLeave(ctx)
    checkPeople(ctx)
    checkOverrideSlots(ctx)
    checkDuplicatePost(ctx)
    checkOverCapacity(ctx)
    checkHeadcount(ctx, min)
    checkFixedPostFull(ctx, fixedPosts)
    checkDutySlots(ctx, dutySlots)
    checkLeader(ctx)
    checkCounterStaffing(ctx)
    checkRingStaffing(ctx, ringSlots)
  }

  violations.sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.level !== b.level) return a.level === 'error' ? -1 : 1
    return 0
  })

  return violations
}
