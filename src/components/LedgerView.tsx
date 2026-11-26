import { useEffect, useMemo, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AppData, LeaveRecord, LeaveType, LedgerEntry } from '../types'
import { countRestDays, leavesInMonth } from '../lib/scheduler'
import { buildLedger, dutySummary, expiredQuota, ledgerDaysForLeave, SOURCE_LABEL } from '../lib/leave'
import { currentMonth, diffDays, monthDates, shiftMonth, toISO } from '../lib/date'
import { uid } from '../lib/store'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  month: string
  onMonthChange: (month: string) => void
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

const LEAVE_TYPES: LeaveType[] = ['调休', '补休', '年假', '病假', '事假', '其他']

function LeaveIcon() {
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

function LedgerIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  )
}

function BenchIcon() {
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
      <path d="m19 9-5 5-4-4-3 3" />
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

export default function LedgerView({ data, setData, month, onMonthChange }: Props) {
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const [personId, setPersonId] = useState('')
  const [type, setType] = useState<LeaveType>('调休')
  const [start, setStart] = useState(() => toISO(new Date()))
  const [end, setEnd] = useState(() => toISO(new Date()))
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const dates = useMemo(() => monthDates(month), [month])
  const people = useMemo(() => [...data.people].sort((a, b) => a.order - b.order), [data.people])
  const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? '已删除'

  const rows = useMemo(() => buildLedger(data, dates), [data, dates])
  const monthLeaves = useMemo(
    () => [...leavesInMonth(data, month)].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0)),
    [data, month],
  )

  const leaveDays = end >= start ? diffDays(start, end) + 1 : 0
  const quota = data.settings.restQuotaDays

  const restStats = useMemo(
    () =>
      people.map((person) => {
        const rest = countRestDays(data, person.id, dates)
        return { person, rest, low: person.pool === 'main' && rest < quota }
      }),
    [people, data, dates, quota],
  )

  /** 调休余额：值班 +1、登记 −N */
  const balanceStats = useMemo(
    () => people.map((person) => ({ person, summary: dutySummary(data, person.id, dates) })),
    [people, data, dates],
  )

  /** 本月还有额度未休掉的人数 */
  const unusedCount = balanceStats.filter((b) => b.summary.balance > 0).length

  /** 上月额度未用完（已清零）的人数 */
  const expiredCount = useMemo(
    () => people.filter((person) => expiredQuota(data, person.id, month) > 0).length,
    [people, data, month],
  )

  function submitLeave(e: FormEvent) {
    e.preventDefault()
    if (!personId) {
      setToast({ kind: 'err', title: '请先选择休假人员' })
      return
    }
    if (leaveDays <= 0) {
      setToast({ kind: 'err', title: '结束日期不能早于开始日期' })
      return
    }
    const entryDays = ledgerDaysForLeave(type, leaveDays)
    const entry: LedgerEntry | null =
      entryDays === null
        ? null
        : {
            id: uid('ledger'),
            personId,
            date: start,
            days: entryDays,
            reason: `登记${type} ${leaveDays} 天`,
            source: 'leave',
            auto: true,
          }
    const record: LeaveRecord = {
      id: uid('leave'),
      personId,
      type,
      start,
      end,
      note: note.trim() || undefined,
      ledgerId: entry?.id,
    }
    setData((prev) => ({
      ...prev,
      leaves: [record, ...prev.leaves],
      ledger: entry ? [entry, ...prev.ledger] : prev.ledger,
    }))
    setNote('')
    setToast({
      kind: 'ok',
      title: '已登记休假',
      text: entry ? `并扣减台账 ${leaveDays} 天` : '未影响调休额度',
    })
  }

  function removeLeave(leave: LeaveRecord) {
    const person = nameOf(leave.personId)
    const days = diffDays(leave.start, leave.end) + 1
    setConfirm({
      title: '删除休假记录',
      body: `确定删除「${person}」${leave.start} ~ ${leave.end} 的${leave.type}记录？${
        leave.ledgerId ? '关联的台账扣减也会一起删除。' : ''
      }`,
      confirmText: '删除',
      onConfirm: () => {
        setData((prev) => ({
          ...prev,
          leaves: prev.leaves.filter((l) => l.id !== leave.id),
          ledger: leave.ledgerId ? prev.ledger.filter((e) => e.id !== leave.ledgerId) : prev.ledger,
        }))
        setToast({ kind: 'ok', title: '已删除休假记录', text: `${person} ${days} 天` })
      },
    })
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <LeaveIcon />
          休假登记
          <span className="rt">{monthLeaves.length} 条本月记录</span>
        </h2>
        <div className="panel-body">
          <form onSubmit={submitLeave}>
            <div className="grid3">
              <div className="field">
                <label>人员</label>
                <select className="input" value={personId} onChange={(e) => setPersonId(e.target.value)}>
                  <option value="">请选择</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                      {person.pool === 'counter' ? '（512 柜台）' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>类型</label>
                <select
                  className="input"
                  value={type}
                  onChange={(e) => setType(e.target.value as LeaveType)}
                >
                  {LEAVE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>天数</label>
                <input className="input" type="text" value={`${leaveDays} 天`} readOnly />
              </div>
              <div className="field">
                <label>开始日期</label>
                <input className="input" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="field">
                <label>结束日期</label>
                <input className="input" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              <div className="field">
                <label>备注</label>
                <input
                  className="input"
                  type="text"
                  placeholder="选填"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>
            </div>
            <div className="row">
              <button className="btn acc" type="submit">
                <PlusIcon />
                登记休假
              </button>
              <span className="note" style={{ marginTop: 0 }}>
                调休、补休会自动在台账里扣减同等天数；年假、病假等不占用调休额度。
              </span>
            </div>
          </form>

          <div className="grid2" style={{ marginTop: 14 }}>
            <div>
              <div className="grp-hd">
                <i />
                本月休假记录
                <span className="cnt">{monthLeaves.length} 条</span>
              </div>
              {monthLeaves.length === 0 ? (
                <div className="empty">本月还没有休假记录。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>人员</th>
                      <th style={{ width: 72 }}>类型</th>
                      <th>起止</th>
                      <th style={{ width: 64 }}>天数</th>
                      <th style={{ width: 60 }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthLeaves.map((leave) => (
                      <tr key={leave.id}>
                        <td>
                          {nameOf(leave.personId)}
                          {leave.note ? <div className="note" style={{ marginTop: 0 }}>{leave.note}</div> : null}
                        </td>
                        <td>
                          <span className="chip">{leave.type}</span>
                        </td>
                        <td className="mono">
                          {leave.start === leave.end ? leave.start : `${leave.start} ~ ${leave.end}`}
                        </td>
                        <td className="num">{diffDays(leave.start, leave.end) + 1}</td>
                        <td>
                          <button className="btn sm ghost" title="删除" onClick={() => removeLeave(leave)}>
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div>
              <div className="grp-hd">
                <i />
                调休余额
                <span className="cnt">值班 +1 · 登记 −N</span>
              </div>
              {people.length === 0 ? (
                <div className="empty">还没有人员。</div>
              ) : (
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>人员</th>
                      <th style={{ width: 78 }}>值班</th>
                      <th style={{ width: 78 }}>使用</th>
                      <th style={{ width: 78 }}>余额</th>
                    </tr>
                  </thead>
                  <tbody>
                    {balanceStats.map(({ person, summary }) => {
                      const cls = summary.balance < 0 ? 'neg' : summary.balance > 0 ? 'pos' : ''
                      return (
                        <tr key={person.id}>
                          <td>{person.name}</td>
                          <td className="num">{summary.duty}</td>
                          <td className="num">{summary.used}</td>
                          <td className="num">
                            <span className={`bal ${cls}`}>{summary.balance}</span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <div className="note">
                周六与法定假日值班 1 天记 +1，登记调休 / 补休 1 天记 −N。额度必须当月休完，
                月末未用完自动清零、不结转下月。
                {unusedCount > 0 && ` 本月还有 ${unusedCount} 人有额度未休掉。`}
                {expiredCount > 0 && ` 上月有 ${expiredCount} 人额度未用完已清零。`}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <LedgerIcon />
          台账流水
          <span className="rt">{rows.length} 条 · {month}</span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 12 }}>
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

          {rows.length === 0 ? (
            <div className="empty">本月还没有台账流水。</div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th style={{ width: 120 }}>日期</th>
                  <th style={{ width: 110 }}>人员</th>
                  <th style={{ width: 84 }}>变动</th>
                  <th>原因</th>
                  <th style={{ width: 100 }}>来源</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.date}</td>
                    <td>{nameOf(row.personId)}</td>
                    <td className="num">
                      <span className={`bal ${row.days < 0 ? 'neg' : 'pos'}`}>
                        {row.days > 0 ? `+${row.days}` : row.days}
                      </span>
                    </td>
                    <td>{row.reason}</td>
                    <td>
                      <span
                        className={`chip${row.source === 'duty' ? ' ok' : row.source === 'leave' ? ' err' : ''}`}
                      >
                        {SOURCE_LABEL[row.source]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="note">
            值班流水由排班实时推导，周六上岗一人记 +1；登记调休记 −N。余额为负说明欠休，需要安排补休。
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>
          <BenchIcon />
          月休统计
          <span className="rt">目标 {quota} 天 / 人</span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 12 }}>
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

          {restStats.length === 0 ? (
            <div className="empty">还没有人员。</div>
          ) : (
            <div className="pad" style={{ padding: 0 }}>
              {restStats.map(({ person, rest, low }) => {
                const max = Math.max(quota, rest, 1)
                const fill = Math.min(100, (rest / max) * 100)
                const mark = Math.min(100, (quota / max) * 100)
                return (
                  <div key={person.id} className="bench">
                    <span className="lb">{person.name}</span>
                    <div className="tk">
                      <span className={`fl${low ? ' low' : ''}`} style={{ width: `${fill}%` }} />
                      <i style={{ left: `${mark}%` }} />
                    </div>
                    <span className={`vl${low ? ' low' : ''}`}>
                      {rest}/{quota}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
          <p className="note">
            月休 = 周日公休 + 表内不在岗登记（含年假），只作提示不影响排班；竖线是目标值，低于目标标红。
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
