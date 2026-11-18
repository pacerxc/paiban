import { useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import type { AppData } from '../types'
import { blankData, normalize, seedData } from '../lib/store'
import { exportJson, exportMonthCsv } from '../lib/export'
import { formatMonthDay, startOfWeek, toISO } from '../lib/date'
import { ledgerBalance } from '../lib/leave'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
  month: string
  onMonthChange: (month: string) => void
}

export default function DataView({ data, setData, month, onMonthChange }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [startDate, setStartDate] = useState(data.settings.startDate)
  const [orgName, setOrgName] = useState(data.settings.orgName)

  const activeCount = data.people.filter((p) => p.active).length
  const capacity = data.posts.reduce((sum, p) => sum + p.capacity, 0)
  const negativeCount = data.people.filter((p) => ledgerBalance(data.ledger, p.id) < 0).length

  function handleImport(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result))
        if (!parsed || !Array.isArray(parsed.people) || !Array.isArray(parsed.posts)) {
          throw new Error('文件内容不是本项目的数据格式')
        }
        setData(normalize(parsed))
        setStartDate(String(parsed.settings?.startDate ?? startOfWeek(toISO(new Date()))))
        setOrgName(String(parsed.settings?.orgName ?? ''))
        alert('导入成功')
      } catch (error) {
        alert(`导入失败：${(error as Error).message}`)
      }
    }
    reader.readAsText(file)
    event.target.value = ''
  }

  function saveSettings() {
    const start = startOfWeek(startDate)
    setData((prev) => ({
      ...prev,
      settings: { orgName: orgName.trim() || '综合班组', startDate: start },
    }))
    setStartDate(start)
    alert(`已保存。轮转起始周为 ${formatMonthDay(start)} 所在周（周一）。`)
  }

  function resetSeed() {
    if (!confirm('用示例数据覆盖当前全部数据？建议先导出备份。')) return
    setData(seedData())
  }

  function clearAll() {
    if (!confirm('清空人员、休假、台账和排班调整？岗位设置会保留。建议先导出备份。')) return
    setData((prev) => blankData(prev))
  }

  return (
    <div>
      <div className="stats">
        <div className="stat">
          <b>{activeCount}</b>
          <span>在岗人员</span>
        </div>
        <div className="stat">
          <b>{data.posts.length}</b>
          <span>岗位数</span>
        </div>
        <div className="stat">
          <b>{capacity}</b>
          <span>岗位需求</span>
        </div>
        <div className="stat">
          <b>{data.leaves.length}</b>
          <span>休假记录</span>
        </div>
        <div className="stat">
          <b className={negativeCount > 0 ? 'text-danger' : ''}>{negativeCount}</b>
          <span>欠休人员</span>
        </div>
      </div>

      <div className="two-col">
        <section className="card pad">
          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>基本设置</h2>
            <span className="muted">影响轮转起点与页面标题</span>
          </div>
          <div className="form-grid">
            <div className="field">
              <label>班组名称</label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                placeholder="如：综合班组"
              />
            </div>
            <div className="field">
              <label>轮转起始周</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="field wide">
              <button className="btn" onClick={saveSettings}>
                保存设置
              </button>
            </div>
          </div>
          <p className="muted" style={{ marginBottom: 0 }}>
            起始周会自动对齐到所在周的周一。每周整体顺移一位，换班只改当天。
          </p>
        </section>

        <section className="card pad">
          <div className="section-title" style={{ marginTop: 0 }}>
            <h2>备份与导出</h2>
            <span className="muted">数据只存在当前浏览器</span>
          </div>
          <div className="stack">
            <button className="btn ghost" onClick={() => exportJson(data)}>
              导出全部数据（JSON）
            </button>
            <button className="btn ghost" onClick={() => exportMonthCsv(data, month)}>
              导出 {month} 排班表（CSV）
            </button>
            <button className="btn ghost" onClick={() => fileRef.current?.click()}>
              导入 JSON 数据
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              style={{ display: 'none' }}
              onChange={handleImport}
            />
            <div className="divider" />
            <label className="inline-field">
              导出月份
              <input
                type="month"
                value={month}
                onChange={(e) => e.target.value && onMonthChange(e.target.value)}
              />
            </label>
            <button className="btn ghost" onClick={resetSeed}>
              恢复默认名单与岗位
            </button>
            <button className="btn danger" onClick={clearAll}>
              清空人员与记录
            </button>
          </div>
          <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
            换电脑或换浏览器前，先导出 JSON 备份；换设备后再导入即可恢复。
          </p>
        </section>
      </div>

      <div className="section-title">
        <h2>使用说明</h2>
      </div>
      <div className="card pad">
        <ol className="help-list">
          <li>在「人员」页维护名单、轮转顺序，可设置只能上的岗位、固定岗位（如拍照）和只排周六。</li>
          <li>「岗位」页设置每个岗位每天需要几个人；工作日岗位需求之和应与常规在岗人数一致。</li>
          <li>
            「周看板」「月看板」可以直接拖动姓名换班：拖到另一个姓名上是当天对调，拖到空缺处是补位；不合规则时目标变红，上方固定区域会写明违反了哪一条。
          </li>
          <li>点日期下方的「上班 / 放假」可临时调整某一天；换班与放假都只影响当天，后续周次继续按轮转顺序。</li>
          <li>「人员月历」按人查看整月每天在哪个岗位，并自动统计上班、休假、休息天数。</li>
          <li>「休假与台账」登记调休 / 补休，可同步扣减额度；余额为负说明欠休。</li>
          <li>数据保存在浏览器 localStorage，清理浏览器数据会丢失，请定期导出 JSON 备份。</li>
        </ol>
      </div>
    </div>
  )
}
