import type { AppData, LeaveRecord, LedgerEntry, Person, Post, WeekPlan } from '../types'
import { startOfWeek, toISO } from './date'

const STORAGE_KEY = 'paiban.data.v1'

export const POST_COLORS = [
  '#0e7c66',
  '#b45309',
  '#2f6f9f',
  '#7c5cbf',
  '#b0446a',
  '#3f7a3f',
  '#8a6a2f',
  '#466a7a',
]

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

const SEED_NAMES = [
  '张伟', '王芳', '李娜', '刘洋', '陈静',
  '杨帆', '赵磊', '黄敏', '周杰', '吴迪',
  '徐强', '孙丽', '马超', '朱琳', '胡军',
  '郭婷', '何平', '高翔', '林雪', '罗鹏',
]

const SEED_POSTS: Array<[string, number]> = [
  ['前台', 3],
  ['咨询', 3],
  ['收费', 2],
  ['药房', 3],
  ['检验', 2],
  ['影像', 2],
  ['治疗', 3],
  ['后勤', 2],
]

export function seedData(): AppData {
  const posts: Post[] = SEED_POSTS.map(([name, capacity], i) => ({
    id: `post_${i + 1}`,
    name,
    capacity,
    color: POST_COLORS[i % POST_COLORS.length],
  }))
  const people: Person[] = SEED_NAMES.map((name, i) => ({
    id: `person_${i + 1}`,
    name,
    order: i + 1,
    allowedPostIds: null,
    active: true,
  }))
  return {
    version: 1,
    settings: { orgName: '综合班组', startDate: startOfWeek(toISO(new Date())) },
    people,
    posts,
    leaves: [],
    ledger: [],
    weeks: {},
  }
}

/** 空白数据：保留岗位与设置，便于按自己的名单重新录入 */
export function blankData(current: AppData): AppData {
  return {
    ...current,
    people: [],
    leaves: [],
    ledger: [],
    weeks: {},
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

  const weeks: Record<string, WeekPlan> = {}
  if (source.weeks && typeof source.weeks === 'object') {
    for (const [key, value] of Object.entries(source.weeks as Record<string, Raw>)) {
      if (!value || typeof value !== 'object') continue
      const manual: Record<string, string> = {}
      if (value.manual && typeof value.manual === 'object') {
        for (const [personId, postId] of Object.entries(value.manual as Record<string, unknown>)) {
          if (typeof postId === 'string') manual[personId] = postId
        }
      }
      if (Object.keys(manual).length > 0) weeks[key] = { weekStart: String(value.weekStart ?? key), manual }
    }
  }

  return {
    version: 1,
    settings: {
      orgName: String(source.settings?.orgName ?? seed.settings.orgName),
      startDate: String(source.settings?.startDate ?? seed.settings.startDate),
    },
    people,
    posts,
    leaves,
    ledger,
    weeks,
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
