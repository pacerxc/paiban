import { useMemo } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData } from '../types'
import { monthDates, shiftMonth } from '../lib/date'
import { exportMonthCsv } from '../lib/export'
import { dayState } from '../lib/scheduler'
import Board, { clearAdjustments, hasDayAdjustment } from './Board'

interface Props {
  data: AppData
  month: string
  onMonthChange: (month: string) => void
  setData: Dispatch<SetStateAction<AppData>>
}

export default function MonthView({ data, month, onMonthChange, setData }: Props) {
  const dates = useMemo(() => monthDates(month), [month])
  const [year, monthNumber] = month.split('-')

  const workDays = dates.filter((date) => dayState(data, date).working).length
  const adjustedDays = dates.filter(
    (date) => data.days[date] !== undefined || hasDayAdjustment(data, date),
  ).length

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
            <span>
              上班 {workDays} 天 · {adjustedDays > 0 ? `${adjustedDays} 天有调整` : '全部按轮转'}
            </span>
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
          <button
            className="btn ghost"
            onClick={() => setData((prev) => clearAdjustments(prev, dates))}
            disabled={adjustedDays === 0}
          >
            重置本月
          </button>
        </div>
      </div>

      <div className="banner info">
        <strong>整月看板</strong>
        <span>
          左右滑动查看整月。月初可以把这张表发给大家，需要换班的直接在这里拖动；同样只影响当天，红色代表这次调整不符合规则，原因显示在上方。
        </span>
      </div>

      <Board data={data} dates={dates} setData={setData} mode="month" />
    </div>
  )
}
