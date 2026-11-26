/* 规则校验引擎独立验证脚本（临时产物，验证后删除） */
import { seedData } from './src/lib/store'
import { planDay } from './src/lib/scheduler'
import { checkRules } from './src/lib/rules'
import type { AppData } from './src/types'

const data: AppData = seedData()
data.settings.startDate = '2026-11-16'

let pass = 0
let fail = 0
function check(label: string, ok: boolean, extra = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${label} ${extra}`)
  } else {
    fail++
    console.log(`  ✗ ${label} ${extra}`)
  }
}

const WEEK = ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20', '2026-11-21', '2026-11-22']
const nameOf = (id: string) => data.people.find((p) => p.id === id)?.name ?? id

console.log('=== 1. 种子数据应当 0 条 error ===')
const base = checkRules(data, WEEK)
console.log(base.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n') || '    （无违规）')
check('种子数据无 error 级违规', base.filter((v) => v.level === 'error').length === 0, `(error ${base.filter((v) => v.level === 'error').length} / warn ${base.filter((v) => v.level === 'warn').length})`)

console.log('\n=== 2. 固定岗人员被调到别的岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const yan = d.people.find((p) => p.name === '颜贞贞')!
  // 2026-11-18 周三：把颜贞贞从照相挪到一号台
  const plan = planDay(d, '2026-11-18')
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  const photoIdx = slots.post_5.indexOf(yan.id)
  slots.post_5[photoIdx] = null
  slots.post_1[0] = yan.id
  d.dayPlans['2026-11-18'] = slots
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule} | ${v.fix}`).join('\n'))
  const hit = vs.find((v) => v.level === 'error' && v.title.includes('颜贞贞') && v.rule.includes('固定岗'))
  check('检出「固定岗人员被调离本岗」', !!hit, hit ? `(${hit.title})` : '')
  check('给出可执行的修改建议', !!hit && hit.fix.length > 4, hit ? `(${hit.fix})` : '')
}

console.log('\n=== 3. 512 柜台人员工作日被排到大厅岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const ai = d.people.find((p) => p.name === '艾丽娜')!
  const plan = planDay(d, '2026-11-18')
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  const idx = slots.post_8.indexOf(ai.id)
  slots.post_8[idx] = null
  slots.post_1[0] = ai.id
  d.dayPlans['2026-11-18'] = slots
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「512 柜台人员被排到大厅岗」', vs.some((v) => v.title.includes('艾丽娜') && v.rule.includes('512')))
}

console.log('\n=== 4. 休假当天仍被排班 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const zh = d.people.find((p) => p.name === '朱婕')!
  d.leaves.push({ id: 'l1', personId: zh.id, type: '年假', start: '2026-11-18', end: '2026-11-18' })
  const plan = planDay(d, '2026-11-18')
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  // 把朱婕硬塞进一号台（她当天本来就在一号台，改成放受理以示区别）
  const zIdx = slots.post_1.indexOf(zh.id)
  slots.post_1[zIdx] = null
  slots.post_2[0] = zh.id
  d.dayPlans['2026-11-18'] = slots
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「休假期间仍被排班」', vs.some((v) => v.title.includes('朱婕') && v.rule.includes('休假')))
}

console.log('\n=== 5. 在岗人数不足 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const plan = planDay(d, '2026-11-18')
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  // 清空受理与一号台 -> 在岗 6 人
  slots.post_1[0] = null
  slots.post_2[0] = null
  slots.post_2[1] = null
  d.dayPlans['2026-11-18'] = slots
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「在岗人数不足」', vs.some((v) => v.rule.includes('最少在岗')))
}

console.log('\n=== 6. 值班组长空缺 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  // 把三位大厅组长都设为停用
  for (const p of d.people) {
    if (p.name === '王玉花' || p.name === '杨娟' || p.name === '汪甜') p.active = false
  }
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「值班组长空缺」', vs.some((v) => v.rule.includes('组长')))
}

console.log('\n=== 7. 周六值班位次不足 8 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const sat = '2026-11-21'
  const plan = planDay(d, sat)
  console.log(`    周六在岗 ${plan.onDuty} / 位次 ${plan.capacity}`)
  check('周六位次为 8', plan.capacity === 8, `(${plan.capacity})`)
  const vs = checkRules(d, [sat])
  check('正常周六无 error', vs.filter((v) => v.level === 'error').length === 0)
}

console.log('\n=== 8. 同一人同一天两个岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const plan = planDay(d, '2026-11-18')
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  const first = slots.post_1[0]
  if (first) slots.post_2[0] = first
  d.dayPlans['2026-11-18'] = slots
  const vs = checkRules(d, ['2026-11-18'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「一人一天两个岗」', vs.some((v) => v.rule.includes('一人一天')))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) throw new Error(`${fail} 项断言未通过`)
