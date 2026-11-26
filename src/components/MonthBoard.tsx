import { useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData, Person } from '../types'
import { planRange } from '../lib/scheduler'
import { buildLedger, restBreakdown } from '../lib/leave'
import { currentMonth, monthDates, parseISO, shiftMonth, weekdayLabel } from '../lib/date'

interface Props {
  data: AppData
  month: string
  onMonthChange: (month: string) => void
  setData: Dispatch<SetStateAction<AppData>>
}

interface CellInfo {
  text: string
  cls: string
  title: string
}

function CalendarIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  )
}

export default function MonthBoard({ data, month, onMonthChange }: Props) {
  const dates = useMemo(() => monthDates(month), [month])
  const plans = useMemo(() => planRange(data, dates), [data, dates])
  const ledgerRows = useMemo(() => buildLedger(data, dates), [data, dates])
  const people = useMemo(() => [...data.people].sort((a, b) => a.order - b.order), [data.people])

  const postName = useMemo(() => {
    const map = new Map<string, string>()
    for (const post of data.posts) map.set(post.id, post.name)
    return map
  }, [data.posts])

  /** 本月台账余额（值班 +1 与登记扣减合并） */
  const balanceByPerson = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of ledgerRows) {
      map.set(row.personId, (map.get(row.personId) ?? 0) + row.days)
    }
    return map
  }, [ledgerRows])

  const quota = data.settings.restQuotaDays

  const summaries = useMemo(
    () =>
      people.map((person) => {
        // 月休 = 周日公休 + 表内不在岗登记（含年假）；三项相加即为休息天数
        const breakdown = restBreakdown(data, person.id, dates)
        const rest = breakdown.sunday + breakdown.offDuty + breakdown.leave
        return { person, rest, breakdown }
      }),
    [people, data, dates],
  )

  function cellOf(person: Person, date: string): CellInfo {
    const plan = plans.get(date)!
    if (!person.active) return { text: '—', cls: 'off', title: '已停用，不参与排班' }
    if (!plan.working) return { text: '放假', cls: 'off', title: `${date} 放假` }
    if (plan.onLeavePersonIds.includes(person.id)) {
      const type = plan.leaveTypeByPerson.get(person.id) ?? '休假'
      return { text: '假', cls: 'leave', title: `${date} ${type}` }
    }
    const postId = plan.byPerson.get(person.id)
    if (!postId) return { text: '休', cls: 'off', title: `${date} 轮空` }
    const name = postName.get(postId) ?? '在岗'
    return { text: name, cls: 'work', title: `${date} ${name}` }
  }

  const weekCount = dates.filter((d) => parseISO(d).getDay() === 6).length

  return (
    <div className="panel">
      <h2>
        <CalendarIcon />
        月表
        <span className="rt">
          {month} · {people.length} 人 · 周六 {weekCount} 天
        </span>
      </h2>

      <div className="panel-body">
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className="btn sm"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            title="上一月"
          >
            上一月
          </button>
          <span className="mono" style={{ fontWeight: 600 }}>
            {month}
          </span>
          <button
            className="btn sm"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            title="下一月"
          >
            下一月
          </button>
          <button className="btn sm ghost" onClick={() => onMonthChange(currentMonth())}>
            回到本月
          </button>
          <span className="note" style={{ marginTop: 0 }}>
            月休 = 周日公休 + 表内不在岗登记（含年假），只提示不影响排班
          </span>
        </div>

        {people.length === 0 ? (
          <div className="empty">还没有人员，先到「人员」页录入名单。</div>
        ) : (
          <table className="month">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>姓名</th>
                {dates.map((date) => {
                  const plan = plans.get(date)!
                  const weekday = parseISO(date).getDay()
                  const cls = [weekday === 6 ? 'we' : '', !plan.working ? 'off' : '']
                    .filter(Boolean)
                    .join(' ')
                  return (
                    <th key={date} className={cls}>
                      {Number(date.slice(8))}
                      <span className="d">{weekdayLabel(date)}</span>
                    </th>
                  )
                })}
                <th>休息汇总</th>
              </tr>
            </thead>
            <tbody>
              {summaries.map(({ person, rest, breakdown }) => {
                const isCounter = person.pool === 'counter'
                const diff = rest - quota
                const low = !isCounter && diff < 0
                const balance = balanceByPerson.get(person.id) ?? 0
                return (
                  <tr key={person.id}>
                    <td className="name">
                      {person.name}
                      {person.canLead ? ' ★' : ''}
                      {!person.active ? (
                        <span className="chip" style={{ marginLeft: 5 }}>
                          停用
                        </span>
                      ) : null}
                      {isCounter ? (
                        <span className="chip support" style={{ marginLeft: 5 }}>
                          {person.teamId ? `${person.teamId}组` : '512'}
                        </span>
                      ) : null}
                    </td>
                    {dates.map((date) => {
                      const cell = cellOf(person, date)
                      return (
                        <td key={date} className={`cellm ${cell.cls}`} title={cell.title}>
                          {cell.text}
                        </td>
                      )
                    })}
                    <td
                      className={`sum${low ? ' low' : ''}`}
                      title={`周日公休 ${breakdown.sunday} 天 · 轮空 ${breakdown.offDuty} 天 · 休假 ${breakdown.leave} 天`}
                    >
                      {isCounter ? (
                        <>
                          <div>{rest} 天</div>
                          <div className="note" style={{ marginTop: 0 }}>
                            512 柜台不计目标
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            已休 {rest} / {quota}
                          </div>
                          <div className="note" style={{ marginTop: 0 }}>
                            差额 {diff > 0 ? `+${diff}` : diff}
                          </div>
                        </>
                      )}
                      {balance < 0 ? (
                        <span className="chip err" style={{ marginLeft: 4 }}>
                          欠休 {-balance} 天
                        </span>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        <p className="note">
          在岗显示岗位组名；「假」为登记休假，「休」为轮空，「放假」为公休。带 ★ 的是组长池成员，
          值班组长按天轮值。
        </p>
      </div>
    </div>
  )
}
