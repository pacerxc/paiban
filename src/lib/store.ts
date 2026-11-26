import type {
  AppData,
  DayState,
  LeaveRecord,
  LedgerEntry,
  Person,
  Post,
  RingState,
  Team,
  TeamId,
} from '../types'
import { startOfWeek, toISO } from './date'
import { planDay, capacityOf } from './scheduler'

const STORAGE_KEY = 'paiban.data.v6'
/** 历史版本 key，读取时按顺序尝试迁移 */
const LEGACY_KEYS = ['paiban.data.v5', 'paiban.data.v4', 'paiban.data.v3', 'paiban.data.v2', 'paiban.data.v1']

/** v5 的岗位 id：一份手工覆盖至少要包含这些岗位才算完整 */
const REQUIRED_POST_IDS = ['post_1', 'post_2', 'post_3', 'post_4', 'post_5', 'post_6', 'post_7', 'post_8']

export const POST_COLORS = [
  '#0e7c66',
  '#b45309',
  '#2f6f9f',
  '#b0446a',
  '#3f7a3f',
  '#8a6a2f',
  '#5b6472',
  '#7a5ba6',
]

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/**
 * 平日轮转环的默认基准。
 *
 * 取自真实班表 2026-11-30 那一周：7 个轮转位次（101 → 102 → 103 → 104 → 105 → 106 → 填表）
 * 依次是杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟；
 * 机动/候补池是王玉花、朱婕、陈静静。
 *
 * 往后每周整体右移一位：101 位由机动池队首补入，填表位的人离环回到池尾。
 */
export const SEED_RING_ANCHOR = '2026-11-30'
/** 轮转起始周：锚点那一周的周一。值班组交替与组长周轮值都以它为相位零点 */
export const SEED_START_DATE = '2026-11-23'
const SEED_RING_MEMBERS = ['杨雯', '杨娟', '汪甜', '林丽雯', '贺夏炎', '耿园园', '周娟']
const SEED_RING_STANDBY = ['王玉花', '朱婕', '陈静静']
/** 轮转环的位次数：101 ~ 106 共 6 个 + 填表 1 个 */
export const RING_SIZE = 7

/**
 * 按名单生成轮转环。
 *
 * 名单对不上（换了自己的班组、或清空名单后重新录入）时，
 * 用主班池里没进环的人依次补齐环位与机动池。
 */
export function defaultRing(people: Person[]): RingState {
  const byName = new Map(people.map((p) => [p.name, p.id]))
  const pick = (names: string[]): string[] =>
    names.map((n) => byName.get(n)).filter((x): x is string => !!x)

  const members = pick(SEED_RING_MEMBERS)
  const standby = pick(SEED_RING_STANDBY)

  const used = new Set([...members, ...standby])
  const rest = people
    .filter((p) => p.active && p.pool === 'main' && !p.fixedPostId && !used.has(p.id))
    .map((p) => p.id)

  const need = Math.max(0, RING_SIZE - members.length)
  const fill = rest.slice(0, need)
  return {
    anchorDate: SEED_RING_ANCHOR,
    members: [...members, ...fill],
    standby: [...standby, ...rest.slice(need)],
  }
}

/**
 * 校正一份轮转环：剔除不存在的人、补齐环位、把没进环的人放进机动池尾部。
 *
 * 环位不足时先从机动池头部借；机动池空了再拿主班池里没被安排的人补。
 */
export function normalizeRing(source: RingState | undefined, people: Person[]): RingState {
  // 旧数据里没有环（v5 及更早）：直接用默认基准搭一份
  if (!source) return defaultRing(people)

  const alive = new Set(people.filter((p) => p.active).map((p) => p.id))
  const members = (source?.members ?? []).filter((id) => alive.has(id))
  const standby = (source?.standby ?? []).filter((id) => alive.has(id) && !members.includes(id))

  // 机动池里还没进环的人，优先补进空着的环位
  while (members.length < RING_SIZE && standby.length > 0) {
    members.push(standby.shift()!)
  }

  const assigned = new Set([...members, ...standby])
  const rest = people
    .filter((p) => p.active && p.pool === 'main' && !p.fixedPostId && !assigned.has(p.id))
    .map((p) => p.id)

  return {
    anchorDate: source?.anchorDate ?? SEED_RING_ANCHOR,
    members,
    standby: [...standby, ...rest],
  }
}

/**
 * 9 个岗位：
 * - 工作日（周一~周五）：复印1 受理2 校对2 扫描1 填表1 拍照1，另有机动（顶班待命）、
 *   边境证（机动有余力时做）各 0~1，以及 512 柜台 4 人（独立岗）
 * - 周六 / 法定调休上班日：8 个核心位次均摊（复印1 受理2 校对2 扫描1 填表1 拍照1），
 *   无机动、无边境证、无 512
 */
export const SEED_POSTS: Array<{
  id: string
  name: string
  capacity: number
  saturdayCapacity: number
  separate?: boolean
  flexMode?: 'leftover' | 'available'
  ringSlot?: boolean
  optional?: boolean
  hint?: string
  slotHints?: string[]
}> = [
  {
    id: 'post_1',
    name: '一号台',
    capacity: 1,
    saturdayCapacity: 1,
    ringSlot: true,
    hint: '101',
    slotHints: ['101（复印）'],
  },
  {
    id: 'post_2',
    name: '受理',
    capacity: 2,
    saturdayCapacity: 2,
    ringSlot: true,
    hint: '102 / 103',
    slotHints: ['102（受理）', '103（受理）'],
  },
  {
    id: 'post_3',
    name: '校对',
    capacity: 2,
    saturdayCapacity: 2,
    ringSlot: true,
    hint: '104 / 105',
    slotHints: ['104（校对）', '105（副校对）'],
  },
  {
    id: 'post_4',
    name: '扫描',
    capacity: 1,
    saturdayCapacity: 1,
    ringSlot: true,
    hint: '106',
    slotHints: ['106（扫描）'],
  },
  { id: 'post_6', name: '填表', capacity: 1, saturdayCapacity: 1, ringSlot: true, hint: '填表', slotHints: ['填表'] },
  { id: 'post_5', name: '照相', capacity: 1, saturdayCapacity: 1, hint: '拍照', slotHints: ['拍照'] },
  {
    id: 'post_7',
    name: '机动',
    capacity: 3,
    saturdayCapacity: 0,
    flexMode: 'leftover',
    hint: '816',
  },
  {
    id: 'post_9',
    name: '边境证',
    capacity: 1,
    saturdayCapacity: 0,
    optional: true,
    flexMode: 'available',
    hint: '107',
  },
  {
    id: 'post_8',
    name: '512',
    capacity: 4,
    saturdayCapacity: 0,
    separate: true,
    flexMode: 'available',
    hint: '512 柜台',
  },
]

/**
 * 值班班组：顺序即轮转顺序 / B 组向 A 组借人的顺序。
 *
 * A 组顺序按真实班表 2026-12-05（周六）的位次排定 —— 组内顺序 = 周六位次顺序，
 * 所以这一组排出来的周六班表与真实班表逐格一致：
 * 朱婕(101) 杨娟(102) 耿园园(103) 林丽雯(104) 查云(105) 贺夏炎(106) 艾丽娜(填表) 颜贞贞(拍照)。
 */
export const SEED_TEAM_NAMES: Record<TeamId, string[]> = {
  A: ['朱婕', '杨娟', '耿园园', '林丽雯', '查云', '贺夏炎', '艾丽娜', '颜贞贞'],
  B: ['王玉花', '杨雯', '汪甜', '周娟', '陈静静', '顾彬彬', '唐小雨'],
}

/** 组长池：前三位管除 512 外的岗位，艾丽娜只管 512 */
const HALL_LEADERS = ['王玉花', '杨娟', '汪甜']
const COUNTER_LEADERS = ['艾丽娜']

/** 大厅组长候选顺序：王玉花 → 杨娟 → 汪甜（一周一人轮值，当天不在岗由下一位代班） */
const HALL_LEADER_SEQUENCE = ['王玉花', '杨娟', '汪甜']

/** 某个人的大厅组长轮值序号；不是大厅组长则返回 undefined */
function leaderOrderOf(name: string): number | undefined {
  const index = HALL_LEADER_SEQUENCE.indexOf(name)
  return index >= 0 ? index + 1 : undefined
}

interface SeedPerson {
  name: string
  pool?: 'main' | 'counter'
  canLead?: boolean
  leaderScope?: 'hall' | 'counter'
  fixedPost?: string
  allowedPosts?: string[]
  /** 每周固定轮休日：0 = 周一 … 4 = 周五 */
  restWeekday?: number
  note?: string
}

/**
 * 轮休日按真实班表 2026-11-30 那一周的「调休」行还原：
 * 周一 杨雯、耿园园；周三 颜贞贞、王玉花；周四 杨娟；周五 汪甜、林丽雯。
 *
 * 排班时轮休的人当天不上岗，由机动顶上；与年假、休假叠加时以休假为准。
 */
const SEED_REST_WEEKDAY: Record<string, number> = {
  杨雯: 0,
  耿园园: 0,
  颜贞贞: 2,
  王玉花: 2,
  杨娟: 3,
  汪甜: 4,
  林丽雯: 4,
}

/**
 * v6 里允许保留固定岗的岗位：只有「拍照」是真实固定岗。
 *
 * 其余位次（一号台 / 受理 / 校对 / 扫描 / 填表）由轮转环决定，
 * 指派固定岗会跟环抢人 —— v5 遗留的「受理固定周娟、贺夏炎」就是这么
 * 把受理挤成 4 个人的。迁移时这些指派一律清掉。
 */
const V6_FIXED_POST_IDS = new Set(['post_5'])

/**
 * 真实班表 2026-11-30 那一周登记的年假（台账里的「调休」行）。
 *
 * 名字对得上就补进休假登记，对不上说明是别的班组，不动。
 */
const SEED_LEAVE_PLAN: Array<{
  name: string
  type: LeaveRecord['type']
  start: string
  end: string
}> = [
  { name: '陈静静', type: '年假', start: '2026-11-30', end: '2026-12-04' },
  { name: '唐小雨', type: '年假', start: '2026-11-30', end: '2026-12-01' },
  { name: '查云', type: '年假', start: '2026-12-02', end: '2026-12-02' },
  { name: '艾丽娜', type: '年假', start: '2026-12-03', end: '2026-12-03' },
  { name: '顾彬彬', type: '年假', start: '2026-12-04', end: '2026-12-04' },
]

const SEED_PEOPLE: SeedPerson[] = [
  { name: '周娟' },
  { name: '朱婕' },
  { name: '杨娟', canLead: true, leaderScope: 'hall', restWeekday: SEED_REST_WEEKDAY['杨娟'] },
  { name: '杨雯', restWeekday: SEED_REST_WEEKDAY['杨雯'] },
  { name: '林丽雯', restWeekday: SEED_REST_WEEKDAY['林丽雯'] },
  { name: '汪甜', canLead: true, leaderScope: 'hall', restWeekday: SEED_REST_WEEKDAY['汪甜'] },
  { name: '王玉花', canLead: true, leaderScope: 'hall', restWeekday: SEED_REST_WEEKDAY['王玉花'] },
  { name: '耿园园', restWeekday: SEED_REST_WEEKDAY['耿园园'] },
  { name: '贺夏炎' },
  { name: '陈静静' },
  {
    name: '颜贞贞',
    fixedPost: 'post_5',
    restWeekday: SEED_REST_WEEKDAY['颜贞贞'],
    note: '拍照岗固定岗，缺人时全员可顶',
  },
  { name: '艾丽娜', pool: 'counter', canLead: true, leaderScope: 'counter', note: '512 柜台负责人' },
  { name: '查云', pool: 'counter' },
  { name: '顾彬彬', pool: 'counter' },
  { name: '唐小雨', pool: 'counter' },
]

export function seedData(): AppData {  const posts: Post[] = SEED_POSTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    capacity: p.capacity,
    saturdayCapacity: p.saturdayCapacity,
    color: POST_COLORS[i % POST_COLORS.length],
    separate: p.separate,
    flexMode: p.flexMode,
    ringSlot: p.ringSlot,
    optional: p.optional,
    hint: p.hint,
    slotHints: p.slotHints,
  }))

  const people: Person[] = SEED_PEOPLE.map((seed, i) => {
    const teamId = (Object.keys(SEED_TEAM_NAMES) as TeamId[]).find((id) =>
      SEED_TEAM_NAMES[id].includes(seed.name),
    )
    return {
      id: `person_${i + 1}`,
      name: seed.name,
      order: i + 1,
      pool: seed.pool ?? 'main',
      teamId: teamId ?? null,
      canLead: seed.canLead === true,
      leaderScope: seed.leaderScope,
      leaderOrder: seed.leaderScope === 'counter' ? 1 : leaderOrderOf(seed.name),
      allowedPostIds: seed.allowedPosts ?? null,
      fixedPostId: seed.fixedPost ?? null,
      restWeekday: seed.restWeekday ?? null,
      active: true,
      note: seed.note,
    }
  })

  const teams: Team[] = (['A', 'B'] as TeamId[]).map((id) => ({
    id,
    name: id === 'A' ? 'A组' : 'B组',
    memberIds: SEED_TEAM_NAMES[id]
      .map((name) => people.find((p) => p.name === name)?.id)
      .filter((x): x is string => !!x),
  }))

  // 真实班表 2026-11-30 那一周登记的年假（台账里的「调休」行）
  const idOf = (name: string) => people.find((p) => p.name === name)?.id ?? ''
  const leaves: LeaveRecord[] = SEED_LEAVE_PLAN.map((plan, i) => ({
    id: `seed_lv_${i + 1}`,
    personId: idOf(plan.name),
    type: plan.type,
    start: plan.start,
    end: plan.end,
  })).filter((l) => !!l.personId)

  return {
    version: 6,
    settings: {
      orgName: '综合班组',
      startDate: SEED_START_DATE,
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      firstTeam: 'B',
    },
    people,
    posts,
    teams,
    ring: defaultRing(people),
    days: {},
    dayPlans: {},
    dayLeaders: {},
    leaves,
    ledger: [],
  }
}

/** 空白数据：保留岗位与设置，便于按自己的名单重新录入 */
export function blankData(current: AppData): AppData {
  return {
    ...current,
    people: [],
    teams: current.teams.map((t) => ({ ...t, memberIds: [] })),
    ring: { anchorDate: current.ring?.anchorDate ?? SEED_RING_ANCHOR, members: [], standby: [] },
    days: {},
    dayPlans: {},
    dayLeaders: {},
    leaves: [],
    ledger: [],
  }
}

type Raw = Record<string, any>

function normalizePeople(source: Raw, fallback: Person[]): Person[] {
  if (!Array.isArray(source.people)) return fallback
  return source.people.map((p: Raw, i: number) => ({
    id: String(p.id ?? uid('person')),
    name: String(p.name ?? '未命名'),
    order: Number(p.order ?? i + 1) || i + 1,
    pool: p.pool === 'counter' || p.pool === 'support' ? 'counter' : 'main',
    teamId: p.teamId === 'A' || p.teamId === 'B' ? p.teamId : null,
    canLead: p.canLead === true,
    leaderScope: p.leaderScope === 'counter' ? 'counter' : p.leaderScope === 'hall' ? 'hall' : undefined,
    leaderOrder: Number.isFinite(Number(p.leaderOrder)) ? Number(p.leaderOrder) : undefined,
    allowedPostIds: Array.isArray(p.allowedPostIds) ? p.allowedPostIds.map(String) : null,
    fixedPostId: p.fixedPostId ? String(p.fixedPostId) : null,
    restWeekday:
      p.restWeekday === null || p.restWeekday === undefined
        ? null
        : Math.max(0, Math.min(4, Number(p.restWeekday) || 0)),
    active: p.active !== false,
    note: p.note ? String(p.note) : undefined,
  }))
}

/**
 * 岗位表合并：以种子为准保底，再吃用户改过的名字 / 编制 / 颜色。
 *
 * 周六编制是模型口径（8 个核心位次均摊），不由旧数据带过来；
 * 「是否参与轮转环」「是否核心位次」也是模型口径，只认种子。
 */
function normalizePosts(source: Raw, fallback: Post[]): Post[] {
  const result: Post[] = fallback.map((p) => ({ ...p }))
  const byId = new Map(result.map((p) => [p.id, p]))
  if (Array.isArray(source.posts)) {
    const extras: Post[] = []
    for (const [i, raw] of (source.posts as Raw[]).entries()) {
      const id = String(raw.id ?? '')
      const base = byId.get(id)
      if (!base) {
        extras.push({
          id: id || uid('post'),
          name: String(raw.name ?? '未命名岗位'),
          capacity: Math.max(0, Number(raw.capacity ?? 1) || 0),
          saturdayCapacity: Math.max(0, Number(raw.saturdayCapacity ?? 1) || 0),
          color: String(raw.color ?? POST_COLORS[i % POST_COLORS.length]),
          separate: raw.separate === true,
          flexMode: raw.flexMode === 'leftover' || raw.flexMode === 'available' ? raw.flexMode : undefined,
        })
        continue
      }
      base.name = String(raw.name ?? base.name)
      base.capacity = Math.max(0, Number(raw.capacity ?? base.capacity) || 0)
      base.color = String(raw.color ?? base.color)
      if (typeof raw.separate === 'boolean') base.separate = raw.separate
      if (raw.flexMode === 'leftover' || raw.flexMode === 'available') base.flexMode = raw.flexMode
    }
    result.push(...extras)
  }
  return result
}

function normalizeTeams(source: Raw, fallback: Team[]): Team[] {
  if (!Array.isArray(source.teams) || source.teams.length === 0) return fallback
  return source.teams.map((t: Raw, i: number) => ({
    id: (t.id === 'B' ? 'B' : 'A') as TeamId,
    name: String(t.name ?? (t.id === 'B' ? 'B组' : 'A组')),
    memberIds: Array.isArray(t.memberIds) ? t.memberIds.map(String) : [],
  }))
}

export function normalize(input: Raw): AppData {
  const seed = seedData()
  const source = input && typeof input === 'object' ? input : {}

  const people = normalizePeople(source, seed.people)
  const posts = normalizePosts(source, seed.posts)
  const teams = normalizeTeams(source, seed.teams)

  const days: Record<string, DayState> = {}
  if (source.days && typeof source.days === 'object') {
    for (const [date, state] of Object.entries(source.days as Record<string, unknown>)) {
      if (state === 'work' || state === 'off') days[date] = state
    }
  }

  const dayPlans: Record<string, Record<string, (string | null)[]>> = {}
  if (source.dayPlans && typeof source.dayPlans === 'object') {
    // 手工覆盖的语义是「替换当天全部安排」，所以一份完整的覆盖必然包含全部岗位。
    // v5 的岗位表里没有「边境证」，这类旧覆盖补一个空位即可继续用；
    // 缺了核心岗位的残缺覆盖会让整天有岗位空着，直接丢弃、让当天回到自动排班。
    const requiredPostIds = posts.map((p) => p.id)
    for (const [date, plan] of Object.entries(source.dayPlans as Record<string, unknown>)) {
      if (!plan || typeof plan !== 'object') continue
      const entry: Record<string, (string | null)[]> = {}
      for (const [postId, slots] of Object.entries(plan as Record<string, unknown>)) {
        if (Array.isArray(slots)) {
          entry[postId] = slots.map((id) => (id === null || id === undefined ? null : String(id)))
        }
      }
      const complete = REQUIRED_POST_IDS.every((id) => id in entry)
      if (!complete) continue
      for (const id of requiredPostIds) if (!(id in entry)) entry[id] = []
      // 旧覆盖的位次数可能超过新编制（周六编制改成了 8 个位次均摊），
      // 截断到该岗允许的上限，剩下的空位由规则校验提示补人。
      for (const post of posts) {
        const limit = Math.max(post.capacity, post.saturdayCapacity)
        if (entry[post.id].length > limit) entry[post.id] = entry[post.id].slice(0, limit)
      }
      dayPlans[date] = entry
    }
  }

  const dayLeaders: Record<string, string> = {}
  if (source.dayLeaders && typeof source.dayLeaders === 'object') {
    for (const [date, personId] of Object.entries(source.dayLeaders as Record<string, unknown>)) {
      if (typeof personId === 'string') dayLeaders[date] = personId
    }
  }

  const leaves: LeaveRecord[] = Array.isArray(source.leaves)
    ? source.leaves
        .filter((l: Raw) => l && l.personId && l.start && l.end)
        .map((l: Raw) => ({
          id: String(l.id ?? uid('leave')),
          personId: String(l.personId),
          type: (l.type ?? '其他') as LeaveRecord['type'],
          start: String(l.start),
          end: String(l.end),
          note: l.note ? String(l.note) : undefined,
          ledgerId: l.ledgerId ? String(l.ledgerId) : undefined,
        }))
    : []

  const ledger: LedgerEntry[] = Array.isArray(source.ledger)
    ? source.ledger
        .filter((e: Raw) => e && e.personId)
        .map((e: Raw) => ({
          id: String(e.id ?? uid('ledger')),
          personId: String(e.personId),
          date: String(e.date ?? toISO(new Date())),
          days: Number(e.days) || 0,
          reason: String(e.reason ?? ''),
          source: (e.source === 'duty' || e.source === 'leave' ? e.source : 'manual') as LedgerEntry['source'],
          auto: e.auto === true,
        }))
    : []

  // 平日轮转环：保留用户手工调整的环成员与机动池顺序，
  // 剔除不存在的人、补齐空着的环位、把没进环的人放进机动池尾部
  const ring = normalizeRing(source.ring, people)

  return {
    version: 6,
    settings: {
      orgName: String(source.settings?.orgName ?? seed.settings.orgName),
      startDate: String(source.settings?.startDate ?? seed.settings.startDate),
      restQuotaDays: Number(source.settings?.restQuotaDays ?? seed.settings.restQuotaDays) || 8,
      minDailyHeadcount:
        Number(source.settings?.minDailyHeadcount ?? seed.settings.minDailyHeadcount) || 8,
      firstTeam: source.settings?.firstTeam === 'B' ? 'B' : 'A',
    },
    people,
    posts,
    teams,
    ring,
    days,
    dayPlans,
    dayLeaders,
    leaves,
    ledger,
  }
}

/* ------------------------------------------------------------------ *
 * 旧版本迁移
 * ------------------------------------------------------------------ */

/** 旧岗位名 -> 新岗位 id */
const LEGACY_POST_MAP: Record<string, string> = {
  一号台: 'post_1',
  受理: 'post_2',
  校对: 'post_3',
  扫描: 'post_3',
  校对扫描: 'post_3',
  拍照: 'post_5',
  照相: 'post_5',
  填表: 'post_6',
  机动: 'post_7',
  '512': 'post_8',
}

/** v1 -> v2：v1 字段更少，补齐默认值即可 */
function migrateV1toV2(input: Raw): Raw {
  const source = input && typeof input === 'object' ? input : {}
  const people = Array.isArray(source.people)
    ? source.people.map((p: Raw, i: number) => ({
        id: String(p.id ?? `person_${i + 1}`),
        name: String(p.name ?? '未命名'),
        order: Number(p.order ?? i + 1) || i + 1,
        allowedPostIds: Array.isArray(p.allowedPostIds) ? p.allowedPostIds.map(String) : null,
        saturdayOnly: p.saturdayOnly === true,
        fixedPostId: p.fixedPostId ? String(p.fixedPostId) : null,
        active: p.active !== false,
        note: p.note ? String(p.note) : undefined,
      }))
    : []
  return {
    ...source,
    version: 2,
    settings: {
      orgName: String(source.settings?.orgName ?? '综合班组'),
      startDate: String(source.settings?.startDate ?? startOfWeek(toISO(new Date()))),
    },
    people,
    posts: Array.isArray(source.posts)
      ? source.posts.map((p: Raw, i: number) => ({
          id: String(p.id ?? `post_${i + 1}`),
          name: String(p.name ?? '未命名岗位'),
          capacity: Math.max(0, Number(p.capacity ?? 1) || 0),
          color: String(p.color ?? POST_COLORS[i % POST_COLORS.length]),
        }))
      : [],
    days: source.days && typeof source.days === 'object' ? source.days : {},
    dayPosts: source.dayPosts && typeof source.dayPosts === 'object' ? source.dayPosts : {},
    leaves: Array.isArray(source.leaves) ? source.leaves : [],
    ledger: Array.isArray(source.ledger) ? source.ledger : [],
  }
}

/** v2 -> v3：岗位重组、支援池拆分、组长池、dayPosts -> dayPlans */
function migrateV2toV3(input: Raw): Raw {
  const source = input && typeof input === 'object' ? input : {}
  const legacyPosts: Raw[] = Array.isArray(source.posts) ? source.posts : []
  const legacyPostById = new Map<string, Raw>()
  const legacyPostByName = new Map<string, Raw>()
  for (const p of legacyPosts) {
    legacyPostById.set(String(p.id), p)
    legacyPostByName.set(String(p.name), p)
  }

  const mapPostId = (rawId: string): string | null => {
    const legacy = legacyPostById.get(rawId)
    const name = String(legacy?.name ?? '')
    if (LEGACY_POST_MAP[name]) return LEGACY_POST_MAP[name]
    const direct = SEED_POSTS.find((p) => p.id === rawId)
    return direct ? direct.id : null
  }

  const rawPeople: Raw[] = Array.isArray(source.people) ? source.people : []
  const supportNames = rawPeople
    .filter((p) => p.saturdayOnly === true)
    .map((p) => String(p.name ?? ''))
  const people = rawPeople.map((p: Raw, i: number) => {
    const name = String(p.name ?? '未命名')
    const supportIndex = supportNames.indexOf(name)
    return {
      id: String(p.id ?? `person_${i + 1}`),
      name,
      order: Number(p.order ?? i + 1) || i + 1,
      pool: p.saturdayOnly === true ? 'counter' : 'main',
      crew: p.saturdayOnly === true ? (supportIndex % 2 === 0 ? 'A' : 'B') : null,
      canLead: HALL_LEADERS.includes(name),
      allowedPostIds: Array.isArray(p.allowedPostIds)
        ? p.allowedPostIds.map((id) => mapPostId(String(id))).filter((x): x is string => !!x)
        : null,
      fixedPostId: p.fixedPostId ? mapPostId(p.fixedPostId) : null,
      active: p.active !== false,
      note: p.note ? String(p.note) : undefined,
    }
  })

  const posts = SEED_POSTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    capacity: p.capacity,
    saturdayCapacity: p.saturdayCapacity,
    color: POST_COLORS[i % POST_COLORS.length],
  }))

  return {
    ...source,
    version: 3,
    settings: {
      orgName: String(source.settings?.orgName ?? '综合班组'),
      startDate: String(source.settings?.startDate ?? startOfWeek(toISO(new Date()))),
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      supportSlots: 2,
      crewAlternate: true,
    },
    people,
    posts,
    crews: [
      { id: 'A', name: '甲组' },
      { id: 'B', name: '乙组' },
    ],
    days:
      source.days && typeof source.days === 'object'
        ? (Object.fromEntries(
            Object.entries(source.days as Record<string, unknown>).filter(([, v]) => v === 'work' || v === 'off'),
          ) as Record<string, DayState>)
        : {},
    dayPlans: {},
    dayLeaders: {},
    leaves: Array.isArray(source.leaves) ? source.leaves : [],
    ledger: Array.isArray(source.ledger)
      ? source.ledger.map((e: Raw) => ({
          id: String(e.id ?? uid('ledger')),
          personId: String(e.personId),
          date: String(e.date ?? toISO(new Date())),
          days: Number(e.days) || 0,
          reason: String(e.reason ?? ''),
          source: e.auto === true ? ('leave' as const) : ('manual' as const),
          auto: e.auto === true,
        }))
      : [],
  }
}

/**
 * v3 -> v4：新增 512 独立岗、校对/扫描拆分、A/B 值班班组、4 个组长。
 *
 * v3 的「校对扫描」位次并入新「校对」岗；新「扫描」岗留空，由轮转补位。
 */
function migrateV3toV4(input: Raw): AppData {
  const source = input && typeof input === 'object' ? input : {}
  const seed = seedData()

  const rawPeople: Raw[] = Array.isArray(source.people) ? source.people : []
  const nameById = new Map<string, string>()
  for (const p of rawPeople) nameById.set(String(p.id), String(p.name ?? ''))

  // v3 岗位 id -> v4 岗位 id
  const POST_ID_MAP: Record<string, string> = {
    post_1: 'post_1',
    post_2: 'post_2',
    post_3: 'post_3', // 校对扫描 -> 校对
    post_4: 'post_5', // 照相
    post_5: 'post_6', // 填表
    post_6: 'post_7', // 机动
  }
  const mapPostId = (rawId: string): string => {
    if (POST_ID_MAP[rawId]) return POST_ID_MAP[rawId]
    const byName = Object.entries(LEGACY_POST_MAP).find(([name]) => name === rawId)
    return byName ? byName[1] : rawId
  }

  const teamOf = (name: string): TeamId | null => {
    if (SEED_TEAM_NAMES.A.includes(name)) return 'A'
    if (SEED_TEAM_NAMES.B.includes(name)) return 'B'
    return null
  }

  const people: Person[] = rawPeople.map((p: Raw, i: number) => {
    const name = String(p.name ?? '未命名')
    const isCounter = p.pool === 'support' || p.pool === 'counter'
    const canLead = HALL_LEADERS.includes(name) || COUNTER_LEADERS.includes(name)
    return {
      id: String(p.id ?? `person_${i + 1}`),
      name,
      order: Number(p.order ?? i + 1) || i + 1,
      pool: isCounter ? 'counter' : 'main',
      teamId: teamOf(name),
      canLead,
      leaderScope: COUNTER_LEADERS.includes(name)
        ? 'counter'
        : HALL_LEADERS.includes(name)
          ? 'hall'
          : undefined,
      leaderOrder: COUNTER_LEADERS.includes(name) ? 1 : leaderOrderOf(name),
      allowedPostIds: Array.isArray(p.allowedPostIds)
        ? p.allowedPostIds.map((id) => mapPostId(String(id)))
        : null,
      // v6 的固定岗只有「拍照」一个，其余固定岗都放回轮转环
      fixedPostId: name === '颜贞贞' ? 'post_5' : null,
      active: p.active !== false,
      note: p.note ? String(p.note) : undefined,
    }
  })

  const teams: Team[] = (['A', 'B'] as TeamId[]).map((id) => ({
    id,
    name: id === 'A' ? 'A组' : 'B组',
    memberIds: SEED_TEAM_NAMES[id]
      .map((name) => people.find((p) => p.name === name)?.id)
      .filter((x): x is string => !!x),
  }))

  const base: AppData = {
    version: 6,
    settings: {
      orgName: String(source.settings?.orgName ?? '综合班组'),
      startDate: String(source.settings?.startDate ?? SEED_START_DATE),
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      firstTeam: 'B',
    },
    people,
    posts: seed.posts,
    teams,
    ring: defaultRing(people),
    days:
      source.days && typeof source.days === 'object'
        ? (Object.fromEntries(
            Object.entries(source.days as Record<string, unknown>).filter(
              ([, v]) => v === 'work' || v === 'off',
            ),
          ) as Record<string, DayState>)
        : {},
    dayPlans: {},
    dayLeaders: {},
    leaves: Array.isArray(source.leaves) ? source.leaves : [],
    ledger: Array.isArray(source.ledger) ? source.ledger : [],
  }

  // v3 的手工覆盖一律丢弃。
  //
  // 覆盖的语义是「替换当天全部安排」，而 v3 → v6 换了岗位模型
  // （校对扫描拆成校对 + 扫描、新增 512 独立岗与边境证岗、周六位次由 11 改 8）。
  // 旧覆盖即使改了岗位 id 也必然缺少扫描与 512，迁过来会让整天有岗位空着，
  // 与其留一份坏数据，不如让当天回到自动排班。v4 / v5 的数据不受影响（不经过这里）。
  base.dayPlans = {}

  return base
}

/**
 * v5 → v6：轮转环、边境证岗、周六编制、组长周轮值、值班组起点。
 *
 * 沿用 normalize 补齐新字段，再把周六值班组的起点改成 B ——
 * 真实班表 2026-11-21 / 11-28 / 12-05 / 12-12 的值班组依次是 A / B / A / B，
 * v5 的 A 起点整整差一周。
 */
function migrateV5toV6(input: Raw): AppData {
  const next = normalize(input)
  return {
    ...next,
    version: 6,
    settings: { ...next.settings, firstTeam: 'B' },
    ring: normalizeRing(input.ring, next.people),
  }
}

/**
 * 把 v6 的模型口径字段对齐到真实班表基准。
 *
 * 这些字段在 v6 不是「随手可改」的自由字段，而是模型的一部分：
 * - 固定岗：只有拍照岗是固定的，其余位次由轮转环决定
 * - 轮休日：按真实班表 11-30 那周的「调休」行还原
 * - 组内顺序：= 周六位次顺序（A 组按 12-05 的位次排）
 * - 排班起始日：v6 以 2026-11-23 为相位零点，值班组起点为 B
 *
 * 只在「从旧版本迁移」时调用；v6 自己的数据原样保留，
 * 用户在页面上改过的轮休日、环顺序、备注等都不会被冲掉。
 */
function applyV6ModelDefaults(data: AppData): AppData {
  const people = data.people.map((p) => ({
    ...p,
    fixedPostId: p.fixedPostId && V6_FIXED_POST_IDS.has(p.fixedPostId) ? p.fixedPostId : null,
    restWeekday: SEED_REST_WEEKDAY[p.name] ?? null,
    leaderOrder: p.leaderOrder ?? leaderOrderOf(p.name),
  }))

  // 组内顺序 = 周六位次顺序：基准里的名次在前，名单外的按原顺序接在后面
  const teams = data.teams.map((t) => {
    const order = SEED_TEAM_NAMES[t.id] ?? []
    const rank = (id: string): number => {
      const person = people.find((x) => x.id === id)
      if (!person) return Number.MAX_SAFE_INTEGER
      const i = order.indexOf(person.name)
      return i >= 0 ? i : 1000 + person.order
    }
    return { ...t, memberIds: [...t.memberIds].sort((a, b) => rank(a) - rank(b)) }
  })

  // 真实班表那周的年假登记：名单对得上就补进去，已经登记过的不重复
  const leaves = [...data.leaves]
  SEED_LEAVE_PLAN.forEach((plan, i) => {
    const person = people.find((p) => p.name === plan.name)
    if (!person) return
    const exists = leaves.some(
      (l) => l.personId === person.id && !(l.end < plan.start || l.start > plan.end),
    )
    if (exists) return
    leaves.push({
      id: `seed_lv_${i + 1}`,
      personId: person.id,
      type: plan.type,
      start: plan.start,
      end: plan.end,
    })
  })

  return {
    ...data,
    people,
    teams,
    leaves,
    settings: {
      ...data.settings,
      startDate: SEED_START_DATE,
      firstTeam: 'B',
    },
  }
}

/** 尝试把任意历史版本数据迁移到 v6 */
export function migrate(raw: Raw): AppData {
  const source = raw && typeof raw === 'object' ? raw : {}
  const version = Number(source.version ?? 1)
  if (version >= 6) return normalize(source)
  const migrated =
    version === 5 || version === 4
      ? migrateV5toV6(source)
      : version === 3
        ? migrateV3toV4(source)
        : version === 2
          ? migrateV3toV4(migrateV2toV3(source))
          : migrateV3toV4(migrateV2toV3(migrateV1toV2(source)))
  return applyV6ModelDefaults(migrated)
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return normalize(JSON.parse(raw))
    for (const key of LEGACY_KEYS) {
      const legacy = localStorage.getItem(key)
      if (!legacy) continue
      const migrated = migrate(JSON.parse(legacy))
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      } catch {
        // 存储不可写时仍返回迁移结果，本次会话内可用
      }
      return migrated
    }
    return seedData()
  } catch {
    return seedData()
  }
}

/** 保存失败时抛出，由调用方给出可见提示 */
export function saveData(data: AppData): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

/** 存储是否可用（用于设置页提示） */
export function storageAvailable(): boolean {
  try {
    const probe = '__paiban_probe__'
    localStorage.setItem(probe, '1')
    localStorage.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export { planDay, capacityOf }
