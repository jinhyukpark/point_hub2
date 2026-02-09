"use strict";
/**
 * PointHub External API Client
 *
 * 외부 PointHub API를 호출하는 클라이언트
 * Base URL: https://www.point-hub.cloud/api
 * 인증: HMAC-SHA256 서명
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
// 서명 생성
// ============================================
/**
 * HMAC-SHA256 서명 생성
 * @param apiKey API 키
 * @param timestamp Unix 타임스탬프
 * @param secretKey 시크릿 키
 * @returns 서명 문자열
 */
function generateSignature(apiKey, timestamp, secretKey) {
    const message = `${apiKey}${timestamp}`;
    return crypto.createHmac('sha256', secretKey).update(message).digest('hex');
}
/**
 * PointHub API 호출
 */
async function callPointHubApi(endpoint, params = {}) {
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
                result: 'fail',
                code: '9999',
                message: `HTTP Error: ${response.status} ${response.statusText}`
            };
        }
        const data = await response.json();
        return data;
    }
    catch (error) {
        console.error(`PointHub API Error [${endpoint}]:`, error);
        return {
            result: 'fail',
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
async function memberCheck(id, password, comCode) {
    console.log('=== PointHub memberCheck API 호출 ===');
    console.log('Request:', { id, password: '***', comCode: comCode || config.comCode });
    const result = await callPointHubApi('/PH/MEMBER/Check', {
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
// ============================================
// GPORDER (게임 주문 포인트)
// ============================================
/**
 * GPORDER 잔액 조회
 * POST /PH/GPORDER/select
 */
async function gporderSelect(mbid, mbid2) {
    return callPointHubApi('/PH/GPORDER/select', { mbid, mbid2 });
}
/**
 * GPORDER 입금 (Transfer)
 * POST /PH/GPORDER/TRANSFER
 */
async function gporderTransfer(mbid, mbid2, amount, memo) {
    return callPointHubApi('/PH/GPORDER/TRANSFER', { mbid, mbid2, amount, memo });
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