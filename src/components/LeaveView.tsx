import { useMemo, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import type { AppData, LeaveRecord, LeaveType, LedgerEntry } from '../types'
import { diffDays, toISO } from '../lib/date'
import { ledgerBalance, leaveTotalDays } from '../lib/leave'
import { uid } from '../lib/store'

const LEAVE_TYPES: LeaveType[] = ['调休', '补休', '年假', '病假', '事假', '其他']

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
}

export default function LeaveView({ data, setData }: Props) {
  const today = toISO(new Date())
  const [personId, setPersonId] = useState('')
  const [type, setType] = useState<LeaveType>('调休')
  const [start, setStart] = useState(today)
  const [end, setEnd] = useState(today)
  const [note, setNote] = useState('')
  const [linkLedger, setLinkLedger] = useState(true)

  const [ledgerPerson, setLedgerPerson] = useState('')
  const [ledgerDays, setLedgerDays] = useState('1')
  const [ledgerDate, setLedgerDate] = useState(today)
  const [ledgerReason, setLedgerReason] = useState('')

  const people = useMemo(
    () => [...data.people].sort((a, b) => a.order - b.order),
    [data.people],
  )
  const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? '已删除'
  const canLink = type === '调休' || type === '补休'
  const leaveDays = end >= start ? diffDays(start, end) + 1 : 0

  function addLeave(e: FormEvent) {
    e.preventDefault()
    if (!personId) {
      alert('请选择休假人员')
      return
    }
    if (leaveDays <= 0) {
      alert('结束日期不能早于开始日期')
      return
    }
    const leaveId = uid('leave')
    const entry: LedgerEntry | null =
      linkLedger && canLink
        ? {
            id: uid('ledger'),
            personId,
            date: start,
            days: -leaveDays,
            reason: `${type}：${start} ~ ${end}`,
            auto: true,
          }
        : null
    const record: LeaveRecord = {
      id: leaveId,
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
  }

  function removeLeave(id: string) {
    setData((prev) => {
      const leave = prev.leaves.find((l) => l.id === id)
      if (!leave) return prev
      return {
        ...prev,
        leaves: prev.leaves.filter((l) => l.id !== id),
        ledger: leave.ledgerId ? prev.ledger.filter((e) => e.id !== leave.ledgerId) : prev.ledger,
      }
    })
  }

  function addLedger(e: FormEvent) {
    e.preventDefault()
    const days = Number(ledgerDays)
    if (!ledgerPerson || !Number.isFinite(days) || days === 0) {
      alert('请选择人员，并填写非零的天数（正数增加，负数扣减）')
      return
    }
    setData((prev) => ({
      ...prev,
      ledger: [
        {
          id: uid('ledger'),
          personId: ledgerPerson,
          date: ledgerDate,
          days,
          reason: ledgerReason.trim() || '手动调整',
        },
        ...prev.ledger,
      ],
    }))
    setLedgerDays('1')
    setLedgerReason('')
  }

  function removeLedger(id: string) {
    const entry = data.ledger.find((e) => e.id === id)
    if (!entry) return
    if (
      entry.auto &&
      !confirm('这条台账由休假记录自动生成，删除后台账与休假记录的关联会断开。继续？')
    ) {
      return
    }
    setData((prev) => ({ ...prev, ledger: prev.ledger.filter((e) => e.id !== id) }))
  }

  const recentLedger = [...data.ledger]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .slice(0, 30)

  return (
    <div>
      <div className="two-col">
        <section className="card pad">
          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>登记休假</h2>
            <span className="muted">调休 / 补休可同步扣减台账</span>
          </div>
          <form className="form-grid" onSubmit={addLeave}>
            <div className="field">
              <label>人员</label>
              <select value={personId} onChange={(e) => setPersonId(e.target.value)}>
                <option value="">请选择</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>类型</label>
              <select
                value={type}
                onChange={(e) => {
                  const next = e.target.value as LeaveType
                  setType(next)
                  if (next !== '调休' && next !== '补休') setLinkLedger(false)
                }}
              >
                {LEAVE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>开始日期</label>
              <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field">
              <label>结束日期</label>
              <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="field">
              <label>天数</label>
              <input type="text" value={`${leaveDays} 天`} readOnly />
            </div>
            <div className="field">
              <label>备注</label>
              <input
                type="text"
                placeholder="选填，如：家中有事"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="field wide">
              <label className="switch">
                <input
                  type="checkbox"
                  checked={canLink && linkLedger}
                  disabled={!canLink}
                  onChange={(e) => setLinkLedger(e.target.checked)}
                />
                <span>
                  同时在台账中扣减 {leaveDays} 天
                  {!canLink ? '（仅调休/补休可用）' : ''}
                </span>
              </label>
            </div>
            <div className="field wide">
              <button className="btn" type="submit" disabled={!personId}>
                添加休假记录
              </button>
            </div>
          </form>
        </section>

        <section className="card pad">
          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>台账调整</h2>
            <span className="muted">正数增加额度，负数扣减</span>
          </div>
          <form className="form-grid" onSubmit={addLedger}>
            <div className="field">
              <label>人员</label>
              <select value={ledgerPerson} onChange={(e) => setLedgerPerson(e.target.value)}>
                <option value="">请选择</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>日期</label>
              <input type="date" value={ledgerDate} onChange={(e) => setLedgerDate(e.target.value)} />
            </div>
            <div className="field">
              <label>天数</label>
              <input
                type="number"
                step="0.5"
                value={ledgerDays}
                onChange={(e) => setLedgerDays(e.target.value)}
              />
            </div>
            <div className="field">
              <label>原因</label>
              <input
                type="text"
                placeholder="如：国庆值班"
                value={ledgerReason}
                onChange={(e) => setLedgerReason(e.target.value)}
              />
            </div>
            <div className="field wide">
              <button className="btn ghost" type="submit" disabled={!ledgerPerson}>
                记录台账
              </button>
            </div>
          </form>
          <p className="muted" style={{ marginBottom: 0 }}>
            余额 = 历次增加 - 历次扣减。为负数说明该人员欠休，需要安排补休。
          </p>
        </section>
      </div>

      <div className="section-title">
        <h2>欠休台账</h2>
        <span className="muted">按人员汇总</span>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th style={{ width: 46 }}>序号</th>
              <th>姓名</th>
              <th>累计调休</th>
              <th>累计补休</th>
              <th>台账余额</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {people.map((person, i) => {
              const balance = ledgerBalance(data.ledger, person.id)
              return (
                <tr key={person.id}>
                  <td className="muted">{i + 1}</td>
                  <td>
                    <strong>{person.name}</strong>
                  </td>
                  <td>{leaveTotalDays(data.leaves, person.id, '调休')} 天</td>
                  <td>{leaveTotalDays(data.leaves, person.id, '补休')} 天</td>
                  <td>
                    <strong className={balance < 0 ? 'text-danger' : ''}>{balance} 天</strong>
                  </td>
                  <td>
                    {balance < 0 ? (
                      <span className="badge danger">欠休 {-balance} 天</span>
                    ) : balance > 0 ? (
                      <span className="badge ok">可休 {balance} 天</span>
                    ) : (
                      <span className="badge">已平账</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="section-title">
        <h2>休假记录</h2>
        <span className="muted">共 {data.leaves.length} 条</span>
      </div>

      {data.leaves.length === 0 ? (
        <div className="card empty">还没有休假记录。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>人员</th>
                <th>类型</th>
                <th>起止</th>
                <th>天数</th>
                <th>备注</th>
                <th>台账</th>
                <th style={{ width: 70 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {[...data.leaves]
                .sort((a, b) => (a.start < b.start ? 1 : -1))
                .map((leave) => (
                  <tr key={leave.id}>
                    <td>
                      <strong>{nameOf(leave.personId)}</strong>
                    </td>
                    <td>
                      <span className={leave.type === '补休' ? 'badge ok' : 'badge warn'}>
                        {leave.type}
                      </span>
                    </td>
                    <td>
                      {leave.start === leave.end ? leave.start : `${leave.start} ~ ${leave.end}`}
                    </td>
                    <td>{diffDays(leave.start, leave.end) + 1} 天</td>
                    <td className="muted">{leave.note || '—'}</td>
                    <td>
                      {leave.ledgerId ? (
                        <span className="badge ok">已扣减</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td>
                      <button className="btn danger sm" onClick={() => removeLeave(leave.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="section-title">
        <h2>台账流水</h2>
        <span className="muted">最近 30 条</span>
      </div>

      {recentLedger.length === 0 ? (
        <div className="card empty">还没有台账记录。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>人员</th>
                <th>变动</th>
                <th>原因</th>
                <th>来源</th>
                <th style={{ width: 70 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {recentLedger.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.date}</td>
                  <td>{nameOf(entry.personId)}</td>
                  <td>
                    <strong className={entry.days < 0 ? 'text-danger' : 'text-ok'}>
                      {entry.days > 0 ? `+${entry.days}` : entry.days} 天
                    </strong>
                  </td>
                  <td className="muted">{entry.reason}</td>
                  <td>
                    {entry.auto ? <span className="badge">休假自动</span> : <span className="badge">手动</span>}
                  </td>
                  <td>
                    <button className="btn danger sm" onClick={() => removeLedger(entry.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
