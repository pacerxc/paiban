/** 人员池：main = 大厅主班池；counter = 512 柜台常驻（工作日在 512，周六随值班组进大厅） */
export type Pool = 'main' | 'counter'

/** 值班班组：A / B，隔周交替承担周六及法定假日值班 */
export type TeamId = 'A' | 'B'

export interface Team {
  id: TeamId
  name: string
  /** 组内成员 id，顺序即轮转顺序 / B 组向 A 组借人的顺序 */
  memberIds: string[]
}

/** 组长管辖范围：hall = 除 512 外所有岗位；counter = 只管 512 */
export type LeaderScope = 'hall' | 'counter'

export interface Person {
  id: string
  name: string
  /** 轮转顺序，从 1 开始 */
  order: number
  pool: Pool
  /** 值班班组；不在任何组为 null */
  teamId: TeamId | null
  /** 是否在组长池（可担任值班组长） */
  canLead: boolean
  /** 组长管辖范围；非组长为 undefined */
  leaderScope?: LeaderScope
  /** 组长候选顺序，从 1 开始；一周一人按周轮值，当天不在岗时由下一位代班 */
  leaderOrder?: number
  /** null 表示可以上全部岗位，否则只允许数组内的岗位 */
  allowedPostIds: string[] | null
  /** 固定岗位：只排这一个岗，缺岗时由机动顶上（真实班表里只有「拍照」是固定岗） */
  fixedPostId: string | null
  /** 每周固定轮休日：0 = 周一 … 4 = 周五；null = 不轮休 */
  restWeekday?: number | null
  active: boolean
  note?: string
}

/**
 * 浮动岗的位次计算方式：
 * - leftover：位次取「剩余可用人数」（机动岗，吸收机动池里多出来的人）
 * - available：位次取「该岗可用人数」（512 柜台、边境证，有人休假就少人）
 */
export type FlexMode = 'leftover' | 'available'

export interface Post {
  id: string
  name: string
  /** 工作日编制 */
  capacity: number
  /** 周六 / 法定调休上班日编制 */
  saturdayCapacity: number
  color: string
  /** 独立岗：单独成块，不计入大厅在岗人数（512 柜台） */
  separate?: boolean
  /** 浮动岗：位次数按当天实际情况计算 */
  flexMode?: FlexMode
  /** 参与平日轮转环：按岗位顺序展开 capacity 个位次，环成员每周整体右移一位 */
  ringSlot?: boolean
  /** 非核心位次：不计入「每日最少在岗」的基数（边境证） */
  optional?: boolean
  /** 真实表格里的行标签，例：「101（复印）」 */
  hint?: string
  /** 每个位次在真实表格里的标签，例：受理岗 = ['102（受理）', '103（受理）'] */
  slotHints?: string[]
}

/**
 * 平日轮转环。
 *
 * 真实班表的轮转规律：7 个位次（101 → 102 → 103 → 104 → 105 → 106 → 填表）
 * 每周整体右移一位；101 位是入口，由机动/候补池的队首补入；填表位是出口，
 * 当周在填表的人离环回到池尾。
 *
 * `members` 的顺序即位次顺序（members[0] 站 101 位，members[6] 站填表位）。
 */
export interface RingState {
  /** 锚点周（周一）：该周的环状态是基准，往前后按周推进 */
  anchorDate: string
  /** 环成员（有序，7 人） */
  members: string[]
  /** 机动/候补池（有序）：队首优先补进 101 位，出环的人回到队尾 */
  standby: string[]
}

export type LeaveType = '调休' | '补休' | '年假' | '病假' | '事假' | '其他'

export interface LeaveRecord {
  id: string
  personId: string
  type: LeaveType
  start: string
  end: string
  note?: string
  /** 若该休假在台账中自动扣减，记录关联的台账条目 id */
  ledgerId?: string
}

/** 台账来源：值班自动 +1 / 休假自动 −N / 手动调整 */
export type LedgerSource = 'duty' | 'leave' | 'manual'

export interface LedgerEntry {
  id: string
  personId: string
  date: string
  /** 正数为增加额度，负数为使用/扣减 */
  days: number
  reason: string
  source: LedgerSource
  /** 由系统自动生成 */
  auto?: boolean
}

/** 单日状态：上班 / 放假（未设置时按周一至周六上班、周日休息） */
export type DayState = 'work' | 'off'

export interface AppData {
  version: number
  settings: {
    orgName: string
    /** 轮转起始周（周一）：值班组交替与组长轮值都以它为相位零点 */
    startDate: string
    /** 每人每月休息目标天数 */
    restQuotaDays: number
    /** 每日最少在岗人数（不含 512 柜台、机动岗与边境证） */
    minDailyHeadcount: number
    /** 第一个周六值班组：A / B，之后隔周交替 */
    firstTeam: TeamId
  }
  people: Person[]
  posts: Post[]
  teams: Team[]
  /** 平日轮转环：7 个位次每周整体右移一位 */
  ring: RingState
  /** 节假日等单日状态覆盖：日期 -> 上班 / 放假 */
  days: Record<string, DayState>
  /** 逐日岗位安排覆盖：日期 -> 岗位id -> 位次槽位（人员id 或 null 表示空缺） */
  dayPlans: Record<string, Record<string, (string | null)[]>>
  /** 逐日值班组长（大厅）：日期 -> 人员id；缺省时按组长池轮值 */
  dayLeaders: Record<string, string>
  leaves: LeaveRecord[]
  ledger: LedgerEntry[]
}
