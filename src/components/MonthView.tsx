import { useMemo } from 'react'
import type { AppData } from '../types'
import { addDays, formatDateRange, monthWeeks, shiftMonth, startOfWeek, toISO } from '../lib/date'
import { generateAssignments } from '../lib/scheduler'
import { leaveDaysInRange } from '../lib/leave'

interface Props {
  data: AppData
  month: string
  onMonthChange: (month: string) => void
}

export default function MonthView({ data, month, onMonthChange }: Props) {
  const weeks = useMemo(() => monthWeeks(month), [month])
  const people = useMemo(
    () => data.people.filter((p) => p.active).sort((a, b) => a.order - b.order),
    [data.people],
  )
  const postById = useMemo(() => new Map(data.posts.map((p) => [p.id, p])), [data.posts])
  const plans = useMemo(
    () => weeks.map((week) => generateAssignments(data, week)),
    [data, weeks],
  )
  const thisWeek = startOfWeek(toISO(new Date()))
  const [year, monthNumber] = month.split('-')

  return (
    <div>
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="btn ghost" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            ‹ 上月
          </button>
          <div className="week-title">
            <strong>
              {year} 年 {Number(monthNumber)} 月
            </strong>
            <span>共 {weeks.length} 个排班周</span>
          </div>
          <button className="btn ghost" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            下月 ›
          </button>
        </div>
        <div className="toolbar-actions">
          <input
            type="month"
            value={month}
            onChange={(e) => e.target.value && onMonthChange(e.target.value)}
          />
          <button className="btn ghost" onClick={() => window.print()}>
            打印
          </button>
        </div>
      </div>

      {weeks.length === 0 ? (
        <div className="card empty">本月暂无数据。</div>
      ) : (
        <div className="table-wrap">
          <table className="month-table">
            <thead>
              <tr>
                <th className="sticky-col">姓名</th>
                {weeks.map((week) => (
                  <th key={week} className={week === thisWeek ? 'current-week' : ''}>
                    {formatDateRange(week, addDays(week, 6))}
                  </th>
                ))}
                <th>休假日</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => {
                const monthLeave = weeks.reduce(
                  (sum, week) => sum + leaveDaysInRange(data.leaves, person.id, week, addDays(week, 6)),
                  0,
                )
                return (
                  <tr key={person.id}>
                    <td className="sticky-col">
                      <strong>{person.name}</strong>
                    </td>
                    {weeks.map((week, wi) => {
                      const postId = plans[wi].byPerson.get(person.id) ?? ''
                      const post = postById.get(postId)
                      const days = leaveDaysInRange(data.leaves, person.id, week, addDays(week, 6))
                      return (
                        <td key={week}>
                          <span className="post-cell">
                            {post ? (
                              <>
                                <span className="dot" style={{ background: post.color }} />
                                {post.name}
                              </>
                            ) : (
                              <span className="muted">待定</span>
                            )}
                            {days > 0 && <span className="badge warn">休{days}</span>}
                          </span>
                        </td>
                      )
                    })}
                    <td>
                      {monthLeave > 0 ? <span className="badge warn">{monthLeave} 天</span> : <span className="muted">—</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="legend">
        {data.posts.map((post) => (
          <span key={post.id} className="legend-item">
            <span className="dot" style={{ background: post.color }} />
            {post.name}（{post.capacity}人）
          </span>
        ))}
      </div>
      <p className="muted" style={{ marginTop: 10 }}>
        月度页面展示每月实际覆盖的排班周，跨月的周会同时出现在两个月份里，周排班以周一为起点。
      </p>
    </div>
  )
}
