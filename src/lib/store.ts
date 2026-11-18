import type { AppData, DayState, LeaveRecord, LedgerEntry, Person, Post } from '../types'
import { startOfWeek, toISO } from './date'

const STORAGE_KEY = 'paiban.data.v2'

export const POST_COLORS = [
  '#0e7c66',
  '#b45309',
  '#2f6f9f',
  '#7c5cbf',
  '#b0446a',
  '#3f7a3f',
  '#8a6a2f',
]

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

const SEED_POSTS: Array<[string, number]> = [
  ['一号台', 1],
  ['受理', 2],
  ['校对', 2],
  ['扫描', 1],
  ['机动', 3],
  ['拍照', 1],
  ['填表', 1],
]

interface SeedPerson {
  name: string
  note?: string
  saturdayOnly?: boolean
  fixedPostIndex?: number
  allowedPostIndexes?: number[]
}

const SEED_PEOPLE: SeedPerson[] = [
  { name: '朱婕' },
  { name: '杨雯' },
  { name: '杨娟' },
  { name: '汪甜' },
  {
    name: '查云',
    saturdayOnly: true,
    allowedPostIndexes: [0, 6],
    note: '周六专属，只排一号台 / 填表',
  },
  {
    name: '颜贞贞',
    fixedPostIndex: 5,
    allowedPostIndexes: [5],
    note: '固定拍照岗，休息时由组内其他人替补',
  },
  { name: '林丽雯' },
  { name: '耿园园' },
  { name: '周娟' },
  { name: '陈静静' },
  {
    name: '艾丽娜',
    saturdayOnly: true,
    allowedPostIndexes: [0, 6],
    note: '周六专属，只排一号台 / 填表',
  },
  { name: '王玉花' },
  {
    name: '唐小雨',
    saturdayOnly: true,
    allowedPostIndexes: [0, 6],
    note: '周六专属，只排一号台 / 填表',
  },
  {
    name: '顾彬彬',
    saturdayOnly: true,
    allowedPostIndexes: [0, 6],
    note: '周六专属，只排一号台 / 填表',
  },
  { name: '贺夏炎' },
]

export function seedData(): AppData {
  const posts: Post[] = SEED_POSTS.map(([name, capacity], i) => ({
    id: `post_${i + 1}`,
    name,
    capacity,
    color: POST_COLORS[i % POST_COLORS.length],
  }))

  const people: Person[] = SEED_PEOPLE.map((seed, i) => ({
    id: `person_${i + 1}`,
    name: seed.name,
    order: i + 1,
    allowedPostIds: seed.allowedPostIndexes
      ? seed.allowedPostIndexes.map((idx) => `post_${idx + 1}`)
      : null,
    saturdayOnly: seed.saturdayOnly === true,
    fixedPostId: seed.fixedPostIndex !== undefined ? `post_${seed.fixedPostIndex + 1}` : null,
    active: true,
    note: seed.note,
  }))

  return {
    version: 2,
    settings: { orgName: '综合班组', startDate: startOfWeek(toISO(new Date())) },
    people,
    posts,
    days: {},
    dayPosts: {},
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
    dayPosts: {},
    leaves: [],
    ledger: [],
  }
}

type Raw = Record<string, any>

export function normalize(input: Raw): AppData {
  const seed = seedData()
  const source = input && typeof input === 'object' ? input : {}

  const people: Person[] = Array.isArray(source.people)
    ? source.people.map((p: Raw, i: number) => ({
        id: String(p.id ?? uid('person')),
        name: String(p.name ?? '未命名'),
        order: Number(p.order ?? i + 1) || i + 1,
        allowedPostIds: Array.isArray(p.allowedPostIds) ? p.allowedPostIds.map(String) : null,
        saturdayOnly: p.saturdayOnly === true,
        fixedPostId: p.fixedPostId ? String(p.fixedPostId) : null,
        active: p.active !== false,
        note: p.note ? String(p.note) : undefined,
      }))
    : seed.people

  const posts: Post[] = Array.isArray(source.posts)
    ? source.posts.map((p: Raw, i: number) => ({
        id: String(p.id ?? uid('post')),
        name: String(p.name ?? '未命名岗位'),
        capacity: Math.max(0, Number(p.capacity ?? 1) || 0),
        color: String(p.color ?? POST_COLORS[i % POST_COLORS.length]),
      }))
    : seed.posts

  const days: Record<string, DayState> = {}
  if (source.days && typeof source.days === 'object') {
    for (const [date, state] of Object.entries(source.days as Record<string, unknown>)) {
      if (state === 'work' || state === 'off') days[date] = state
    }
  }

  const dayPosts: Record<string, string> = {}
  if (source.dayPosts && typeof source.dayPosts === 'object') {
    for (const [key, postId] of Object.entries(source.dayPosts as Record<string, unknown>)) {
      if (typeof postId === 'string') dayPosts[key] = postId
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
          auto: e.auto === true,
        }))
    : []

  return {
    version: 2,
    settings: {
      orgName: String(source.settings?.orgName ?? seed.settings.orgName),
      startDate: String(source.settings?.startDate ?? seed.settings.startDate),
    },
    people,
    posts,
    days,
    dayPosts,
    leaves,
    ledger,
  }
}

export function loadData(): AppData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return seedData()
    return normalize(JSON.parse(raw))
  } catch {
    return seedData()
  }
}

export function saveData(data: AppData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {
    // 浏览器存储不可用时静默失败，数据仍保存在当前页面
  }
}
