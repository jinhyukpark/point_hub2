"use strict";
/**
 * PointHub External API Integration
 * Version: 0.5
 *
 * 외부 파트너사(예: IVY PAY)와의 API 연동을 위한 모듈
 * - 회원 로그인 확인 (MEMBER/Check)
 * - USDP 관리 (현금성 포인트)
 * - USDM 관리 (마일리지 포인트)
 * - Gpoint 관리
 * - GPorder 관리
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateProfileImage = exports.getMemberInfo = exports.gporderWithdraw = exports.gporderTransfer = exports.gporderSelect = exports.gpointWithdraw = exports.gpointTransfer = exports.gpointSelect = exports.usdmWithdraw = exports.usdmTransfer = exports.usdmSelect = exports.usdpWithdraw = exports.usdpTransfer = exports.usdpSelect = exports.memberCheck = void 0;
exports.generateSignature = generateSignature;
exports.verifySignature = verifySignature;
exports.uidToMbid2 = uidToMbid2;
exports.mbid2ToUid = mbid2ToUid;
exports.formatMemberId = formatMemberId;
exports.saveMbid2Mapping = saveMbid2Mapping;
const https_1 = require("firebase-functions/v2/https");
const crypto_1 = require("crypto");
const firebase_config_1 = require("./firebase-config");
// ============================================
// Configuration
// ============================================
// 실제 운영 시 환경변수 또는 Firebase config에서 가져와야 함
const POINTHUB_CONFIG = {
    API_KEY: process.env.POINTHUB_API_KEY || 'test-api-key',
    SECRET_KEY: process.env.POINTHUB_SECRET_KEY || 'test-secret-key',
    // 회원 ID 접두사 (mbid) - 예: "EN", "KR" 등
    MEMBER_PREFIX: process.env.POINTHUB_MEMBER_PREFIX || 'EN',
    // 타임스탬프 유효 범위 (초) - 너무 오래된 요청 거부
    TIMESTAMP_TOLERANCE: 300 // 5분
};
// ============================================
// Error Codes
// ============================================
const ERROR_CODES = {
    SUCCESS: { code: '0000', message: 'Success' },
    INVALID_SIGNATURE: { code: '1001', message: 'Invalid signature' },
    INVALID_TIMESTAMP: { code: '1002', message: 'Invalid or expired timestamp' },
    INVALID_API_KEY: { code: '1003', message: 'Invalid API key' },
    MISSING_PARAMETERS: { code: '1004', message: 'Missing required parameters' },
    MEMBER_NOT_FOUND: { code: '2001', message: 'Member not found' },
    MEMBER_INACTIVE: { code: '2002', message: 'Member is inactive' },
    INSUFFICIENT_BALANCE: { code: '3001', message: 'Insufficient balance' },
    INVALID_AMOUNT: { code: '3002', message: 'Invalid amount' },
    TRANSACTION_FAILED: { code: '3003', message: 'Transaction failed' },
    INTERNAL_ERROR: { code: '9999', message: 'Internal server error' }
};
// ============================================
// Authentication Helper
// ============================================
/**
 * HMAC-SHA256 서명 생성
 * 포맷: HMAC-SHA256(apiKey + timestamp, secretKey)
 */
function generateSignature(apiKey, timestamp, secretKey) {
    const message = `${apiKey}${timestamp}`;
    const hmac = (0, crypto_1.createHmac)('sha256', secretKey);
    hmac.update(message);
    return hmac.digest('hex').toUpperCase();
}
/**
 * 요청 서명 검증
 */
function verifySignature(request) {
    // API Key 검증
    if (request.apiKey !== POINTHUB_CONFIG.API_KEY) {
        return { valid: false, error: ERROR_CODES.INVALID_API_KEY };
    }
    // 타임스탬프 검증 (너무 오래된 요청 거부)
    const now = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(now - request.timestamp);
    if (timeDiff > POINTHUB_CONFIG.TIMESTAMP_TOLERANCE) {
        return { valid: false, error: ERROR_CODES.INVALID_TIMESTAMP };
    }
    // 서명 검증
    const expectedSignature = generateSignature(request.apiKey, request.timestamp, POINTHUB_CONFIG.SECRET_KEY);
    if (request.signature.toUpperCase() !== expectedSignature) {
        return { valid: false, error: ERROR_CODES.INVALID_SIGNATURE };
    }
    return { valid: true };
}
/**
 * 회원 ID 생성 (mbid + mbid2)
 * 예: "EN" + "60549422" = "EN-60549422"
 */
function formatMemberId(mbid, mbid2) {
    return `${mbid}-${mbid2}`;
}
/**
 * Firebase UID를 mbid2로 변환 (숫자 ID 생성)
 * Firebase UID는 문자열이므로 해시를 사용하여 고유 숫자 생성
 */
function uidToMbid2(uid) {
    // UID의 해시값을 사용하여 8자리 숫자 생성
    let hash = 0;
    for (let i = 0; i < uid.length; i++) {
        const char = uid.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    // 양수 8자리 숫자로 변환 (10000000 ~ 99999999)
    return Math.abs(hash % 90000000) + 10000000;
}
/**
 * mbid2를 Firebase UID로 변환 (역방향 조회)
 * users/mappings/mbid2ToUid에서 조회
 */
async function mbid2ToUid(mbid2) {
    const snapshot = await firebase_config_1.rtdb.ref(`/users/mappings/mbid2ToUid/${mbid2}`).once('value');
    return snapshot.val();
}
/**
 * mbid2 매핑 저장
 */
async function saveMbid2Mapping(uid, mbid2) {
    await firebase_config_1.rtdb.ref(`/users/mappings/mbid2ToUid/${mbid2}`).set(uid);
    await firebase_config_1.rtdb.ref(`/users/${uid}/profile/mbid2`).set(mbid2);
}
// ============================================
// Request Parser
// ============================================
function parseRequest(req) {
    // POST body 또는 query parameters에서 데이터 추출
    const body = req.body || {};
    const query = req.query || {};
    return {
        apiKey: body.apiKey || body.api_key || query.apiKey || query.api_key || '',
        timestamp: parseInt(body.timestamp || query.timestamp || '0', 10),
        signature: body.signature || body.sign || query.signature || query.sign || '',
        mbid: body.mbid || query.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
        mbid2: parseInt(body.mbid2 || query.mbid2 || '0', 10),
        amount: parseFloat(body.amount || query.amount || '0'),
        memo: body.memo || query.memo || ''
    };
}
function createResponse(result, code, message, data) {
    const response = { result, code, message };
    if (data !== undefined) {
        response.data = data;
    }
    return response;
}
// ============================================
// API Endpoints
// ============================================
/**
 * 회원 로그인 확인 (MEMBER/Check)
 *
 * 요청: POST /api/PH/MEMBER/Check
 * - apiKey: API 키
 * - timestamp: Unix 타임스탬프
 * - signature: HMAC-SHA256 서명
 * - mbid: 회원 ID 접두사 (예: "EN")
 * - mbid2: 회원 ID 숫자부분
 *
 * 응답:
 * - result: "success" | "fail"
 * - code: 결과 코드
 * - message: 결과 메시지
 * - data: { mbid, mbid2, nickname, level, isActive }
 */
exports.memberCheck = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    var _a, _b, _c;
    try {
        // POST 요청만 허용
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        // 필수 파라미터 검증
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        // 서명 검증
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        // mbid2로 UID 조회
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // 사용자 정보 조회
        const userSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}`).once('value');
        const userData = userSnapshot.val();
        if (!userData) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // 활성 상태 확인
        const isActive = ((_a = userData.auth) === null || _a === void 0 ? void 0 : _a.disabled) !== true;
        if (!isActive) {
            res.status(403).json(createResponse('fail', ERROR_CODES.MEMBER_INACTIVE.code, ERROR_CODES.MEMBER_INACTIVE.message));
            return;
        }
        const response = {
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                nickname: ((_b = userData.profile) === null || _b === void 0 ? void 0 : _b.nickname) || 'Unknown',
                level: ((_c = userData.vip) === null || _c === void 0 ? void 0 : _c.level) || 1,
                isActive: isActive
            }
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error('[MEMBER/Check] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDP 잔액 조회 (USDP/select)
 */
exports.usdpSelect = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        // 파라미터 검증
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        // 서명 검증
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        // mbid2로 UID 조회
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // USDP 잔액 조회 (wallet.usdt를 USDP로 사용)
        const walletSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
        const balance = walletSnapshot.val() || 0;
        const response = {
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                balance: balance,
                currency: 'USDP'
            }
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error('[USDP/select] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDP 입금 (USDP/TRANSFER)
 */
exports.usdpTransfer = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        // 파라미터 검증
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        // 서명 검증
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        // mbid2로 UID 조회
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // 트랜잭션으로 잔액 증가
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`);
        const transactionResult = await walletRef.transaction((currentBalance) => {
            return (currentBalance || 0) + request.amount;
        });
        if (!transactionResult.committed) {
            res.status(500).json(createResponse('fail', ERROR_CODES.TRANSACTION_FAILED.code, ERROR_CODES.TRANSACTION_FAILED.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `USDP_TRF_${Date.now()}_${request.mbid2}`;
        // 거래 기록 저장
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'credit',
            amountUsd: request.amount,
            meta: {
                operation: 'pointhub_transfer',
                currency: 'USDP',
                transactionId: transactionId,
                memo: request.memo || 'PointHub USDP Transfer'
            },
            createdAt: Date.now()
        });
        // 외부 API 거래 기록
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'USDP_TRANSFER',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        const response = {
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'USDP',
                timestamp: Date.now()
            }
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error('[USDP/TRANSFER] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDP 출금 (USDP/WITHDRAW)
 */
exports.usdpWithdraw = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        // 파라미터 검증
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        // 서명 검증
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        // mbid2로 UID 조회
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // 현재 잔액 확인
        const currentBalanceSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
        const currentBalance = currentBalanceSnapshot.val() || 0;
        if (currentBalance < request.amount) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INSUFFICIENT_BALANCE.code, `${ERROR_CODES.INSUFFICIENT_BALANCE.message}. Current: ${currentBalance}, Required: ${request.amount}`));
            return;
        }
        // 트랜잭션으로 잔액 감소
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`);
        const transactionResult = await walletRef.transaction((balance) => {
            const current = balance || 0;
            if (current < request.amount) {
                return; // Abort transaction
            }
            return current - request.amount;
        });
        if (!transactionResult.committed) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INSUFFICIENT_BALANCE.code, ERROR_CODES.INSUFFICIENT_BALANCE.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `USDP_WD_${Date.now()}_${request.mbid2}`;
        // 거래 기록 저장
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'debit',
            amountUsd: -request.amount,
            meta: {
                operation: 'pointhub_withdraw',
                currency: 'USDP',
                transactionId: transactionId,
                memo: request.memo || 'PointHub USDP Withdraw'
            },
            createdAt: Date.now()
        });
        // 외부 API 거래 기록
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'USDP_WITHDRAW',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: -request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        const response = {
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'USDP',
                timestamp: Date.now()
            }
        };
        res.status(200).json(response);
    }
    catch (error) {
        console.error('[USDP/WITHDRAW] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDM 잔액 조회 (USDM/select)
 * USDM = 마일리지 포인트 (IVY 토큰 사용)
 */
exports.usdmSelect = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // USDM = IVY 토큰 잔액
        const walletSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/ivy`).once('value');
        const balance = walletSnapshot.val() || 0;
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                balance: balance,
                currency: 'USDM'
            }
        });
    }
    catch (error) {
        console.error('[USDM/select] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDM 입금 (USDM/TRANSFER)
 */
exports.usdmTransfer = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/ivy`);
        const transactionResult = await walletRef.transaction((currentBalance) => {
            return (currentBalance || 0) + request.amount;
        });
        if (!transactionResult.committed) {
            res.status(500).json(createResponse('fail', ERROR_CODES.TRANSACTION_FAILED.code, ERROR_CODES.TRANSACTION_FAILED.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `USDM_TRF_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'credit',
            amountUsd: request.amount,
            meta: {
                operation: 'pointhub_transfer',
                currency: 'USDM',
                transactionId: transactionId,
                memo: request.memo || 'PointHub USDM Transfer'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'USDM_TRANSFER',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'USDM',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[USDM/TRANSFER] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * USDM 출금 (USDM/WITHDRAW)
 */
exports.usdmWithdraw = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/ivy`);
        const transactionResult = await walletRef.transaction((balance) => {
            const current = balance || 0;
            if (current < request.amount) {
                return;
            }
            return current - request.amount;
        });
        if (!transactionResult.committed) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INSUFFICIENT_BALANCE.code, ERROR_CODES.INSUFFICIENT_BALANCE.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `USDM_WD_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'debit',
            amountUsd: -request.amount,
            meta: {
                operation: 'pointhub_withdraw',
                currency: 'USDM',
                transactionId: transactionId,
                memo: request.memo || 'PointHub USDM Withdraw'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'USDM_WITHDRAW',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: -request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'USDM',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[USDM/WITHDRAW] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * Gpoint 잔액 조회 (GPOINT/select)
 */
exports.gpointSelect = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // Gpoint 잔액 조회
        const walletSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gpoint`).once('value');
        const balance = walletSnapshot.val() || 0;
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                balance: balance,
                currency: 'GPOINT'
            }
        });
    }
    catch (error) {
        console.error('[GPOINT/select] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * Gpoint 입금 (GPOINT/TRANSFER)
 */
exports.gpointTransfer = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gpoint`);
        const transactionResult = await walletRef.transaction((currentBalance) => {
            return (currentBalance || 0) + request.amount;
        });
        if (!transactionResult.committed) {
            res.status(500).json(createResponse('fail', ERROR_CODES.TRANSACTION_FAILED.code, ERROR_CODES.TRANSACTION_FAILED.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `GPOINT_TRF_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'credit',
            amountUsd: request.amount,
            meta: {
                operation: 'pointhub_transfer',
                currency: 'GPOINT',
                transactionId: transactionId,
                memo: request.memo || 'PointHub GPOINT Transfer'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'GPOINT_TRANSFER',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'GPOINT',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[GPOINT/TRANSFER] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * Gpoint 출금 (GPOINT/WITHDRAW)
 */
exports.gpointWithdraw = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gpoint`);
        const transactionResult = await walletRef.transaction((balance) => {
            const current = balance || 0;
            if (current < request.amount) {
                return;
            }
            return current - request.amount;
        });
        if (!transactionResult.committed) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INSUFFICIENT_BALANCE.code, ERROR_CODES.INSUFFICIENT_BALANCE.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `GPOINT_WD_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'debit',
            amountUsd: -request.amount,
            meta: {
                operation: 'pointhub_withdraw',
                currency: 'GPOINT',
                transactionId: transactionId,
                memo: request.memo || 'PointHub GPOINT Withdraw'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'GPOINT_WITHDRAW',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: -request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'GPOINT',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[GPOINT/WITHDRAW] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * GPorder 잔액 조회 (GPORDER/select)
 */
exports.gporderSelect = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        // GPorder 잔액 조회
        const walletSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gporder`).once('value');
        const balance = walletSnapshot.val() || 0;
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                balance: balance,
                currency: 'GPORDER'
            }
        });
    }
    catch (error) {
        console.error('[GPORDER/select] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * GPorder 입금 (GPORDER/TRANSFER)
 */
exports.gporderTransfer = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gporder`);
        const transactionResult = await walletRef.transaction((currentBalance) => {
            return (currentBalance || 0) + request.amount;
        });
        if (!transactionResult.committed) {
            res.status(500).json(createResponse('fail', ERROR_CODES.TRANSACTION_FAILED.code, ERROR_CODES.TRANSACTION_FAILED.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `GPORDER_TRF_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'credit',
            amountUsd: request.amount,
            meta: {
                operation: 'pointhub_transfer',
                currency: 'GPORDER',
                transactionId: transactionId,
                memo: request.memo || 'PointHub GPORDER Transfer'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'GPORDER_TRANSFER',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'GPORDER',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[GPORDER/TRANSFER] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
/**
 * GPorder 출금 (GPORDER/WITHDRAW)
 */
exports.gporderWithdraw = (0, https_1.onRequest)({ cors: true, region: 'asia-northeast3' }, async (req, res) => {
    try {
        if (req.method !== 'POST') {
            res.status(405).json(createResponse('fail', '1000', 'Method not allowed'));
            return;
        }
        const request = parseRequest(req);
        if (!request.apiKey || !request.timestamp || !request.signature) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, ERROR_CODES.MISSING_PARAMETERS.message));
            return;
        }
        if (!request.mbid2 || request.mbid2 === 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.MISSING_PARAMETERS.code, 'mbid2 is required'));
            return;
        }
        if (!request.amount || request.amount <= 0) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INVALID_AMOUNT.code, ERROR_CODES.INVALID_AMOUNT.message));
            return;
        }
        const signatureResult = verifySignature(request);
        if (!signatureResult.valid && signatureResult.error) {
            res.status(401).json(createResponse('fail', signatureResult.error.code, signatureResult.error.message));
            return;
        }
        const uid = await mbid2ToUid(request.mbid2);
        if (!uid) {
            res.status(404).json(createResponse('fail', ERROR_CODES.MEMBER_NOT_FOUND.code, ERROR_CODES.MEMBER_NOT_FOUND.message));
            return;
        }
        const walletRef = firebase_config_1.rtdb.ref(`/users/${uid}/wallet/gporder`);
        const transactionResult = await walletRef.transaction((balance) => {
            const current = balance || 0;
            if (current < request.amount) {
                return;
            }
            return current - request.amount;
        });
        if (!transactionResult.committed) {
            res.status(400).json(createResponse('fail', ERROR_CODES.INSUFFICIENT_BALANCE.code, ERROR_CODES.INSUFFICIENT_BALANCE.message));
            return;
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        const transactionId = `GPORDER_WD_${Date.now()}_${request.mbid2}`;
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push({
            type: 'debit',
            amountUsd: -request.amount,
            meta: {
                operation: 'pointhub_withdraw',
                currency: 'GPORDER',
                transactionId: transactionId,
                memo: request.memo || 'PointHub GPORDER Withdraw'
            },
            createdAt: Date.now()
        });
        await firebase_config_1.rtdb.ref('/pointhub/transactions').push({
            type: 'GPORDER_WITHDRAW',
            transactionId: transactionId,
            mbid: request.mbid,
            mbid2: request.mbid2,
            uid: uid,
            amount: -request.amount,
            newBalance: newBalance,
            memo: request.memo,
            timestamp: Date.now()
        });
        res.status(200).json({
            result: 'success',
            code: ERROR_CODES.SUCCESS.code,
            message: ERROR_CODES.SUCCESS.message,
            data: {
                transactionId: transactionId,
                mbid: request.mbid || POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: request.mbid2,
                amount: request.amount,
                newBalance: newBalance,
                currency: 'GPORDER',
                timestamp: Date.now()
            }
        });
    }
    catch (error) {
        console.error('[GPORDER/WITHDRAW] Error:', error);
        res.status(500).json(createResponse('fail', ERROR_CODES.INTERNAL_ERROR.code, ERROR_CODES.INTERNAL_ERROR.message));
    }
});
// ============================================
// Internal Helper Functions (for Unity client)
// ============================================
/**
 * Firebase UID로 회원 정보 조회 (내부용)
 * Unity 클라이언트에서 사용
 */
const https_2 = require("firebase-functions/v2/https");
exports.getMemberInfo = (0, https_2.onCall)({ region: 'asia-northeast3' }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
    if (!request.auth) {
        return { success: false, error: 'Authentication required' };
    }
    const uid = request.auth.uid;
    try {
        // 사용자 정보 조회
        const userSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}`).once('value');
        const userData = userSnapshot.val();
        if (!userData) {
            return { success: false, error: 'User not found' };
        }
        // mbid2가 없으면 생성
        let mbid2 = (_a = userData.profile) === null || _a === void 0 ? void 0 : _a.mbid2;
        if (!mbid2) {
            mbid2 = uidToMbid2(uid);
            await saveMbid2Mapping(uid, mbid2);
        }
        return {
            success: true,
            data: {
                uid: uid,
                mbid: POINTHUB_CONFIG.MEMBER_PREFIX,
                mbid2: mbid2,
                memberId: formatMemberId(POINTHUB_CONFIG.MEMBER_PREFIX, mbid2),
                nickname: ((_b = userData.profile) === null || _b === void 0 ? void 0 : _b.nickname) || 'Unknown',
                email: ((_c = userData.auth) === null || _c === void 0 ? void 0 : _c.email) || '',
                level: ((_d = userData.vip) === null || _d === void 0 ? void 0 : _d.level) || 1,
                wallet: {
                    usdt: ((_e = userData.wallet) === null || _e === void 0 ? void 0 : _e.usdt) || 0,
                    ivy: ((_f = userData.wallet) === null || _f === void 0 ? void 0 : _f.ivy) || 0,
                    gpoint: ((_g = userData.wallet) === null || _g === void 0 ? void 0 : _g.gpoint) || 0,
                    gporder: ((_h = userData.wallet) === null || _h === void 0 ? void 0 : _h.gporder) || 0,
                    pending: ((_j = userData.wallet) === null || _j === void 0 ? void 0 : _j.pending) || 0
                },
                profileImage: ((_k = userData.profile) === null || _k === void 0 ? void 0 : _k.profileImage) || null,
                isActive: ((_l = userData.auth) === null || _l === void 0 ? void 0 : _l.disabled) !== true
            }
        };
    }
    catch (error) {
        console.error('[getMemberInfo] Error:', error);
        return { success: false, error: 'Failed to get member info' };
    }
});
/**
 * 회원 프로필 이미지 업데이트 (내부용)
 */
exports.updateProfileImage = (0, https_2.onCall)({ region: 'asia-northeast3' }, async (request) => {
    if (!request.auth) {
        return { success: false, error: 'Authentication required' };
    }
    const uid = request.auth.uid;
    const { imageUrl } = request.data;
    if (!imageUrl) {
        return { success: false, error: 'Image URL is required' };
    }
    try {
        await firebase_config_1.rtdb.ref(`/users/${uid}/profile/profileImage`).set(imageUrl);
        return { success: true, message: 'Profile image updated' };
    }
    catch (error) {
        console.error('[updateProfileImage] Error:', error);
        return { success: false, error: 'Failed to update profile image' };
    }
});
//# sourceMappingURL=pointhub-api.js.map