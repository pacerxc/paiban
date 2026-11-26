import { useCallback, useEffect, useState } from 'react'
import type { AppData } from './types'
import { loadData, saveData } from './lib/store'
import { currentMonth, startOfWeek, toISO } from './lib/date'
import Console from './components/Console'
import MonthBoard from './components/MonthBoard'
import PeopleView from './components/PeopleView'
import LedgerView from './components/LedgerView'
import StatsView from './components/StatsView'
import ExportView from './components/ExportView'

type Theme = 'warm' | 'ocean' | 'dark'
type TabId = 'board' | 'month' | 'people' | 'ledger' | 'stats' | 'export'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'board', label: '班表' },
  { id: 'month', label: '月表' },
  { id: 'people', label: '人员' },
  { id: 'ledger', label: '台账' },
  { id: 'stats', label: '统计' },
  { id: 'export', label: '导出' },
]

const THEMES: Array<{ id: Theme; label: string }> = [
  { id: 'warm', label: '暖纸' },
  { id: 'ocean', label: '碧海' },
  { id: 'dark', label: '暗夜' },
]

interface Toast {
  kind: 'ok' | 'err' | 'info'
  title: string
  detail?: string
}

const ICON = {
  chart: 'M3 3v18h18M19 9l-5 5-4-4-3 3',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
}

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [tab, setTab] = useState<TabId>('board')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(toISO(new Date())))
  const [month, setMonth] = useState(currentMonth)
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem('paiban.theme') as Theme) || 'warm',
  )
  const [toast, setToast] = useState<Toast | null>(null)
  const [storageError, setStorageError] = useState(false)

  useEffect(() => {
    try {
      saveData(data)
      setStorageError(false)
    } catch {
      setStorageError(true)
    }
  }, [data])

  useEffect(() => {
    document.body.dataset.theme = theme
    localStorage.setItem('paiban.theme', theme)
  }, [theme])

  const notify = useCallback((kind: Toast['kind'], title: string, detail?: string) => {
    setToast({ kind, title, detail })
    window.setTimeout(() => setToast((prev) => (prev?.title === title ? null : prev)), 2600)
  }, [])

  const weekEnd = shiftWeek(weekStart, 1)

  return (
    <div>
      <header className="bar">
        <div className="brand">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON.chart} />
          </svg>
          排班台
          <span className="tag">方案 C · 三栏控制台</span>
        </div>
        <div className="spacer" />

        <label className="search">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d={ICON.search} />
          </svg>
          <input placeholder="搜索姓名 / 岗位" />
        </label>

        <div className="stepper">
          <button type="button" onClick={() => setWeekStart(shiftWeek(weekStart, -1))} aria-label="上一周">
            ‹
          </button>
          <span>
            {weekStart.slice(0, 7)} · {weekStart.slice(8, 10)}—{weekEnd.slice(8, 10)}
          </span>
          <button type="button" onClick={() => setWeekStart(shiftWeek(weekStart, 1))} aria-label="下一周">
            ›
          </button>
        </div>

        {TABS.filter((item) => item.id !== 'export').map((item) => (
          <button
            key={item.id}
            type="button"
            className={`btn${tab === item.id ? ' on' : ''}`}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}

        <button
          type="button"
          className={`btn${tab === 'export' ? ' on' : ' acc'}`}
          onClick={() => setTab('export')}
          title="导出岗位表 / 人员月表"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d={ICON.download} />
          </svg>
          导出
        </button>

        <div className="row" style={{ gap: 4 }}>
          {THEMES.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`btn sm${theme === item.id ? ' on' : ''}`}
              onClick={() => setTheme(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      <p className="hint">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
        </svg>
        拖动<b>班表里的姓名</b>可换岗；从左栏<b>人员树</b>拖人进格子＝安排上班；拖到下方<b>不在岗</b>＝当天休息。带{' '}
        <b>★</b> 的是值班组长。表格下方会实时列出<b>违反的规则</b>，照着改完再点<b>锁定本周</b>保存。
      </p>

      {storageError && (
        <p className="hint" style={{ color: 'var(--err)', marginBottom: 12 }}>
          浏览器本地存储不可用，本次修改<b>无法保存</b>，请到「导出」页导出 JSON 备份。
        </p>
      )}

      {tab === 'board' && (
        <Console
          data={data}
          weekStart={weekStart}
          setData={setData}
          notify={notify}
        />
      )}
      {tab === 'month' && (
        <MonthBoard data={data} month={month} onMonthChange={setMonth} setData={setData} />
      )}
      {tab === 'people' && <PeopleView data={data} setData={setData} />}
      {tab === 'ledger' && (
        <LedgerView data={data} setData={setData} month={month} onMonthChange={setMonth} />
      )}
      {tab === 'stats' && (
        <StatsView data={data} month={month} onMonthChange={setMonth} />
      )}
      {tab === 'export' && (
        <ExportView
          data={data}
          setData={setData}
          month={month}
          onMonthChange={setMonth}
          weekStart={weekStart}
        />
      )}

      <div className="foot">
        <span>
          <b>数据</b>　保存在本机浏览器（paiban.data.v5），建议定期在「导出」页备份。
        </span>
        <span>
          <b>岗位配置</b>　工作日 一号台1 受理2 校对2 扫描1 照相1 填表1 机动0~3；周六/假日 一号台2 填表2 受理3 照相1（无校对、扫描、机动）。
        </span>
        <span>
          <b>512 柜台</b>　独立岗位，工作日 4 人常驻、不计入大厅在岗；周六与法定调休上班日不设此岗。
        </span>
        <span>
          <b>值班组</b>　A、B 两组隔周交替，周六与法定假日整组上岗 8 人；B 组少 1 人，按 A 组名单顺序一人一次轮借。
        </span>
        <span>
          <b>轮转环</b>　7 个位次（101 → 102 → 103 → 104 → 105 → 106 → 填表）每周整体右移一位，机动池的人顶休假缺岗，可在「人员」页拖拽调整。
        </span>
        <span>
          <b>规则校验</b>　班表下方实时列出违反的规则（固定岗、512 柜台、在岗人数、组长位次等），只提示不拦截。
        </span>
      </div>

      {toast && (
        <div className={`toast ${toast.kind}`}>
          <span className="mark">{toast.kind === 'ok' ? '✓' : toast.kind === 'err' ? '!' : 'i'}</span>
          <span>
            <b>{toast.title}</b>
            {toast.detail && <span>{toast.detail}</span>}
          </span>
        </div>
      )}
    </div>
  )
}

function shiftWeek(weekStart: string, delta: number): string {
  const [y, m, d] = weekStart.split('-').map(Number)
  const date = new Date(y, m - 1, d + delta * 7)
  return toISO(date)
}
