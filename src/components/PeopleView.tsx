import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData, Person } from '../types'
import { uid } from '../lib/store'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
}

export default function PeopleView({ data, setData }: Props) {
  const [name, setName] = useState('')
  const people = useMemo(
    () => [...data.people].sort((a, b) => a.order - b.order),
    [data.people],
  )
  const activeCount = people.filter((p) => p.active).length
  const capacity = data.posts.reduce((sum, p) => sum + p.capacity, 0)

  function update(id: string, patch: Partial<Person>) {
    setData((prev) => ({
      ...prev,
      people: prev.people.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function addPerson() {
    const trimmed = name.trim()
    if (!trimmed) return
    const maxOrder = people.reduce((max, p) => Math.max(max, p.order), 0)
    setData((prev) => ({
      ...prev,
      people: [
        ...prev.people,
        {
          id: uid('person'),
          name: trimmed,
          order: maxOrder + 1,
          allowedPostIds: null,
          active: true,
        },
      ],
    }))
    setName('')
  }

  function move(id: string, delta: number) {
    setData((prev) => {
      const list = [...prev.people].sort((a, b) => a.order - b.order)
      const index = list.findIndex((p) => p.id === id)
      const target = index + delta
      if (index < 0 || target < 0 || target >= list.length) return prev
      const next = [...list]
      ;[next[index], next[target]] = [next[target], next[index]]
      return { ...prev, people: next.map((p, i) => ({ ...p, order: i + 1 })) }
    })
  }

  function removePerson(id: string) {
    const person = data.people.find((p) => p.id === id)
    if (!person) return
    if (!confirm(`删除「${person.name}」？相关的休假记录和台账也会一起删除。`)) return
    setData((prev) => {
      const weeks: AppData['weeks'] = {}
      for (const [key, plan] of Object.entries(prev.weeks)) {
        const manual = { ...plan.manual }
        delete manual[id]
        if (Object.keys(manual).length > 0) weeks[key] = { ...plan, manual }
      }
      return {
        ...prev,
        people: prev.people.filter((p) => p.id !== id),
        leaves: prev.leaves.filter((l) => l.personId !== id),
        ledger: prev.ledger.filter((e) => e.personId !== id),
        weeks,
      }
    })
  }

  function toggleAllowed(person: Person, postId: string) {
    const all = person.allowedPostIds === null
    const base = all ? data.posts.map((p) => p.id) : [...person.allowedPostIds!]
    const next = base.includes(postId)
      ? base.filter((id) => id !== postId)
      : [...base, postId]
    update(person.id, {
      allowedPostIds: next.length === data.posts.length ? null : next,
    })
  }

  return (
    <div>
      <div className="toolbar no-print">
        <div className="add-row">
          <input
            type="text"
            placeholder="输入姓名"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPerson()}
          />
          <button className="btn" onClick={addPerson} disabled={!name.trim()}>
            添加人员
          </button>
        </div>
        <div className="muted">
          在岗 {activeCount} 人 · 岗位需求 {capacity} 人
          {activeCount !== capacity && (
            <span className="badge warn" style={{ marginLeft: 8 }}>
              人数与岗位需求不一致
            </span>
          )}
        </div>
      </div>

      {people.length === 0 ? (
        <div className="card empty">还没有人员，先添加名单，再回到「周排班」查看轮转结果。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 56 }}>顺序</th>
                <th style={{ minWidth: 120 }}>姓名</th>
                <th style={{ minWidth: 260 }}>只能上的岗位</th>
                <th style={{ width: 90 }}>在岗</th>
                <th style={{ width: 120 }}>调整</th>
                <th style={{ width: 70 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person, i) => {
                const all = person.allowedPostIds === null
                return (
                  <tr key={person.id} className={person.active ? '' : 'inactive-row'}>
                    <td>
                      <div className="order-ctrl">
                        <button
                          className="icon-btn"
                          onClick={() => move(person.id, -1)}
                          disabled={i === 0}
                          title="上移"
                        >
                          ↑
                        </button>
                        <button
                          className="icon-btn"
                          onClick={() => move(person.id, 1)}
                          disabled={i === people.length - 1}
                          title="下移"
                        >
                          ↓
                        </button>
                      </div>
                    </td>
                    <td>
                      <input
                        className="name-input"
                        type="text"
                        value={person.name}
                        onChange={(e) => update(person.id, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <div className="chips">
                        <button
                          className={all ? 'chip on' : 'chip'}
                          onClick={() => update(person.id, { allowedPostIds: null })}
                        >
                          全部岗位
                        </button>
                        {data.posts.map((post) => {
                          const on = all || person.allowedPostIds!.includes(post.id)
                          return (
                            <button
                              key={post.id}
                              className={on ? 'chip on' : 'chip'}
                              onClick={() => toggleAllowed(person, post.id)}
                            >
                              {post.name}
                            </button>
                          )
                        })}
                      </div>
                      {!all && person.allowedPostIds!.length === 0 && (
                        <div className="badge danger" style={{ marginTop: 6 }}>
                          未选择任何岗位，将无法排班
                        </div>
                      )}
                    </td>
                    <td>
                      <label className="switch">
                        <input
                          type="checkbox"
                          checked={person.active}
                          onChange={(e) => update(person.id, { active: e.target.checked })}
                        />
                        <span>{person.active ? '在岗' : '停用'}</span>
                      </label>
                    </td>
                    <td>
                      <div className="btn-group">
                        <button
                          className="btn ghost sm"
                          onClick={() => move(person.id, -1)}
                          disabled={i === 0}
                        >
                          上移
                        </button>
                        <button
                          className="btn ghost sm"
                          onClick={() => move(person.id, 1)}
                          disabled={i === people.length - 1}
                        >
                          下移
                        </button>
                      </div>
                    </td>
                    <td>
                      <button className="btn danger sm" onClick={() => removePerson(person.id)}>
                        删除
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        顺序决定轮转次序：每周所有人按此顺序整体后移一位。点击岗位标签可以限制某人只能上指定岗位，未限制的默认全部可上。
      </p>
    </div>
  )
}
