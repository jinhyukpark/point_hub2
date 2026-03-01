"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.memberCheck = memberCheck;
exports.usdpSelect = usdpSelect;
exports.usdpTransfer = usdpTransfer;
exports.usdpWithdraw = usdpWithdraw;
exports.usdmSelect = usdmSelect;
exports.usdmTransfer = usdmTransfer;
exports.usdmWithdraw = usdmWithdraw;
exports.gpointSelect = gpointSelect;
exports.gpointTransfer = gpointTransfer;
exports.gpointWithdraw = gpointWithdraw;
exports.gporderSelect = gporderSelect;
exports.gporderTransfer = gporderTransfer;
exports.gporderTransferSingle = gporderTransferSingle;
exports.gporderWithdraw = gporderWithdraw;
exports.getConfig = getConfig;
exports.getMemberPrefix = getMemberPrefix;
const crypto = __importStar(require("crypto"));
// 환경 변수에서 설정 로드
const config = {
    baseUrl: process.env.POINTHUB_BASE_URL || 'https://www.point-hub.cloud/api',
    apiKey: process.env.POINTHUB_API_KEY || '',
    secretKey: process.env.POINTHUB_SECRET_KEY || '',
    comCode: process.env.POINTHUB_COM_CODE || '',
    memberPrefix: process.env.POINTHUB_MEMBER_PREFIX || 'EN'
};
// ============================================
// 서명 및 해시 생성
// ============================================
/**
 * HMAC-SHA256 서명 생성
 * 형식: "API-KEY:UnixTimeStamp:Secret-Key"를 SECRET-KEY로 HMAC-SHA256
 */
function generateSignature(apiKey, timestamp, secretKey) {
    const message = `${apiKey}:${timestamp}:${secretKey}`;
    return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}
/**
 * SHA256 해시 생성 (비밀번호용)
 */
function sha256Hash(text) {
    return crypto.createHash('sha256').update(text).digest('hex');
}
/**
 * PointHub API 호출
 * - Header: Authorization (SIGNATURE), APIKEY
 * - Content-Type: application/x-www-form-urlencoded;charset=UTF-8
 * - Body: URL encoded 파라미터
 */
async function callPointHubApi(endpoint, params = {}) {
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
        const apiResponse = await response.json();
        console.log('[PointHub API] Response:', JSON.stringify(apiResponse, null, 2));
        // 성공 여부: result가 "0000"이면 성공
        const isSuccess = apiResponse.result === '0000';
        // 데이터 추출: 배열이면 첫 번째 요소, 아니면 그대로
        let extractedData;
        if (isSuccess && apiResponse.data) {
            if (Array.isArray(apiResponse.data) && apiResponse.data.length > 0) {
                extractedData = apiResponse.data[0];
            }
            else if (typeof apiResponse.data !== 'string') {
                extractedData = apiResponse.data;
            }
        }
        return {
            success: isSuccess,
            code: apiResponse.result,
            message: apiResponse.resultMsg,
            data: extractedData
        };
    }
    catch (error) {
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
async function memberCheck(id, password, comCode) {
    console.log('=== PointHub memberCheck API 호출 ===');
    console.log('Request:', { webID: id, WebPassWord: '***', ComCode: comCode || config.comCode });
    // 비밀번호를 SHA256 해시
    const hashedPassword = sha256Hash(password);
    const result = await callPointHubApi('/PH/MEMBER/Check', {
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
async function usdpSelect(mbid, mbid2) {
    return callPointHubApi('/PH/USDP/select', { mbid, mbid2 });
}
/**
 * USDP 입금 (Transfer)
 * POST /PH/USDP/TRANSFER
 */
async function usdpTransfer(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/USDP/TRANSFER', { mbid, mbid2, amount, memo });
}
/**
 * USDP 출금 (Withdraw)
 * POST /PH/USDP/WITHDRAW
 */
async function usdpWithdraw(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/USDP/WITHDRAW', { mbid, mbid2, amount, memo });
}
// ============================================
// USDM (마일리지 포인트)
// ============================================
/**
 * USDM 잔액 조회
 * POST /PH/USDM/select
 */
async function usdmSelect(mbid, mbid2) {
    return callPointHubApi('/PH/USDM/select', { mbid, mbid2 });
}
/**
 * USDM 입금 (Transfer)
 * POST /PH/USDM/TRANSFER
 */
async function usdmTransfer(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/USDM/TRANSFER', { mbid, mbid2, amount, memo });
}
/**
 * USDM 출금 (Withdraw)
 * POST /PH/USDM/WITHDRAW
 */
async function usdmWithdraw(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/USDM/WITHDRAW', { mbid, mbid2, amount, memo });
}
// ============================================
// GPOINT (게임 포인트)
// ============================================
/**
 * GPOINT 잔액 조회
 * POST /PH/GPOINT/select
 */
async function gpointSelect(mbid, mbid2) {
    return callPointHubApi('/PH/GPOINT/select', { mbid, mbid2 });
}
/**
 * GPOINT 입금 (Transfer)
 * POST /PH/GPOINT/TRANSFER
 */
async function gpointTransfer(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/GPOINT/TRANSFER', { mbid, mbid2, amount, memo });
}
/**
 * GPOINT 출금 (Withdraw)
 * POST /PH/GPOINT/WITHDRAW
 */
async function gpointWithdraw(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/GPOINT/WITHDRAW', { mbid, mbid2, amount, memo });
}
/**
 * GPORDER 잔액 조회
 * POST /PH/GPORDER/select
 */
async function gporderSelect(mbid, mbid2) {
    return callPointHubApi('/PH/GPORDER/select', { mbid, mbid2 });
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
async function gporderTransfer(items) {
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
        const apiResponse = await response.json();
        console.log('[PointHub API] Response:', JSON.stringify(apiResponse, null, 2));
        const isSuccess = apiResponse.result === '0000';
        return {
            success: isSuccess,
            code: apiResponse.result,
            message: apiResponse.resultMsg,
            data: isSuccess ? apiResponse.data : undefined
        };
    }
    catch (error) {
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
async function gporderTransferSingle(mbid, mbid2, amount, orderType, memo) {
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
async function gporderWithdraw(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/GPORDER/WITHDRAW', { mbid, mbid2, amount, memo });
}
// ============================================
// 유틸리티
// ============================================
/**
 * 현재 설정 확인 (디버깅용)
 */
function getConfig() {
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
function getMemberPrefix() {
    return config.memberPrefix;
}
//# sourceMappingURL=pointhub-client.js.map