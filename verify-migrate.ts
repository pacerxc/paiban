/* 手工覆盖完整性自检（临时产物，验证后删除） */
import { migrate, normalize, seedData } from './src/lib/store'
import { planDay } from './src/lib/scheduler'
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
  d.settings.startDate = '2026-11-23'
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
  d.settings.startDate = '2026-11-23'
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
  check('迁移后版本为 5', out.version === 5, `(${out.version})`)
  check('迁移后不残留 v3 的手工覆盖', Object.keys(out.dayPlans).length === 0, `(${Object.keys(out.dayPlans).join(',')})`)
  check('迁移后补齐平日轮转顺序', out.weekdayOrder.length === 7, `(${out.weekdayOrder.length})`)
  const plan = planDay(out, '2026-11-16')
  check('迁移后 512 柜台正常有人', plan.byPerson.get(ai.id) === 'post_8')
  check('迁移后核心位次满 8', plan.coreOnDuty === 8, `(${plan.coreOnDuty})`)
}

console.log('\n=== 4. 平日轮转顺序：v5 默认值与 v4 推导一致 ===')
{
  const d = seedData()
  check(
    '平日轮转顺序 = 杨娟、朱婕、林丽雯、耿园园、王玉花、汪甜、陈静静',
    d.weekdayOrder
      .map((id) => d.people.find((p) => p.id === id)?.name)
      .join('、') === '杨娟、朱婕、林丽雯、耿园园、王玉花、汪甜、陈静静',
    `(${d.weekdayOrder.map((id) => d.people.find((p) => p.id === id)?.name).join('、')})`,
  )
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
if (fail > 0) throw new Error(`${fail} 项断言未通过`)
