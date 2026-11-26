/* v5 → v6 迁移与数据自愈回归测试 */
import { migrate, normalize, seedData, defaultRing } from './src/lib/store'
import { planDay, ringAt } from './src/lib/scheduler'
import type { AppData } from './src/types'

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

const seed = seedData()
const ai = seed.people.find((p) => p.name === '艾丽娜')!
const nameOf = (data: AppData, id: string) => data.people.find((p) => p.id === id)?.name ?? id

/** 造一份完整的覆盖：所有岗位都有槽位 */
function completeOverride(data: AppData, date: string): Record<string, (string | null)[]> {
  const plan = planDay(data, date)
  const out: Record<string, (string | null)[]> = {}
  for (const post of data.posts) {
    const cap = plan.slotCount.get(post.id) ?? 0
    const arr: (string | null)[] = [...(plan.byPost.get(post.id) ?? [])]
    while (arr.length < cap) arr.push(null)
    out[post.id] = arr
  }
  return out
}

console.log('=== 1. 完整覆盖必须保留 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(seed))
  const full = completeOverride(d, '2026-11-25')
  const raw = JSON.parse(JSON.stringify(d))
  raw.dayPlans = { '2026-11-25': full }
  const out = normalize(raw)
  check('完整覆盖被保留', !!out.dayPlans['2026-11-25'])
  check('保留后该天仍能正常排班', planDay(out, '2026-11-25').byPerson.get(ai.id) === 'post_8')
}

console.log('\n=== 2. 残缺覆盖（缺 512 / 扫描）必须丢弃 ===')
{
  const d: AppData = JSON.parse(JSON.stringify(seed))
  const full = completeOverride(d, '2026-11-25')
  delete full.post_8
  delete full.post_4
  const raw = JSON.parse(JSON.stringify(d))
  raw.dayPlans = { '2026-11-25': full }
  const out = normalize(raw)
  check('残缺覆盖被丢弃', !out.dayPlans['2026-11-25'])
  check('当天回到自动排班，512 柜台有人', planDay(out, '2026-11-25').byPerson.get(ai.id) === 'post_8')
  check('当天核心位次满 8', planDay(out, '2026-11-25').coreOnDuty === 8, `(${planDay(out, '2026-11-25').coreOnDuty})`)
}

console.log('\n=== 3. v3 数据迁移后不留残缺覆盖 ===')
{
  const v3 = {
    version: 3,
    settings: { orgName: '综合班组', startDate: '2026-11-16' },
    people: seed.people.map((p) => ({
      id: p.id,
      name: p.name,
      order: p.order,
      pool: p.pool === 'counter' ? 'support' : 'main',
      canLead: p.canLead,
      allowedPostIds: [],
      fixedPostId: p.fixedPostId,
      active: p.active,
    })),
    posts: seed.posts.map((p) => ({
      id: p.id,
      name: p.name,
      capacity: p.capacity,
      saturdayCapacity: p.saturdayCapacity,
    })),
    crews: [
      { id: 'A', name: '甲组' },
      { id: 'B', name: '乙组' },
    ],
    days: {},
    // v3 的旧岗位模型：6 个岗位，没有 扫描、没有 512
    dayPlans: {
      '2026-11-16': {
        post_1: [seed.people.find((p) => p.name === '杨娟')!.id],
        post_2: [
          seed.people.find((p) => p.name === '周娟')!.id,
          seed.people.find((p) => p.name === '贺夏炎')!.id,
        ],
        post_3: [
          seed.people.find((p) => p.name === '汪甜')!.id,
          seed.people.find((p) => p.name === '耿园园')!.id,
        ],
        post_4: [seed.people.find((p) => p.name === '颜贞贞')!.id],
        post_5: [seed.people.find((p) => p.name === '杨雯')!.id],
        post_6: [seed.people.find((p) => p.name === '朱婕')!.id],
      },
    },
    leaves: [],
    ledger: [],
  }
  const out = migrate(v3)
  check('迁移后版本为 6', out.version === 6, `(${out.version})`)
  check('迁移后不残留 v3 的手工覆盖', Object.keys(out.dayPlans).length === 0, `(${Object.keys(out.dayPlans).join(',')})`)
  check('迁移后补齐 7 人轮转环', out.ring.members.length === 7, `(${out.ring.members.length})`)
  const plan = planDay(out, '2026-11-16')
  check('迁移后 512 柜台正常有人', plan.byPerson.get(ai.id) === 'post_8')
  check('迁移后核心位次满 8', plan.coreOnDuty === 8, `(${plan.coreOnDuty})`)
}

console.log('\n=== 4. v5 数据迁移：值班组起点、轮转环、周六编制 ===')
{
  const v5: any = JSON.parse(JSON.stringify(seed))
  v5.version = 5
  v5.settings.firstTeam = 'A'
  v5.weekdayOrder = seed.people
    .filter((p) => p.pool === 'main' && !p.fixedPostId)
    .map((p) => p.id)
  delete v5.ring
  // v5 的岗位表没有「边境证」，周六编制也是旧的一号台2/受理3/填表2
  v5.posts = v5.posts.filter((p: any) => p.id !== 'post_9')
  for (const p of v5.posts) {
    if (p.id === 'post_1') p.saturdayCapacity = 2
    if (p.id === 'post_2') p.saturdayCapacity = 3
    if (p.id === 'post_3') p.saturdayCapacity = 0
    if (p.id === 'post_4') p.saturdayCapacity = 0
    if (p.id === 'post_6') p.saturdayCapacity = 2
  }
  const out = migrate(v5)
  check('迁移后版本为 6', out.version === 6, `(${out.version})`)
  check('周六值班组起点改为 B', out.settings.firstTeam === 'B', `(${out.settings.firstTeam})`)
  check('补齐「边境证」岗位', out.posts.some((p) => p.id === 'post_9'))
  check('周六编制回到 8 个位次均摊', out.posts.reduce((s, p) => s + (p.separate ? 0 : p.saturdayCapacity), 0) === 8)
  check('补齐 7 人轮转环', out.ring.members.length === 7, `(${out.ring.members.length})`)
  check(
    '轮转环 = 真实 11-30 基准搭配',
    out.ring.members.map((id) => nameOf(out, id)).join('、') ===
      '杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟',
    `(${out.ring.members.map((id) => nameOf(out, id)).join('、')})`,
  )
  check(
    '机动池 = 王玉花、朱婕、陈静静',
    out.ring.standby.map((id) => nameOf(out, id)).join('、') === '王玉花、朱婕、陈静静',
    `(${out.ring.standby.map((id) => nameOf(out, id)).join('、')})`,
  )
}

console.log('\n=== 5. 默认轮转环与推进规则 ===')
{
  const d = seedData()
  check(
    '默认轮转环 = 杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟',
    d.ring.members.map((id) => nameOf(d, id)).join('、') ===
      '杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟',
    `(${d.ring.members.map((id) => nameOf(d, id)).join('、')})`,
  )
  check('锚点周 = 2026-11-30', d.ring.anchorDate === '2026-11-30', `(${d.ring.anchorDate})`)

  // 往后一周：整体右移一位，101 位由机动池队首补入，填表位的人离环
  const next = ringAt(d, '2026-12-07')
  check(
    '下周环 = 王玉花、杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园',
    next.members.map((id) => nameOf(d, id)).join('、') ===
      '王玉花、杨雯、杨娟、汪甜、林丽雯、贺夏炎、耿园园',
    `(${next.members.map((id) => nameOf(d, id)).join('、')})`,
  )
  check(
    '周娟离环、回到机动池尾',
    next.standby.map((id) => nameOf(d, id)).join('、') === '朱婕、陈静静、周娟',
    `(${next.standby.map((id) => nameOf(d, id)).join('、')})`,
  )

  // 往前一周：右移的逆操作
  const prev = ringAt(d, '2026-11-23')
  check(
    '上周环 = 杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟、陈静静',
    prev.members.map((id) => nameOf(d, id)).join('、') ===
      '杨娟、汪甜、林丽雯、贺夏炎、耿园园、周娟、陈静静',
    `(${prev.members.map((id) => nameOf(d, id)).join('、')})`,
  )
  check(
    '上周机动池 = 杨雯、王玉花、朱婕',
    prev.standby.map((id) => nameOf(d, id)).join('、') === '杨雯、王玉花、朱婕',
    `(${prev.standby.map((id) => nameOf(d, id)).join('、')})`,
  )
}

console.log('\n=== 6. 自愈：环里的人被删掉后自动补齐 ===')
{
  const d = seedData()
  const victim = d.ring.members[0]
  d.people = d.people.filter((p) => p.id !== victim)
  const out = normalize(d)
  check('环位仍然补到 7 人', out.ring.members.length === 7, `(${out.ring.members.length})`)
  check('被删的人不再出现在环或池里', !out.ring.members.includes(victim) && !out.ring.standby.includes(victim))
}

console.log('\n=== 7. 名单清空后重新录入 ===')
{
  const d = seedData()
  const blank = { ...d, people: [] }
  const out = normalize(blank)
  check('清空名单不报错，环为空', out.ring.members.length === 0)
  check('默认轮转环对空名单也安全', defaultRing([]).members.length === 0)
}

console.log('\n=== 8. v5 遗留数据：旧固定岗 / 轮休日 / 起始日 / 组序 / 年假 ===')
{
  // 造一份「真实用户从 v5 升上来」的数据：旧固定岗、无轮休日、起始日错位、组序是旧名单序
  const v5: any = JSON.parse(JSON.stringify(seed))
  v5.version = 5
  v5.settings.startDate = '2026-11-16'
  v5.settings.firstTeam = 'A'
  const idOf = (n: string) => v5.people.find((p: any) => p.name === n).id
  for (const p of v5.people) {
    p.fixedPostId = null
    p.restWeekday = null
  }
  v5.people.find((p: any) => p.name === '周娟').fixedPostId = 'post_2'
  v5.people.find((p: any) => p.name === '贺夏炎').fixedPostId = 'post_2'
  v5.people.find((p: any) => p.name === '杨雯').fixedPostId = 'post_6'
  v5.people.find((p: any) => p.name === '颜贞贞').fixedPostId = 'post_5'
  v5.teams = [
    {
      id: 'A',
      name: 'A组',
      memberIds: ['杨娟', '朱婕', '颜贞贞', '林丽雯', '耿园园', '贺夏炎', '艾丽娜', '查云'].map(idOf),
    },
    {
      id: 'B',
      name: 'B组',
      memberIds: ['王玉花', '杨雯', '汪甜', '周娟', '陈静静', '顾彬彬', '唐小雨'].map(idOf),
    },
  ]
  v5.leaves = []

  const out = migrate(v5)
  check(
    '旧固定岗被清掉（受理不再有人固定）',
    out.people.every((p) => p.fixedPostId === null || p.fixedPostId === 'post_5'),
  )
  check(
    '拍照固定岗保留给颜贞贞',
    out.people.filter((p) => p.fixedPostId === 'post_5').map((p) => p.name).join('、') === '颜贞贞',
  )
  check(
    '轮休日按真实调休还原',
    out.people.find((p) => p.name === '杨雯')?.restWeekday === 0 &&
      out.people.find((p) => p.name === '杨娟')?.restWeekday === 3 &&
      out.people.find((p) => p.name === '林丽雯')?.restWeekday === 4,
  )
  check('排班起始日对齐 2026-11-23', out.settings.startDate === '2026-11-23', `(${out.settings.startDate})`)
  check(
    'A 组组内顺序 = 周六位次顺序',
    out.teams
      .find((t) => t.id === 'A')!
      .memberIds.map((id) => nameOf(out, id))
      .join('、') === '朱婕、杨娟、耿园园、林丽雯、查云、贺夏炎、艾丽娜、颜贞贞',
    `(${out.teams.find((t) => t.id === 'A')!.memberIds.map((id) => nameOf(out, id)).join('、')})`,
  )
  check('真实年假补进休假登记', out.leaves.length === 5, `(${out.leaves.length})`)

  // 关键回归：受理不再被塞成 4 个人
  const shouLi = out.posts.find((p) => p.id === 'post_2')!
  const monday = planDay(out, '2026-11-30')
  const n = monday.byPost.get('post_2')?.length ?? 0
  check('受理不再超编', n <= shouLi.capacity, `(${n} 人 / 编制 ${shouLi.capacity})`)

  // 迁移后仍与真实班表逐格一致
  const real: Record<string, string[]> = {
    post_1: ['王玉花'],
    post_2: ['杨娟', '汪甜'],
    post_3: ['林丽雯', '贺夏炎'],
    post_4: ['朱婕'],
    post_6: ['周娟'],
    post_5: ['颜贞贞'],
  }
  const diffs: string[] = []
  for (const [postId, expected] of Object.entries(real)) {
    const actual = (monday.byPost.get(postId) ?? []).map((id) => nameOf(out, id))
    if (actual.join('、') !== expected.join('、')) {
      diffs.push(`${postId} 期望 ${expected.join('、')} 实际 ${actual.join('、')}`)
    }
  }
  check('迁移后 11-30 周一与真实班表逐格一致', diffs.length === 0, diffs.join(' | '))
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) throw new Error(`${fail} 项断言未通过`)
