/**
 * 内置法定节假日
 *
 * 依据：
 * - 2026 年：国务院办公厅关于 2026 年部分节假日安排的通知（国办发明电〔2025〕7 号，2025-11-04）
 *   https://www.gov.cn/zhengce/content/202511/content_7047090.htm
 * - 2027 年：国务院办公厅关于 2027 年部分节假日安排的通知（2026-11-05）
 *   https://www.news.cn/politics/20261105/69adf4f2f2db490c9fc518874a24d602/c.html
 *
 * 覆盖范围：2026-01-01 ~ 2027-12-31。超出范围返回 null，按「周一至周六上班、周日休息」处理。
 */

export type HolidayState = 'work' | 'off'

interface HolidayRange {
  name: string
  from: string
  to: string
}

/** 放假日（整段放假） */
const OFF_RANGES: HolidayRange[] = [
  // 2026
  { name: '元旦', from: '2026-01-01', to: '2026-01-03' },
  { name: '春节', from: '2026-02-15', to: '2026-02-23' },
  { name: '清明节', from: '2026-04-04', to: '2026-04-06' },
  { name: '劳动节', from: '2026-05-01', to: '2026-05-05' },
  { name: '端午节', from: '2026-06-19', to: '2026-06-21' },
  { name: '中秋节', from: '2026-09-25', to: '2026-09-27' },
  { name: '国庆节', from: '2026-10-01', to: '2026-10-07' },
  // 2027
  { name: '元旦', from: '2027-01-01', to: '2027-01-03' },
  { name: '春节', from: '2027-02-05', to: '2027-02-13' },
  { name: '清明节', from: '2027-04-03', to: '2027-04-05' },
  { name: '劳动节', from: '2027-05-01', to: '2027-05-05' },
  { name: '端午节', from: '2027-06-09', to: '2027-06-09' },
  { name: '中秋节', from: '2027-09-15', to: '2027-09-15' },
  { name: '国庆节', from: '2027-10-01', to: '2027-10-07' },
]

/** 调休上班日（原本是周日，但法定要上班） */
const WORK_DATES: Array<{ name: string; date: string }> = [
  { name: '元旦调休', date: '2026-01-04' },
  { name: '春节调休', date: '2026-02-14' },
  { name: '春节调休', date: '2026-02-28' },
  { name: '劳动节调休', date: '2026-05-09' },
  { name: '国庆节调休', date: '2026-09-20' },
  { name: '国庆节调休', date: '2026-10-10' },
  { name: '春节调休', date: '2027-01-31' },
  { name: '春节调休', date: '2027-02-14' },
  { name: '劳动节调休', date: '2027-05-08' },
  { name: '国庆节调休', date: '2027-09-26' },
  { name: '国庆节调休', date: '2027-10-09' },
]

export const HOLIDAY_RANGE = { from: '2026-01-01', to: '2027-12-31' }

/**
 * 查询某天的法定状态
 * @returns 'off' 放假 / 'work' 调休上班 / null 无特殊安排
 */
export function holidayState(date: string): HolidayState | null {
  if (date < HOLIDAY_RANGE.from || date > HOLIDAY_RANGE.to) return null
  for (const range of OFF_RANGES) {
    if (date >= range.from && date <= range.to) return 'off'
  }
  for (const item of WORK_DATES) {
    if (item.date === date) return 'work'
  }
  return null
}

/** 某天所属的节假日名称 */
export function holidayName(date: string): string | null {
  for (const range of OFF_RANGES) {
    if (date >= range.from && date <= range.to) return range.name
  }
  for (const item of WORK_DATES) {
    if (item.date === date) return item.name
  }
  return null
}

/** 内置日历范围内的放假日清单（用于设置页展示） */
export function holidayList(): HolidayRange[] {
  return OFF_RANGES.map((r) => ({ ...r }))
}

/** 内置日历范围内的调休上班日清单 */
export function workDateList(): Array<{ name: string; date: string }> {
  return WORK_DATES.map((d) => ({ ...d }))
}
