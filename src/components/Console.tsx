import { useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction, DragEvent } from 'react'
import type { AppData } from '../types'
import { addDays, parseISO, weekdayLabel } from '../lib/date'
import { buildAlerts, checkPersonPost, planDay, planRange } from '../lib/scheduler'
import type { DayPlan } from '../lib/scheduler'
import { checkRules } from '../lib/rules'
import { buildLedger } from '../lib/leave'

interface Props {
  data: AppData
  weekStart: string
  setData: Dispatch<SetStateAction<AppData>>
  notify: (kind: 'ok' | 'err' | 'info', title: string, detail?: string) => void
}

/** 槽位数组：人员 id 或 null（空位次） */
type Slots = (string | null)[]
type DaySlots = Record<string, Slots>

type DragSource =
  | { type: 'cell'; date: string; postId: string; slot: number }
  | { type: 'rest'; date: string }
  | { type: 'tree' }

interface DragState {
  personId: string
  source: DragSource
}

const ICON = {
  users:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 7a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87',
  warn: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01',
  alarm:
    'M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  coin: 'M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  cal: 'M3 4h18v18H3zM16 2v4M8 2v4M3 10h18',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8h.01M11 12h1v4h1',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  undo: 'M3 7v6h6M3.5 13a9 9 0 1 0 2.1-6.4L3 9',
}

function Icon({ d, size = 13 }: { d: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
    >
      <path d={d} />
    </svg>
  )
}

function shortDate(date: string): string {
  const d = parseISO(date)
  return `${d.getMonth() + 1}.${d.getDate()}`
}

export default function Console({ data, weekStart, setData, notify }: Props) {
  const dates = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  )
  const month = weekStart.slice(0, 7)
  const monthDates = useMemo(() => {
    const [y, m] = month.split('-').map(Number)
    const total = new Date(y, m, 0).getDate()
    return Array.from({ length: total }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
  }, [month])

  const plans = useMemo(() => planRange(data, dates), [data, dates])
  const personById = useMemo(() => new Map(data.people.map((p) => [p.id, p])), [data.people])
  const postById = useMemo(() => new Map(data.posts.map((p) => [p.id, p])), [data.posts])

  const dragRef = useRef<DragState | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)

  const hallPosts = data.posts.filter((p) => !p.separate)
  const counterPosts = data.posts.filter((p) => p.separate)
  /** 机动岗：浮动岗，位次按当天剩余人数，单独标出免得混进「最少在岗」基数 */
  const flexPost = data.posts.find((p) => p.flexMode === 'leftover')

  /* ------------------------------------------------------------ 槽位 */

  /** 取得某天某岗位的槽位（null = 空位次） */
  function slotsOf(date: string, postId: string, plan: DayPlan): Slots {
    const post = postById.get(postId)
    if (!post) return []
    const cap = plan.slotCount.get(postId) ?? 0
    const override = data.dayPlans[date]
    const base: Slots = override
      ? (override[postId] ?? []).slice(0, cap)
      : (plan.byPost.get(postId) ?? []).slice(0, cap)
    const arr: Slots = [...base]
    while (arr.length < cap) arr.push(null)
    return arr
  }

  /** 物化某天的岗位安排（把自动排班转成可编辑的槽位结构） */
  function materialize(date: string): DaySlots {
    const plan = plans.get(date)
    const out: DaySlots = {}
    for (const post of data.posts) {
      out[post.id] = slotsOf(date, post.id, plan!)
    }
    return out
  }

  /* ---------------------------------------------------------- 拖拽 */

  function onDragStart(event: DragEvent, personId: string, source: DragSource) {
    dragRef.current = { personId, source }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', personId)
  }

  function onDragEnd() {
    dragRef.current = null
    setOverKey(null)
  }

  function onDragLeave(event: DragEvent) {
    const related = (event.relatedTarget as HTMLElement | null)?.closest?.('[data-drop]')
    const current = (event.currentTarget as HTMLElement).closest('[data-drop]')
    if (related && current && related === current) return
    setOverKey(null)
  }

  function onDragOver(event: DragEvent) {
    const target = (event.target as HTMLElement).closest('[data-drop]') as HTMLElement | null
    if (!target || !dragRef.current) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const key = `${target.getAttribute('data-drop')}:${target.getAttribute('data-date')}:${target.getAttribute('data-post') ?? ''}`
    if (key !== overKey) setOverKey(key)
  }

  function onDrop(event: DragEvent) {
    event.preventDefault()
    const drag = dragRef.current
    const target = (event.target as HTMLElement).closest('[data-drop]') as HTMLElement | null
    setOverKey(null)
    if (!drag || !target) return

    const date = target.getAttribute('data-date') ?? ''
    const kind = target.getAttribute('data-drop')
    if (!date) return

    if (kind === 'rest') {
      dropToRest(date, drag)
      return
    }
    const postId = target.getAttribute('data-post') ?? ''
    const chip = (event.target as HTMLElement).closest('.pc[data-slot]') as HTMLElement | null
    const slot = chip ? Number(chip.getAttribute('data-slot')) : null
    dropToCell(date, postId, slot, drag)
  }

  /** 把人放到某天的某个位次；返回被挤出的那个人 */
  function placeInto(
    day: DaySlots,
    date: string,
    postId: string,
    slot: number | null,
    personId: string,
  ): string | null {
    const arr = day[postId]
    if (!arr) return null

    // 先把 person 从当天所有位次腾空
    for (const post of data.posts) {
      const a = day[post.id]
      const i = a.indexOf(personId)
      if (i >= 0) a[i] = null
    }

    let target = slot
    let displaced: string | null = null
    if (target == null || target < 0 || target >= arr.length) {
      const empty = arr.findIndex((x) => x === null)
      if (empty >= 0) {
        target = empty
      } else {
        const first = arr.findIndex((x) => x !== null)
        if (first < 0) {
          arr[0] = personId
          return null
        }
        displaced = arr[first]
        target = first
      }
    } else if (arr[target] !== null && arr[target] !== personId) {
      displaced = arr[target]
    }

    arr[target] = personId
    return displaced
  }

  /**
   * 软校验：排班规则冲突时只提示、不拦截。
   * 返回违反的规则文案，null 表示这条安排没问题。
   */
  function softCheck(date: string, personId: string, postId: string): string | null {
    const check = checkPersonPost(data, personId, postId, date)
    if (check.ok) return null
    return `${check.text}　${check.rule}`
  }

  function dropToCell(date: string, postId: string, slot: number | null, drag: DragState) {
    const source = drag.source
    if (
      source.type === 'cell' &&
      source.date === date &&
      source.postId === postId &&
      source.slot === slot
    ) {
      return
    }

    const targetPlan = plans.get(date)
    if (targetPlan && targetPlan.onLeavePersonIds.includes(drag.personId)) {
      const type = targetPlan.leaveTypeByPerson.get(drag.personId)
      notify(
        'err',
        `${personById.get(drag.personId)?.name ?? ''} 当天${type ?? '休假'}`,
        '休假期间不排班，请先在「台账」页取消该假',
      )
      return
    }
    if (targetPlan && !targetPlan.working) {
      notify('err', `${shortDate(date)} 全员公休`, '先在「台账」或设置里改成上班日')
      return
    }

    // 软校验：先看会不会违反岗位规则，违反也照排，只在提示里说明
    const warnings: string[] = []
    const own = softCheck(date, drag.personId, postId)
    if (own) warnings.push(own)

    const dayPlans = { ...data.dayPlans }
    const day = materialize(date)
    const displaced = placeInto(day, date, postId, slot, drag.personId)

    if (displaced && displaced !== drag.personId) {
      if (source.type === 'cell') {
        const other = softCheck(date, displaced, source.postId)
        if (other) warnings.push(other)
        const srcDay = source.date === date ? day : materialize(source.date)
        if (source.date !== date) {
          for (const post of data.posts) {
            const a = srcDay[post.id]
            const i = a.indexOf(drag.personId)
            if (i >= 0) a[i] = null
          }
        }
        const srcArr = srcDay[source.postId]
        if (srcArr) {
          const empty = srcArr.findIndex((x) => x === null)
          const at =
            source.slot >= 0 && source.slot < srcArr.length && srcArr[source.slot] === null
              ? source.slot
              : empty >= 0
                ? empty
                : 0
          srcArr[at] = displaced
        }
        if (source.date !== date) dayPlans[source.date] = srcDay
      }
      notify(
        warnings.length > 0 ? 'err' : 'ok',
        `${personById.get(drag.personId)?.name ?? ''} 已调岗`,
        warnings.length > 0
          ? `违反规则：${warnings.join('　')}`
          : `${personById.get(displaced)?.name ?? ''} 换到「${postById.get(postId)?.name ?? ''}」的来源位次`,
      )
    } else {
      notify(
        warnings.length > 0 ? 'err' : 'ok',
        `${personById.get(drag.personId)?.name ?? ''} 已安排到「${postById.get(postId)?.name ?? ''}」`,
        warnings.length > 0 ? `违反规则：${warnings.join('　')}` : shortDate(date),
      )
    }

    dayPlans[date] = day
    setData({ ...data, dayPlans })
  }

  function dropToRest(date: string, drag: DragState) {
    const dayPlans = { ...data.dayPlans }
    const day = materialize(date)
    for (const post of data.posts) {
      const a = day[post.id]
      const i = a.indexOf(drag.personId)
      if (i >= 0) a[i] = null
    }
    dayPlans[date] = day
    setData({ ...data, dayPlans })
    notify(
      'info',
      `${personById.get(drag.personId)?.name ?? ''} ${shortDate(date)} 改为休息`,
      '拖回岗位格可恢复上班',
    )
  }

  /* ------------------------------------------------------- 顶部操作 */

  function lockWeek() {
    const dayPlans = { ...data.dayPlans }
    for (const date of dates) dayPlans[date] = materialize(date)
    setData({ ...data, dayPlans })
    notify('ok', '本周已锁定', '之后轮转起点变化不会影响这一周')
  }

  function resetWeek() {
    const dayPlans = { ...data.dayPlans }
    for (const date of dates) delete dayPlans[date]
    setData({ ...data, dayPlans })
    notify('info', '本周调整已清除', '恢复为自动排班')
  }

  /* ---------------------------------------------------------- 渲染 */

  const mains = data.people.filter((p) => p.active && p.pool === 'main')
  const counters = data.people.filter((p) => p.active && p.pool === 'counter')
  const leaders = data.people.filter((p) => p.active && p.canLead)

  const alerts = useMemo(() => buildAlerts(data, dates), [data, dates])

  /** 本周规则校验：拖动后实时重算，表格下方列出每一处违反的规则 */
  const violations = useMemo(() => checkRules(data, dates), [data, dates])
  const ruleErrors = violations.filter((v) => v.level === 'error').length
  const ruleWarns = violations.length - ruleErrors
  const adjustedDays = dates.filter((date) => data.dayPlans[date]).length

  const restStat = useMemo(() => {
    const quota = data.settings.restQuotaDays
    const rows = mains.map((p) => {
      let rest = 0
      for (const date of monthDates) {
        const plan = planDay(data, date)
        if (!plan.working) rest++
        else if (!plan.byPerson.get(p.id)) rest++
      }
      return { name: p.name, value: rest }
    })
    rows.sort((a, b) => b.value - a.value)
    return rows
  }, [data, mains, monthDates])

  const ledgerRows = useMemo(() => {
    const rows = buildLedger(data, monthDates)
    const map = new Map<string, { duty: number; used: number }>()
    for (const row of rows) {
      const item = map.get(row.personId) ?? { duty: 0, used: 0 }
      if (row.source === 'duty') item.duty += row.days
      else item.used += Math.abs(Math.min(0, row.days))
      map.set(row.personId, item)
    }
    return data.people
      .filter((p) => p.active)
      .map((p) => {
        const item = map.get(p.id) ?? { duty: 0, used: 0 }
        return {
          name: p.name,
          duty: item.duty,
          used: item.used,
          balance: item.duty - item.used,
        }
      })
      .sort((a, b) => b.balance - a.balance)
  }, [data, monthDates])

  const debtCount = ledgerRows.filter((r) => r.balance < 0).length
  const shortRestCount = restStat.filter((r) => r.value < data.settings.restQuotaDays).length
  const hasDebt = debtCount > 0 || shortRestCount > 0

  const weekTotal = hallPosts
    .filter((p) => p.flexMode !== 'leftover')
    .reduce((sum, p) => sum + p.capacity, 0)
  const flexMax = flexPost?.capacity ?? 0
  const satTotal = hallPosts.reduce((sum, p) => sum + p.saturdayCapacity, 0)
  const counterTotal = counterPosts.reduce((sum, p) => sum + p.capacity, 0)

  const leaderPlans = dates.map((date) => plans.get(date)!)
  const vacantLeaders = leaderPlans.filter((p) => p.working && p.leaderVacant)
  const counterLeaderName = counters.find((p) => p.canLead)?.name ?? ''

  /** 渲染一行岗位 */
  function renderPostRow(post: (typeof data.posts)[number], isCounter = false) {
    return (
      <tr key={post.id} className={isCounter ? 'row-counter' : undefined}>
        <td className={`posthd${isCounter ? ' sep' : ''}`}>
          <div className="g">
            <i />
            {post.name}
          </div>
          <div className="c">
            {isCounter
              ? `${post.capacity}人 · 周六无此岗`
              : `${post.capacity}人 · 周六${post.saturdayCapacity}`}
          </div>
        </td>
        {dates.map((date) => {
          const plan = plans.get(date)!
          if (!plan.working) {
            return (
              <td key={date} className="cell col-off">
                公休
              </td>
            )
          }
          const slots = slotsOf(date, post.id, plan)
          const low = !isCounter && plan.coreOnDuty < data.settings.minDailyHeadcount
          const cls = [
            plan.type === 'duty' ? 'col-sat' : '',
            low ? 'col-low' : '',
            overKey === `cell:${date}:${post.id}` ? 'over' : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <td
              key={date}
              className={`cell ${cls}`}
              data-drop="cell"
              data-date={date}
              data-post={post.id}
              onDragOver={onDragOver}
              onDrop={onDrop}
            >
              {slots.map((personId, index) => {
                if (!personId) {
                  return (
                    <span key={index} className="pc vac" data-slot={index}>
                      缺
                    </span>
                  )
                }
                const person = personById.get(personId)
                if (!person) return null
                const isLeader =
                  plan.leaderId === personId || plan.counterLeaderId === personId
                const note = [
                  person.fixedPostId ? `固定${postById.get(person.fixedPostId)?.name ?? ''}` : '',
                  person.teamId ? `${person.teamId}组` : '',
                  person.pool === 'counter' ? '512 柜台' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <span
                    key={index}
                    className="pc"
                    draggable
                    data-slot={index}
                    title={note || undefined}
                    onDragStart={(e) =>
                      onDragStart(e, personId, {
                        type: 'cell',
                        date,
                        postId: post.id,
                        slot: index,
                      })
                    }
                    onDragEnd={onDragEnd}
                  >
                    {person.name}
                    {isLeader && <span className="st">★</span>}
                  </span>
                )
              })}
            </td>
          )
        })}
      </tr>
    )
  }

  return (
    <div className="console">
      {/* ------------------------------------------------ 左栏：人员树 */}
      <aside className="rail">
        <div className="rail-hd">
          <h2>
            <Icon d={ICON.users} />
            人员
            <span className="cnt">{data.people.filter((p) => p.active).length} 人</span>
          </h2>
        </div>

        <div className="grp-hd">
          <i />
          主班池
          <span className="cnt">{mains.length} 人</span>
        </div>
        {mains.map((p) => (
          <div
            key={p.id}
            className="person"
            draggable
            data-person={p.id}
            onDragStart={(e) => onDragStart(e, p.id, { type: 'tree' })}
            onDragEnd={onDragEnd}
          >
            <span className="nm">{p.name}</span>
            <span className="tags">
              {p.canLead && <span className="b lead">组长</span>}
              {p.fixedPostId && (
                <span className="b rest">{postById.get(p.fixedPostId)?.name ?? '固定'}</span>
              )}
              {p.teamId && <span className="b">{p.teamId}组</span>}
            </span>
          </div>
        ))}

        <div className="grp-hd">
          <i style={{ background: '#9aa1aa' }} />
          512 柜台
          <span className="cnt">{counters.length} 人</span>
        </div>
        {counters.map((p) => (
          <div
            key={p.id}
            className="team"
            draggable
            data-person={p.id}
            onDragStart={(e) => onDragStart(e, p.id, { type: 'tree' })}
            onDragEnd={onDragEnd}
          >
            <span className="g">{p.teamId ?? '—'}</span>
            <span className="ns">{p.name}</span>
            {p.canLead && (
              <span className="tags">
                <span className="b lead">组长</span>
              </span>
            )}
          </div>
        ))}

        <div className="grp-hd" style={{ paddingTop: 14 }}>
          <i style={{ background: 'var(--slate)' }} />
          值班班组
          <span className="cnt">周六隔周轮</span>
        </div>
        {data.teams.map((team) => (
          <div key={team.id} className="team">
            <span className="g">{team.id}</span>
            <span className="ns">
              {team.memberIds
                .map((id) => personById.get(id)?.name ?? '')
                .filter(Boolean)
                .join('、')}
            </span>
          </div>
        ))}

        <div className="grp-hd" style={{ paddingTop: 14 }}>
          <i style={{ background: 'var(--slate)' }} />
          组长池
          <span className="cnt">{leaders.length} 人 · 轮值</span>
        </div>
        {leaders.map((p) => (
          <div
            key={p.id}
            className="team"
            draggable
            onDragStart={(e) => onDragStart(e, p.id, { type: 'tree' })}
            onDragEnd={onDragEnd}
          >
            <span className="ns">{p.name}</span>
            <span className="tags">
              <span className="b lead">{p.leaderScope === 'counter' ? '512' : '大厅'}</span>
            </span>
          </div>
        ))}

        <div className="pad" style={{ paddingTop: 13 }}>
          <div className="note" style={{ marginTop: 0 }}>
            组长是职务标签，不是独立岗位。大厅组长按 王玉花 → 杨娟 → 汪甜 逐日轮值；
            艾丽娜只负责 512 柜台。
          </div>
        </div>
      </aside>

      {/* ------------------------------------------------ 中栏：班表 */}
      <main className="center">
        <div className="center-hd">
          <h1>
            本班表 · 第{' '}
            {Math.max(
              1,
              Math.round(
                (parseISO(weekStart).getTime() - parseISO(data.settings.startDate).getTime()) /
                  (7 * 86400000),
              ) + 1,
            )}{' '}
            周
          </h1>
          <span className="sub">
            工作日 {weekTotal} 位次 + 机动 0~{flexMax} · 周六 {satTotal} 位次 · 512 柜台 {counterTotal} 人 · 周日公休 · 最少在岗{' '}
            {data.settings.minDailyHeadcount} 人
          </span>
          <div className="rt">
            <button type="button" className="btn" onClick={lockWeek} title="把本周排班固定下来">
              <Icon d={ICON.lock} />
              锁定本周
            </button>
            <button type="button" className="btn" onClick={resetWeek} title="清除本周所有手工调整">
              <Icon d={ICON.undo} />
              重置本周
            </button>
          </div>
        </div>

        <div className="leaderbar">
          <span className="lab">值班组长</span>
          {leaderPlans.filter((p) => p.working).length === 0 ? (
            <span className="rt">本周无工作日</span>
          ) : (
            <span className="row" style={{ gap: 10 }}>
              {leaderPlans
                .filter((p) => p.working)
                .map((p) => (
                  <span
                    key={p.date}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <span style={{ color: 'var(--ink-3)' }}>{weekdayLabel(p.date)}</span>
                    {p.leaderId ? (
                      <>
                        <span className="n">{personById.get(p.leaderId)?.name}</span>
                        <span className="st">★</span>
                      </>
                    ) : (
                      <span className="bad">空缺</span>
                    )}
                  </span>
                ))}
              {vacantLeaders.length > 0 && (
                <span className="bad">{vacantLeaders.length} 天需指定代理组长</span>
              )}
            </span>
          )}
          <span className="rt">512 柜台组长 {counterLeaderName || '空缺'}</span>
        </div>

        <table className="grid">
          <thead>
            <tr>
              <th style={{ width: 104 }}>岗位</th>
              {dates.map((date) => {
                const plan = plans.get(date)!
                const low = plan.working && plan.coreOnDuty < data.settings.minDailyHeadcount
                const cls = !plan.working ? 'off' : plan.type === 'duty' ? 'sat' : ''
                const flexCount = flexPost ? (plan.byPost.get(flexPost.id)?.length ?? 0) : 0
                return (
                  <th key={date} className={`${cls}${low ? ' low' : ''}`}>
                    <span className="dow">{weekdayLabel(date)}</span>
                    <span className="md">{shortDate(date)}</span>
                    <span className="c">
                      {plan.working ? (
                        <>
                          {plan.coreOnDuty}/{plan.coreCapacity}
                          {flexCount > 0 ? <em className="fx">机动 {flexCount}</em> : null}
                        </>
                      ) : (
                        '公休'
                      )}
                    </span>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>{hallPosts.map((post) => renderPostRow(post))}</tbody>
          {counterPosts.length > 0 && (
            <>
              <tbody className="grid-sep">
                <tr>
                  <td className="sep-note" colSpan={dates.length + 1}>
                    512 柜台 · 独立岗位，不与大厅岗位混排，不计入大厅在岗人数
                  </td>
                </tr>
              </tbody>
              <tbody>{counterPosts.map((post) => renderPostRow(post, true))}</tbody>
            </>
          )}
        </table>

        {/* -------------------------------------- 表格下方：规则校验提示 */}
        <div className={`rulebox${violations.length > 0 ? ' has' : ''}`}>
          <div className="rulebox-hd">
            <Icon d={ICON.warn} />
            规则校验
            <span className="rt">
              {violations.length === 0
                ? '本周排班符合全部规则'
                : `${ruleErrors} 条违反 · ${ruleWarns} 条提醒`}
            </span>
          </div>
          {violations.length === 0 ? (
            <div className="rulebox-ok">
              没有发现违反规则的情况。拖动调整后这里会实时列出问题所在，确认后再「锁定本周」保存。
            </div>
          ) : (
            <ul className="rulelist">
              {violations.map((v, index) => (
                <li key={`${v.date}-${v.personId ?? ''}-${v.postId ?? ''}-${index}`} className={`vrow ${v.level}`}>
                  <span className="ic">
                    <Icon d={v.level === 'error' ? ICON.alarm : ICON.warn} size={11} />
                  </span>
                  <span className="tx">
                    <b>{v.title}</b>
                    <span>{v.rule}</span>
                    <span className="fx">建议：{v.fix}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="rulebox-ft">
            本周已手工调整 {adjustedDays} 天；未锁定前调整会随顺序变化重排，锁定后固定下来。
          </div>
        </div>

        <div className="strip">
          <div className="strip-hd">
            <Icon d={ICON.users} />
            不在岗（拖人到这里＝当天休息）
          </div>
          <div className="restrow">
            {dates.map((date) => {
              const plan = plans.get(date)!
              const names = [
                ...plan.onLeavePersonIds.map((id) => ({
                  id,
                  type: plan.leaveTypeByPerson.get(id),
                })),
                ...plan.resting.map((id) => ({ id, type: undefined as string | undefined })),
              ]
              return (
                <div
                  key={date}
                  className={`rbox${overKey === `rest:${date}:` ? ' over' : ''}`}
                  data-drop="rest"
                  data-date={date}
                  onDragOver={onDragOver}
                  onDrop={onDrop}
                >
                  <div className="d">
                    {weekdayLabel(date)} {shortDate(date)}
                  </div>
                  <div className="ns">
                    {names.length === 0 && (
                      <span style={{ fontSize: '10.5px', color: 'var(--ink-3)' }}>拖人到这里</span>
                    )}
                    {names.map(({ id, type }) => {
                      const person = personById.get(id)
                      if (!person) return null
                      const isLeader = plan.leaderId === id || plan.counterLeaderId === id
                      return (
                        <span
                          key={id}
                          className="pc"
                          draggable
                          onDragStart={(e) => onDragStart(e, id, { type: 'rest', date })}
                          onDragEnd={onDragEnd}
                          title={type ? `休假类型：${type}` : '当天轮休'}
                        >
                          {person.name}
                          {isLeader && <span className="st">★</span>}
                          {type && <sup>{type}</sup>}
                        </span>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {/* ----------------------------------------------- 右栏：告警台账 */}
      <aside className="rail rail-r">
        <div className="rail-hd">
          <h2>
            <Icon d={ICON.warn} />
            告警
            <span className="cnt">
              {alerts.errors} 严重 · {alerts.warnings + (hasDebt ? 1 : 0)} 提醒
            </span>
          </h2>
        </div>

        {alerts.alerts.map((alert, index) => (
          <div key={index} className={`alarm ${alert.level}`}>
            <span className="ic">
              <Icon d={alert.level === 'error' ? ICON.alarm : ICON.warn} size={11} />
            </span>
            <span className="tx">
              <b>{alert.title}</b>
              <span>{alert.detail}</span>
            </span>
          </div>
        ))}
        {hasDebt && (
          <div className="alarm warn">
            <span className="ic">
              <Icon d={ICON.coin} size={11} />
            </span>
            <span className="tx">
              <b>
                {debtCount} 人欠休 · {shortRestCount} 人休息不足 {data.settings.restQuotaDays} 天
              </b>
              <span>只统计与提示，不影响排班</span>
            </span>
          </div>
        )}
        <div className="alarm info">
          <span className="ic">
            <Icon d={ICON.info} size={11} />
          </span>
          <span className="tx">
            <b>周六 A/B 组隔周轮 · 整组上岗</b>
            <span>512 柜台 {counterTotal} 人工作日常驻，周六不设此岗</span>
          </span>
        </div>

        <div className="railhd2">
          <Icon d={ICON.coin} />
          轮休额度台账
          <span className="rt">值班 +1 · 登记 −N</span>
        </div>
        <table className="ledger">
          <thead>
            <tr>
              <th>姓名</th>
              <th style={{ width: 30 }}>+1</th>
              <th style={{ width: 30 }}>−N</th>
              <th style={{ width: 64 }}>余额</th>
            </tr>
          </thead>
          <tbody>
            {ledgerRows.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td className="mono" style={{ color: 'var(--ink-3)' }}>
                  {row.duty}
                </td>
                <td className="mono" style={{ color: 'var(--ink-3)' }}>
                  {row.used}
                </td>
                <td>
                  <span
                    className={`bal ${row.balance < 0 ? 'neg' : row.balance > 0 ? 'pos' : ''}`}
                  >
                    {row.balance > 0 ? `+${row.balance}` : row.balance}
                  </span>
                  {row.balance < 0 && <span className="mini">欠</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="railhd2">
          <Icon d={ICON.cal} />
          {Number(month.slice(5))} 月休息天数
          <span className="rt">目标 {data.settings.restQuotaDays} 天</span>
        </div>
        <div className="pad">
          {restStat.map((row) => {
            const low = row.value < data.settings.restQuotaDays
            const pct = Math.min(100, (row.value / 12) * 100)
            return (
              <div key={row.name} className="bench">
                <span className="lb">{row.name}</span>
                <span className="tk">
                  <span className={`fl${low ? ' low' : ''}`} style={{ width: `${pct}%` }} />
                  <i style={{ left: `${(data.settings.restQuotaDays / 12) * 100}%` }} />
                </span>
                <span className={`vl${low ? ' low' : ''}`}>
                  {row.value}/{data.settings.restQuotaDays}
                </span>
              </div>
            )
          })}
          <div className="note">
            口径：周日公休 + 表内不在岗登记（含年假）。竖线为目标。轮休额度当月用完，不结转。
          </div>
        </div>
      </aside>
    </div>
  )
}
