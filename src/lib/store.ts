import type { AppData, Crew, DayState, LeaveRecord, LedgerEntry, Person, Post } from '../types'
import { startOfWeek, toISO } from './date'
import { planDay, capacityOf } from './scheduler'

const STORAGE_KEY = 'paiban.data.v3'
/** 历史版本 key，读取时按顺序尝试迁移 */
const LEGACY_KEYS = ['paiban.data.v2', 'paiban.data.v1']

export const POST_COLORS = [
  '#0e7c66',
  '#b45309',
  '#2f6f9f',
  '#b0446a',
  '#3f7a3f',
  '#8a6a2f',
]

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

/** 6 个岗位组：工作日 8 位次，周六 11 位次 */
export const SEED_POSTS: Array<{ id: string; name: string; capacity: number; saturdayCapacity: number }> = [
  { id: 'post_1', name: '一号台', capacity: 1, saturdayCapacity: 2 },
  { id: 'post_2', name: '受理', capacity: 2, saturdayCapacity: 3 },
  { id: 'post_3', name: '校对扫描', capacity: 2, saturdayCapacity: 2 },
  { id: 'post_4', name: '照相', capacity: 1, saturdayCapacity: 1 },
  { id: 'post_5', name: '填表', capacity: 1, saturdayCapacity: 2 },
  { id: 'post_6', name: '机动', capacity: 1, saturdayCapacity: 1 },
]

export const SEED_CREWS: Crew[] = [
  { id: 'A', name: '甲组' },
  { id: 'B', name: '乙组' },
]

/** 组长池 */
const LEADER_NAMES = ['王玉花', '杨娟', '汪甜']

interface SeedPerson {
  name: string
  pool?: 'main' | 'support'
  crew?: 'A' | 'B'
  canLead?: boolean
  fixedPost?: string
  allowedPosts?: string[]
  note?: string
}

const SEED_PEOPLE: SeedPerson[] = [
  { name: '周娟', fixedPost: 'post_2' },
  { name: '朱婕' },
  { name: '杨娟', canLead: true },
  { name: '杨雯', fixedPost: 'post_5' },
  { name: '林丽雯' },
  { name: '汪甜', canLead: true },
  { name: '王玉花', canLead: true },
  { name: '耿园园' },
  { name: '贺夏炎', fixedPost: 'post_2' },
  { name: '陈静静' },
  { name: '颜贞贞', fixedPost: 'post_4', note: '照相岗优先岗，缺人时全员可顶' },
  { name: '顾彬彬', pool: 'support', crew: 'A' },
  { name: '唐小雨', pool: 'support', crew: 'A' },
  { name: '查云', pool: 'support', crew: 'B' },
  { name: '艾丽娜', pool: 'support', crew: 'B' },
]

export function seedData(): AppData {
  const posts: Post[] = SEED_POSTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    capacity: p.capacity,
    saturdayCapacity: p.saturdayCapacity,
    color: POST_COLORS[i % POST_COLORS.length],
  }))

  const people: Person[] = SEED_PEOPLE.map((seed, i) => ({
    id: `person_${i + 1}`,
    name: seed.name,
    order: i + 1,
    pool: seed.pool ?? 'main',
    crew: seed.crew ?? null,
    canLead: seed.canLead === true,
    allowedPostIds: seed.allowedPosts ?? null,
    fixedPostId: seed.fixedPost ?? null,
    active: true,
    note: seed.note,
  }))

  return {
    version: 3,
    settings: {
      orgName: '综合班组',
      startDate: startOfWeek(toISO(new Date())),
      restQuotaDays: 8,
      minDailyHeadcount: 8,
      supportSlots: 2,
      crewAlternate: true,
    },
    people,
    posts,
    crews: SEED_CREWS,
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
    pool: p.pool === 'support' ? 'support' : 'main',
    crew: p.crew === 'A' || p.crew === 'B' ? p.crew : null,
    canLead: p.canLead === true,
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
    }
  })
}

export function normalize(input: Raw): AppData {
  const seed = seedData()
  const source = input && typeof input === 'object' ? input : {}

  const people = normalizePeople(source, seed.people)
  const posts = normalizePosts(source, seed.posts)

  const days: Record<string, DayState> = {}
  if (source.days && typeof source.days === 'object') {
    for (const [date, state] of Object.entries(source.days as Record<string, unknown>)) {
      if (state === 'work' || state === 'off') days[date] = state
    }
  }

  const dayPlans: Record<string, Record<string, (string | null)[]>> = {}
  if (source.dayPlans && typeof source.dayPlans === 'object') {
    for (const [date, plan] of Object.entries(source.dayPlans as Record<string, unknown>)) {
      if (!plan || typeof plan !== 'object') continue
      const entry: Record<string, (string | null)[]> = {}
      for (const [postId, slots] of Object.entries(plan as Record<string, unknown>)) {
        if (Array.isArray(slots)) {
          entry[postId] = slots.map((id) => (id === null || id === undefined ? null : String(id)))
        }
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

  return {
    version: 3,
    settings: {
      orgName: String(source.settings?.orgName ?? seed.settings.orgName),
      startDate: String(source.settings?.startDate ?? seed.settings.startDate),
      restQuotaDays: Number(source.settings?.restQuotaDays ?? seed.settings.restQuotaDays) || 8,
      minDailyHeadcount:
        Number(source.settings?.minDailyHeadcount ?? seed.settings.minDailyHeadcount) || 8,
      supportSlots: Number(source.settings?.supportSlots ?? seed.settings.supportSlots) || 2,
      crewAlternate: source.settings?.crewAlternate !== false,
    },
    people,
    posts,
    crews: Array.isArray(source.crews) && source.crews.length ? source.crews : seed.crews,
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

/** 旧岗位名 -> 新岗位组 id */
const LEGACY_POST_MAP: Record<string, string> = {
  一号台: 'post_1',
  受理: 'post_2',
  校对: 'post_3',
  扫描: 'post_3',
  校对扫描: 'post_3',
  拍照: 'post_4',
  照相: 'post_4',
  填表: 'post_5',
  机动: 'post_6',
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
function migrateV2toV3(input: Raw): AppData {
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

  // 人员：saturdayOnly -> pool/crew，组长池 -> canLead
  const rawPeople: Raw[] = Array.isArray(source.people) ? source.people : []
  const supportNames = rawPeople
    .filter((p) => p.saturdayOnly === true)
    .map((p) => String(p.name ?? ''))
  const people: Person[] = rawPeople.map((p: Raw, i: number) => {
    const name = String(p.name ?? '未命名')
    const supportIndex = supportNames.indexOf(name)
    return {
      id: String(p.id ?? `person_${i + 1}`),
      name,
      order: Number(p.order ?? i + 1) || i + 1,
      pool: p.saturdayOnly === true ? 'support' : 'main',
      crew: p.saturdayOnly === true ? (supportIndex % 2 === 0 ? 'A' : 'B') : null,
      canLead: LEADER_NAMES.includes(name),
      allowedPostIds: Array.isArray(p.allowedPostIds)
        ? p.allowedPostIds.map((id) => mapPostId(String(id))).filter((x): x is string => !!x)
        : null,
      fixedPostId: p.fixedPostId ? mapPostId(String(p.fixedPostId)) : null,
      active: p.active !== false,
      note: p.note ? String(p.note) : undefined,
    }
  })

  const posts: Post[] = SEED_POSTS.map((p, i) => ({
    id: p.id,
    name: p.name,
    capacity: p.capacity,
    saturdayCapacity: p.saturdayCapacity,
    color: POST_COLORS[i % POST_COLORS.length],
  }))

  const base: AppData = {
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
    crews: SEED_CREWS,
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

  // dayPosts（日期|人员 -> 岗位id 或 ''）-> dayPlans（日期 -> 岗位 -> 人员数组）
  const legacyDayPosts: Record<string, string> =
    source.dayPosts && typeof source.dayPosts === 'object' ? source.dayPosts : {}
  const dates = new Set<string>()
  const perDate = new Map<string, Array<{ personId: string; postId: string | null }>>()
  for (const [key, postId] of Object.entries(legacyDayPosts)) {
    const sep = key.indexOf('|')
    if (sep < 0) continue
    const date = key.slice(0, sep)
    const personId = key.slice(sep + 1)
    dates.add(date)
    const list = perDate.get(date) ?? []
    list.push({ personId, postId: postId ? mapPostId(postId) : null })
    perDate.set(date, list)
  }

  for (const date of dates) {
    const plan = planDay(base, date)
    const postsOfDay: Record<string, (string | null)[]> = {}
    for (const post of posts) {
      const cap = capacityOf(post, date)
      const ids = plan.byPost.get(post.id) ?? []
      const arr: (string | null)[] = ids.slice(0, cap)
      while (arr.length < cap) arr.push(null)
      postsOfDay[post.id] = arr
    }
    for (const item of perDate.get(date) ?? []) {
      // 先从所有岗位腾出槽位，再落到目标岗位
      for (const post of posts) {
        const arr = postsOfDay[post.id]
        const idx = arr.indexOf(item.personId)
        if (idx >= 0) arr[idx] = null
      }
      if (item.postId && postsOfDay[item.postId]) {
        const arr = postsOfDay[item.postId]
        const empty = arr.indexOf(null)
        if (empty >= 0) arr[empty] = item.personId
        else arr.push(item.personId)
      }
    }
    base.dayPlans[date] = postsOfDay
  }

  return base
}

/** 尝试把任意历史版本数据迁移到 v3 */
export function migrate(raw: Raw): AppData {
  const source = raw && typeof raw === 'object' ? raw : {}
  const version = Number(source.version ?? 1)
  if (version >= 3) return normalize(source)
  if (version === 2) return migrateV2toV3(source)
  return migrateV2toV3(migrateV1toV2(source))
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
