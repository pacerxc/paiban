import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData } from '../types'
import { generateAssignments } from '../lib/scheduler'
import {
  addDays,
  formatDateRange,
  formatMonthDay,
  startOfWeek,
  toISO,
  weekIndexOf,
} from '../lib/date'
import { leaveDaysInRange, overlapDays } from '../lib/leave'
import { copyText, exportWeekCsv, weekText } from '../lib/export'

interface Props {
  data: AppData
  weekStart: string
  onWeekChange: (weekStart: string) => void
  setData: Dispatch<SetStateAction<AppData>>
}

export default function WeekView({ data, weekStart, onWeekChange, setData }: Props) {
  const [copied, setCopied] = useState(false)

  const people = useMemo(
    () => data.people.filter((p) => p.active).sort((a, b) => a.order - b.order),
    [data.people],
  )
  const posts = data.posts
  const result = useMemo(() => generateAssignments(data, weekStart), [data, weekStart])
  const postById = useMemo(() => new Map(posts.map((p) => [p.id, p])), [posts])
  const weekEnd = addDays(weekStart, 6)
  const manual = data.weeks[weekStart]?.manual ?? {}
  const manualCount = Object.keys(manual).length
  const index = weekIndexOf(data.settings.startDate, weekStart)
  const todayWeek = startOfWeek(toISO(new Date()))

  const countOf = (postId: string) => (result.byPost.get(postId) ?? []).length
  const shortages = posts.filter((p) => countOf(p.id) < p.capacity)
  const overflows = posts.filter((p) => countOf(p.id) > p.capacity)
  const unassigned = people.filter((p) => !result.byPerson.get(p.id))
  const fullWeekLeaves = people.filter(
    (p) => leaveDaysInRange(data.leaves, p.id, weekStart, weekEnd) >= 7,
  )

  function setPost(personId: string, postId: string) {
    setData((prev) => {
      const weeks = { ...prev.weeks }
      const manualNext = { ...(weeks[weekStart]?.manual ?? {}) }
      if (postId) manualNext[personId] = postId
      else delete manualNext[personId]
      if (Object.keys(manualNext).length === 0) delete weeks[weekStart]
      else weeks[weekStart] = { weekStart, manual: manualNext }
      return { ...prev, weeks }
    })
  }

  function resetWeek() {
    setData((prev) => {
      const weeks = { ...prev.weeks }
      delete weeks[weekStart]
      return { ...prev, weeks }
    })
  }

  async function handleCopy() {
    const ok = await copyText(weekText(data, weekStart))
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div>
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="btn ghost" onClick={() => onWeekChange(addDays(weekStart, -7))}>
            ‹ 上一周
          </button>
          <div className="week-title">
            <strong>{formatDateRange(weekStart, weekEnd)}</strong>
            <span>
              {index >= 0 ? `第 ${index + 1} 周轮换` : `起始周前 ${-index} 周`}
              {manualCount > 0 ? ` · 已手动调整 ${manualCount} 人` : ' · 自动轮转'}
            </span>
          </div>
          <button className="btn ghost" onClick={() => onWeekChange(addDays(weekStart, 7))}>
            下一周 ›
          </button>
        </div>
        <div className="toolbar-actions">
          <button
            className="btn ghost"
            onClick={() => onWeekChange(todayWeek)}
            disabled={todayWeek === weekStart}
          >
            回到本周
          </button>
          <button className="btn ghost" onClick={handleCopy}>
            {copied ? '已复制' : '复制文本'}
          </button>
          <button className="btn ghost" onClick={() => exportWeekCsv(data, weekStart)}>
            导出 CSV
          </button>
          <button className="btn ghost" onClick={() => window.print()}>
            打印
          </button>
          <button className="btn ghost" onClick={resetWeek} disabled={manualCount === 0}>
            重置调整
          </button>
        </div>
      </div>

      {shortages.length > 0 || overflows.length > 0 || unassigned.length > 0 ? (
        <div className="banner danger">
          <strong>需要关注</strong>
          <span>
            {shortages.map((p) => `${p.name}缺 ${p.capacity - countOf(p.id)} 人`).join('，')}
            {overflows.length > 0 &&
              `${shortages.length ? '；' : ''}${overflows
                .map((p) => `${p.name}超编 ${countOf(p.id) - p.capacity} 人`)
                .join('，')}`}
            {unassigned.length > 0 &&
              `${shortages.length || overflows.length ? '；' : ''}待定：${unassigned
                .map((p) => p.name)
                .join('、')}`}
          </span>
        </div>
      ) : null}

      {fullWeekLeaves.length > 0 ? (
        <div className="banner">
          <strong>整周休假</strong>
          <span>
            {fullWeekLeaves.map((p) => p.name).join('、')} 本周不在岗，请手动调整顶岗人员
          </span>
        </div>
      ) : null}

      <div className="section-title">
        <h2>岗位分布</h2>
        <span className="muted">
          {people.length} 人 / 岗位需求 {posts.reduce((s, p) => s + p.capacity, 0)} 人
        </span>
      </div>

      {posts.length === 0 ? (
        <div className="card empty">还没有岗位，请先到「岗位」页添加。</div>
      ) : (
        <div className="post-grid">
          {posts.map((post) => {
            const personIds = result.byPost.get(post.id) ?? []
            const assigned = personIds.length
            const missing = Math.max(0, post.capacity - assigned)
            return (
              <div
                className="post-card"
                key={post.id}
                style={{ borderLeftColor: post.color }}
              >
                <div className="post-card-head">
                  <span className="dot" style={{ background: post.color }} />
                  <h3>{post.name}</h3>
                  <span
                    className={
                      assigned < post.capacity
                        ? 'count under'
                        : assigned > post.capacity
                          ? 'count over'
                          : 'count'
                    }
                  >
                    {assigned}/{post.capacity}
                  </span>
                </div>
                <ul className="chip-list">
                  {personIds.map((id) => {
                    const person = data.people.find((p) => p.id === id)
                    if (!person) return null
                    const leaveDays = leaveDaysInRange(data.leaves, id, weekStart, weekEnd)
                    return (
                      <li className="person-chip" key={id}>
                        {person.name}
                        {leaveDays > 0 && <em>休{leaveDays}天</em>}
                      </li>
                    )
                  })}
                  {Array.from({ length: missing }).map((_, i) => (
                    <li className="empty-slot" key={`empty-${i}`}>
                      空缺
                    </li>
                  ))}
                  {assigned === 0 && missing === 0 && (
                    <li className="empty-slot">未设置人数</li>
                  )}
                </ul>
              </div>
            )
          })}
        </div>
      )}

      <div className="section-title">
        <h2>人员明细</h2>
        <span className="muted">切换岗位后本周自动记住，下周继续按轮转顺序</span>
      </div>

      {people.length === 0 ? (
        <div className="card empty">还没有在岗人员，请先到「人员」页添加。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 46 }}>序号</th>
                <th>姓名</th>
                <th style={{ minWidth: 170 }}>本周岗位</th>
                <th>本周休假</th>
                <th style={{ width: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person, i) => {
                const assignedPostId = result.byPerson.get(person.id) ?? ''
                const leaves = data.leaves.filter(
                  (l) => l.personId === person.id && overlapDays(l.start, l.end, weekStart, weekEnd) > 0,
                )
                const leaveDays = leaveDaysInRange(data.leaves, person.id, weekStart, weekEnd)
                return (
                  <tr key={person.id}>
                    <td className="muted">{i + 1}</td>
                    <td>
                      <strong>{person.name}</strong>
                      {person.allowedPostIds && (
                        <div className="muted" style={{ fontSize: 11 }}>
                          仅限 {person.allowedPostIds.length} 个岗位
                        </div>
                      )}
                    </td>
                    <td>
                      <select
                        value={manual[person.id] ?? ''}
                        onChange={(e) => setPost(person.id, e.target.value)}
                      >
                        <option value="">
                          自动（{postById.get(assignedPostId)?.name ?? '待定'}）
                        </option>
                        {posts.map((post) => (
                          <option key={post.id} value={post.id}>
                            {post.name}
                          </option>
                        ))}
                      </select>
                      {manual[person.id] && <span className="badge warn">手动</span>}
                    </td>
                    <td>
                      {leaves.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        <span className="badge warn">
                          {leaves.map((l) => l.type).join('、')} {leaveDays}天
                        </span>
                      )}
                    </td>
                    <td>
                      {manual[person.id] ? (
                        <button className="btn ghost sm" onClick={() => setPost(person.id, '')}>
                          恢复自动
                        </button>
                      ) : (
                        <span className="muted" style={{ fontSize: 11 }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        轮转规则：人员按顺序每周整体顺移一个位次。岗位人数不同，因此同一岗位通常会连续 2-3 周，之后自动换到下一个岗位。
        起始周：{formatMonthDay(data.settings.startDate)}，可在「数据」页调整。
      </p>
    </div>
  )
}
