import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, DragEvent, SetStateAction } from 'react'
import type { AppData, LeaderScope, Person, Pool, Team, TeamId } from '../types'
import { POST_COLORS, defaultWeekdayOrder, uid } from '../lib/store'
import { rotationPool } from '../lib/scheduler'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
}

interface ConfirmState {
  title: string
  body: string
  confirmText?: string
  onConfirm: () => void
}

interface ToastState {
  kind: 'ok' | 'err' | 'info'
  title: string
  text?: string
}

/**
 * 拖拽来源。
 * - weekday：平日轮转顺序里的某个人
 * - team：值班班组组内排序的某个人（只能在同一个组内拖）
 */
type DragSource =
  | { kind: 'weekday'; personId: string }
  | { kind: 'team'; teamId: TeamId; personId: string }

const TEAM_IDS: TeamId[] = ['A', 'B']

function teamName(id: TeamId): string {
  return id === 'A' ? 'A组' : 'B组'
}

/** 保证班组数组里存在该组（数据被外部改动过时不至于报错） */
function upsertTeam(teams: Team[], teamId: TeamId): Team[] {
  if (teams.some((t) => t.id === teamId)) return teams
  return [...teams, { id: teamId, name: teamName(teamId), memberIds: [] }]
}

function PeopleIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  )
}

function PostsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  )
}

function TeamsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="7" r="3" />
      <path d="M6 21v-1a6 6 0 0 1 12 0v1" />
    </svg>
  )
}

function LeadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 3l2.5 6.3H21l-5.2 4 2 6.4L12 16l-5.8 3.7 2-6.4L3 9.3h6.5z" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  )
}

function UpIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

function DownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function AlertIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  )
}

function RotateIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 1l4 4-4 4" />
      <path d="M3 11V9a4 4 0 0 1 4-4h14" />
      <path d="M7 23l-4-4 4-4" />
      <path d="M21 13v2a4 4 0 0 1-4 4H3" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7v6h6" />
      <path d="M3.5 13a9 9 0 1 0 2.1-6.4L3 9" />
    </svg>
  )
}

function toInt(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

export default function PeopleView({ data, setData }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  /** 当前被拖过的行（用于高亮放置位置） */
  const [overKey, setOverKey] = useState<string | null>(null)
  const dragRef = useRef<DragSource | null>(null)

  const [newName, setNewName] = useState('')
  const [newPool, setNewPool] = useState<Pool>('main')
  const [newTeam, setNewTeam] = useState<TeamId | 'none'>('none')
  const [newPostName, setNewPostName] = useState('')
  const [newPostCapacity, setNewPostCapacity] = useState('1')
  const [newPostSaturday, setNewPostSaturday] = useState('1')
  const [teamPick, setTeamPick] = useState<Record<TeamId, string>>({ A: '', B: '' })
  const [hallPick, setHallPick] = useState('')
  const [counterPick, setCounterPick] = useState('')

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const people = useMemo(() => [...data.people].sort((a, b) => a.order - b.order), [data.people])
  const mainPeople = useMemo(() => people.filter((p) => p.pool === 'main'), [people])
  const counterPeople = useMemo(() => people.filter((p) => p.pool === 'counter'), [people])
  const hallLeaders = useMemo(
    () =>
      people
        .filter((p) => p.canLead && p.leaderScope !== 'counter' && p.active)
        .sort((a, b) => (a.leaderOrder ?? a.order) - (b.leaderOrder ?? b.order)),
    [people],
  )
  const counterLeaders = useMemo(
    () =>
      people
        .filter((p) => p.canLead && p.leaderScope === 'counter' && p.active)
        .sort((a, b) => (a.leaderOrder ?? a.order) - (b.leaderOrder ?? b.order)),
    [people],
  )

  /** 工作日轮转池（大厅主班池中无固定岗的人），顺序 = data.weekdayOrder */
  const rotators = useMemo(() => rotationPool(data), [data.people, data.weekdayOrder])

  /** 当前平日顺序是否已经等于默认值（用于禁用「恢复默认」） */
  const weekdayOrderIsDefault = useMemo(() => {
    const current = rotators.map((p) => p.id)
    const fallback = defaultWeekdayOrder(data.people, data.teams)
    return current.length === fallback.length && current.every((id, i) => id === fallback[i])
  }, [rotators, data.people, data.teams])

  const teamOptions = useMemo(
    () =>
      TEAM_IDS.map((id) => ({
        id,
        name: data.teams.find((t) => t.id === id)?.name ?? teamName(id),
      })),
    [data.teams],
  )

  const teamMembersMap = useMemo(() => {
    const map = new Map<TeamId, Person[]>()
    for (const id of TEAM_IDS) {
      const team = data.teams.find((t) => t.id === id)
      const members = (team?.memberIds ?? [])
        .map((pid) => data.people.find((p) => p.id === pid))
        .filter((p): p is Person => !!p)
      map.set(id, members)
    }
    return map
  }, [data.teams, data.people])

  const weekdayCapacity = data.posts.reduce((sum, p) => sum + (p.separate ? 0 : p.capacity), 0)
  const saturdayCapacity = data.posts.reduce((sum, p) => sum + (p.separate ? 0 : p.saturdayCapacity), 0)
  const counterCapacity = data.posts.reduce((sum, p) => sum + (p.separate ? p.capacity : 0), 0)

  const fixedAssignments = data.posts
    .map((post) => ({
      post,
      members: people.filter((p) => p.active && p.fixedPostId === post.id),
    }))
    .filter((row) => row.members.length > 0)

  function updatePerson(id: string, patch: Partial<Person>) {
    setData((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  /** 设置组长职务：null = 不是组长 */
  function setLeaderScope(id: string, scope: LeaderScope | null) {
    setData((prev) => {
      const sameScope = prev.people.filter(
        (p) => p.active && p.canLead && p.leaderScope === scope && p.id !== id,
      )
      const maxOrder = sameScope.reduce((max, p) => Math.max(max, p.leaderOrder ?? p.order), 0)
      return {
        ...prev,
        people: prev.people.map((p) =>
          p.id === id
            ? {
                ...p,
                canLead: scope !== null,
                leaderScope: scope ?? undefined,
                leaderOrder: scope === null ? undefined : maxOrder + 1,
              }
            : p,
        ),
      }
    })
  }

  /** 把某人放进某组：组内顺序 = 追加到末尾；同时清掉别组的记录 */
  function addTeamMember(teamId: TeamId, personId: string) {
    if (!personId) return
    setData((prev) => ({
      ...prev,
      teams: upsertTeam(prev.teams, teamId).map((t) =>
        t.id === teamId
          ? {
              ...t,
              memberIds: t.memberIds.includes(personId) ? t.memberIds : [...t.memberIds, personId],
            }
          : { ...t, memberIds: t.memberIds.filter((mid) => mid !== personId) },
      ),
      people: prev.people.map((p) => (p.id === personId ? { ...p, teamId } : p)),
    }))
    const person = data.people.find((p) => p.id === personId)
    setToast({ kind: 'ok', title: '已加入班组', text: person ? `${person.name} → ${teamName(teamId)}` : undefined })
  }

  function removeTeamMember(teamId: TeamId, personId: string) {
    setData((prev) => ({
      ...prev,
      teams: prev.teams.map((t) =>
        t.id === teamId ? { ...t, memberIds: t.memberIds.filter((mid) => mid !== personId) } : t,
      ),
      people: prev.people.map((p) =>
        p.id === personId ? { ...p, teamId: p.teamId === teamId ? null : p.teamId } : p,
      ),
    }))
  }

  function moveTeamMember(teamId: TeamId, personId: string, delta: number) {
    setData((prev) => ({
      ...prev,
      teams: prev.teams.map((t) => {
        if (t.id !== teamId) return t
        const ids = [...t.memberIds]
        const index = ids.indexOf(personId)
        const target = index + delta
        if (index < 0 || target < 0 || target >= ids.length) return t
        const tmp = ids[index]
        ids[index] = ids[target]
        ids[target] = tmp
        return { ...t, memberIds: ids }
      }),
    }))
  }

  /** 班组组内排序：把某人拖到指定序号（只能在同一个组内） */
  function moveTeamMemberTo(teamId: TeamId, personId: string, targetIndex: number) {
    setData((prev) => ({
      ...prev,
      teams: prev.teams.map((t) => {
        if (t.id !== teamId) return t
        const from = t.memberIds.indexOf(personId)
        if (from < 0) return t
        const rest = t.memberIds.filter((id) => id !== personId)
        const to = Math.max(0, Math.min(targetIndex, rest.length))
        rest.splice(to, 0, personId)
        return { ...t, memberIds: rest }
      }),
    }))
  }

  /** 平日轮转顺序：把某人拖到指定序号 */
  function moveWeekdayMember(personId: string, targetIndex: number) {
    setData((prev) => {
      const ids = rotationPool(prev).map((p) => p.id)
      const from = ids.indexOf(personId)
      if (from < 0) return prev
      const rest = ids.filter((id) => id !== personId)
      const to = Math.max(0, Math.min(targetIndex, rest.length))
      rest.splice(to, 0, personId)
      return { ...prev, weekdayOrder: rest }
    })
  }

  /** 平日轮转顺序：上下移动一位 */
  function moveWeekdayMemberBy(personId: string, delta: number) {
    setData((prev) => {
      const ids = rotationPool(prev).map((p) => p.id)
      const from = ids.indexOf(personId)
      const target = from + delta
      if (from < 0 || target < 0 || target >= ids.length) return prev
      const next = [...ids]
      const [moved] = next.splice(from, 1)
      next.splice(target, 0, moved)
      return { ...prev, weekdayOrder: next }
    })
  }

  /** 恢复默认平日顺序：按 A 组在前、B 组在后的班组顺序还原 */
  function resetWeekdayOrder() {
    setData((prev) => ({ ...prev, weekdayOrder: defaultWeekdayOrder(prev.people, prev.teams) }))
    setToast({ kind: 'ok', title: '已恢复默认', text: '平日轮转顺序按班组顺序还原' })
  }

  /* ------------------------------------------------------------ 拖拽排序 */

  function onDragStart(event: DragEvent, source: DragSource) {
    dragRef.current = source
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', source.personId)
  }

  function onDragEnd() {
    dragRef.current = null
    setOverKey(null)
  }

  function onDragLeave(event: DragEvent) {
    const related = (event.relatedTarget as HTMLElement | null)?.closest?.('[data-drop]')
    const current = (event.currentTarget as HTMLElement).closest('[data-drop]')
    if (related && current && related === current) return
    setOverKey(null)
  }

  /** 落点是否接受当前拖拽：平日只能进平日，班组只能在同一个组内 */
  function canDrop(kind: string, teamId: TeamId | null, drag: DragSource | null): boolean {
    if (!drag) return false
    if (kind === 'weekday') return drag.kind === 'weekday'
    if (kind === 'team') return drag.kind === 'team' && drag.teamId === teamId
    return false
  }

  function onDragOver(event: DragEvent) {
    const target = (event.target as HTMLElement).closest('[data-drop]') as HTMLElement | null
    if (!target) return
    const kind = target.getAttribute('data-drop') ?? ''
    const team = target.getAttribute('data-team')
    const teamId: TeamId | null = team === 'A' || team === 'B' ? team : null
    if (!canDrop(kind, teamId, dragRef.current)) {
      setOverKey(null)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const key = `${kind}:${teamId ?? ''}:${target.getAttribute('data-index') ?? ''}`
    if (key !== overKey) setOverKey(key)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    const drag = dragRef.current
    const target = (event.target as HTMLElement).closest('[data-drop]') as HTMLElement | null
    setOverKey(null)
    if (!drag || !target) return

    const kind = target.getAttribute('data-drop') ?? ''
    const team = target.getAttribute('data-team')
    const teamId: TeamId | null = team === 'A' || team === 'B' ? team : null
    if (!canDrop(kind, teamId, drag)) return

    const rawIndex = target.getAttribute('data-index')
    const index = rawIndex === null ? -1 : Number.parseInt(rawIndex, 10)
    if (!Number.isFinite(index) || index < 0) return

    if (kind === 'weekday' && drag.kind === 'weekday') {
      moveWeekdayMember(drag.personId, index)
      return
    }
    if (kind === 'team' && drag.kind === 'team' && teamId) {
      moveTeamMemberTo(teamId, drag.personId, index)
    }
  }

  /** 人员表里直接改班组 */
  function setPersonTeam(personId: string, teamId: TeamId | null) {
    setData((prev) => ({
      ...prev,
      teams: (teamId ? upsertTeam(prev.teams, teamId) : prev.teams).map((t) =>
        t.id === teamId
          ? {
              ...t,
              memberIds: t.memberIds.includes(personId) ? t.memberIds : [...t.memberIds, personId],
            }
          : { ...t, memberIds: t.memberIds.filter((mid) => mid !== personId) },
      ),
      people: prev.people.map((p) => (p.id === personId ? { ...p, teamId } : p)),
    }))
  }

  /** 大厅组长轮值顺序 = leaderOrder（王玉花 → 杨娟 → 汪甜），与名单 order 无关 */
  function moveHallLeader(personId: string, delta: number) {
    setData((prev) => {
      const leaders = prev.people
        .filter((p) => p.canLead && p.leaderScope !== 'counter' && p.active)
        .sort((a, b) => (a.leaderOrder ?? a.order) - (b.leaderOrder ?? b.order))
      const index = leaders.findIndex((p) => p.id === personId)
      const target = index + delta
      if (index < 0 || target < 0 || target >= leaders.length) return prev
      const next = [...leaders]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved)
      const slots = leaders.map((p) => p.leaderOrder ?? p.order).sort((a, b) => a - b)
      const orderMap = new Map(next.map((p, i) => [p.id, slots[i]]))
      return {
        ...prev,
        people: prev.people.map((p) => {
          const leaderOrder = orderMap.get(p.id)
          return leaderOrder === undefined ? p : { ...p, leaderOrder }
        }),
      }
    })
  }

  function addPerson() {
    const trimmed = newName.trim()
    if (!trimmed) {
      setToast({ kind: 'err', title: '请先填写姓名' })
      return
    }
    const maxOrder = people.reduce((max, p) => Math.max(max, p.order), 0)
    const teamId = newTeam === 'none' ? null : newTeam
    const person: Person = {
      id: uid('person'),
      name: trimmed,
      order: maxOrder + 1,
      pool: newPool,
      teamId,
      canLead: false,
      allowedPostIds: null,
      fixedPostId: null,
      active: true,
    }
    setData((prev) => ({
      ...prev,
      people: [...prev.people, person],
      teams: teamId
        ? upsertTeam(prev.teams, teamId).map((t) =>
            t.id === teamId ? { ...t, memberIds: [...t.memberIds, person.id] } : t,
          )
        : prev.teams,
    }))
    setNewName('')
    setToast({ kind: 'ok', title: '已添加', text: trimmed })
  }

  function moveInPool(id: string, pool: Pool, delta: number) {
    setData((prev) => {
      const list = prev.people.filter((p) => p.pool === pool).sort((a, b) => a.order - b.order)
      const index = list.findIndex((p) => p.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return prev
      const a = list[index]
      const b = list[target]
      const orderA = a.order
      const orderB = b.order
      return {
        ...prev,
        people: prev.people.map((p) =>
          p.id === a.id ? { ...p, order: orderB } : p.id === b.id ? { ...p, order: orderA } : p,
        ),
      }
    })
  }

  function removePerson(id: string) {
    const person = data.people.find((p) => p.id === id)
    if (!person) return
    setConfirm({
      title: '删除人员',
      body: `确定删除「${person.name}」？该员的休假记录、台账和手工排班会一起删除，班组名单也会移除。`,
      confirmText: '删除',
      onConfirm: () => {
        setData((prev) => {
          const dayPlans: Record<string, Record<string, (string | null)[]>> = {}
          for (const date of Object.keys(prev.dayPlans)) {
            const plan = prev.dayPlans[date]
            const entry: Record<string, (string | null)[]> = {}
            for (const postId of Object.keys(plan)) {
              const ids: (string | null)[] = plan[postId]
              // 该员所在的位次留空，保留槽位顺序
              const kept = ids.map((pid) => (pid === id ? null : pid))
              if (kept.length) entry[postId] = kept
            }
            if (Object.keys(entry).length) dayPlans[date] = entry
          }
          const dayLeaders: Record<string, string> = {}
          for (const date of Object.keys(prev.dayLeaders)) {
            const leaderId: string = prev.dayLeaders[date]
            if (leaderId !== id) dayLeaders[date] = leaderId
          }
          return {
            ...prev,
            people: prev.people.filter((p) => p.id !== id),
            teams: prev.teams.map((t) => ({
              ...t,
              memberIds: t.memberIds.filter((mid) => mid !== id),
            })),
            leaves: prev.leaves.filter((l) => l.personId !== id),
            ledger: prev.ledger.filter((e) => e.personId !== id),
            dayPlans,
            dayLeaders,
          }
        })
        setToast({ kind: 'ok', title: '已删除人员', text: person.name })
      },
    })
  }

  function addPost() {
    const trimmed = newPostName.trim()
    if (!trimmed) {
      setToast({ kind: 'err', title: '请填写岗位组名称' })
      return
    }
    const capacity = Math.max(0, toInt(newPostCapacity, 1))
    const saturday = Math.max(0, toInt(newPostSaturday, capacity))
    const post = {
      id: uid('post'),
      name: trimmed,
      capacity,
      saturdayCapacity: saturday,
      color: POST_COLORS[data.posts.length % POST_COLORS.length],
    }
    setData((prev) => ({ ...prev, posts: [...prev.posts, post] }))
    setNewPostName('')
    setNewPostCapacity('1')
    setNewPostSaturday('1')
    setToast({ kind: 'ok', title: '已添加岗位组', text: trimmed })
  }

  function updatePost(id: string, patch: { name?: string; capacity?: number; saturdayCapacity?: number; color?: string }) {
    setData((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function removePost(id: string) {
    const post = data.posts.find((p) => p.id === id)
    if (!post) return
    setConfirm({
      title: '删除岗位组',
      body: `确定删除「${post.name}」？人员的固定岗位会一并清空，手工排班里该岗位也会移除。`,
      confirmText: '删除',
      onConfirm: () => {
        setData((prev) => {
          const dayPlans: Record<string, Record<string, (string | null)[]>> = {}
          for (const date of Object.keys(prev.dayPlans)) {
            const plan = prev.dayPlans[date]
            const entry: Record<string, (string | null)[]> = {}
            for (const postId of Object.keys(plan)) {
              if (postId === id) continue
              const ids: (string | null)[] = plan[postId]
              entry[postId] = ids
            }
            if (Object.keys(entry).length) dayPlans[date] = entry
          }
          return {
            ...prev,
            posts: prev.posts.filter((p) => p.id !== id),
            people: prev.people.map((p) => ({
              ...p,
              fixedPostId: p.fixedPostId === id ? null : p.fixedPostId,
              allowedPostIds: p.allowedPostIds
                ? p.allowedPostIds.filter((pid) => pid !== id)
                : null,
            })),
            dayPlans,
          }
        })
        setToast({ kind: 'ok', title: '已删除岗位组', text: post.name })
      },
    })
  }

  function setSetting<K extends keyof AppData['settings']>(key: K, value: AppData['settings'][K]) {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }))
  }

  function renderPeopleRows(list: Person[], pool: Pool) {
    return list.map((person, index) => (
      <tr key={person.id}>
        <td>
          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
            <input
              className="input"
              type="number"
              min={1}
              value={person.order}
              style={{ width: 54 }}
              onChange={(e) => updatePerson(person.id, { order: Math.max(1, toInt(e.target.value, person.order)) })}
            />
            <button
              className="btn sm ghost"
              title="上移"
              disabled={index === 0}
              onClick={() => moveInPool(person.id, pool, -1)}
            >
              <UpIcon />
            </button>
            <button
              className="btn sm ghost"
              title="下移"
              disabled={index === list.length - 1}
              onClick={() => moveInPool(person.id, pool, 1)}
            >
              <DownIcon />
            </button>
          </div>
        </td>
        <td>
          <input
            className="input"
            type="text"
            value={person.name}
            style={{ width: 110 }}
            onChange={(e) => updatePerson(person.id, { name: e.target.value })}
          />
        </td>
        <td>
          <select
            className="input"
            value={person.teamId ?? ''}
            title="值班班组：决定周六及法定假日值班"
            onChange={(e) => setPersonTeam(person.id, e.target.value === '' ? null : (e.target.value as TeamId))}
          >
            <option value="">不分组</option>
            {teamOptions.map((team) => (
              <option key={team.id} value={team.id}>
                {team.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <select
            className="input"
            value={person.canLead ? (person.leaderScope === 'counter' ? 'counter' : 'hall') : ''}
            title="组长范围：大厅组长管除 512 外所有岗位，512 组长只管柜台"
            onChange={(e) =>
              setLeaderScope(person.id, e.target.value === '' ? null : (e.target.value as LeaderScope))
            }
          >
            <option value="">非组长</option>
            <option value="hall">大厅组长</option>
            <option value="counter">512 组长</option>
          </select>
        </td>
        <td>
          <select
            className="input"
            value={person.fixedPostId ?? ''}
            title="固定岗：除本岗外不可调岗；照相岗缺人时全员可顶"
            onChange={(e) => updatePerson(person.id, { fixedPostId: e.target.value || null })}
          >
            <option value="">不固定</option>
            {data.posts.map((post) => (
              <option key={post.id} value={post.id}>
                {post.name}
              </option>
            ))}
          </select>
        </td>
        <td>
          <button
            className={`btn sm${person.active ? ' on' : ' ghost'}`}
            onClick={() => updatePerson(person.id, { active: !person.active })}
          >
            {person.active ? '在岗' : '停用'}
          </button>
        </td>
        <td>
          <button className="btn sm ghost" title="删除" onClick={() => removePerson(person.id)}>
            <TrashIcon />
          </button>
        </td>
      </tr>
    ))
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <PeopleIcon />
          人员
          <span className="rt">
            主班 {mainPeople.length} · 512 柜台 {counterPeople.length} · 组长 {hallLeaders.length + counterLeaders.length}
          </span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="姓名"
              value={newName}
              style={{ width: 140 }}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPerson()
              }}
            />
            <select
              className="input"
              value={newPool}
              style={{ width: 140 }}
              onChange={(e) => setNewPool(e.target.value as Pool)}
            >
              <option value="main">主班池</option>
              <option value="counter">512 柜台</option>
            </select>
            <select
              className="input"
              value={newTeam}
              style={{ width: 110 }}
              onChange={(e) => setNewTeam(e.target.value as TeamId | 'none')}
            >
              <option value="none">不分组</option>
              {teamOptions.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button className="btn acc" onClick={addPerson}>
              <PlusIcon />
              添加人员
            </button>
          </div>

          <div className="grp-hd">
            <i />
            主班池
            <span className="cnt">{mainPeople.length} 人 · 工作日轮转岗位</span>
          </div>
          {mainPeople.length === 0 ? (
            <div className="empty">主班池还没有人。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 116 }}>顺序</th>
                  <th style={{ width: 130 }}>姓名</th>
                  <th style={{ width: 100 }}>值班班组</th>
                  <th style={{ width: 118 }}>组长范围</th>
                  <th style={{ width: 140 }}>固定岗位</th>
                  <th style={{ width: 92 }}>状态</th>
                  <th style={{ width: 60 }}>操作</th>
                </tr>
              </thead>
              <tbody>{renderPeopleRows(mainPeople, 'main')}</tbody>
            </table>
          )}

          <div className="grp-hd">
            <i />
            512 柜台
            <span className="cnt">{counterPeople.length} 人 · 工作日常驻 512，周六随值班组进大厅</span>
          </div>
          {counterPeople.length === 0 ? (
            <div className="empty">512 柜台还没有人。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 116 }}>顺序</th>
                  <th style={{ width: 130 }}>姓名</th>
                  <th style={{ width: 100 }}>值班班组</th>
                  <th style={{ width: 118 }}>组长范围</th>
                  <th style={{ width: 140 }}>固定岗位</th>
                  <th style={{ width: 92 }}>状态</th>
                  <th style={{ width: 60 }}>操作</th>
                </tr>
              </thead>
              <tbody>{renderPeopleRows(counterPeople, 'counter')}</tbody>
            </table>
          )}

          <p className="note">
            512 柜台是独立岗位：工作日常驻 512，不与大厅岗位混排，也不计入大厅在岗人数；周六及法定调休上班日不设 512 岗，
            柜台人员随值班组进大厅。
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <RotateIcon />
          平日轮转顺序
          <span className="rt">工作日「一号台 → 校对 → 扫描 → 机动」每周整体顺移一位</span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 10 }}>
            <button
              className="btn sm"
              title="按 A 组在前、B 组在后的班组顺序还原"
              disabled={weekdayOrderIsDefault}
              onClick={resetWeekdayOrder}
            >
              <ResetIcon />
              恢复默认
            </button>
            <span className="note" style={{ marginTop: 0 }}>
              拖动姓名前的把手可调整顺序，也可用 ↑ ↓ 按钮微调。
            </span>
          </div>

          <div className="grp-hd">
            <i />
            轮转池
            <span className="cnt">{rotators.length} 人 · 大厅主班池中无固定岗者</span>
          </div>
          {rotators.length === 0 ? (
            <div className="empty">还没有轮转池人员：大厅主班池中「没有固定岗」的人会进入轮转池。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>序</th>
                  <th>姓名</th>
                  <th style={{ width: 120 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {rotators.map((person, index) => (
                  <tr
                    key={person.id}
                    className={`drag-row${overKey === `weekday::${index}` ? ' drag-over' : ''}`}
                    draggable
                    data-drop="weekday"
                    data-index={index}
                    onDragStart={(e) => onDragStart(e, { kind: 'weekday', personId: person.id })}
                    onDragEnd={onDragEnd}
                    onDragOver={onDragOver}
                    onDragLeave={onDragLeave}
                    onDrop={onDrop}
                  >
                    <td className="num">{index + 1}</td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <span className="drag-handle" aria-hidden="true">
                          <GripIcon />
                        </span>
                        <span>{person.name}</span>
                        {person.teamId ? <span className="chip">{person.teamId}组</span> : null}
                        {person.canLead ? <span className="chip lead">组长</span> : null}
                      </div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                        <button
                          className="btn sm ghost"
                          title="上移"
                          draggable={false}
                          disabled={index === 0}
                          onClick={() => moveWeekdayMemberBy(person.id, -1)}
                        >
                          <UpIcon />
                        </button>
                        <button
                          className="btn sm ghost"
                          title="下移"
                          draggable={false}
                          disabled={index === rotators.length - 1}
                          onClick={() => moveWeekdayMemberBy(person.id, 1)}
                        >
                          <DownIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <p className="note">
            这个顺序决定工作日「一号台 → 校对 → 扫描 → 机动」的每周整体顺移：第 1 位先上一号台，其余依次校对、扫描、机动，下周整体顺移一位。
            它与 A/B 值班班组名单相互独立 —— 调整 A/B 组的成员或组内顺序，都不会打乱这里的轮转顺序。
            轮转池 = 大厅主班池中「没有固定岗」的人（有固定岗的人不参与平日轮转）。
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <TeamsIcon />
          值班班组
          <span className="rt">A / B 隔周交替 · 组内顺序 = 周六位次 = 借人顺序</span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
            {teamOptions.map((team) => {
              const members = teamMembersMap.get(team.id) ?? []
              const candidates = people.filter((p) => !members.some((m) => m.id === p.id))
              const picked = teamPick[team.id]
              return (
                <div key={team.id}>
                  <div className="grp-hd">
                    <i />
                    {team.name}
                    <span className="cnt">{members.length} 人</span>
                  </div>
                  {members.length === 0 ? (
                    <div className="empty">暂无成员。</div>
                  ) : (
                    <table className="tbl">
                      <thead>
                        <tr>
                          <th style={{ width: 44 }}>序</th>
                          <th>姓名</th>
                          <th style={{ width: 120 }}>操作</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.map((person, index) => (
                          <tr
                            key={person.id}
                            className={`drag-row${overKey === `team:${team.id}:${index}` ? ' drag-over' : ''}`}
                            draggable
                            data-drop="team"
                            data-team={team.id}
                            data-index={index}
                            onDragStart={(e) =>
                              onDragStart(e, { kind: 'team', teamId: team.id, personId: person.id })
                            }
                            onDragEnd={onDragEnd}
                            onDragOver={onDragOver}
                            onDragLeave={onDragLeave}
                            onDrop={onDrop}
                          >
                            <td className="num">{index + 1}</td>
                            <td>
                              <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                                <span className="drag-handle" aria-hidden="true">
                                  <GripIcon />
                                </span>
                                <span>{person.name}</span>
                                {person.fixedPostId ? (
                                  <span className="chip">
                                    固定{data.posts.find((p) => p.id === person.fixedPostId)?.name ?? ''}
                                  </span>
                                ) : null}
                                {person.canLead ? <span className="chip lead">组长</span> : null}
                              </div>
                            </td>
                            <td>
                              <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                                <button
                                  className="btn sm ghost"
                                  title="上移"
                                  draggable={false}
                                  disabled={index === 0}
                                  onClick={() => moveTeamMember(team.id, person.id, -1)}
                                >
                                  <UpIcon />
                                </button>
                                <button
                                  className="btn sm ghost"
                                  title="下移"
                                  draggable={false}
                                  disabled={index === members.length - 1}
                                  onClick={() => moveTeamMember(team.id, person.id, 1)}
                                >
                                  <DownIcon />
                                </button>
                                <button
                                  className="btn sm ghost"
                                  title="移出该组"
                                  draggable={false}
                                  onClick={() => removeTeamMember(team.id, person.id)}
                                >
                                  <TrashIcon />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  <div className="row" style={{ marginTop: 8 }}>
                    <select
                      className="input"
                      value={picked}
                      style={{ width: 150 }}
                      onChange={(e) => {
                        const value = e.target.value
                        setTeamPick((prev) => (team.id === 'A' ? { ...prev, A: value } : { ...prev, B: value }))
                      }}
                    >
                      <option value="">选择人员…</option>
                      {candidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <button
                      className="btn sm"
                      disabled={!picked}
                      onClick={() => {
                        addTeamMember(team.id, picked)
                        setTeamPick((prev) => (team.id === 'A' ? { ...prev, A: '' } : { ...prev, B: '' }))
                      }}
                    >
                      <PlusIcon />
                      加入
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <p className="note">
            A、B 两组隔周交替承担周六及法定假日值班，值班时整组上岗。组内顺序 = 周六当天按组内顺序填岗位位次 = B 组向 A 组借人的先后顺序：
            B 组比 A 组少 1 人，按 A 组名单顺序一人一次轮借、循环使用。调整顺序可拖拽行首把手，或用上下移动按钮。
            拖拽只在同一个组内有效；跨组请先用「移出该组」再「加入」。
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <LeadIcon />
          组长设置
          <span className="rt">
            大厅组长 {hallLeaders.length} 人 · 512 柜台组长 {counterLeaders.length} 人
          </span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
            <div>
              <div className="grp-hd">
                <i />
                大厅组长
                <span className="cnt">{hallLeaders.length} 人 · 按下列顺序逐日轮值</span>
              </div>
              {hallLeaders.length === 0 ? (
                <div className="empty">还没有大厅组长。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>序</th>
                      <th>姓名</th>
                      <th style={{ width: 120 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hallLeaders.map((person, index) => (
                      <tr key={person.id}>
                        <td className="num">{index + 1}</td>
                        <td>{person.name}</td>
                        <td>
                          <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                            <button
                              className="btn sm ghost"
                              title="上移（轮值提前）"
                              disabled={index === 0}
                              onClick={() => moveHallLeader(person.id, -1)}
                            >
                              <UpIcon />
                            </button>
                            <button
                              className="btn sm ghost"
                              title="下移（轮值推后）"
                              disabled={index === hallLeaders.length - 1}
                              onClick={() => moveHallLeader(person.id, 1)}
                            >
                              <DownIcon />
                            </button>
                            <button
                              className="btn sm ghost"
                              title="取消组长"
                              onClick={() => setLeaderScope(person.id, null)}
                            >
                              <TrashIcon />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <select
                  className="input"
                  value={hallPick}
                  style={{ width: 150 }}
                  onChange={(e) => setHallPick(e.target.value)}
                >
                  <option value="">选择人员…</option>
                  {people
                    .filter((p) => p.active && !(p.canLead && p.leaderScope !== 'counter'))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button
                  className="btn sm"
                  disabled={!hallPick}
                  onClick={() => {
                    setLeaderScope(hallPick, 'hall')
                    setHallPick('')
                  }}
                >
                  <PlusIcon />
                  设为大厅组长
                </button>
              </div>
            </div>

            <div>
              <div className="grp-hd">
                <i />
                512 柜台组长
                <span className="cnt">{counterLeaders.length} 人 · 只负责 512</span>
              </div>
              {counterLeaders.length === 0 ? (
                <div className="empty">还没有 512 柜台组长。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th style={{ width: 44 }}>序</th>
                      <th>姓名</th>
                      <th style={{ width: 120 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {counterLeaders.map((person, index) => (
                      <tr key={person.id}>
                        <td className="num">{index + 1}</td>
                        <td>{person.name}</td>
                        <td>
                          <button
                            className="btn sm ghost"
                            title="取消组长"
                            onClick={() => setLeaderScope(person.id, null)}
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="row" style={{ marginTop: 8 }}>
                <select
                  className="input"
                  value={counterPick}
                  style={{ width: 150 }}
                  onChange={(e) => setCounterPick(e.target.value)}
                >
                  <option value="">选择人员…</option>
                  {people
                    .filter((p) => p.active && !(p.canLead && p.leaderScope === 'counter'))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
                <button
                  className="btn sm"
                  disabled={!counterPick}
                  onClick={() => {
                    setLeaderScope(counterPick, 'counter')
                    setCounterPick('')
                  }}
                >
                  <PlusIcon />
                  设为 512 组长
                </button>
              </div>
            </div>
          </div>

          <p className="note">
            大厅组长管辖除 512 以外的所有岗位，按上表顺序逐日轮值；512 柜台组长只负责 512 柜台。组长是职务标签，不是独立岗位：
            组长当天通常兼一个具体位次。
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <PostsIcon />
          岗位
          <span className="rt">
            {data.posts.length} 个岗位 · 大厅工作日 {weekdayCapacity} 位次 · 周六 {saturdayCapacity} 位次
          </span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 12 }}>
            <input
              className="input"
              type="text"
              placeholder="岗位组名称"
              value={newPostName}
              style={{ width: 150 }}
              onChange={(e) => setNewPostName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addPost()
              }}
            />
            <div className="field" style={{ marginBottom: 0 }}>
              <label>工作日编制</label>
              <input
                className="input"
                type="number"
                min={0}
                value={newPostCapacity}
                style={{ width: 84 }}
                onChange={(e) => setNewPostCapacity(e.target.value)}
              />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>周六编制</label>
              <input
                className="input"
                type="number"
                min={0}
                value={newPostSaturday}
                style={{ width: 84 }}
                onChange={(e) => setNewPostSaturday(e.target.value)}
              />
            </div>
            <button className="btn acc" onClick={addPost}>
              <PlusIcon />
              添加岗位组
            </button>
          </div>

          {data.posts.length === 0 ? (
            <div className="empty">还没有岗位组。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>名称</th>
                  <th style={{ width: 120 }}>工作日编制</th>
                  <th style={{ width: 120 }}>周六编制</th>
                  <th style={{ width: 90 }}>颜色</th>
                  <th style={{ width: 150 }}>类型</th>
                  <th style={{ width: 60 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.posts.map((post) => (
                  <tr key={post.id}>
                    <td>
                      <input
                        className="input"
                        type="text"
                        value={post.name}
                        style={{ width: 140 }}
                        onChange={(e) => updatePost(post.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={post.capacity}
                        style={{ width: 64 }}
                        onChange={(e) => updatePost(post.id, { capacity: Math.max(0, toInt(e.target.value, post.capacity)) })}
                      />
                    </td>
                    <td className="num">
                      <input
                        className="input"
                        type="number"
                        min={0}
                        value={post.saturdayCapacity}
                        style={{ width: 64 }}
                        onChange={(e) =>
                          updatePost(post.id, {
                            saturdayCapacity: Math.max(0, toInt(e.target.value, post.saturdayCapacity)),
                          })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="color"
                        value={post.color}
                        style={{ width: 52, padding: 3 }}
                        onChange={(e) => updatePost(post.id, { color: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {post.separate ? (
                          <span className="chip support">独立岗</span>
                        ) : (
                          <span className="chip">大厅岗</span>
                        )}
                        {post.flexMode ? <span className="chip">浮动岗</span> : null}
                      </div>
                    </td>
                    <td>
                      <button className="btn sm ghost" title="删除" onClick={() => removePost(post.id)}>
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            大厅岗位工作日编制合计 {weekdayCapacity} 位次，周六（含法定调休上班日）编制合计 {saturdayCapacity} 位次；
            512 柜台编制 {counterCapacity} 人。独立岗（512）单独成块，不计入大厅在岗人数，周六与法定调休上班日不设 512 岗。
          </p>

          <div className="grp-hd">
            <i />
            固定岗
            <span className="cnt">{fixedAssignments.reduce((n, row) => n + row.members.length, 0)} 人</span>
          </div>
          {fixedAssignments.length === 0 ? (
            <div className="empty">还没有固定岗人员，可在人员表「固定岗位」列设置。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 160 }}>岗位</th>
                  <th>人员</th>
                </tr>
              </thead>
              <tbody>
                {fixedAssignments.map((row) => (
                  <tr key={row.post.id}>
                    <td>{row.post.name}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {row.members.map((person) => (
                          <span key={person.id} className="chip">
                            {person.name}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            固定岗的人只上本岗，除本岗外不可调岗，休息时由机动岗顶上；照相岗缺人时（固定岗人员不在）全员可顶，任何人都能被拖去顶替照相岗。
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>
          <SettingsIcon />
          小组设置
          <span className="rt">周六值班隔周交替 · 改完立即生效</span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
            <div className="field">
              <label>第一个周六值班组</label>
              <select
                className="input"
                value={data.settings.firstTeam}
                onChange={(e) => setSetting('firstTeam', e.target.value as AppData['settings']['firstTeam'])}
              >
                <option value="A">A 组</option>
                <option value="B">B 组</option>
              </select>
            </div>
            <div className="field">
              <label>班组名称</label>
              <input
                className="input"
                type="text"
                value={data.settings.orgName}
                onChange={(e) => setSetting('orgName', e.target.value)}
              />
            </div>
            <div className="field">
              <label>轮转起始周（周一）</label>
              <input
                className="input"
                type="date"
                value={data.settings.startDate}
                onChange={(e) => setSetting('startDate', e.target.value)}
              />
            </div>
            <div className="field">
              <label>每人每月休息目标（天）</label>
              <input
                className="input"
                type="number"
                min={0}
                value={data.settings.restQuotaDays}
                onChange={(e) =>
                  setSetting('restQuotaDays', Math.max(0, toInt(e.target.value, data.settings.restQuotaDays)))
                }
              />
            </div>
            <div className="field">
              <label>每日最少在岗人数（不含 512）</label>
              <input
                className="input"
                type="number"
                min={0}
                value={data.settings.minDailyHeadcount}
                onChange={(e) =>
                  setSetting('minDailyHeadcount', Math.max(0, toInt(e.target.value, data.settings.minDailyHeadcount)))
                }
              />
            </div>
          </div>

          <p className="note">
            周六及法定假日由 A、B 两组隔周交替整组上岗：从轮转起始周 {data.settings.startDate} 起的第一个周六排第一个值班组，
            此后逐周交替。最少在岗人数不含 512 柜台，休息目标只用于月表提示。
          </p>
          <p className="note">
            轮休额度：周六值班 1 天 +1，法定假日加班 1 天 +1，登记调休或补休 1 天 −1。额度当月用完，月末未使用清零，不结转下月；
            轮休日期在「台账」页手动登记。
          </p>
        </div>
      </div>

      {confirm ? (
        <div className="modal-mask" onClick={() => setConfirm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>
              <AlertIcon />
              {confirm.title}
            </h3>
            <div className="mbody">{confirm.body}</div>
            <div className="mfoot">
              <button className="btn ghost" onClick={() => setConfirm(null)}>
                取消
              </button>
              <button
                className="btn acc"
                onClick={() => {
                  confirm.onConfirm()
                  setConfirm(null)
                }}
              >
                {confirm.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className={`toast ${toast.kind}`}>
          <span className="mark">
            {toast.kind === 'ok' ? <CheckIcon /> : <AlertIcon />}
          </span>
          <div>
            <b>{toast.title}</b>
            {toast.text ? <span>{toast.text}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
