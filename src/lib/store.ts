import type { AppData, DayState, LeaveRecord, LedgerEntry, Person, Post, Team, TeamId } from '../types'
import { startOfWeek, toISO } from './date'
import { planDay, capacityOf } from './scheduler'

const STORAGE_KEY = 'paiban.data.v5'
/** 历史版本 key，读取时按顺序尝试迁移 */
const LEGACY_KEYS = ['paiban.data.v4', 'paiban.data.v3', 'paiban.data.v2', 'paiban.data.v1']

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
 * 平日轮转顺序的默认值。
 *
 * 按值班班组顺序（A 组在前、B 组在后）取大厅主班池中「没有固定岗」的人，
 * 与 v4 时期由班组名单推导轮转池的行为一致 —— 迁移时用它补齐 weekdayOrder。
 */
export function defaultWeekdayOrder(people: Person[], teams: Team[]): string[] {
  const teamIndex = new Map<string, number>()
  let index = 0
  for (const team of teams) {
    for (const personId of team.memberIds) {
      if (!teamIndex.has(personId)) teamIndex.set(personId, index++)
    }
  }
  return people
    .filter((p) => p.active && p.pool === 'main' && !p.fixedPostId)
    .sort((a, b) => {
      const ta = teamIndex.get(a.id)
      const tb = teamIndex.get(b.id)
      if (ta !== undefined && tb !== undefined) return ta - tb
      if (ta !== undefined) return -1
      if (tb !== undefined) return 1
      return a.order - b.order
    })
    .map((p) => p.id)
}

/**
 * 8 个岗位：
 * - 工作日（周一~周五）：一号台1 受理2 校对2 扫描1 照相1 填表1 机动0~3，另有 512 柜台 4 人（独立岗）
 * - 周六 / 法定调休上班日：一号台2 填表2 受理3 照相1，无校对/扫描/机动，无 512
 */
export const SEED_POSTS: Array<{
  id: string
  name: string
  capacity: number
  saturdayCapacity: number
  separate?: boolean
  flexMode?: 'leftover' | 'available'
}> = [
  { id: 'post_1', name: '一号台', capacity: 1, saturdayCapacity: 2 },
  { id: 'post_2', name: '受理', capacity: 2, saturdayCapacity: 3 },
  { id: 'post_3', name: '校对', capacity: 2, saturdayCapacity: 0 },
  { id: 'post_4', name: '扫描', capacity: 1, saturdayCapacity: 0 },
  { id: 'post_5', name: '照相', capacity: 1, saturdayCapacity: 1 },
  { id: 'post_6', name: '填表', capacity: 1, saturdayCapacity: 2 },
  { id: 'post_7', name: '机动', capacity: 3, saturdayCapacity: 0, flexMode: 'leftover' },
  {
    id: 'post_8',
    name: '512',
    capacity: 4,
    saturdayCapacity: 0,
    separate: true,
    flexMode: 'available',
  },
]

/** 值班班组：顺序即轮转顺序 / B 组向 A 组借人的顺序 */
export const SEED_TEAM_NAMES: Record<TeamId, string[]> = {
  A: ['杨娟', '朱婕', '颜贞贞', '林丽雯', '耿园园', '贺夏炎', '艾丽娜', '查云'],
  B: ['王玉花', '杨雯', '汪甜', '周娟', '陈静静', '顾彬彬', '唐小雨'],
}

/** 组长池：前三位管除 512 外的岗位，艾丽娜只管 512 */
const HALL_LEADERS = ['王玉花', '杨娟', '汪甜']
const COUNTER_LEADERS = ['艾丽娜']

/** 大厅组长轮值顺序：王玉花 → 杨娟 → 汪甜（逐日轮） */
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
  note?: string
}

const SEED_PEOPLE: SeedPerson[] = [
  { name: '周娟', fixedPost: 'post_2' },
  { name: '朱婕' },
  { name: '杨娟', canLead: true, leaderScope: 'hall' },
  { name: '杨雯', fixedPost: 'post_6' },
  { name: '林丽雯' },
  { name: '汪甜', canLead: true, leaderScope: 'hall' },
  { name: '王玉花', canLead: true, leaderScope: 'hall' },
  { name: '耿园园' },
  { name: '贺夏炎', fixedPost: 'post_2' },
  { name: '陈静静' },
  { name: '颜贞贞', fixedPost: 'post_5', note: '照相岗固定岗，缺人时全员可顶' },
  { name: '顾彬彬', pool: 'counter' },
  { name: '唐小雨', pool: 'counter' },
  { name: '查云', pool: 'counter' },
  { name: '艾丽娜', pool: 'counter', canLead: true, leaderScope: 'counter', note: '512 柜台负责人' },
]

export function seedData(): AppData {  const posts: Post[] = SEED_POSTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    capacity: p.capacity,
    saturdayCapacity: p.saturdayCapacity,
    color: POST_COLORS[i % POST_COLORS.length],
    separate: p.separate,
    flexMode: p.flexMode,
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

  return {
    version: 5,
    settings: {
      orgName: '综合班组',
      startDate: startOfWeek(toISO(new Date())),
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      firstTeam: 'A',
    },
    people,
    posts,
    teams,
    weekdayOrder: defaultWeekdayOrder(people, teams),
    days: {},
    dayPlans: {},
    dayLeaders: {},
    leaves: [],
    ledger: [],
  }
}

/** 空白数据：保留岗位与设置，便于按自己的名单重新录入 */
export function blankData(current: AppData): AppData {
  return {
    ...current,
    people: [],
    teams: current.teams.map((t) => ({ ...t, memberIds: [] })),
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
    active: p.active !== false,
    note: p.note ? String(p.note) : undefined,
  }))
}

function normalizePosts(source: Raw, fallback: Post[]): Post[] {
  if (!Array.isArray(source.posts)) return fallback
  return source.posts.map((p: Raw, i: number) => {
    const capacity = Math.max(0, Number(p.capacity ?? 1) || 0)
    const saturdayCapacity = Math.max(0, Number(p.saturdayCapacity ?? capacity) || 0)
    return {
      id: String(p.id ?? uid('post')),
      name: String(p.name ?? '未命名岗位'),
      capacity,
      saturdayCapacity,
      color: String(p.color ?? POST_COLORS[i % POST_COLORS.length]),
      separate: p.separate === true,
      flexMode: p.flexMode === 'leftover' || p.flexMode === 'available' ? p.flexMode : undefined,
    }
  })
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
    // 旧岗位模型迁过来的残缺覆盖（缺 扫描 / 512）会让整天有岗位空着，
    // 这里直接丢弃这类不完整的覆盖，让当天回到自动排班。
    const requiredPostIds = posts.map((p) => p.id)
    for (const [date, plan] of Object.entries(source.dayPlans as Record<string, unknown>)) {
      if (!plan || typeof plan !== 'object') continue
      const entry: Record<string, (string | null)[]> = {}
      for (const [postId, slots] of Object.entries(plan as Record<string, unknown>)) {
        if (Array.isArray(slots)) {
          entry[postId] = slots.map((id) => (id === null || id === undefined ? null : String(id)))
        }
      }
      const complete = requiredPostIds.every((id) => id in entry)
      if (!complete) continue
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

  // 平日轮转顺序：保留用户手工调整的先后，新进轮转池的人追加到末尾
  const pool = defaultWeekdayOrder(people, teams)
  const kept = Array.isArray(source.weekdayOrder)
    ? source.weekdayOrder.map(String).filter((id) => pool.includes(id))
    : []
  const weekdayOrder = [...kept, ...pool.filter((id) => !kept.includes(id))]

  return {
    version: 5,
    settings: {
      orgName: String(source.settings?.orgName ?? seed.settings.orgName),
      startDate: String(source.settings?.startDate ?? seed.settings.startDate),
      restQuotaDays: Number(source.settings?.restQuotaDays ?? seed.settings.restQuotaDays) || 8,
      minDailyHeadcount:
        Number(source.settings?.minDailyHeadCount ?? seed.settings.minDailyHeadcount) || 8,
      firstTeam: source.settings?.firstTeam === 'B' ? 'B' : 'A',
    },
    people,
    posts,
    teams,
    weekdayOrder,
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
      fixedPostId: p.fixedPostId ? mapPostId(String(p.fixedPostId)) : null,
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
    version: 5,
    settings: {
      orgName: String(source.settings?.orgName ?? '综合班组'),
      startDate: String(source.settings?.startDate ?? startOfWeek(toISO(new Date()))),
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      firstTeam: 'A',
    },
    people,
    posts: seed.posts,
    teams,
    weekdayOrder: defaultWeekdayOrder(people, teams),
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
  // 覆盖的语义是「替换当天全部安排」，而 v3 → v4 换了岗位模型
  // （校对扫描拆成校对 + 扫描、新增 512 独立岗、周六位次由 11 改 8）。
  // 旧覆盖即使改了岗位 id 也必然缺少扫描与 512，迁过来会让整天有岗位空着，
  // 与其留一份坏数据，不如让当天回到自动排班。v4 的数据不受影响（不经过这里）。
  base.dayPlans = {}

  return base
}

/** 尝试把任意历史版本数据迁移到 v5 */
export function migrate(raw: Raw): AppData {
  const source = raw && typeof raw === 'object' ? raw : {}
  const version = Number(source.version ?? 1)
  if (version >= 4) return normalize(source)
  if (version === 3) return migrateV3toV4(source)
  if (version === 2) return migrateV3toV4(migrateV2toV3(source))
  return migrateV3toV4(migrateV2toV3(migrateV1toV2(source)))
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
