import { useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData, DayState } from '../types'
import { parseISO, toISO, weekdayLabel } from '../lib/date'
import { checkMove, checkSwap, dayState, planDay } from '../lib/scheduler'
import type { CheckResult, DayPlan } from '../lib/scheduler'

interface Props {
  data: AppData
  dates: string[]
  setData: Dispatch<SetStateAction<AppData>>
  mode: 'week' | 'month'
}

interface DragInfo {
  date: string
  personId: string
}

interface Feedback {
  kind: 'error' | 'success' | 'hint'
  title: string
  detail?: string
  rule?: string
}

interface HoverInfo {
  key: string
  ok: boolean
}

const HINT: Feedback = {
  kind: 'hint',
  title: '拖动姓名即可调整',
  detail: '拖到另一个姓名上 = 两人当天对调；拖到「空缺」处 = 补位。也可以先点一个姓名，再点另一个。',
}

function shortDate(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}/${d.getDate()}`
}

function removeDateKeys(record: Record<string, string>, date: string): Record<string, string> {
  const prefix = `${date}|`
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(record)) {
    if (!key.startsWith(prefix)) next[key] = value
  }
  return next
}

export function hasDayAdjustment(data: AppData, date: string): boolean {
  const prefix = `${date}|`
  return Object.keys(data.dayPosts).some((key) => key.startsWith(prefix))
}

/** 清除一段日期内的换班与上班/放假设置 */
export function clearAdjustments(data: AppData, dates: string[]): AppData {
  const set = new Set(dates)
  const dayPosts: Record<string, string> = {}
  for (const [key, value] of Object.entries(data.dayPosts)) {
    if (!set.has(key.split('|')[0])) dayPosts[key] = value
  }
  const days = { ...data.days }
  for (const date of dates) delete days[date]
  return { ...data, dayPosts, days }
}

export default function Board({ data, dates, setData, mode }: Props) {
  const today = toISO(new Date())
  const dragRef = useRef<DragInfo | null>(null)
  const flashTimer = useRef<number | null>(null)
  const [dragging, setDragging] = useState<DragInfo | null>(null)
  const [selected, setSelected] = useState<DragInfo | null>(null)
  const [hover, setHover] = useState<HoverInfo | null>(null)
  const [flashKey, setFlashKey] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(HINT)

  const plans = useMemo(() => {
    const map = new Map<string, DayPlan>()
    for (const date of dates) map.set(date, planDay(data, date))
    return map
  }, [data, dates])

  const personById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people])
  const postById = useMemo(() => new Map(data.posts.map((p) => [p.id, p])), [data.posts])

  function showError(date: string, postId: string, check: CheckResult) {
    setFeedback({
      kind: 'error',
      title: '这个调整不成立',
      detail: check.text,
      rule: check.rule,
    })
    setFlashKey(`${date}|${postId}`)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 2200)
  }

  function showSuccess(text: string, date: string, postId: string) {
    setFeedback({ kind: 'success', title: text })
    setFlashKey(`${date}|${postId}`)
    if (flashTimer.current) window.clearTimeout(flashTimer.current)
    flashTimer.current = window.setTimeout(() => setFlashKey(null), 1600)
  }

  function startDrag(date: string, personId: string) {
    dragRef.current = { date, personId }
    setDragging({ date, personId })
    setSelected(null)
  }

  function endDrag() {
    dragRef.current = null
    setDragging(null)
    setHover(null)
  }

  function performSwap(date: string, targetId: string) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.date !== date) {
      setFeedback({
        kind: 'error',
        title: '不能跨天调整',
        detail: '只能在同一天内对调，换到别的日期请分别调整。',
        rule: '规则：换班只影响当天。',
      })
      endDrag()
      return
    }
    if (drag.personId === targetId) {
      endDrag()
      return
    }
    const check = checkSwap(data, date, drag.personId, targetId)
    if (!check.ok) {
      const plan = plans.get(date)
      const postId = plan?.byPerson.get(targetId) ?? data.posts[0]?.id ?? ''
      showError(date, postId, check)
      endDrag()
      return
    }

    const plan = plans.get(date)
    const postA = plan?.byPerson.get(drag.personId)
    const postB = plan?.byPerson.get(targetId)
    if (!postA || !postB) {
      endDrag()
      return
    }
    const nameA = personById.get(drag.personId)?.name ?? ''
    const nameB = personById.get(targetId)?.name ?? ''
    const from = drag.personId
    setData((prev) => {
      const dayPosts = { ...prev.dayPosts }
      dayPosts[`${date}|${from}`] = postB
      dayPosts[`${date}|${targetId}`] = postA
      return { ...prev, dayPosts }
    })
    showSuccess(`已对调：${nameA} ⇄ ${nameB}（${shortDate(date)} ${weekdayLabel(date)}）`, date, postB)
    endDrag()
  }

  function performMove(date: string, postId: string) {
    const drag = dragRef.current
    if (!drag) return
    if (drag.date !== date) {
      setFeedback({
        kind: 'error',
        title: '不能跨天调整',
        detail: '只能在同一天内调整，换到别的日期请分别调整。',
        rule: '规则：换班只影响当天。',
      })
      endDrag()
      return
    }
    const check = checkMove(data, date, drag.personId, postId)
    if (!check.ok) {
      showError(date, postId, check)
      endDrag()
      return
    }
    const plan = plans.get(date)
    if (plan?.byPerson.get(drag.personId) === postId) {
      endDrag()
      return
    }
    const personName = personById.get(drag.personId)?.name ?? ''
    const postName = postById.get(postId)?.name ?? ''
    const personId = drag.personId
    setData((prev) => ({
      ...prev,
      dayPosts: { ...prev.dayPosts, [`${date}|${personId}`]: postId },
    }))
    showSuccess(`${personName} 已调到「${postName}」（${shortDate(date)}）`, date, postId)
    endDrag()
  }

  function handleChipClick(date: string, personId: string) {
    if (!selected) {
      setSelected({ date, personId })
      setFeedback({
        kind: 'hint',
        title: `已选中 ${personById.get(personId)?.name ?? ''}`,
        detail: '再点另一个姓名即可对调，或点同一列的「空缺」补位。',
      })
      return
    }
    if (selected.date !== date) {
      setSelected({ date, personId })
      return
    }
    if (selected.personId === personId) {
      setSelected(null)
      setFeedback(HINT)
      return
    }
    dragRef.current = selected
    performSwap(date, personId)
    setSelected(null)
  }

  function handleSlotClick(date: string, postId: string) {
    if (!selected || selected.date !== date) {
      setFeedback({ kind: 'hint', title: '先点一个姓名，再点空缺处即可补位。' })
      return
    }
    dragRef.current = selected
    performMove(date, postId)
    setSelected(null)
  }

  function toggleDay(date: string) {
    const current = dayState(data, date)
    const next: DayState = current.working ? 'off' : 'work'
    const weekday = parseISO(date).getDay()
    const fallback: DayState = weekday === 0 ? 'off' : 'work'
    setData((prev) => {
      const days = { ...prev.days }
      if (next === fallback) delete days[date]
      else days[date] = next
      const dayPosts = next === 'off' ? removeDateKeys(prev.dayPosts, date) : prev.dayPosts
      return { ...prev, days, dayPosts }
    })
    setFeedback({
      kind: next === 'work' ? 'success' : 'hint',
      title: `${shortDate(date)} 已设为${next === 'work' ? '上班' : '放假'}`,
      detail:
        next === 'off'
          ? '当天所有排班已清空，人员全部休息。'
          : '按轮转规则重新生成了当天岗位。',
    })
  }

  function resetDay(date: string) {
    setData((prev) => clearAdjustments(prev, [date]))
    setFeedback({ kind: 'hint', title: `${shortDate(date)} 已恢复为自动排班` })
  }

  return (
    <div>
      <div className={`feedback ${feedback.kind}`}>
        <span className="feedback-mark">{feedback.kind === 'error' ? '!' : feedback.kind === 'success' ? '✓' : 'i'}</span>
        <div className="feedback-body">
          <strong>{feedback.title}</strong>
          {feedback.detail && <p>{feedback.detail}</p>}
          {feedback.rule && <p className="feedback-rule">{feedback.rule}</p>}
        </div>
      </div>

      <div className="board-legend">
        <span>
          <i className="mini-chip">固</i> 固定岗位，只能上本岗
        </span>
        <span>
          <i className="mini-chip">六</i> 只在周六上班
        </span>
        <span>
          <i className="mini-chip red">红</i> 拖动到的位置不合法时会变红
        </span>
      </div>

      <div className={`board-wrap ${mode}`}>
        <table className="board-table">
          <thead>
            <tr>
              <th className="board-corner">岗位 / 日期</th>
              {dates.map((date) => {
                const plan = plans.get(date)!
                const adjusted = plan.overridden || hasDayAdjustment(data, date)
                const wd = plan.weekday
                return (
                  <th
                    key={date}
                    className={[
                      'board-day',
                      date === today ? 'is-today' : '',
                      wd === 0 ? 'is-sunday' : '',
                      wd === 6 ? 'is-saturday' : '',
                      plan.working ? '' : 'is-off',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <div className="day-top">
                      <span className="day-date">{shortDate(date)}</span>
                      <span className="day-week">{weekdayLabel(date)}</span>
                    </div>
                    <button
                      type="button"
                      className={`day-toggle ${plan.working ? 'work' : 'off'}`}
                      onClick={() => toggleDay(date)}
                      title="点击切换上班 / 放假"
                    >
                      {plan.working ? '上班' : '放假'}
                    </button>
                    {adjusted && (
                      <button
                        type="button"
                        className="day-reset"
                        onClick={() => resetDay(date)}
                        title="撤销当天调整，恢复自动排班"
                      >
                        ↺
                      </button>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {data.posts.map((post) => (
              <tr key={post.id}>
                <th className="board-post" style={{ borderLeftColor: post.color }}>
                  <span className="dot" style={{ background: post.color }} />
                  <span className="post-name">{post.name}</span>
                  <span className="post-cap">{post.capacity}人</span>
                </th>
                {dates.map((date) => {
                  const plan = plans.get(date)!
                  const cellKey = `${date}|${post.id}`
                  const ids = plan.working ? plan.byPost.get(post.id) ?? [] : []
                  const missing = plan.working ? plan.vacant.get(post.id) ?? 0 : 0
                  const bad = (hover?.key === cellKey && !hover.ok) || flashKey === cellKey
                  const good = hover?.key === cellKey && hover.ok
                  return (
                    <td
                      key={date}
                      className={[
                        'board-cell',
                        plan.working ? '' : 'cell-off',
                        date === today ? 'is-today' : '',
                        bad ? 'is-bad' : '',
                        good ? 'is-good' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      onDragOver={(event) => {
                        if (!dragRef.current) return
                        event.preventDefault()
                        const drag = dragRef.current
                        if (drag.date !== date) {
                          setHover({ key: cellKey, ok: false })
                          return
                        }
                        const check = checkMove(data, date, drag.personId, post.id)
                        setHover({ key: cellKey, ok: check.ok })
                      }}
                      onDragLeave={() => {
                        setHover((prev) => (prev?.key === cellKey ? null : prev))
                      }}
                      onDrop={(event) => {
                        event.preventDefault()
                        setHover(null)
                        if (!dragRef.current) return
                        if (plan.working) performMove(date, post.id)
                      }}
                    >
                      {!plan.working ? (
                        <span className="cell-off-label">放假</span>
                      ) : (
                        <div className="cell-chips">
                          {ids.map((personId) => {
                            const person = personById.get(personId)
                            if (!person) return null
                            const chipKey = `${cellKey}|${personId}`
                            const isDragging =
                              dragging?.date === date && dragging.personId === personId
                            const isSelected =
                              selected?.date === date && selected.personId === personId
                            return (
                              <div
                                key={personId}
                                className={[
                                  'board-chip',
                                  isDragging ? 'is-dragging' : '',
                                  isSelected ? 'is-selected' : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                                draggable
                                title={`${person.name}${person.fixedPostId ? '（固定岗位）' : ''}${
                                  person.saturdayOnly ? '（只排周六）' : ''
                                }`}
                                onDragStart={(event) => {
                                  event.dataTransfer.effectAllowed = 'move'
                                  event.dataTransfer.setData('text/plain', personId)
                                  startDrag(date, personId)
                                }}
                                onDragEnd={endDrag}
                                onDragOver={(event) => {
                                  if (!dragRef.current) return
                                  event.preventDefault()
                                  event.stopPropagation()
                                  const drag = dragRef.current
                                  if (drag.date !== date || drag.personId === personId) {
                                    setHover({ key: cellKey, ok: false })
                                    return
                                  }
                                  const check = checkSwap(data, date, drag.personId, personId)
                                  setHover({ key: cellKey, ok: check.ok })
                                }}
                                onDragLeave={() => {
                                  setHover((prev) => (prev?.key === cellKey ? null : prev))
                                }}
                                onDrop={(event) => {
                                  event.preventDefault()
                                  event.stopPropagation()
                                  setHover(null)
                                  performSwap(date, personId)
                                }}
                                onClick={() => handleChipClick(date, personId)}
                              >
                                <span>{person.name}</span>
                                {person.fixedPostId && <em className="flag">固</em>}
                                {person.saturdayOnly && <em className="flag">六</em>}
                              </div>
                            )
                          })}
                          {Array.from({ length: missing }).map((_, index) => (
                            <div
                              key={`empty-${index}`}
                              className="cell-slot"
                              onClick={() => handleSlotClick(date, post.id)}
                            >
                              空缺
                            </div>
                          ))}
                          {ids.length === 0 && missing === 0 && (
                            <span className="cell-muted">未设人数</span>
                          )}
                        </div>
                      )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th className="board-post rest-head">休息 / 休假</th>
              {dates.map((date) => {
                const plan = plans.get(date)!
                const leaveNames = plan.leaveIds
                  .map((id) => personById.get(id)?.name)
                  .filter(Boolean) as string[]
                const restNames = plan.resting
                  .map((id) => personById.get(id)?.name)
                  .filter(Boolean) as string[]
                return (
                  <td key={date} className={`rest-cell ${plan.working ? '' : 'cell-off'}`}>
                    {!plan.working ? (
                      <span className="cell-muted">全员放假</span>
                    ) : (
                      <div className="rest-chips">
                        {leaveNames.map((name) => (
                          <span className="rest-chip leave" key={`l-${name}`}>
                            {name}·假
                          </span>
                        ))}
                        {restNames.map((name) => (
                          <span className="rest-chip" key={`r-${name}`}>
                            {name}
                          </span>
                        ))}
                        {leaveNames.length === 0 && restNames.length === 0 && (
                          <span className="cell-muted">—</span>
                        )}
                      </div>
                    )}
                  </td>
                )
              })}
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
