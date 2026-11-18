export interface Person {
  id: string
  name: string
  /** 轮转顺序，从 1 开始 */
  order: number
  /** null 表示可以上全部岗位，否则只允许数组内的岗位 */
  allowedPostIds: string[] | null
  /** 只排周六（周六专属人员） */
  saturdayOnly: boolean
  /** 固定岗位：只排这一个岗，休息时由组内其他人替补 */
  fixedPostId: string | null
  active: boolean
  note?: string
}

export interface Post {
  id: string
  name: string
  /** 该岗位每天固定需求人数 */
  capacity: number
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

export interface LedgerEntry {
  id: string
  personId: string
  date: string
  /** 正数为增加额度，负数为使用/扣减 */
  days: number
  reason: string
  /** 由休假记录自动生成 */
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
  }
  people: Person[]
  posts: Post[]
  /** 节假日等单日状态覆盖：日期 -> 上班 / 放假 */
  days: Record<string, DayState>
  /** 逐日岗位调整：`日期|人员id` -> 岗位id，空字符串表示当天不排 */
  dayPosts: Record<string, string>
  leaves: LeaveRecord[]
  ledger: LedgerEntry[]
}
