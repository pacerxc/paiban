import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData, CrewId, Person, Pool } from '../types'
import { POST_COLORS, uid } from '../lib/store'

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

function toInt(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

export default function PeopleView({ data, setData }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const [newName, setNewName] = useState('')
  const [newPool, setNewPool] = useState<Pool>('main')
  const [newCrew, setNewCrew] = useState<CrewId>('A')
  const [newPostName, setNewPostName] = useState('')
  const [newPostCapacity, setNewPostCapacity] = useState('1')
  const [newPostSaturday, setNewPostSaturday] = useState('1')

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const people = useMemo(() => [...data.people].sort((a, b) => a.order - b.order), [data.people])
  const mainPeople = useMemo(() => people.filter((p) => p.pool === 'main'), [people])
  const supportPeople = useMemo(() => people.filter((p) => p.pool === 'support'), [people])
  const leaderPool = useMemo(() => people.filter((p) => p.canLead && p.active), [people])

  const weekdayCapacity = data.posts.reduce((sum, p) => sum + p.capacity, 0)
  const saturdayCapacity = data.posts.reduce((sum, p) => sum + p.saturdayCapacity, 0)

  function updatePerson(id: string, patch: Partial<Person>) {
    setData((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function addPerson() {
    const trimmed = newName.trim()
    if (!trimmed) {
      setToast({ kind: 'err', title: '请先填写姓名' })
      return
    }
    const maxOrder = people.reduce((max, p) => Math.max(max, p.order), 0)
    const person: Person = {
      id: uid('person'),
      name: trimmed,
      order: maxOrder + 1,
      pool: newPool,
      crew: newPool === 'support' ? newCrew : null,
      canLead: false,
      allowedPostIds: null,
      fixedPostId: null,
      active: true,
    }
    setData((prev) => ({ ...prev, people: [...prev.people, person] }))
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
      body: `确定删除「${person.name}」？该员的休假记录、台账和手工排班会一起删除。`,
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
          {person.pool === 'support' ? (
            <select
              className="input"
              value={person.crew ?? 'A'}
              onChange={(e) => updatePerson(person.id, { crew: e.target.value as CrewId })}
            >
              {data.crews.map((crew) => (
                <option key={crew.id} value={crew.id}>
                  {crew.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="chip">主班</span>
          )}
        </td>
        <td>
          <button
            className={`btn sm${person.canLead ? ' on' : ''}`}
            onClick={() => updatePerson(person.id, { canLead: !person.canLead })}
            title="组长是职务标签，可担任值班组长"
          >
            组长
          </button>
        </td>
        <td>
          <select
            className="input"
            value={person.fixedPostId ?? ''}
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
            主班 {mainPeople.length} · 支援 {supportPeople.length} · 组长 {leaderPool.length}
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
              <option value="support">周末支援组</option>
            </select>
            {newPool === 'support' ? (
              <select
                className="input"
                value={newCrew}
                style={{ width: 110 }}
                onChange={(e) => setNewCrew(e.target.value as CrewId)}
              >
                {data.crews.map((crew) => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name}
                  </option>
                ))}
              </select>
            ) : null}
            <button className="btn acc" onClick={addPerson}>
              <PlusIcon />
              添加人员
            </button>
          </div>

          <div className="grp-hd">
            <i />
            主班池
            <span className="cnt">{mainPeople.length} 人</span>
          </div>
          {mainPeople.length === 0 ? (
            <div className="empty">主班池还没有人。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 116 }}>顺序</th>
                  <th style={{ width: 130 }}>姓名</th>
                  <th style={{ width: 100 }}>分组</th>
                  <th style={{ width: 92 }}>组长</th>
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
            周末支援组
            <span className="cnt">{supportPeople.length} 人 · 只在周六顶岗</span>
          </div>
          {supportPeople.length === 0 ? (
            <div className="empty">还没有支援组成员。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 116 }}>顺序</th>
                  <th style={{ width: 130 }}>姓名</th>
                  <th style={{ width: 100 }}>分组</th>
                  <th style={{ width: 92 }}>组长</th>
                  <th style={{ width: 140 }}>固定岗位</th>
                  <th style={{ width: 92 }}>状态</th>
                  <th style={{ width: 60 }}>操作</th>
                </tr>
              </thead>
              <tbody>{renderPeopleRows(supportPeople, 'support')}</tbody>
            </table>
          )}

          <div className="grp-hd">
            <i />
            组长池
            <span className="cnt">{leaderPool.length} 人 · 按天轮值</span>
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            {leaderPool.length === 0 ? (
              <span className="note" style={{ marginTop: 0 }}>
                还没有组长，值班组长会显示空缺。
              </span>
            ) : (
              leaderPool.map((person) => (
                <span key={person.id} className="chip lead">
                  {person.name}
                </span>
              ))
            )}
          </div>
          <p className="note">
            组长是职务标签，不是独立岗位：组长当天通常兼一个具体位次。固定岗位只排那一个岗，休息时由组内其他人替补。
          </p>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <PostsIcon />
          岗位
          <span className="rt">
            {data.posts.length} 个岗位组 · 工作日 {weekdayCapacity} 位次 · 周六 {saturdayCapacity} 位次
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
                      <button className="btn sm ghost" title="删除" onClick={() => removePost(post.id)}>
                        <TrashIcon />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">工作日编制合计 {weekdayCapacity} 位次，周六编制合计 {saturdayCapacity} 位次。</p>
        </div>
      </div>

      <div className="panel">
        <h2>
          <TeamsIcon />
          小组
          <span className="rt">支援组甲乙 · 隔周轮换</span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
            {data.crews.map((crew) => {
              const members = supportPeople.filter((p) => p.crew === crew.id)
              return (
                <div key={crew.id}>
                  <div className="grp-hd">
                    <i />
                    {crew.name}
                    <span className="cnt">{members.length} 人</span>
                  </div>
                  <div className="row" style={{ marginTop: 4 }}>
                    {members.length === 0 ? (
                      <span className="note" style={{ marginTop: 0 }}>
                        暂无成员。
                      </span>
                    ) : (
                      members.map((person) => (
                        <span key={person.id} className="chip support">
                          {person.name}
                        </span>
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid2" style={{ marginTop: 14 }}>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>甲乙隔周轮换</label>
              <button
                className={`btn sm${data.settings.crewAlternate ? ' on' : ''}`}
                style={{ width: 92 }}
                onClick={() => setSetting('crewAlternate', !data.settings.crewAlternate)}
              >
                {data.settings.crewAlternate ? '开' : '关'}
              </button>
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>周六支援位（人）</label>
              <input
                className="input"
                type="number"
                min={0}
                value={data.settings.supportSlots}
                style={{ width: 92 }}
                onChange={(e) => setSetting('supportSlots', Math.max(0, toInt(e.target.value, data.settings.supportSlots)))}
              />
            </div>
          </div>

          <p className="note">
            开启后支援组按周在甲、乙之间轮换：轮转起始周为 {data.settings.startDate} 起的第一周排甲组，第二周排乙组。
            支援组日常在 512 柜台，不进本班表。
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
