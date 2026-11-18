export interface Person {
  id: string
  name: string
  /** 轮转顺序，从 1 开始 */
  order: number
  /** null 表示可以上全部岗位，否则只允许数组内的岗位 */
  allowedPostIds: string[] | null
  active: boolean
  note?: string
}

export interface Post {
  id: string
  name: string
  /** 该岗位固定需求人数 */
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

export interface WeekPlan {
  weekStart: string
  /** 手动指定的岗位：personId -> postId */
  manual: Record<string, string>
}

export interface AppData {
  version: number
  settings: {
    orgName: string
    /** 轮转起始周（周一） */
    startDate: string
  }
  people: Person[]
  posts: Post[]
  leaves: LeaveRecord[]
  ledger: LedgerEntry[]
  weeks: Record<string, WeekPlan>
}
