import { useMemo, useState } from 'react'
import type { AppData } from '../types'
import { monthDates, parseISO, shiftMonth, weekdayLabel } from '../lib/date'
import { exportMonthCsv } from '../lib/export'
import { isOnLeave, planRange } from '../lib/scheduler'

interface Props {
  data: AppData
  month: string
  onMonthChange: (month: string) => void
}

const WEEK_SHORT = ['日', '一', '二', '三', '四', '五', '六']

export default function PersonMonth({ data, month, onMonthChange }: Props) {
  const dates = useMemo(() => monthDates(month), [month])
  const plans = useMemo(() => planRange(data, dates), [data, dates])
  const people = useMemo(
    () => data.people.filter((p) => p.active).sort((a, b) => a.order - b.order),
    [data.people],
  )
  const postById = useMemo(() => new Map(data.posts.map((p) => [p.id, p])), [data.posts])
  const [year, monthNumber] = month.split('-')
  const today = new Date()
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`

  const dayCount = dates.map((date) => {
    const plan = plans.get(date)!
    if (!plan.working) return 0
    return Math.max(0, plan.byPerson.size - plan.leaveIds.length - plan.resting.length)
  })

  return (
    <div>
      <div className="toolbar no-print">
        <div className="week-nav">
          <button className="btn ghost" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            ‹ 上月
          </button>
          <div className="week-title">
            <strong>
              {year} 年 {Number(monthNumber)} 月 · 人员月历
            </strong>
            <span>每天谁在岗、谁休息一目了然，右侧自动结算上班天数</span>
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
          <button className="btn ghost" onClick={() => exportMonthCsv(data, month)}>
            导出 CSV
          </button>
          <button className="btn ghost" onClick={() => window.print()}>
            打印
          </button>
        </div>
      </div>

      <div className="table-wrap person-month">
        <table className="person-month-table">
          <thead>
            <tr>
              <th className="sticky-col person-col">姓名</th>
              {dates.map((date) => {
                const day = Number(date.slice(8))
                const weekday = weekdayLabel(date)
                return (
                  <th
                    key={date}
                    className={[
                      'day-col',
                      weekday === '周日' || weekday === '周六' ? 'weekend' : '',
                      date === todayISO ? 'is-today' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <span className="day-num">{day}</span>
                    <span className="day-wd">{WEEK_SHORT[parseISO(date).getDay()]}</span>
                  </th>
                )
              })}
              <th className="total-col">上班</th>
              <th className="total-col">休假</th>
              <th className="total-col">休/放</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => {
              let work = 0
              let leave = 0
              let rest = 0
              return (
                <tr key={person.id}>
                  <td className="sticky-col person-col">
                    <strong>{person.name}</strong>
                    {person.fixedPostId && <span className="mini-tag">固</span>}
                    {person.saturdayOnly && <span className="mini-tag">六</span>}
                  </td>
                  {dates.map((date) => {
                    const plan = plans.get(date)!
                    let text = ''
                    let cls = ''
                    let color = ''
                    if (isOnLeave(data, person.id, date)) {
                      text = '假'
                      cls = 'leave'
                      leave++
                    } else if (!plan.working) {
                      text = '放'
                      cls = 'off'
                      rest++
                    } else {
                      const postId = plan.byPerson.get(person.id)
                      if (!postId) {
                        text = '休'
                        cls = 'rest'
                        rest++
                      } else {
                        const post = postById.get(postId)
                        text = post?.name ?? '在岗'
                        cls = 'work'
                        color = post?.color ?? ''
                        work++
                      }
                    }
                    return (
                      <td
                        key={date}
                        className={[`pm-cell`, cls, date === todayISO ? 'is-today' : '']
                          .filter(Boolean)
                          .join(' ')}
                      >
                        {color && <span className="pm-dot" style={{ background: color }} />}
                        <span>{text}</span>
                      </td>
                    )
                  })}
                  <td className="total-col work-total">{work}</td>
                  <td className="total-col">{leave || '—'}</td>
                  <td className="total-col">{rest || '—'}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <th className="sticky-col person-col">当日在岗</th>
              {dates.map((date, i) => (
                <td key={date} className="pm-cell count-cell">
                  {dayCount[i] || '—'}
                </td>
              ))}
              <td className="total-col" colSpan={3}>
                人
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="legend">
        <span className="legend-item">
          <b className="legend-swatch work" /> 在岗（显示岗位）
        </span>
        <span className="legend-item">
          <b className="legend-swatch rest" /> 休（轮空 / 周日）
        </span>
        <span className="legend-item">
          <b className="legend-swatch leave" /> 假（休假登记）
        </span>
        <span className="legend-item">
          <b className="legend-swatch off" /> 放（整日放假）
        </span>
      </div>

      <p className="muted" style={{ marginTop: 10 }}>
        上班天数 = 当月实际排到岗位的天数；休假天数来自「休假与台账」登记；休/放 包含周日、轮空和整日放假。
      </p>
    </div>
  )
}
