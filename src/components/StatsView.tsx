import { Fragment, useMemo, useState } from 'react'
import type { AppData, TeamId } from '../types'
import { currentMonth, shiftMonth, weekdayLabel } from '../lib/date'
import { personDayDetails, personMonthStats, shiftStats } from '../lib/stats'
import type { DayDetail, PersonMonthStat } from '../lib/stats'

interface Props {
  data: AppData
  month: string
  onMonthChange: (month: string) => void
}

type ViewMode = 'person' | 'shift'
type SortKey = 'name' | 'onDutyDays' | 'dutyDays' | 'quotaBalance'
type SortDir = 'asc' | 'desc'

interface SortState {
  key: SortKey
  dir: SortDir
}

function ChartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 3v18h18" />
      <path d="M18 17V9M13 17V5M8 17v-3" />
    </svg>
  )
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

function SortIcon({ dir }: { dir: SortDir }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={11}
      height={11}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {dir === 'asc' ? <path d="m18 15-6-6-6 6" /> : <path d="m6 9 6 6 6-6" />}
    </svg>
  )
}

/** 可排序的表头 */
function SortHead({
  label,
  sortKey,
  sort,
  onSort,
  num,
}: {
  label: string
  sortKey: SortKey
  sort: SortState
  onSort: (key: SortKey) => void
  num?: boolean
}) {
  const active = sort.key === sortKey
  return (
    <th
      className={num ? 'num' : undefined}
      onClick={() => onSort(sortKey)}
      title={`按${label}排序`}
      style={{ cursor: 'pointer' }}
    >
      {label}
      {active ? <SortIcon dir={sort.dir} /> : null}
    </th>
  )
}

/** 状态标签 */
function StatusChip({ detail }: { detail: DayDetail }) {
  if (detail.status === 'duty') return <span className="chip support">值班</span>
  if (detail.status === 'leave') return <span className="chip err">{detail.leaveType ?? '休假'}</span>
  if (detail.status === 'onduty') return <span className="chip">在岗</span>
  if (detail.status === 'idle') return <span className="chip">轮空</span>
  return <span className="chip">公休</span>
}

export default function StatsView({ data, month, onMonthChange }: Props) {
  const [mode, setMode] = useState<ViewMode>('person')
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' })
  const [expandedPerson, setExpandedPerson] = useState<string | null>(null)
  const [expandedShift, setExpandedShift] = useState<string | null>(null)

  const stats = useMemo(() => personMonthStats(data, month), [data, month])
  const shifts = useMemo(() => shiftStats(data, month), [data, month])
  const details = useMemo(
    () => (expandedPerson ? personDayDetails(data, expandedPerson, month) : []),
    [data, expandedPerson, month],
  )

  const teamName = (teamId: TeamId | null): string => {
    if (!teamId) return '—'
    return data.teams.find((t) => t.id === teamId)?.name ?? `${teamId}组`
  }

  /** 停用人员：仍列出，但当天不参与排班 */
  const inactiveIds = useMemo(
    () => new Set(data.people.filter((p) => !p.active).map((p) => p.id)),
    [data.people],
  )

  function onSort(key: SortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
  }

  const sorted = useMemo(() => {
    const list = [...stats]
    const dir = sort.dir === 'asc' ? 1 : -1
    list.sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return dir * a.name.localeCompare(b.name, 'zh-Hans-CN')
        case 'onDutyDays':
          return dir * (a.onDutyDays - b.onDutyDays)
        case 'dutyDays':
          return dir * (a.dutyDays - b.dutyDays)
        case 'quotaBalance':
          return dir * (a.quotaBalance - b.quotaBalance)
        default:
          return 0
      }
    })
    return list
  }, [stats, sort])

  return (
    <div className="panel">
      <h2>
        <ChartIcon />
        统计
        <span className="rt">
          {month} · {stats.length} 人 · 值班 {shifts.length} 天
        </span>
      </h2>

      <div className="panel-body">
        <div className="row" style={{ marginBottom: 12 }}>
          <button
            className={`btn sm${mode === 'person' ? ' on' : ''}`}
            onClick={() => setMode('person')}
            title="按人统计"
          >
            <PeopleIcon />
            按人
          </button>
          <button
            className={`btn sm${mode === 'shift' ? ' on' : ''}`}
            onClick={() => setMode('shift')}
            title="按班统计"
          >
            <CalendarIcon />
            按班
          </button>
          <button className="btn sm" onClick={() => onMonthChange(shiftMonth(month, -1))}>
            上一月
          </button>
          <span className="mono" style={{ fontWeight: 600 }}>
            {month}
          </span>
          <button className="btn sm" onClick={() => onMonthChange(shiftMonth(month, 1))}>
            下一月
          </button>
          <button className="btn sm ghost" onClick={() => onMonthChange(currentMonth())}>
            回到本月
          </button>
        </div>

        {mode === 'person' ? (
          <PersonTable
            stats={sorted}
            details={details}
            expanded={expandedPerson}
            onExpand={(id) => setExpandedPerson((prev) => (prev === id ? null : id))}
            onSort={onSort}
            sort={sort}
            teamName={teamName}
            inactiveIds={inactiveIds}
          />
        ) : (
          <ShiftTable
            shifts={shifts}
            expanded={expandedShift}
            onExpand={(date) => setExpandedShift((prev) => (prev === date ? null : date))}
            teamName={teamName}
          />
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 按人视图
 * ------------------------------------------------------------------ */

function PersonTable({
  stats,
  details,
  expanded,
  onExpand,
  onSort,
  sort,
  teamName,
  inactiveIds,
}: {
  stats: PersonMonthStat[]
  details: DayDetail[]
  expanded: string | null
  onExpand: (personId: string) => void
  onSort: (key: SortKey) => void
  sort: SortState
  teamName: (teamId: TeamId | null) => string
  inactiveIds: Set<string>
}) {
  return (
    <div>
      {stats.length === 0 ? (
        <div className="empty">还没有人员，先到「人员」页录入名单。</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <SortHead label="姓名" sortKey="name" sort={sort} onSort={onSort} />
              <th style={{ width: 128 }}>岗位组 / 班组</th>
              <SortHead label="在岗" sortKey="onDutyDays" sort={sort} onSort={onSort} num />
              <SortHead label="值班" sortKey="dutyDays" sort={sort} onSort={onSort} num />
              <th className="num" style={{ width: 62 }}>
                补休
              </th>
              <th className="num" style={{ width: 62 }}>
                调休
              </th>
              <th className="num" style={{ width: 62 }}>
                额度+
              </th>
              <th className="num" style={{ width: 62 }}>
                额度−
              </th>
              <SortHead label="余额" sortKey="quotaBalance" sort={sort} onSort={onSort} num />
              <th className="num" style={{ width: 62 }}>
                欠休
              </th>
            </tr>
          </thead>
          <tbody>
            {stats.map((stat) => {
              const isOpen = expanded === stat.personId
              const balCls = stat.quotaBalance < 0 ? 'neg' : stat.quotaBalance > 0 ? 'pos' : ''
              return (
                <Fragment key={stat.personId}>
                  <tr onClick={() => onExpand(stat.personId)} style={{ cursor: 'pointer' }}>
                    <td>
                      {stat.name}
                      {inactiveIds.has(stat.personId) ? (
                        <span className="chip" style={{ marginLeft: 5 }}>
                          停用
                        </span>
                      ) : null}
                    </td>
                    <td>
                      {stat.pool === 'counter' ? (
                        <span className="chip support" style={{ marginRight: 4 }}>
                          512 柜台
                        </span>
                      ) : null}
                      {stat.teamId ? (
                        <span className="chip">{teamName(stat.teamId)}</span>
                      ) : stat.pool === 'main' ? (
                        <span className="chip">大厅</span>
                      ) : null}
                    </td>
                    <td
                      className="num"
                      title={`公休 ${stat.offDays} 天 · 轮空 ${stat.idleDays} 天 · 其他休假 ${stat.otherLeaveDays} 天`}
                    >
                      {stat.onDutyDays}
                    </td>
                    <td className="num">{stat.dutyDays}</td>
                    <td className="num">{stat.makeUpDays}</td>
                    <td className="num">{stat.adjustDays}</td>
                    <td className="num">{stat.quotaEarned}</td>
                    <td className="num">{stat.quotaUsed}</td>
                    <td className="num">
                      <span className={`bal ${balCls}`}>{stat.quotaBalance}</span>
                    </td>
                    <td className="num">
                      {stat.debt > 0 ? <span className="bal neg">{stat.debt}</span> : '—'}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={10} className="stat-detail">
                        <div className="pad">
                          <div className="row" style={{ marginBottom: 8 }}>
                            <span className="grp-hd" style={{ padding: 0 }}>
                              <i />
                              {stat.name} · 逐日明细
                            </span>
                            <span className="note" style={{ marginTop: 0 }}>
                              上月未用完已清零 {stat.expiredQuota} 天
                            </span>
                          </div>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th style={{ width: 104 }}>日期</th>
                                <th style={{ width: 52 }}>星期</th>
                                <th style={{ width: 104 }}>班别</th>
                                <th style={{ width: 80 }}>岗位</th>
                                <th style={{ width: 68 }}>状态</th>
                                <th style={{ width: 82 }}>额度变动</th>
                                <th>说明</th>
                              </tr>
                            </thead>
                            <tbody>
                              {details.map((detail) => (
                                <tr key={detail.date}>
                                  <td className="mono">{detail.date}</td>
                                  <td>{weekdayLabel(detail.date)}</td>
                                  <td>{detail.shiftLabel}</td>
                                  <td>{detail.postName ?? '—'}</td>
                                  <td>
                                    <StatusChip detail={detail} />
                                  </td>
                                  <td className="num">
                                    {detail.quotaDelta === 0 ? (
                                      '—'
                                    ) : (
                                      <span className={`bal ${detail.quotaDelta < 0 ? 'neg' : 'pos'}`}>
                                        {detail.quotaDelta > 0 ? `+${detail.quotaDelta}` : detail.quotaDelta}
                                      </span>
                                    )}
                                  </td>
                                  <td>{detail.note}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="note">
        口径：在岗 = 工作日（周一至周五）有岗位的天数，值班 = 周六与法定调休上班日上岗的天数，两者不重复计；
        轮空 = 上班日未排上且未休假，公休 = 放假 + 周日。轮休额度：值班 1 天 +1，登记调休 / 补休 1 天 −N，
        年假、病假、事假不影响额度；余额 = 额度+ − 额度−，为负即欠休。额度当月用完，上月末未用完的额度已清零、不结转。
        512 柜台是独立岗，工作日不计入大厅在岗人数，周六随值班组进大厅时照常记值班 +1。停用人员不参与排班，当月上班日记为轮空。
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * 按班视图
 * ------------------------------------------------------------------ */

function ShiftTable({
  shifts,
  expanded,
  onExpand,
  teamName,
}: {
  shifts: ReturnType<typeof shiftStats>
  expanded: string | null
  onExpand: (date: string) => void
  teamName: (teamId: TeamId | null) => string
}) {
  return (
    <div>
      {shifts.length === 0 ? (
        <div className="empty">本月没有值班日（周六与法定调休上班日）。</div>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 104 }}>日期</th>
              <th style={{ width: 52 }}>星期</th>
              <th style={{ width: 76 }}>值班组</th>
              <th className="num" style={{ width: 52 }}>
                人数
              </th>
              <th>参与人</th>
              <th>岗位分工</th>
            </tr>
          </thead>
          <tbody>
            {shifts.map((shift) => {
              const isOpen = expanded === shift.date
              return (
                <Fragment key={shift.date}>
                  <tr onClick={() => onExpand(shift.date)} style={{ cursor: 'pointer' }}>
                    <td className="mono">{shift.date}</td>
                    <td>{weekdayLabel(shift.date)}</td>
                    <td>
                      <span className="chip">{teamName(shift.teamId)}</span>
                    </td>
                    <td className="num">{shift.headcount}</td>
                    <td>{shift.members.join('、')}</td>
                    <td>
                      {shift.assignments.map((a) => `${a.postName}${a.names.length}`).join(' · ')}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr>
                      <td colSpan={6} className="stat-detail">
                        <div className="pad">
                          <span className="grp-hd" style={{ padding: 0 }}>
                            <i />
                            {shift.date} 岗位分工明细
                          </span>
                          <table className="tbl">
                            <thead>
                              <tr>
                                <th style={{ width: 120 }}>岗位</th>
                                <th>当班人员</th>
                              </tr>
                            </thead>
                            <tbody>
                              {shift.assignments.map((a) => (
                                <tr key={a.postId}>
                                  <td>{a.postName}</td>
                                  <td>
                                    {a.names.map((name) => (
                                      <span key={name} className="chip" style={{ marginRight: 4 }}>
                                        {name}
                                      </span>
                                    ))}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      )}

      <p className="note">
        口径：本表只列值班日（周六与法定调休上班日），值班组 A / B 隔周交替、整组上岗 8 人，B 组少 1 人时按 A 组名单顺序轮借；
        岗位分工按岗位顺序展开，只列当天有人的岗位。值班 1 天轮休额度 +1，登记调休 / 补休 1 天 −N，
        额度当月用完，上月末未用完的额度已清零、不结转。
      </p>
    </div>
  )
}
