import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import type { AppData } from '../types'
import { copyText, exportJson, exportMonthCsv, exportPostTableCsv, weekText } from '../lib/export'
import { HOLIDAY_RANGE, holidayList, workDateList } from '../lib/holidays'
import { addDays, currentMonth, shiftMonth } from '../lib/date'
import { migrate } from '../lib/store'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  month: string
  onMonthChange: (month: string) => void
  weekStart: string
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

function DownloadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M7 10l5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  )
}

function CopyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="M17 8l-5-5-5 5" />
      <path d="M12 3v12" />
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
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
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

export default function ExportView({ data, setData, month, onMonthChange, weekStart }: Props) {
  const [toast, setToast] = useState<ToastState | null>(null)
  const [confirm, setConfirm] = useState<ConfirmState | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 2600)
    return () => window.clearTimeout(timer)
  }, [toast])

  const text = useMemo(() => weekText(data, weekStart), [data, weekStart])
  const holidays = useMemo(() => holidayList(), [])
  const workDates = useMemo(() => workDateList(), [])
  const weekEnd = addDays(weekStart, 6)

  function setSetting<K extends keyof AppData['settings']>(key: K, value: AppData['settings'][K]) {
    setData((prev) => ({ ...prev, settings: { ...prev.settings, [key]: value } }))
  }

  async function handleCopy() {
    const ok = await copyText(text)
    if (ok) setToast({ kind: 'ok', title: '周文本已复制', text: '可以直接发到群里' })
    else setToast({ kind: 'err', title: '复制失败', text: '请手动选中文本复制' })
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const content = await file.text()
      const raw = JSON.parse(content) as Record<string, unknown>
      const migrated = migrate(raw)
      setConfirm({
        title: '导入数据',
        body: `文件读取完成：人员 ${migrated.people.length} 人、岗位组 ${migrated.posts.length} 个、休假记录 ${migrated.leaves.length} 条、台账 ${migrated.ledger.length} 条。导入会覆盖当前数据，确认继续？`,
        confirmText: '确认导入',
        onConfirm: () => {
          setData(migrated)
          setToast({ kind: 'ok', title: '已导入数据' })
        },
      })
    } catch {
      setToast({ kind: 'err', title: '导入失败', text: '文件不是合法的 JSON' })
    }
  }

  return (
    <div>
      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <DownloadIcon />
          导出中心
          <span className="rt">{data.settings.orgName}</span>
        </h2>
        <div className="panel-body">
          <div className="row" style={{ marginBottom: 14 }}>
            <button className="btn acc" onClick={() => exportPostTableCsv(data, weekStart)}>
              <DownloadIcon />
              岗位表 CSV（本周）
            </button>
            <button className="btn" onClick={() => exportMonthCsv(data, month)}>
              <DownloadIcon />
              人员月表 CSV（{month}）
            </button>
            <button className="btn" onClick={() => exportJson(data)}>
              <DownloadIcon />
              导出 JSON 备份
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              <UploadIcon />
              导入 JSON
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleFile}
            />
          </div>

          <div className="row" style={{ marginBottom: 14 }}>
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
            <span className="note" style={{ marginTop: 0 }}>
              岗位表 CSV 按本周 {weekStart} ~ {weekEnd} 导出；人员月表 CSV 按所选月份导出。
            </span>
          </div>

          <div className="grp-hd">
            <i />
            周文本
            <span className="cnt">{weekStart} ~ {weekEnd}</span>
          </div>
          <textarea
            className="input"
            rows={10}
            readOnly
            value={text}
            style={{ width: '100%', marginTop: 6, fontFamily: 'inherit', fontSize: 12.5 }}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn" onClick={handleCopy}>
              <CopyIcon />
              复制周文本
            </button>
            <span className="note" style={{ marginTop: 0 }}>
              周文本跟随顶栏的周次，值班组长带 ★。
            </span>
          </div>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 14 }}>
        <h2>
          <SettingsIcon />
          设置
          <span className="rt">改完立即生效</span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
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
                onChange={(e) => setSetting('restQuotaDays', Math.max(0, toInt(e.target.value, data.settings.restQuotaDays)))}
              />
            </div>
            <div className="field">
              <label>每日最少在岗人数</label>
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
            <div className="field">
              <label>周六支援位（人）</label>
              <input
                className="input"
                type="number"
                min={0}
                value={data.settings.supportSlots}
                onChange={(e) => setSetting('supportSlots', Math.max(0, toInt(e.target.value, data.settings.supportSlots)))}
              />
            </div>
            <div className="field">
              <label>甲乙隔周轮换</label>
              <button
                className={`btn sm${data.settings.crewAlternate ? ' on' : ''}`}
                style={{ width: 92 }}
                onClick={() => setSetting('crewAlternate', !data.settings.crewAlternate)}
              >
                {data.settings.crewAlternate ? '开' : '关'}
              </button>
            </div>
          </div>
          <p className="note">
            最少在岗人数低于该值会在告警里标红；休息目标只用于月表提示，不参与排班计算。
          </p>
        </div>
      </div>

      <div className="panel">
        <h2>
          <CalendarIcon />
          内置节假日
          <span className="rt">
            覆盖 {HOLIDAY_RANGE.from} ~ {HOLIDAY_RANGE.to}
          </span>
        </h2>
        <div className="panel-body">
          <div className="grid2">
            <div>
              <div className="grp-hd">
                <i />
                放假日
                <span className="cnt">{holidays.length} 段</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th style={{ width: 116 }}>开始</th>
                    <th style={{ width: 116 }}>结束</th>
                  </tr>
                </thead>
                <tbody>
                  {holidays.map((item) => (
                    <tr key={`${item.from}-${item.to}`}>
                      <td>{item.name}</td>
                      <td className="mono">{item.from}</td>
                      <td className="mono">{item.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div>
              <div className="grp-hd">
                <i />
                调休上班日
                <span className="cnt">{workDates.length} 天</span>
              </div>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th style={{ width: 116 }}>日期</th>
                  </tr>
                </thead>
                <tbody>
                  {workDates.map((item) => (
                    <tr key={item.date}>
                      <td>{item.name}</td>
                      <td className="mono">{item.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <p className="note">
            依据国务院办公厅节假日安排，覆盖 2026-01-01 ~ 2027-12-31；超出范围按「周一至周六上班、周日休息」处理。
            临时调整可在班表里单独改某一天。
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
