import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData } from '../types'
import { addDays, formatDateRange, startOfWeek, toISO, weekIndexOf } from '../lib/date'
import { copyText, exportDatesCsv, weekText } from '../lib/export'
import Board, { clearAdjustments, hasDayAdjustment } from './Board'

interface Props {
  data: AppData
  weekStart: string
  onWeekChange: (weekStart: string) => void
  setData: Dispatch<SetStateAction<AppData>>
}

export default function WeekView({ data, weekStart, onWeekChange, setData }: Props) {
  const [copied, setCopied] = useState(false)

  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const weekEnd = dates[6]
  const index = weekIndexOf(data.settings.startDate, weekStart)
  const todayWeek = startOfWeek(toISO(new Date()))
  const adjustedDays = dates.filter(
    (date) => data.days[date] !== undefined || hasDayAdjustment(data, date),
  ).length

  async function handleCopy() {
    const ok = await copyText(weekText(data, weekStart))
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  function resetWeek() {
    setData((prev) => clearAdjustments(prev, dates))
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
              {adjustedDays > 0 ? ` · ${adjustedDays} 天有手动调整` : ' · 自动轮转'}
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
          <button
            className="btn ghost"
            onClick={() => exportDatesCsv(data, dates, `排班_${weekStart}.csv`)}
          >
            导出 CSV
          </button>
          <button className="btn ghost" onClick={() => window.print()}>
            打印
          </button>
          <button className="btn ghost" onClick={resetWeek} disabled={adjustedDays === 0}>
            重置本周
          </button>
        </div>
      </div>

      <div className="banner info">
        <strong>拖拽换班</strong>
        <span>
          把姓名拖到另一个姓名上即可当天对调；不符合规则时目标会变红，并在上方固定区域说明违反了哪条规则。修改只影响当天，后续周次仍按轮转顺序。
        </span>
      </div>

      <Board data={data} dates={dates} setData={setData} mode="week" />

      <p className="muted" style={{ marginTop: 12 }}>
        周一至周六上班、周日休息。某天临时需要上班或放假，点日期下方的「上班 / 放假」即可切换；周六由填表组 4 人轮 1 人上岗，其余人员轮休。
      </p>
    </div>
  )
}
