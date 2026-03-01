/**
 * PointHub External API Client
 *
 * 외부 PointHub API를 호출하는 클라이언트
 * Base URL: https://www.point-hub.cloud/api
 *
 * 인증 방식:
 * - Header: Authorization (SIGNATURE), APIKEY
 * - SIGNATURE: "API-KEY:UnixTimeStamp:Secret-Key"를 SECRET-KEY로 HMAC-SHA256
 * - 비밀번호: SHA256 해시 후 전송
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
  result: string;        // "0000" = 성공, 그 외 = 에러코드 (예: "8001", "1000")
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

// 회원 확인 응답 데이터 (API 실제 응답)
export interface MemberCheckData {
  mbid: string;           // 회원 ID prefix (예: "PH")
  mbid2: number;          // 회원 고유번호 (예: 80034785)
  webid: string;          // 웹 회원 ID (예: "kkk1234")
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
// 서명 및 해시 생성
// ============================================

/**
 * HMAC-SHA256 서명 생성
 * 형식: "API-KEY:UnixTimeStamp:Secret-Key"를 SECRET-KEY로 HMAC-SHA256
 */
function generateSignature(apiKey: string, timestamp: number, secretKey: string): string {
  const message = `${apiKey}:${timestamp}:${secretKey}`;
  return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}

/**
 * SHA256 해시 생성 (비밀번호용)
 */
function sha256Hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

// ============================================
// HTTP 요청 헬퍼
// ============================================

interface RequestParams {
  [key: string]: unknown;
}

/**
 * PointHub API 호출
 * - Header: Authorization (SIGNATURE), APIKEY
 * - Content-Type: application/x-www-form-urlencoded;charset=UTF-8
 * - Body: URL encoded 파라미터
 */
async function callPointHubApi<T>(
  endpoint: string,
  params: RequestParams = {}
): Promise<PointHubResponse<T>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(config.apiKey, timestamp, config.secretKey);

  const url = `${config.baseUrl}${endpoint}`;

  // 요청 본문에 timestamp 포함
  const requestParams = {
    ...params,
    timestamp: String(timestamp)
  };

  // URL encoded body 생성
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(requestParams)) {
    body.append(key, String(value));
  }

  console.log(`[PointHub API] ${endpoint}`);
  console.log('[PointHub API] Request:', body.toString());

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Authorization': signature,
        'APIKEY': config.apiKey
      },
      body: body.toString()
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
    console.log('[PointHub API] Response:', JSON.stringify(apiResponse, null, 2));

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
 * 요청 파라미터:
 * - webID: 회원아이디
 * - WebPassWord: SHA256으로 해시된 비밀번호
 * - timestamp: Signature 생성시 사용한 값
 * - ComCode: 협의된 회사 ID
 *
 * @param id 사용자 아이디
 * @param password 사용자 비밀번호 (평문 - 내부에서 SHA256 해시)
 * @param comCode 회사 코드 (기본값: 환경변수 POINTHUB_COM_CODE)
 * @returns 인증 성공 시 회원 정보 (mbid, mbid2)
 */
export async function memberCheck(
  id: string,
  password: string,
  comCode?: string
): Promise<PointHubResponse<MemberCheckData>> {
  console.log('=== PointHub memberCheck API 호출 ===');
  console.log('Request:', { webID: id, WebPassWord: '***', ComCode: comCode || config.comCode });

  // 비밀번호를 SHA256 해시
  const hashedPassword = sha256Hash(password);

  const result = await callPointHubApi<MemberCheckData>('/PH/MEMBER/Check', {
    webID: id,
    WebPassWord: hashedPassword,
    ComCode: comCode || config.comCode
  });

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
 * GPorder 입금 항목 타입
 */
export interface GporderTransferItem {
  mbid: string;           // 회원 ID prefix (예: "PH")
  mbid2: number;          // 회원 고유번호
  amount: number;         // 금액
  Ordertype: '03' | '04'; // 03: 게임매출1 (20%), 04: 게임매출2 (골든벨 미당첨)
  memo?: string;          // 메모 (선택)
}

/**
 * GPorder Transfer 응답 데이터
 */
export interface GporderTransferResponseData {
  processedCount: number;
  results: Array<{
    mbid: string;
    mbid2: number;
    amount: number;
    success: boolean;
  }>;
}

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
 * GPORDER 일괄 입금 (Transfer) - JSON 형식
 * POST /PH/GPORDER/TRANSFER
 *
 * API 문서 기준:
 * - Content-Type: application/json
 * - transCode: "IN_Rech_GPorder_API"
 * - 배열 형식으로 여러 건 일괄 전송
 * - Ordertype: 03 (게임매출1 - 20%), 04 (게임매출2 - 골든벨 미당첨)
 * - 전송 주기: UTC 00/06/12/18시 매 40분
 *
 * @param items 입금할 항목 배열
 * @returns 처리 결과
 */
export async function gporderTransfer(
  items: GporderTransferItem[]
): Promise<PointHubResponse<GporderTransferResponseData>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(config.apiKey, timestamp, config.secretKey);

  const url = `${config.baseUrl}/PH/GPORDER/TRANSFER`;

  // JSON 요청 본문 생성
  const requestBody = {
    transCode: 'IN_Rech_GPorder_API',
    timestamp: timestamp,
    data: items.map(item => ({
      mbid: item.mbid,
      mbid2: item.mbid2,
      amount: item.amount,
      Ordertype: item.Ordertype,
      memo: item.memo || ''
    }))
  };

  console.log(`[PointHub API] /PH/GPORDER/TRANSFER (JSON)`);
  console.log('[PointHub API] Request:', JSON.stringify(requestBody, null, 2));

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': signature,
        'APIKEY': config.apiKey
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

    const apiResponse = await response.json() as PointHubApiResponse<GporderTransferResponseData>;
    console.log('[PointHub API] Response:', JSON.stringify(apiResponse, null, 2));

    const isSuccess = apiResponse.result === '0000';

    return {
      success: isSuccess,
      code: apiResponse.result,
      message: apiResponse.resultMsg,
      data: isSuccess ? (apiResponse.data as GporderTransferResponseData) : undefined
    };
  } catch (error) {
    console.error('[PointHub API] GPORDER TRANSFER Error:', error);
    return {
      success: false,
      code: '9999',
      message: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * GPORDER 단일 입금 헬퍼
 * 단일 항목을 배열로 감싸서 gporderTransfer 호출
 *
 * @param mbid 회원 ID prefix
 * @param mbid2 회원 고유번호
 * @param amount 금액
 * @param orderType 03: 게임매출1 (20%), 04: 게임매출2 (골든벨 미당첨)
 * @param memo 메모 (선택)
 */
export async function gporderTransferSingle(
  mbid: string,
  mbid2: number,
  amount: number,
  orderType: '03' | '04',
  memo?: string
): Promise<PointHubResponse<GporderTransferResponseData>> {
  return gporderTransfer([{
    mbid,
    mbid2,
    amount,
    Ordertype: orderType,
    memo
  }]);
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
