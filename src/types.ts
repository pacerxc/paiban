/** 人员池：主班（进大厅班表）/ 支援（周末支援组，日常在 512 柜台，不进本班表） */
export type Pool = 'main' | 'support'

/** 支援组分组：甲组 / 乙组，隔周轮换 */
export type CrewId = 'A' | 'B'

export interface Crew {
  id: CrewId
  name: string
}

export interface Person {
  id: string
  name: string
  /** 轮转顺序，从 1 开始 */
  order: number
  pool: Pool
  /** 支援组分组；主班为 null */
  crew: CrewId | null
  /** 是否在组长池（可担任值班组长） */
  canLead: boolean
  /** null 表示可以上全部岗位，否则只允许数组内的岗位 */
  allowedPostIds: string[] | null
  /** 固定岗位：只排这一个岗，休息时由组内其他人替补 */
  fixedPostId: string | null
  active: boolean
  note?: string
}

export interface Post {
  id: string
  name: string
  /** 工作日编制 */
  capacity: number
  /** 周六编制；与 capacity 相同时可同值 */
  saturdayCapacity: number
  color: string
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
    /** 每日最少在岗人数 */
    minDailyHeadcount: number
    /** 周六支援组顶岗人数 */
    supportSlots: number
    /** 支援组甲乙隔周轮换 */
    crewAlternate: boolean
  }
  people: Person[]
  posts: Post[]
  crews: Crew[]
  /** 节假日等单日状态覆盖：日期 -> 上班 / 放假 */
  days: Record<string, DayState>
  /** 逐日岗位安排覆盖：日期 -> 岗位id -> 位次槽位（人员id 或 null 表示空缺） */
  dayPlans: Record<string, Record<string, (string | null)[]>>
  /** 逐日值班组长：日期 -> 人员id；缺省时按组长池轮值 */
  dayLeaders: Record<string, string>
  leaves: LeaveRecord[]
  ledger: LedgerEntry[]
}
