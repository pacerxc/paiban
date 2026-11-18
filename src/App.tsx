import { useEffect, useState } from 'react'
import type { AppData } from './types'
import { loadData, saveData } from './lib/store'
import { currentMonth, startOfWeek, toISO } from './lib/date'
import WeekView from './components/WeekView'
import MonthView from './components/MonthView'
import PersonMonth from './components/PersonMonth'
import PeopleView from './components/PeopleView'
import PostsView from './components/PostsView'
import LeaveView from './components/LeaveView'
import DataView from './components/DataView'

const TABS = [
  { id: 'week', label: '周看板' },
  { id: 'month', label: '月看板' },
  { id: 'personMonth', label: '人员月历' },
  { id: 'people', label: '人员' },
  { id: 'posts', label: '岗位' },
  { id: 'leave', label: '休假与台账' },
  { id: 'data', label: '数据' },
] as const

type TabId = (typeof TABS)[number]['id']

export default function App() {
  const [data, setData] = useState<AppData>(loadData)
  const [tab, setTab] = useState<TabId>('week')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(toISO(new Date())))
  const [month, setMonth] = useState(currentMonth)

  useEffect(() => {
    saveData(data)
  }, [data])

  const activeCount = data.people.filter((p) => p.active).length
  const capacity = data.posts.reduce((sum, p) => sum + p.capacity, 0)

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand">
            <div className="brand-mark">排</div>
            <div>
              <h1>排班台</h1>
              <p>{data.settings.orgName} · 轮转排班 · 拖拽换班 · 休假台账</p>
            </div>
          </div>
          <div className="header-stats">
            <span>
              <b>{activeCount}</b> 在岗
            </span>
            <span>
              <b>{data.posts.length}</b> 岗位
            </span>
            <span>
              <b>{capacity}</b> 岗位需求
            </span>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'tab active' : 'tab'}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="container">
        {tab === 'week' && (
          <WeekView data={data} weekStart={weekStart} onWeekChange={setWeekStart} setData={setData} />
        )}
        {tab === 'month' && (
          <MonthView data={data} month={month} onMonthChange={setMonth} setData={setData} />
        )}
        {tab === 'personMonth' && (
          <PersonMonth data={data} month={month} onMonthChange={setMonth} />
        )}
        {tab === 'people' && <PeopleView data={data} setData={setData} />}
        {tab === 'posts' && <PostsView data={data} setData={setData} />}
        {tab === 'leave' && <LeaveView data={data} setData={setData} />}
        {tab === 'data' && (
          <DataView data={data} setData={setData} month={month} onMonthChange={setMonth} />
        )}
      </main>

      <footer className="app-footer">数据保存在本机浏览器，建议定期在「数据」页导出备份</footer>
    </div>
  )
}
