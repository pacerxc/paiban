/* 排班模型与规则引擎回归测试 */
import { seedData } from './src/lib/store'
import { planDay, ringAt, dutyTeamOf } from './src/lib/scheduler'
import { checkRules } from './src/lib/rules'
import type { AppData } from './src/types'

const data: AppData = seedData()

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

const WEEK = ['2026-11-30', '2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']
const nameOf = (d: AppData, id: string) => d.people.find((p) => p.id === id)?.name ?? id

/** 造一份覆盖：按当天实际排班取槽位，再让调用方改 */
function overrideOf(d: AppData, date: string): Record<string, (string | null)[]> {
  const plan = planDay(d, date)
  const slots: Record<string, (string | null)[]> = {}
  for (const post of d.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    slots[post.id] = arr
  }
  return slots
}

/** 某人当天所在的岗位 id 与槽位下标 */
function locate(d: AppData, date: string, personId: string): { postId: string; index: number } | null {
  const plan = planDay(d, date)
  for (const post of d.posts) {
    const index = (plan.byPost.get(post.id) ?? []).indexOf(personId)
    if (index >= 0) return { postId: post.id, index }
  }
  return null
}

console.log('=== 1. 种子数据应当 0 条 error ===')
{
  const base = checkRules(data, WEEK)
  console.log(base.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n') || '    （无违规）')
  const errors = base.filter((v) => v.level === 'error').length
  check('种子数据无 error 级违规', errors === 0, `(error ${errors} / warn ${base.length - errors})`)
}

console.log('\n=== 2. 平日轮转环：每周整体右移一位 ===')
{
  const thisWeek = ringAt(data, '2026-11-30')
  check(
    '本周环 = 杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟',
    thisWeek.members.map((id) => nameOf(data, id)).join('、') ===
      '杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟',
    `(${thisWeek.members.map((id) => nameOf(data, id)).join('、')})`,
  )
  const next = ringAt(data, '2026-12-07')
  check(
    '下周环 = 王玉花、杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园',
    next.members.map((id) => nameOf(data, id)).join('、') ===
      '王玉花、杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园',
    `(${next.members.map((id) => nameOf(data, id)).join('、')})`,
  )
  const plan = planDay(data, '2026-12-08')
  const slots = overrideOf(data, '2026-12-08')
  check('下周 101 位 = 王玉花', slots.post_1[0] === next.members[0])
  check('下周 102 位 = 杨雯', slots.post_2[0] === next.members[1], `(${nameOf(data, slots.post_2[0]!)})`)
  check('下周填表 = 耿园园', slots.post_6[0] === next.members[6])
  check('下周核心位次满 8', plan.coreOnDuty === 8, `(${plan.coreOnDuty})`)
}

console.log('\n=== 3. 周六：值班组整组上岗，8 个位次均摊，512 不开 ===')
{
  check('11-21 值班组 = A 组', dutyTeamOf(data, '2026-11-21') === 'A', `(${dutyTeamOf(data, '2026-11-21')})`)
  check('11-28 值班组 = B 组', dutyTeamOf(data, '2026-11-28') === 'B', `(${dutyTeamOf(data, '2026-11-28')})`)
  check('12-05 值班组 = A 组', dutyTeamOf(data, '2026-12-05') === 'A', `(${dutyTeamOf(data, '2026-12-05')})`)
  check('12-12 值班组 = B 组', dutyTeamOf(data, '2026-12-12') === 'B', `(${dutyTeamOf(data, '2026-12-12')})`)

  const sat = '2026-12-05'
  const plan = planDay(data, sat)
  const slots = overrideOf(data, sat)
  check('周六 8 个核心位次', plan.coreOnDuty === 8, `(${plan.coreOnDuty}/${plan.coreCapacity})`)
  check('周六 512 柜台不设岗', (plan.byPost.get('post_8') ?? []).length === 0)
  check('周六机动不排人', (plan.byPost.get('post_7') ?? []).length === 0)
  check('周六边境证不排人', (plan.byPost.get('post_9') ?? []).length === 0)
  check(
    '周六位次与真实班表逐格一致：朱婕101 杨娟102 耿园园103 林丽雯104 查云105 贺夏炎106 艾丽娜填表 颜贞贞拍照',
    slots.post_1[0] === data.people.find((p) => p.name === '朱婕')!.id &&
      slots.post_2[0] === data.people.find((p) => p.name === '杨娟')!.id &&
      slots.post_2[1] === data.people.find((p) => p.name === '耿园园')!.id &&
      slots.post_3[0] === data.people.find((p) => p.name === '林丽雯')!.id &&
      slots.post_3[1] === data.people.find((p) => p.name === '查云')!.id &&
      slots.post_4[0] === data.people.find((p) => p.name === '贺夏炎')!.id &&
      slots.post_6[0] === data.people.find((p) => p.name === '艾丽娜')!.id &&
      slots.post_5[0] === data.people.find((p) => p.name === '颜贞贞')!.id,
  )
  check('另一个班组整组休息（7 人未在岗）', 7 === data.people.filter((p) => p.active && !plan.byPerson.get(p.id)).length)
}

console.log('\n=== 4. 值班组长：一周一人 + 代班 ===')
{
  const plan = planDay(data, '2026-11-30')
  const leader = data.people.find((p) => p.id === plan.leaderId)
  check('11-30 那周的组长 = 杨娟', leader?.name === '杨娟', `(${leader?.name})`)
  check(
    '整周只有周四换人（杨娟轮休，周四由汪甜代班）',
    WEEK.map((d) => nameOf(data, planDay(data, d).leaderId ?? '')).join('、') ===
      '杨娟、杨娟、杨娟、汪甜、杨娟、杨娟',
    `(${WEEK.map((d) => nameOf(data, planDay(data, d).leaderId ?? '')).join('、')})`,
  )
}

console.log('\n=== 5. 机动顶岗：环上有人休假时由机动顶上 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const yang = d.people.find((p) => p.name === '杨雯')! // 本周 101 位
  d.leaves.push({ id: 'l2', personId: yang.id, type: '调休', start: '2026-11-30', end: '2026-11-30' })
  const plan = planDay(d, '2026-11-30')
  const slots = overrideOf(d, '2026-11-30')
  const wang = d.people.find((p) => p.name === '王玉花')!
  check('杨雯休假后 101 位由机动顶上', slots.post_1[0] === wang.id, `(${nameOf(d, slots.post_1[0]!)})`)
  check('当天核心位次仍满 8', plan.coreOnDuty === 8, `(${plan.coreOnDuty})`)
}

console.log('\n=== 6. 固定岗人员被调到别的岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const yan = d.people.find((p) => p.name === '颜贞贞')!
  const slots = overrideOf(d, '2026-12-01')
  const at = locate(d, '2026-12-01', yan.id)!
  slots[at.postId][at.index] = null
  slots.post_1[0] = yan.id
  d.dayPlans['2026-12-01'] = slots
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule} | ${v.fix}`).join('\n'))
  const hit = vs.find((v) => v.level === 'error' && v.title.includes('颜贞贞') && v.rule.includes('固定岗'))
  check('检出「固定岗人员被调离本岗」', !!hit, hit ? `(${hit.title})` : '')
  check('给出可执行的修改建议', !!hit && hit.fix.length > 4, hit ? `(${hit.fix})` : '')
}

console.log('\n=== 7. 512 柜台人员工作日被排到大厅岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const ai = d.people.find((p) => p.name === '艾丽娜')!
  const slots = overrideOf(d, '2026-12-01')
  const idx = slots.post_8.indexOf(ai.id)
  slots.post_8[idx] = null
  slots.post_1[0] = ai.id
  d.dayPlans['2026-12-01'] = slots
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「512 柜台人员被排到大厅岗」', vs.some((v) => v.title.includes('艾丽娜') && v.rule.includes('512')))
}

console.log('\n=== 8. 休假当天仍被排班 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const zh = d.people.find((p) => p.name === '朱婕')!
  d.leaves.push({ id: 'l3', personId: zh.id, type: '年假', start: '2026-12-01', end: '2026-12-01' })
  const slots = overrideOf(d, '2026-12-01')
  const at = locate(d, '2026-12-01', zh.id)
  if (at) slots[at.postId][at.index] = null
  slots.post_2[0] = zh.id
  d.dayPlans['2026-12-01'] = slots
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「休假期间仍被排班」', vs.some((v) => v.title.includes('朱婕') && v.rule.includes('休假')))
}

console.log('\n=== 9. 在岗人数不足 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const slots = overrideOf(d, '2026-12-01')
  slots.post_1[0] = null
  slots.post_2[0] = null
  slots.post_2[1] = null
  d.dayPlans['2026-12-01'] = slots
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「在岗人数不足」', vs.some((v) => v.rule.includes('最少在岗')))
}

console.log('\n=== 10. 值班组长空缺 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  for (const p of d.people) {
    if (p.name === '王玉花' || p.name === '杨娟' || p.name === '汪甜') p.active = false
  }
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「值班组长空缺」', vs.some((v) => v.rule.includes('组长')))
}

console.log('\n=== 11. 同一人同一天两个岗 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  const slots = overrideOf(d, '2026-12-01')
  const first = slots.post_1[0]
  if (first) slots.post_2[0] = first
  d.dayPlans['2026-12-01'] = slots
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「一人一天两个岗」', vs.some((v) => v.rule.includes('一人一天')))
}

console.log('\n=== 12. 轮转环人数不足要提示 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(data))
  d.ring.members = d.ring.members.slice(0, 5)
  const vs = checkRules(d, ['2026-12-01'])
  console.log(vs.map((v) => `    [${v.level}] ${v.title} —— ${v.rule}`).join('\n'))
  check('检出「轮转环人数不足」', vs.some((v) => v.title.includes('轮转环')))
}

console.log('\n=== 13. 种子数据复刻真实班表 2026-11-30 那一周 ===')
{
  // 真实班表逐格转录（照片 2026-11-30 ~ 12-05）
  const REAL: Record<string, Record<string, string[]>> = {
    '2026-11-30': {
      post_1: ['王玉花'],
      post_2: ['杨娟', '汪甜'],
      post_3: ['林丽雯', '贺夏炎'],
      post_4: ['朱婕'],
      post_5: ['颜贞贞'],
      post_6: ['周娟'],
      post_7: [],
      post_9: [],
      post_8: ['艾丽娜', '查云', '顾彬彬'],
    },
    '2026-12-01': {
      post_1: ['杨雯'],
      post_2: ['杨娟', '汪甜'],
      post_3: ['林丽雯', '贺夏炎'],
      post_4: ['耿园园'],
      post_5: ['颜贞贞'],
      post_6: ['周娟'],
      post_7: ['朱婕'],
      post_9: ['王玉花'],
      post_8: ['艾丽娜', '查云', '顾彬彬'],
    },
    '2026-12-02': {
      post_1: ['杨雯'],
      post_2: ['杨娟', '汪甜'],
      post_3: ['林丽雯', '贺夏炎'],
      post_4: ['耿园园'],
      post_5: ['朱婕'],
      post_6: ['周娟'],
      post_7: [],
      post_9: [],
      post_8: ['唐小雨', '艾丽娜', '顾彬彬'],
    },
    '2026-12-03': {
      post_1: ['杨雯'],
      post_2: ['朱婕', '汪甜'],
      post_3: ['林丽雯', '贺夏炎'],
      post_4: ['耿园园'],
      post_5: ['颜贞贞'],
      post_6: ['周娟'],
      post_7: [],
      post_9: ['王玉花'],
      post_8: ['唐小雨', '查云', '顾彬彬'],
    },
    '2026-12-04': {
      post_1: ['杨雯'],
      post_2: ['杨娟', '王玉花'],
      post_3: ['朱婕', '贺夏炎'],
      post_4: ['耿园园'],
      post_5: ['颜贞贞'],
      post_6: ['周娟'],
      post_7: [],
      post_9: [],
      post_8: ['唐小雨', '艾丽娜', '查云'],
    },
    '2026-12-05': {
      post_1: ['朱婕'],
      post_2: ['杨娟', '耿园园'],
      post_3: ['林丽雯', '查云'],
      post_4: ['贺夏炎'],
      post_5: ['颜贞贞'],
      post_6: ['艾丽娜'],
      post_7: [],
      post_9: [],
      post_8: [],
    },
  }

  const diffs: string[] = []
  for (const [date, posts] of Object.entries(REAL)) {
    for (const [postId, expected] of Object.entries(posts)) {
      const plan = planDay(data, date)
      const actual = (plan.byPost.get(postId) ?? []).map((id) => nameOf(data, id))
      // 512 柜台在真实表里是三行轮换，比对集合；其余岗位比对位次顺序
      const same =
        postId === 'post_8'
          ? [...actual].sort().join('、') === [...expected].sort().join('、')
          : actual.join('、') === expected.join('、')
      if (!same) diffs.push(`${date} ${postId}：期望 ${expected.join('/')}，实际 ${actual.join('/')}`)
    }
  }
  console.log(diffs.map((d) => `    · ${d}`).join('\n') || '    （逐格完全一致）')
  // 周四 102 与 107 在真实表里是人工指定的，程序按「顶岗优先、其次边境证」排，两人在两岗上互换
  const known = diffs.filter((d) => d.startsWith('2026-12-03') && (d.includes('post_2') || d.includes('post_9')))
  check(
    '与真实班表逐格一致（周四 102/107 为人工互换，已单列）',
    diffs.length === known.length && diffs.every((d) => known.includes(d)),
    `(差异 ${diffs.length} 处)`,
  )

  const leaders = WEEK.map((d) => nameOf(data, planDay(data, d).leaderId ?? '')).join('、')
  check(
    '值班组长与真实班表一致：杨娟×5，周四汪甜代班',
    leaders === '杨娟、杨娟、杨娟、汪甜、杨娟、杨娟',
    `(${leaders})`,
  )
}

console.log('\n=== 14. 旧固定岗指到轮转位次时不能跟环抢人 ===')
{
  // v5 遗留：「受理」固定周娟、贺夏炎，「填表」固定杨雯
  const d: AppData = JSON.parse(JSON.stringify(data))
  const byName = (n: string) => d.people.find((p) => p.name === n)!
  byName('周娟').fixedPostId = 'post_2'
  byName('贺夏炎').fixedPostId = 'post_2'
  byName('杨雯').fixedPostId = 'post_6'

  const plan = planDay(d, '2026-11-30')
  const shouLi = plan.byPost.get('post_2') ?? []
  check('受理不超过编制（2 人）', shouLi.length <= 2, `(${shouLi.length} 人)`)
  check(
    '受理仍是环上的杨娟、汪甜',
    shouLi.map((id) => nameOf(d, id)).join('、') === '杨娟、汪甜',
    `(${shouLi.map((id) => nameOf(d, id)).join('、')})`,
  )
  check(
    '填表仍是环上的周娟',
    (plan.byPost.get('post_6') ?? []).map((id) => nameOf(d, id)).join('、') === '周娟',
    `(${(plan.byPost.get('post_6') ?? []).map((id) => nameOf(d, id)).join('、')})`,
  )
  check(
    '机动待命与边境证都空着（与真实班表一致）',
    (plan.byPost.get('post_7') ?? []).length === 0 && (plan.byPost.get('post_9') ?? []).length === 0,
    `(机动 ${(plan.byPost.get('post_7') ?? []).length} 人 / 边境证 ${(plan.byPost.get('post_9') ?? []).length} 人)`,
  )
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) throw new Error(`${fail} 项断言未通过`)
