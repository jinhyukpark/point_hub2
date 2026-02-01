/**
 * 한국 시간(KST, UTC+9) 관련 유틸리티 함수
 */

/**
 * UTC 타임스탬프를 한국 시간으로 변환
 * @param timestamp UTC 타임스탬프 (밀리초)
 * @returns 한국 시간 Date 객체
 */
export function toKST(timestamp: number): Date {
  const date = new Date(timestamp);
  // UTC 시간에 9시간 추가
  const kstOffset = 9 * 60 * 60 * 1000;
  return new Date(date.getTime() + kstOffset);
}

/**
 * 현재 시간을 한국 시간으로 반환
 * @returns 한국 시간 Date 객체
 */
export function nowKST(): Date {
  return toKST(Date.now());
}

/**
 * 타임스탬프를 한국 시간 문자열로 변환 (YYYY-MM-DD HH:mm:ss 형식)
 * @param timestamp UTC 타임스탬프 (밀리초)
 * @returns 한국 시간 문자열
 */
export function formatKST(timestamp: number): string {
  const kstDate = toKST(timestamp);
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getUTCDate()).padStart(2, '0');
  const hours = String(kstDate.getUTCHours()).padStart(2, '0');
  const minutes = String(kstDate.getUTCMinutes()).padStart(2, '0');
  const seconds = String(kstDate.getUTCSeconds()).padStart(2, '0');
  
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

/**
 * 한국 시간 기준으로 오늘 날짜 (YYYY-MM-DD) 반환
 * @returns 오늘 날짜 문자열
 */
export function todayKST(): string {
  const kstDate = nowKST();
  const year = kstDate.getUTCFullYear();
  const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(kstDate.getUTCDate()).padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

