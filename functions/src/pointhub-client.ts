/**
 * PointHub External API Client
 *
 * 외부 PointHub API를 호출하는 클라이언트
 * Base URL: https://www.point-hub.cloud/api
 * 인증: HMAC-SHA256 서명
 */

import * as crypto from 'crypto';

// 환경 변수에서 설정 로드
const config = {
  baseUrl: process.env.POINTHUB_BASE_URL || 'https://www.point-hub.cloud/api',
  apiKey: process.env.POINTHUB_API_KEY || '',
  secretKey: process.env.POINTHUB_SECRET_KEY || '',
  comCode: process.env.POINTHUB_COM_CODE || '',
  memberPrefix: process.env.POINTHUB_MEMBER_PREFIX || 'EN'
};

// ============================================
// 타입 정의
// ============================================

// 실제 PointHub API 응답 형식
export interface PointHubApiResponse<T = unknown> {
  result: string;        // "0000" = 성공, 그 외 = 에러코드 (예: "8001")
  resultMsg: string;     // "success" 또는 에러 메시지
  data: T | '' | T[];    // 성공 시 배열, 실패 시 빈 문자열
}

// 내부 사용 표준화된 응답 형식
export interface PointHubResponse<T = unknown> {
  success: boolean;
  code: string;
  message: string;
  data?: T;
}

export interface MemberCheckData {
  mbid: string;
  mbid2: string | number;
}

export interface BalanceData {
  mbid: string;
  mbid2: number;
  balance: number;
  currency: string;
  timestamp: number;
}

export interface TransferData {
  mbid: string;
  mbid2: number;
  amount: number;
  currency: string;
  transactionId: string;
  newBalance: number;
  timestamp: number;
}

export interface WithdrawData {
  mbid: string;
  mbid2: number;
  amount: number;
  currency: string;
  transactionId: string;
  newBalance: number;
  timestamp: number;
}

// ============================================
// 서명 생성
// ============================================

/**
 * HMAC-SHA256 서명 생성
 * @param apiKey API 키
 * @param timestamp Unix 타임스탬프
 * @param secretKey 시크릿 키
 * @returns 서명 문자열
 */
function generateSignature(apiKey: string, timestamp: number, secretKey: string): string {
  const message = `${apiKey}${timestamp}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

// ============================================
// HTTP 요청 헬퍼
// ============================================

interface RequestParams {
  mbid?: string;
  mbid2?: number;
  amount?: number;
  memo?: string;
  [key: string]: unknown;
}

/**
 * PointHub API 호출
 */
async function callPointHubApi<T>(
  endpoint: string,
  params: RequestParams = {}
): Promise<PointHubResponse<T>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(config.apiKey, timestamp, config.secretKey);

  const requestBody = {
    apiKey: config.apiKey,
    timestamp,
    signature,
    ...params
  };

  const url = `${config.baseUrl}${endpoint}`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      return {
        success: false,
        code: '9999',
        message: `HTTP Error: ${response.status} ${response.statusText}`
      };
    }

    // 실제 PointHub API 응답 파싱
    const apiResponse = await response.json() as PointHubApiResponse<T>;

    // 성공 여부: result가 "0000"이면 성공
    const isSuccess = apiResponse.result === '0000';

    // 데이터 추출: 배열이면 첫 번째 요소, 아니면 그대로
    let extractedData: T | undefined;
    if (isSuccess && apiResponse.data) {
      if (Array.isArray(apiResponse.data) && apiResponse.data.length > 0) {
        extractedData = apiResponse.data[0] as T;
      } else if (typeof apiResponse.data !== 'string') {
        extractedData = apiResponse.data as T;
      }
    }

    return {
      success: isSuccess,
      code: apiResponse.result,
      message: apiResponse.resultMsg,
      data: extractedData
    };
  } catch (error) {
    console.error(`PointHub API Error [${endpoint}]:`, error);
    return {
      success: false,
      code: '9999',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// ============================================
// API 함수들
// ============================================

/**
 * 회원 로그인 인증
 * POST /PH/MEMBER/Check
 *
 * @param id 사용자 아이디
 * @param password 사용자 비밀번호
 * @param comCode 회사 코드 (기본값: 환경변수 POINTHUB_COM_CODE)
 * @returns 인증 성공 시 회원 정보 (mbid, mbid2 등)
 */
export async function memberCheck(
  id: string,
  password: string,
  comCode?: string
): Promise<PointHubResponse<MemberCheckData>> {
  console.log('=== PointHub memberCheck API 호출 ===');
  console.log('Request:', { id, password: '***', comCode: comCode || config.comCode });

  const result = await callPointHubApi<MemberCheckData>('/PH/MEMBER/Check', {
    id,
    password,
    comCode: comCode || config.comCode
  });

  console.log('Response:', JSON.stringify(result, null, 2));
  console.log('=== PointHub memberCheck API 완료 ===');

  return result;
}

// ============================================
// USDP (현금성 포인트)
// ============================================

/**
 * USDP 잔액 조회
 * POST /PH/USDP/select
 */
export async function usdpSelect(
  mbid: string,
  mbid2: number
): Promise<PointHubResponse<BalanceData>> {
  return callPointHubApi<BalanceData>('/PH/USDP/select', { mbid, mbid2 });
}

/**
 * USDP 입금 (Transfer)
 * POST /PH/USDP/TRANSFER
 */
export async function usdpTransfer(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<TransferData>> {
  return callPointHubApi<TransferData>('/PH/USDP/TRANSFER', { mbid, mbid2, amount, memo });
}

/**
 * USDP 출금 (Withdraw)
 * POST /PH/USDP/WITHDRAW
 */
export async function usdpWithdraw(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<WithdrawData>> {
  return callPointHubApi<WithdrawData>('/PH/USDP/WITHDRAW', { mbid, mbid2, amount, memo });
}

// ============================================
// USDM (마일리지 포인트)
// ============================================

/**
 * USDM 잔액 조회
 * POST /PH/USDM/select
 */
export async function usdmSelect(
  mbid: string,
  mbid2: number
): Promise<PointHubResponse<BalanceData>> {
  return callPointHubApi<BalanceData>('/PH/USDM/select', { mbid, mbid2 });
}

/**
 * USDM 입금 (Transfer)
 * POST /PH/USDM/TRANSFER
 */
export async function usdmTransfer(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<TransferData>> {
  return callPointHubApi<TransferData>('/PH/USDM/TRANSFER', { mbid, mbid2, amount, memo });
}

/**
 * USDM 출금 (Withdraw)
 * POST /PH/USDM/WITHDRAW
 */
export async function usdmWithdraw(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<WithdrawData>> {
  return callPointHubApi<WithdrawData>('/PH/USDM/WITHDRAW', { mbid, mbid2, amount, memo });
}

// ============================================
// GPOINT (게임 포인트)
// ============================================

/**
 * GPOINT 잔액 조회
 * POST /PH/GPOINT/select
 */
export async function gpointSelect(
  mbid: string,
  mbid2: number
): Promise<PointHubResponse<BalanceData>> {
  return callPointHubApi<BalanceData>('/PH/GPOINT/select', { mbid, mbid2 });
}

/**
 * GPOINT 입금 (Transfer)
 * POST /PH/GPOINT/TRANSFER
 */
export async function gpointTransfer(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<TransferData>> {
  return callPointHubApi<TransferData>('/PH/GPOINT/TRANSFER', { mbid, mbid2, amount, memo });
}

/**
 * GPOINT 출금 (Withdraw)
 * POST /PH/GPOINT/WITHDRAW
 */
export async function gpointWithdraw(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<WithdrawData>> {
  return callPointHubApi<WithdrawData>('/PH/GPOINT/WITHDRAW', { mbid, mbid2, amount, memo });
}

// ============================================
// GPORDER (게임 주문 포인트)
// ============================================

/**
 * GPORDER 잔액 조회
 * POST /PH/GPORDER/select
 */
export async function gporderSelect(
  mbid: string,
  mbid2: number
): Promise<PointHubResponse<BalanceData>> {
  return callPointHubApi<BalanceData>('/PH/GPORDER/select', { mbid, mbid2 });
}

/**
 * GPORDER 입금 (Transfer)
 * POST /PH/GPORDER/TRANSFER
 */
export async function gporderTransfer(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<TransferData>> {
  return callPointHubApi<TransferData>('/PH/GPORDER/TRANSFER', { mbid, mbid2, amount, memo });
}

/**
 * GPORDER 출금 (Withdraw)
 * POST /PH/GPORDER/WITHDRAW
 */
export async function gporderWithdraw(
  mbid: string,
  mbid2: number,
  amount: number,
  memo?: string
): Promise<PointHubResponse<WithdrawData>> {
  return callPointHubApi<WithdrawData>('/PH/GPORDER/WITHDRAW', { mbid, mbid2, amount, memo });
}

// ============================================
// 유틸리티
// ============================================

/**
 * 현재 설정 확인 (디버깅용)
 */
export function getConfig() {
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey ? `${config.apiKey.substring(0, 8)}...` : 'NOT SET',
    secretKey: config.secretKey ? '***SET***' : 'NOT SET',
    comCode: config.comCode,
    memberPrefix: config.memberPrefix
  };
}

/**
 * 기본 Member Prefix 가져오기
 */
export function getMemberPrefix(): string {
  return config.memberPrefix;
}
