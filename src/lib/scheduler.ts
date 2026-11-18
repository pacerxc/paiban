import type { AppData, Person } from '../types'
import { weekIndexOf } from './date'

export interface WeekAssignments {
  byPerson: Map<string, string | null>
  byPost: Map<string, string[]>
}

function isAllowed(person: Person, postId: string): boolean {
  return person.allowedPostIds === null || person.allowedPostIds.includes(postId)
}

/**
 * 轮转排班：
 * 1. 把每个岗位按需求人数展开成「位次」（如 前台3人 = 3个位次），共 N 个位次；
 * 2. 人员按轮转顺序排列，每周整体顺移 1 个位次；
 * 3. 手动指定的岗位优先占位；
 * 4. 有岗位限制的人通过二分图匹配，在满足人数和限制的前提下尽量贴近轮转位次。
 */
export function generateAssignments(data: AppData, weekStart: string): WeekAssignments {
  const people = data.people.filter((p) => p.active).sort((a, b) => a.order - b.order)
  const posts = data.posts
  const byPerson = new Map<string, string | null>()
  const byPost = new Map<string, string[]>()

  const slots: string[] = []
  for (const post of posts) {
    const cap = Math.max(0, Math.floor(post.capacity))
    for (let i = 0; i < cap; i++) slots.push(post.id)
  }

  for (const post of posts) byPost.set(post.id, [])

  if (people.length === 0 || slots.length === 0) {
    for (const person of people) byPerson.set(person.id, null)
    return { byPerson, byPost }
  }

  const manual = data.weeks[weekStart]?.manual ?? {}
  const slotOwner: Array<number | null> = new Array(slots.length).fill(null)
  const locked = new Set<number>()

  // 手动指定优先占位
  people.forEach((person, pi) => {
    const postId = manual[person.id]
    if (!postId || !posts.some((p) => p.id === postId)) return
    locked.add(pi)
    const free = slots.findIndex((slotPost, si) => slotPost === postId && slotOwner[si] === null)
    if (free >= 0) slotOwner[free] = pi
    else byPerson.set(person.id, postId) // 超出岗位需求也允许，界面会提示超编
  })

  const offset =
    ((weekIndexOf(data.settings.startDate, weekStart) % people.length) + people.length) % people.length

  const candidates: number[][] = people.map((person, pi) => {
    const preferred = (pi + offset) % slots.length
    const list: number[] = []
    for (let d = 0; d < slots.length; d++) {
      const si = (preferred + d) % slots.length
      if (isAllowed(person, slots[si])) list.push(si)
    }
    return list
  })

  const tryAssign = (pi: number, visited: boolean[]): boolean => {
    for (const si of candidates[pi]) {
      if (visited[si]) continue
      visited[si] = true
      const owner = slotOwner[si]
      if (owner === null) {
        slotOwner[si] = pi
        return true
      }
      if (!locked.has(owner) && tryAssign(owner, visited)) {
        slotOwner[si] = pi
        return true
      }
    }
    return false
  }

  people.forEach((_, pi) => {
    if (locked.has(pi)) return
    tryAssign(pi, new Array(slots.length).fill(false))
  })

  slots.forEach((postId, si) => {
    const owner = slotOwner[si]
    if (owner !== null) byPerson.set(people[owner].id, postId)
  })

  for (const person of people) {
    if (!byPerson.has(person.id)) byPerson.set(person.id, null)
  }

  for (const person of people) {
    const postId = byPerson.get(person.id)
    if (postId) byPost.get(postId)?.push(person.id)
  }

  return { byPerson, byPost }
}
