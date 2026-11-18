import { useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AppData, Post } from '../types'
import { POST_COLORS, uid } from '../lib/store'

interface Props {
  data: AppData
  setData: Dispatch<SetStateAction<AppData>>
}

export default function PostsView({ data, setData }: Props) {
  const [name, setName] = useState('')
  const [capacity, setCapacity] = useState(2)

  const totalCapacity = useMemo(
    () => data.posts.reduce((sum, p) => sum + p.capacity, 0),
    [data.posts],
  )
  const activeCount = data.people.filter((p) => p.active).length

  function update(id: string, patch: Partial<Post>) {
    setData((prev) => ({
      ...prev,
      posts: prev.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    }))
  }

  function addPost() {
    const trimmed = name.trim()
    if (!trimmed) return
    setData((prev) => ({
      ...prev,
      posts: [
        ...prev.posts,
        {
          id: uid('post'),
          name: trimmed,
          capacity: Math.max(0, capacity),
          color: POST_COLORS[prev.posts.length % POST_COLORS.length],
        },
      ],
    }))
    setName('')
    setCapacity(2)
  }

  function removePost(id: string) {
    const post = data.posts.find((p) => p.id === id)
    if (!post) return
    if (!confirm(`删除岗位「${post.name}」？相关的换班记录会一并清除。`)) return
    setData((prev) => {
      const dayPosts: Record<string, string> = {}
      for (const [key, postId] of Object.entries(prev.dayPosts)) {
        if (postId !== id) dayPosts[key] = postId
      }
      return {
        ...prev,
        posts: prev.posts.filter((p) => p.id !== id),
        dayPosts,
        people: prev.people.map((p) => ({
          ...p,
          allowedPostIds: p.allowedPostIds
            ? p.allowedPostIds.filter((pid) => pid !== id)
            : p.allowedPostIds,
          fixedPostId: p.fixedPostId === id ? null : p.fixedPostId,
        })),
      }
    })
  }

  return (
    <div>
      <div className="toolbar no-print">
        <div className="add-row">
          <input
            type="text"
            placeholder="岗位名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addPost()}
          />
          <label className="inline-field">
            需求人数
            <input
              type="number"
              min={0}
              value={capacity}
              onChange={(e) => setCapacity(Number(e.target.value) || 0)}
            />
          </label>
          <button className="btn" onClick={addPost} disabled={!name.trim()}>
            添加岗位
          </button>
        </div>
        <div className="muted">
          岗位总需求 {totalCapacity} 人 / 在岗 {activeCount} 人
          {totalCapacity !== activeCount && (
            <span className="badge warn" style={{ marginLeft: 8 }}>
              差 {Math.abs(totalCapacity - activeCount)} 人
            </span>
          )}
          <span style={{ marginLeft: 8 }}>（周六另有 1 名填表组人员上岗）</span>
        </div>
      </div>

      {data.posts.length === 0 ? (
        <div className="card empty">还没有岗位，先添加岗位并设置每岗需求人数。</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th style={{ width: 52 }}>颜色</th>
                <th style={{ minWidth: 150 }}>岗位名称</th>
                <th style={{ width: 140 }}>需求人数</th>
                <th style={{ minWidth: 160 }}>说明</th>
                <th style={{ width: 70 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.posts.map((post) => (
                <tr key={post.id}>
                  <td>
                    <input
                      type="color"
                      className="color-input"
                      value={post.color}
                      onChange={(e) => update(post.id, { color: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="name-input"
                      type="text"
                      value={post.name}
                      onChange={(e) => update(post.id, { name: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      style={{ width: 90 }}
                      value={post.capacity}
                      onChange={(e) =>
                        update(post.id, { capacity: Math.max(0, Number(e.target.value) || 0) })
                      }
                    />
                  </td>
                  <td className="muted">
                    当前需 {post.capacity} 人，排班时按此人数展开位次
                  </td>
                  <td>
                    <button className="btn danger sm" onClick={() => removePost(post.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="muted" style={{ marginTop: 12 }}>
        岗位需求人数之和应与工作日可排人员数一致。新增「填表」这类岗位后，周六会由填表组轮 1 人上岗；如需调整岗位，直接在「周看板」拖动姓名即可。
      </p>
    </div>
  )
}
