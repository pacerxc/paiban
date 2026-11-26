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
  /** 组长轮值顺序，从 1 开始；大厅组长按 王玉花 → 杨娟 → 汪甜 逐日轮 */
  leaderOrder?: number
  /** null 表示可以上全部岗位，否则只允许数组内的岗位 */
  allowedPostIds: string[] | null
  /** 固定岗位：只排这一个岗，休息时由机动岗顶上 */
  fixedPostId: string | null
  active: boolean
  note?: string
}

/**
 * 浮动岗的位次计算方式：
 * - leftover：位次取「剩余可用人数」（机动岗，吸收轮转池里多出来的人）
 * - available：位次取「该岗可用人数」（512 柜台，有人休假就少人）
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
    /** 轮转起始周（周一） */
    startDate: string
    /** 每人每月休息目标天数 */
    restQuotaDays: number
    /** 每日最少在岗人数（不含 512 柜台） */
    minDailyHeadcount: number
    /** 第一个周六值班组：A / B，之后隔周交替 */
    firstTeam: TeamId
  }
  people: Person[]
  posts: Post[]
  teams: Team[]
  /** 节假日等单日状态覆盖：日期 -> 上班 / 放假 */
  days: Record<string, DayState>
  /** 逐日岗位安排覆盖：日期 -> 岗位id -> 位次槽位（人员id 或 null 表示空缺） */
  dayPlans: Record<string, Record<string, (string | null)[]>>
  /** 逐日值班组长（大厅）：日期 -> 人员id；缺省时按组长池轮值 */
  dayLeaders: Record<string, string>
  leaves: LeaveRecord[]
  ledger: LedgerEntry[]
}
