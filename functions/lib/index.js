"use strict";
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
exports.cubeGameSettlementWorker = exports.testResetCubeGame = exports.testCubeGameWithFixedMove = exports.testCubeGameWithOracle = exports.testFillCubeGame = exports.testCubeGameSettlement = exports.processCubeGameSettlements = exports.finalizeCubeGameHistory = exports.getCubeGameHistory = exports.initializeCubeGame = exports.getCurrentCubeGame = exports.getCubeGamePositions = exports.getCubeGameStatus = exports.joinCubeGame = exports.testMatchingGameWithWinningNumbers = exports.testMatchingGameSettlement = exports.createRandomGame = exports.createOrderGame = exports.getCompletedMatchingGames = exports.getMatchingGameHistory = exports.getMatchingGameStatus = exports.joinMatchingGame = exports.getGoldenBellRoundRewards = exports.updateGoldenBellParticipantReward = exports.updateGoldenBellRoundChoices = exports.fetchGoldenBellUpcomingGames = exports.fetchGoldenBellParticipants = exports.checkRoundResult = exports.saveGoldenBellResult = exports.getGoldenBellHistory = exports.getWaitingRoomStatus = exports.startNextRound = exports.createDailyGoldenBellGamesCallable = exports.createDailyGoldenBellGames = exports.selectTeam = exports.submitGoldenBellDecision = exports.getGoldenBellStatus = exports.submitGoldenBellChoice = exports.joinGoldenBell = exports.getGameHistoryDetail = exports.getPendingGameResults = exports.getUserGameHistoryNew = exports.updateGameHistoryResult = exports.createGameHistory = exports.registerGoldenBellParticipant = exports.processGoldenBellReward = exports.processGoldenBellBet = exports.getUserGameHistory = exports.getCurrentGameStatus = exports.playGame = void 0;
exports.testResetAllData = exports.enhancedInitUserProfile = exports.initializeSystem = exports.getOraclePriceData = exports.getServerTime = exports.testInitializeAll = exports.testCreateMatchingGame = exports.testUpdateOracle = exports.oracleSnapshot = exports.testAddToGporderQueue = exports.testProcessGporderQueue = exports.gporderBatchScheduler = exports.testGpointSync = exports.gpointSyncScheduler = exports.cubeGameSettlementScheduler = exports.matchingGameSettlementScheduler = exports.matchingRandomScheduler = exports.matchingOrderScheduler = exports.goldenBellRoundScheduler = exports.goldenBellRecoveryScheduler = exports.goldenBellDailyScheduler = exports.debit = exports.credit = exports.createUserProfile = exports.pointHubLogin = exports.setAllUsersVip = void 0;
exports.addToGporderQueue = addToGporderQueue;
const https_1 = require("firebase-functions/v2/https");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_2 = require("firebase-functions/v2/https");
const firebase_config_1 = __importStar(require("./firebase-config"));
const pointhub_client_1 = require("./pointhub-client");
// 새로운 게임 관리 함수들 import
var game_manager_1 = require("./game-manager");
Object.defineProperty(exports, "playGame", { enumerable: true, get: function () { return game_manager_1.playGame; } });
Object.defineProperty(exports, "getCurrentGameStatus", { enumerable: true, get: function () { return game_manager_1.getCurrentGameStatus; } });
Object.defineProperty(exports, "getUserGameHistory", { enumerable: true, get: function () { return game_manager_1.getUserGameHistory; } });
Object.defineProperty(exports, "processGoldenBellBet", { enumerable: true, get: function () { return game_manager_1.processGoldenBellBet; } });
Object.defineProperty(exports, "processGoldenBellReward", { enumerable: true, get: function () { return game_manager_1.processGoldenBellReward; } });
Object.defineProperty(exports, "registerGoldenBellParticipant", { enumerable: true, get: function () { return game_manager_1.registerGoldenBellParticipant; } });
// 게임 히스토리 관리 함수들
var gameHistory_1 = require("./gameHistory");
Object.defineProperty(exports, "createGameHistory", { enumerable: true, get: function () { return gameHistory_1.createGameHistory; } });
Object.defineProperty(exports, "updateGameHistoryResult", { enumerable: true, get: function () { return gameHistory_1.updateGameHistoryResult; } });
Object.defineProperty(exports, "getUserGameHistoryNew", { enumerable: true, get: function () { return gameHistory_1.getUserGameHistory; } });
Object.defineProperty(exports, "getPendingGameResults", { enumerable: true, get: function () { return gameHistory_1.getPendingGameResults; } });
Object.defineProperty(exports, "getGameHistoryDetail", { enumerable: true, get: function () { return gameHistory_1.getGameHistoryDetail; } });
// 골든벨 게임 함수들
var goldenbell_game_new_1 = require("./goldenbell-game-new");
Object.defineProperty(exports, "joinGoldenBell", { enumerable: true, get: function () { return goldenbell_game_new_1.joinGoldenBell; } });
Object.defineProperty(exports, "submitGoldenBellChoice", { enumerable: true, get: function () { return goldenbell_game_new_1.submitGoldenBellChoice; } });
Object.defineProperty(exports, "getGoldenBellStatus", { enumerable: true, get: function () { return goldenbell_game_new_1.getGoldenBellStatus; } });
Object.defineProperty(exports, "submitGoldenBellDecision", { enumerable: true, get: function () { return goldenbell_game_new_1.submitGoldenBellDecision; } });
Object.defineProperty(exports, "selectTeam", { enumerable: true, get: function () { return goldenbell_game_new_1.selectTeam; } });
Object.defineProperty(exports, "createDailyGoldenBellGames", { enumerable: true, get: function () { return goldenbell_game_new_1.createDailyGoldenBellGames; } });
Object.defineProperty(exports, "createDailyGoldenBellGamesCallable", { enumerable: true, get: function () { return goldenbell_game_new_1.createDailyGoldenBellGamesCallable; } });
Object.defineProperty(exports, "startNextRound", { enumerable: true, get: function () { return goldenbell_game_new_1.startNextRound; } });
Object.defineProperty(exports, "getWaitingRoomStatus", { enumerable: true, get: function () { return goldenbell_game_new_1.getWaitingRoomStatus; } });
Object.defineProperty(exports, "getGoldenBellHistory", { enumerable: true, get: function () { return goldenbell_game_new_1.getGoldenBellHistory; } });
Object.defineProperty(exports, "saveGoldenBellResult", { enumerable: true, get: function () { return goldenbell_game_new_1.saveGoldenBellResult; } });
Object.defineProperty(exports, "checkRoundResult", { enumerable: true, get: function () { return goldenbell_game_new_1.checkRoundResult; } });
Object.defineProperty(exports, "fetchGoldenBellParticipants", { enumerable: true, get: function () { return goldenbell_game_new_1.fetchGoldenBellParticipants; } });
Object.defineProperty(exports, "fetchGoldenBellUpcomingGames", { enumerable: true, get: function () { return goldenbell_game_new_1.fetchGoldenBellUpcomingGames; } });
Object.defineProperty(exports, "updateGoldenBellRoundChoices", { enumerable: true, get: function () { return goldenbell_game_new_1.updateGoldenBellRoundChoices; } });
Object.defineProperty(exports, "updateGoldenBellParticipantReward", { enumerable: true, get: function () { return goldenbell_game_new_1.updateGoldenBellParticipantReward; } });
Object.defineProperty(exports, "getGoldenBellRoundRewards", { enumerable: true, get: function () { return goldenbell_game_new_1.getGoldenBellRoundRewards; } });
// 매칭 게임 함수들  
var matching_game_new_1 = require("./matching-game-new");
Object.defineProperty(exports, "joinMatchingGame", { enumerable: true, get: function () { return matching_game_new_1.joinMatchingGame; } });
Object.defineProperty(exports, "getMatchingGameStatus", { enumerable: true, get: function () { return matching_game_new_1.getMatchingGameStatus; } });
Object.defineProperty(exports, "getMatchingGameHistory", { enumerable: true, get: function () { return matching_game_new_1.getMatchingGameHistory; } });
Object.defineProperty(exports, "getCompletedMatchingGames", { enumerable: true, get: function () { return matching_game_new_1.getCompletedMatchingGames; } });
Object.defineProperty(exports, "createOrderGame", { enumerable: true, get: function () { return matching_game_new_1.createOrderGame; } });
Object.defineProperty(exports, "createRandomGame", { enumerable: true, get: function () { return matching_game_new_1.createRandomGame; } });
Object.defineProperty(exports, "testMatchingGameSettlement", { enumerable: true, get: function () { return matching_game_new_1.testMatchingGameSettlement; } });
Object.defineProperty(exports, "testMatchingGameWithWinningNumbers", { enumerable: true, get: function () { return matching_game_new_1.testMatchingGameWithWinningNumbers; } });
// 큐브 게임 함수들
var cube_game_new_1 = require("./cube-game-new");
Object.defineProperty(exports, "joinCubeGame", { enumerable: true, get: function () { return cube_game_new_1.joinCubeGame; } });
Object.defineProperty(exports, "getCubeGameStatus", { enumerable: true, get: function () { return cube_game_new_1.getCubeGameStatus; } });
Object.defineProperty(exports, "getCubeGamePositions", { enumerable: true, get: function () { return cube_game_new_1.getCubeGamePositions; } });
Object.defineProperty(exports, "getCurrentCubeGame", { enumerable: true, get: function () { return cube_game_new_1.getCurrentCubeGame; } });
Object.defineProperty(exports, "initializeCubeGame", { enumerable: true, get: function () { return cube_game_new_1.initializeCubeGame; } });
Object.defineProperty(exports, "getCubeGameHistory", { enumerable: true, get: function () { return cube_game_new_1.getCubeGameHistory; } });
Object.defineProperty(exports, "finalizeCubeGameHistory", { enumerable: true, get: function () { return cube_game_new_1.finalizeCubeGameHistory; } });
Object.defineProperty(exports, "processCubeGameSettlements", { enumerable: true, get: function () { return cube_game_new_1.processCubeGameSettlements; } });
Object.defineProperty(exports, "testCubeGameSettlement", { enumerable: true, get: function () { return cube_game_new_1.testCubeGameSettlement; } });
Object.defineProperty(exports, "testFillCubeGame", { enumerable: true, get: function () { return cube_game_new_1.testFillCubeGame; } });
Object.defineProperty(exports, "testCubeGameWithOracle", { enumerable: true, get: function () { return cube_game_new_1.testCubeGameWithOracle; } });
Object.defineProperty(exports, "testCubeGameWithFixedMove", { enumerable: true, get: function () { return cube_game_new_1.testCubeGameWithFixedMove; } });
Object.defineProperty(exports, "testResetCubeGame", { enumerable: true, get: function () { return cube_game_new_1.testResetCubeGame; } });
Object.defineProperty(exports, "cubeGameSettlementWorker", { enumerable: true, get: function () { return cube_game_new_1.cubeGameSettlementWorker; } });
// Admin tools
var admin_tools_1 = require("./admin-tools");
Object.defineProperty(exports, "setAllUsersVip", { enumerable: true, get: function () { return admin_tools_1.setAllUsersVip; } });
// ============================================
// PointHub 로그인 (인증 불필요 - 로그인 전이므로)
// ============================================
exports.pointHubLogin = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const { id, password } = request.data;
    if (!id || !password) {
        throw new https_2.HttpsError('invalid-argument', 'ID와 비밀번호를 입력해주세요.');
    }
    console.log('=== pointHubLogin 시작 ===');
    console.log('ID:', id);
    try {
        // 1. PointHub API로 계정 확인
        const phResult = await (0, pointhub_client_1.memberCheck)(id, password);
        console.log('PointHub 응답:', JSON.stringify(phResult));
        // PointHub 인증 실패
        if (!phResult.success) {
            const errorMsg = `[${phResult.code}] ${phResult.message || 'PointHub 인증에 실패했습니다.'}`;
            console.log('PointHub 인증 실패:', errorMsg);
            throw new https_2.HttpsError('unauthenticated', errorMsg);
        }
        // 2. Firebase Auth 계정 확인/생성
        const email = `${id}@pointhub.local`; // PointHub ID를 이메일 형식으로 변환
        let firebaseUser;
        try {
            // 기존 사용자 확인
            firebaseUser = await firebase_config_1.default.auth().getUserByEmail(email);
            console.log('기존 Firebase 사용자 발견:', firebaseUser.uid);
        }
        catch (error) {
            // 사용자가 없으면 생성
            if (error.code === 'auth/user-not-found') {
                console.log('새 Firebase 사용자 생성 중...');
                firebaseUser = await firebase_config_1.default.auth().createUser({
                    email: email,
                    password: password,
                    displayName: id // PointHub API는 nickname을 반환하지 않으므로 id 사용
                });
                console.log('새 Firebase 사용자 생성됨:', firebaseUser.uid);
                // 사용자 프로필 초기화
                const userProfile = {
                    createdAt: Date.now()
                };
                const userWallet = {
                    usdt: 100,
                    ivy: 0,
                    pending: 0
                };
                await firebase_config_1.rtdb.ref(`/users/${firebaseUser.uid}`).set({
                    auth: {
                        uid: firebaseUser.uid,
                        email: email,
                        emailVerified: false
                    },
                    profile: userProfile,
                    wallet: userWallet,
                    pointHub: {
                        id: id,
                        mbid: (_a = phResult.data) === null || _a === void 0 ? void 0 : _a.mbid,
                        mbid2: (_b = phResult.data) === null || _b === void 0 ? void 0 : _b.mbid2
                    }
                });
                // 회원가입 보너스 Ledger 기록
                const ledgerEntry = {
                    type: 'credit',
                    amountUsd: 100,
                    meta: {
                        operation: 'signup_bonus',
                        description: 'Welcome bonus for new user (PointHub)',
                        timestamp: Date.now()
                    },
                    createdAt: Date.now()
                };
                await firebase_config_1.rtdb.ref(`/ledger/${firebaseUser.uid}`).push(ledgerEntry);
            }
            else {
                throw error;
            }
        }
        // 3. PointHub GPoint 잔액 조회
        let gpointBalance = 0;
        if (((_c = phResult.data) === null || _c === void 0 ? void 0 : _c.mbid) && ((_d = phResult.data) === null || _d === void 0 ? void 0 : _d.mbid2)) {
            console.log('GPoint 잔액 조회 중...');
            const gpointResult = await (0, pointhub_client_1.gpointSelect)(phResult.data.mbid, phResult.data.mbid2);
            if (gpointResult.success && gpointResult.data) {
                gpointBalance = gpointResult.data.balance || 0;
                console.log('GPoint 잔액:', gpointBalance);
            }
            else {
                console.log('GPoint 잔액 조회 실패 (기본값 0 사용):', gpointResult.message);
            }
        }
        // 4. Custom Token 생성
        const customToken = await firebase_config_1.default.auth().createCustomToken(firebaseUser.uid, {
            pointHubId: id,
            mbid: (_e = phResult.data) === null || _e === void 0 ? void 0 : _e.mbid,
            mbid2: (_f = phResult.data) === null || _f === void 0 ? void 0 : _f.mbid2
        });
        // 5. Firebase wallet에 GPoint 잔액 동기화
        await firebase_config_1.rtdb.ref(`/users/${firebaseUser.uid}/wallet/usdt`).set(gpointBalance);
        console.log('=== pointHubLogin 완료 ===');
        return {
            success: true,
            customToken: customToken,
            user: {
                uid: firebaseUser.uid,
                email: email,
                displayName: id,
                pointHub: {
                    id: id,
                    mbid: (_g = phResult.data) === null || _g === void 0 ? void 0 : _g.mbid,
                    mbid2: (_h = phResult.data) === null || _h === void 0 ? void 0 : _h.mbid2
                },
                wallet: {
                    gpoint: gpointBalance
                }
            }
        };
    }
    catch (error) {
        console.error('pointHubLogin 에러:', error);
        if (error instanceof https_2.HttpsError) {
            throw error;
        }
        throw new https_2.HttpsError('internal', '로그인 처리 중 오류가 발생했습니다.');
    }
});
// User initialization on account creation
exports.createUserProfile = (0, https_1.onCall)(async (request) => {
    // Allow testing without authentication
    const uid = request.data.uid || (request.auth ? request.auth.uid : 'test-user');
    const email = request.data.email || (request.auth ? request.auth.token.email : 'test@example.com');
    const userProfile = {
        createdAt: Date.now()
    };
    // 회원가입 시 기본 100달러 지급
    const userWallet = {
        usdt: 100, // 기본 100달러 지급
        ivy: 0,
        pending: 0
    };
    // 사용자 프로필 및 지갑 초기화
    await firebase_config_1.rtdb.ref(`/users/${uid}`).set({
        auth: {
            uid,
            email,
            emailVerified: (request.auth && request.auth.token.email_verified) || false
        },
        profile: userProfile,
        wallet: userWallet
    });
    // 회원가입 보너스 Ledger 기록
    const ledgerEntry = {
        type: 'credit',
        amountUsd: 100,
        meta: {
            operation: 'signup_bonus',
            description: 'Welcome bonus for new user',
            timestamp: Date.now()
        },
        createdAt: Date.now()
    };
    await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push(ledgerEntry);
    console.log(`User ${uid} (${email}) initialized with $100 welcome bonus`);
    return { success: true, uid, email };
});
// Server-side credit function
exports.credit = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    const { amount, type, meta = {} } = request.data;
    if (!amount || amount <= 0) {
        throw new Error('Invalid amount');
    }
    try {
        // Update wallet balance atomically
        await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
            return (currentBalance || 0) + amount;
        });
        // Record transaction in ledger
        const ledgerEntry = {
            type: 'credit',
            amountUsd: amount,
            meta: { ...meta, operation: type },
            createdAt: Date.now()
        };
        await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push(ledgerEntry);
        console.log(`Credited ${amount} USDT to user ${uid}`);
        return { success: true, amount, balance: await getCurrentBalance(uid) };
    }
    catch (error) {
        console.error('Credit operation failed:', error);
        throw new Error('Credit operation failed');
    }
});
// Server-side debit function
// ⚠️ 중요: 이 함수는 무조건 USDT만 사용합니다. 다른 통화는 지원하지 않습니다.
exports.debit = (0, https_1.onCall)(async (request) => {
    var _a, _b;
    // USDT 전용 상수 정의 (절대 변경 불가)
    const CURRENCY = 'usdt'; // 소문자로 고정, 대소문자 구분 없음
    if (!request.auth) {
        throw new https_2.HttpsError('unauthenticated', 'Authentication required');
    }
    const { uid } = request.auth;
    // 요청 데이터 로깅 (디버깅용)
    console.log(`[debit] Request data:`, JSON.stringify(request.data));
    console.log(`[debit] Request data type:`, typeof request.data);
    const { amount, type, meta = {} } = request.data || {};
    // currency 파라미터가 있어도 완전히 무시 (USDT만 사용)
    if ((_a = request.data) === null || _a === void 0 ? void 0 : _a.currency) {
        console.warn(`[debit] Currency parameter '${request.data.currency}' ignored. This function only uses USDT.`);
    }
    // amount 파라미터 검증 (더 엄격하게)
    if (amount === undefined || amount === null) {
        console.error(`[debit] Amount is missing. Request data:`, request.data);
        throw new https_2.HttpsError('invalid-argument', 'Amount parameter is required.');
    }
    // 숫자로 변환 시도
    const amountNumber = typeof amount === 'number' ? amount : parseFloat(String(amount));
    if (isNaN(amountNumber) || !isFinite(amountNumber)) {
        console.error(`[debit] Invalid amount format: ${amount} (type: ${typeof amount})`);
        throw new https_2.HttpsError('invalid-argument', `Invalid amount format. Expected number, got: ${typeof amount}`);
    }
    if (amountNumber <= 0) {
        console.error(`[debit] Amount must be greater than 0. Got: ${amountNumber}`);
        throw new https_2.HttpsError('invalid-argument', `Amount must be greater than 0. Got: ${amountNumber}`);
    }
    try {
        console.log(`[debit] Processing debit for user ${uid}, amount: ${amountNumber} USDT, type: ${type || 'unknown'}`);
        // ⚠️ 중요: 무조건 USDT 기준으로만 처리 (하드코딩, 절대 변경 불가)
        // - request.data에 currency 파라미터가 있어도 완전히 무시
        // - 다른 통화 타입이나 wallet 경로 사용 절대 금지
        // - 모든 debit 작업은 반드시 /users/{uid}/wallet/usdt 경로만 사용
        // 이전 문제점:
        // 1. 트랜잭션 결과(committed 속성)를 확인하지 않아서 실제 실패 여부를 알 수 없었음
        // 2. transactionSuccess 변수가 트랜잭션 콜백 외부에서 설정되어 제대로 동작하지 않았음
        // 3. 일반 Error를 throw해서 클라이언트에 명확한 에러 정보가 전달되지 않았음
        // 4. 트랜잭션 전에 잔액을 확인하는 것이 race condition을 유발함
        // USDT wallet 경로 (절대 변경 불가, 함수 시작 부분의 CURRENCY 상수 사용)
        const walletPath = `/users/${uid}/wallet/${CURRENCY}`;
        console.log(`[debit] Using wallet path: ${walletPath} (USDT only, hardcoded)`);
        // matching-game-new.ts와 동일한 패턴: 트랜잭션 전 잔액 확인
        // 주의: 이 잔액은 fallback용이며, 실제 차감은 트랜잭션 내부에서 수행
        const preTransactionSnapshot = await firebase_config_1.rtdb.ref(walletPath).once('value');
        const expectedBalance = preTransactionSnapshot.val() || 0;
        console.log(`[debit] Pre-transaction balance: ${expectedBalance} USDT (for fallback only, transaction uses DB value)`);
        // ⚠️ 중요: 트랜잭션 내부에서만 잔액 확인 및 차감
        // matching-game-new.ts와 동일한 패턴:
        // 1. 트랜잭션 내부에서 balance를 읽음 (원자적, 최신 값)
        // 2. balance가 null/undefined이면 expectedBalance를 fallback으로 사용
        // 3. 트랜잭션은 충돌 시 자동 재시도되므로 항상 최신 값을 읽음
        console.log(`[debit] Starting transaction on path: ${walletPath}`);
        const transactionResult = await firebase_config_1.rtdb.ref(walletPath).transaction((currentBalance) => {
            // matching-game-new.ts 패턴: balance가 null/undefined이면 expectedBalance 사용
            const balance = currentBalance !== null && currentBalance !== undefined ? currentBalance : expectedBalance;
            const current = Number(balance) || 0;
            console.log(`[debit] Transaction callback - currentBalance from DB: ${JSON.stringify(currentBalance)}, using balance: ${current}, expected: ${expectedBalance}, required: ${amountNumber}`);
            // 잔액 부족 체크 (트랜잭션 내부에서 확인)
            if (current < amountNumber) {
                console.error(`[debit] Transaction aborting - insufficient balance: ${current} < ${amountNumber}`);
                return; // Abort transaction - insufficient balance (undefined 반환)
            }
            // 잔액 차감
            const newBalance = current - amountNumber;
            console.log(`[debit] Transaction committing - newBalance: ${newBalance} USDT`);
            return newBalance;
        });
        if (!transactionResult.committed) {
            // 트랜잭션이 abort된 경우, snapshot에서 최종 잔액 확인
            const finalBalance = ((_b = transactionResult.snapshot) === null || _b === void 0 ? void 0 : _b.val()) || 0;
            console.error(`[debit] Transaction aborted. Final balance in DB: ${finalBalance}, Required: ${amountNumber}`);
            // 더 명확한 에러 메시지
            throw new https_2.HttpsError('failed-precondition', `Insufficient balance. Current balance: ${finalBalance} USDT, Required: ${amountNumber} USDT`);
        }
        const newBalance = transactionResult.snapshot.val() || 0;
        console.log(`[debit] Transaction committed. New balance: ${newBalance}`);
        // Record transaction in ledger
        try {
            const ledgerEntry = {
                type: 'debit',
                amountUsd: -amountNumber,
                meta: { ...meta, operation: type || 'debit' },
                createdAt: Date.now()
            };
            await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push(ledgerEntry);
            console.log(`[debit] Ledger entry recorded for user ${uid}`);
        }
        catch (ledgerError) {
            console.error(`[debit] Failed to record ledger entry for user ${uid}:`, ledgerError);
            // Ledger 기록 실패는 치명적이지 않으므로 계속 진행
        }
        console.log(`[debit] Successfully debited ${amountNumber} USDT from user ${uid}. New balance: ${newBalance}`);
        return {
            success: true,
            amount: amountNumber,
            balance: newBalance
        };
    }
    catch (error) {
        console.error('[debit] Debit operation failed:', error);
        if (error instanceof https_2.HttpsError) {
            throw error;
        }
        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        throw new https_2.HttpsError('internal', `Debit operation failed: ${errorMessage}`);
    }
});
// Helper function to get current balance
async function getCurrentBalance(uid) {
    const snapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
    return snapshot.val() || 0;
}
// Golden Bell Daily Scheduler - generate entire day at 00:00 UTC
exports.goldenBellDailyScheduler = (0, scheduler_1.onSchedule)({
    schedule: "0 0 * * *", // 매일 자정
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { createDailyGoldenBellGames } = await Promise.resolve().then(() => __importStar(require('./goldenbell-game-new')));
        await createDailyGoldenBellGames();
        console.log('Daily Golden Bell schedule generated successfully');
    }
    catch (error) {
        console.error('Daily Golden Bell schedule generation failed:', error);
    }
});
// Golden Bell Recovery Scheduler - runs at 5,10,15... minute marks to ensure today's schedule exists
exports.goldenBellRecoveryScheduler = (0, scheduler_1.onSchedule)({
    schedule: "5,10,15,20,25,30,35,40,45,50,55 * * * *",
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { ensureTodayGoldenBellSchedule } = await Promise.resolve().then(() => __importStar(require('./goldenbell-game-new')));
        await ensureTodayGoldenBellSchedule();
        console.log('Golden Bell recovery check completed');
    }
    catch (error) {
        console.error('Golden Bell recovery scheduler failed:', error);
    }
});
// Golden Bell Round Scheduler - every 1 minute (라운드 시작 관리)
exports.goldenBellRoundScheduler = (0, scheduler_1.onSchedule)({
    schedule: "* * * * *", // 매 1분마다
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { startNextRound } = await Promise.resolve().then(() => __importStar(require('./goldenbell-game-new')));
        await startNextRound();
    }
    catch (error) {
        console.error('Golden Bell round scheduling failed:', error);
    }
});
// Matching Game ORDER Scheduler - daily at 00:00 UTC
exports.matchingOrderScheduler = (0, scheduler_1.onSchedule)({
    schedule: "0 0 * * *", // 매일 자정
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { createOrderGame } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
        await createOrderGame();
        console.log('ORDER matching game scheduled successfully');
    }
    catch (error) {
        console.error('ORDER matching game scheduling failed:', error);
    }
});
// Matching Game RANDOM Scheduler - every 6 hours
exports.matchingRandomScheduler = (0, scheduler_1.onSchedule)({
    schedule: "0 */6 * * *", // 매 6시간마다
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { createRandomGame } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
        await createRandomGame();
        console.log('RANDOM matching game scheduled successfully');
    }
    catch (error) {
        console.error('RANDOM matching game scheduling failed:', error);
    }
});
// Matching Game Settlement Scheduler - every 1 minute (게임 종료 체크 및 결과 계산)
exports.matchingGameSettlementScheduler = (0, scheduler_1.onSchedule)({
    schedule: "* * * * *", // 매 1분마다
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { processMatchingGameSettlements } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
        await processMatchingGameSettlements();
    }
    catch (error) {
        console.error('Matching game settlement scheduling failed:', error);
    }
});
// Cube Game Settlement Scheduler - every 1 minute (게임 종료 체크, 결과 계산, 새 게임 생성)
exports.cubeGameSettlementScheduler = (0, scheduler_1.onSchedule)({
    schedule: "* * * * *", // 매 1분마다
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    try {
        const { processCubeGameSettlements } = await Promise.resolve().then(() => __importStar(require('./cube-game-new')));
        await processCubeGameSettlements();
    }
    catch (error) {
        console.error('Cube game settlement scheduling failed:', error);
    }
});
// ============================================
// Gpoint 동기화 스케줄러 (PointHub → Firebase)
// ============================================
/**
 * Gpoint 6시간 동기화 스케줄러
 * UTC 00:00, 06:00, 12:00, 18:00에 실행
 *
 * PointHub에서 충전된 Gpoint를 Firebase wallet에 동기화
 * GPorder 배치(:40)보다 먼저 실행되어 최신 잔액 반영
 */
exports.gpointSyncScheduler = (0, scheduler_1.onSchedule)({
    schedule: "0 0,6,12,18 * * *", // UTC 00:00, 06:00, 12:00, 18:00
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    var _a;
    console.log('[Gpoint Sync] Starting 6-hour sync...');
    try {
        // 1. PointHub 데이터가 있는 모든 사용자 조회
        const usersSnapshot = await firebase_config_1.rtdb.ref('/users').once('value');
        if (!usersSnapshot.exists()) {
            console.log('[Gpoint Sync] No users found');
            return;
        }
        const usersData = usersSnapshot.val();
        const userIds = Object.keys(usersData);
        let syncedCount = 0;
        let errorCount = 0;
        const syncResults = [];
        // 2. 각 사용자별로 Gpoint 동기화
        for (const uid of userIds) {
            const userData = usersData[uid];
            const pointHubData = userData === null || userData === void 0 ? void 0 : userData.pointHub;
            // PointHub 연동이 없는 사용자 스킵
            if (!(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid) || !(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid2)) {
                continue;
            }
            try {
                // 현재 Firebase 잔액 조회
                const currentBalance = ((_a = userData === null || userData === void 0 ? void 0 : userData.wallet) === null || _a === void 0 ? void 0 : _a.usdt) || 0;
                // PointHub에서 Gpoint 잔액 조회
                const gpointResult = await (0, pointhub_client_1.gpointSelect)(pointHubData.mbid, pointHubData.mbid2);
                if (gpointResult.success && gpointResult.data) {
                    const newBalance = gpointResult.data.balance || 0;
                    // 잔액이 다를 경우에만 업데이트
                    if (currentBalance !== newBalance) {
                        await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).set(newBalance);
                        // 동기화 로그 기록
                        await firebase_config_1.rtdb.ref(`/gpoint_sync_logs/${uid}`).push({
                            timestamp: Date.now(),
                            oldBalance: currentBalance,
                            newBalance: newBalance,
                            diff: newBalance - currentBalance
                        });
                        console.log(`[Gpoint Sync] ${uid}: ${currentBalance} → ${newBalance} (diff: ${newBalance - currentBalance})`);
                        syncResults.push({ uid, success: true, oldBalance: currentBalance, newBalance });
                    }
                    syncedCount++;
                }
                else {
                    console.error(`[Gpoint Sync] Failed for ${uid}: ${gpointResult.message}`);
                    syncResults.push({ uid, success: false, error: gpointResult.message });
                    errorCount++;
                }
            }
            catch (error) {
                console.error(`[Gpoint Sync] Error for ${uid}:`, error);
                syncResults.push({ uid, success: false, error: error instanceof Error ? error.message : 'Unknown error' });
                errorCount++;
            }
            // API 호출 간 딜레이 (rate limiting 방지)
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // 3. 배치 로그 기록
        await firebase_config_1.rtdb.ref('/gpoint_sync_batch_logs').push({
            timestamp: Date.now(),
            totalUsers: userIds.length,
            syncedCount,
            errorCount,
            results: syncResults.filter(r => r.oldBalance !== r.newBalance || !r.success) // 변경된 것만 기록
        });
        console.log(`[Gpoint Sync] Completed. Synced: ${syncedCount}, Errors: ${errorCount}`);
    }
    catch (error) {
        console.error('[Gpoint Sync] Scheduler failed:', error);
        // 에러 로그 기록
        await firebase_config_1.rtdb.ref('/gpoint_sync_batch_logs').push({
            timestamp: Date.now(),
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * [TEST ONLY] Gpoint 동기화 수동 실행 - 에뮬레이터 테스트용
 */
exports.testGpointSync = (0, https_1.onCall)(async (request) => {
    var _a;
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    try {
        const usersSnapshot = await firebase_config_1.rtdb.ref('/users').once('value');
        if (!usersSnapshot.exists()) {
            return { success: true, message: 'No users found', syncedCount: 0 };
        }
        const usersData = usersSnapshot.val();
        const userIds = Object.keys(usersData);
        let syncedCount = 0;
        let changedCount = 0;
        const results = [];
        for (const uid of userIds) {
            const userData = usersData[uid];
            const pointHubData = userData === null || userData === void 0 ? void 0 : userData.pointHub;
            if (!(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid) || !(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid2)) {
                continue;
            }
            const currentBalance = ((_a = userData === null || userData === void 0 ? void 0 : userData.wallet) === null || _a === void 0 ? void 0 : _a.usdt) || 0;
            const gpointResult = await (0, pointhub_client_1.gpointSelect)(pointHubData.mbid, pointHubData.mbid2);
            if (gpointResult.success && gpointResult.data) {
                const newBalance = gpointResult.data.balance || 0;
                const changed = currentBalance !== newBalance;
                if (changed) {
                    await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).set(newBalance);
                    changedCount++;
                }
                results.push({
                    uid,
                    mbid: pointHubData.mbid,
                    mbid2: pointHubData.mbid2,
                    oldBalance: currentBalance,
                    newBalance,
                    changed
                });
                syncedCount++;
            }
        }
        return {
            success: true,
            message: `Gpoint sync completed (TEST MODE)`,
            totalUsers: userIds.length,
            syncedCount,
            changedCount,
            results
        };
    }
    catch (error) {
        console.error('[TEST] Gpoint sync failed:', error);
        throw new https_2.HttpsError('internal', error instanceof Error ? error.message : 'Unknown error');
    }
});
// ============================================
// GPorder 대기열 및 배치 처리
// ============================================
/**
 * GPorder 대기열에 항목 추가
 * 게임에서 매출 발생 시 호출
 *
 * @param uid 사용자 Firebase UID
 * @param amount 금액
 * @param orderType 03: 게임매출1 (20%), 04: 게임매출2 (골든벨 미당첨)
 * @param gameType 게임 종류 (matching, goldenbell, cube 등)
 * @param gameId 게임 ID
 */
async function addToGporderQueue(uid, amount, orderType, gameType, gameId) {
    try {
        // 사용자의 PointHub 정보 조회
        const userSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/pointHub`).once('value');
        const pointHubData = userSnapshot.val();
        if (!(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid) || !(pointHubData === null || pointHubData === void 0 ? void 0 : pointHubData.mbid2)) {
            console.error(`[GPorder Queue] User ${uid} has no PointHub data`);
            return false;
        }
        // 대기열에 추가
        const queueItem = {
            uid,
            mbid: pointHubData.mbid,
            mbid2: pointHubData.mbid2,
            amount,
            orderType,
            gameType,
            gameId,
            createdAt: Date.now(),
            status: 'pending'
        };
        await firebase_config_1.rtdb.ref('/gporder_queue').push(queueItem);
        console.log(`[GPorder Queue] Added: ${uid}, amount: ${amount}, type: ${orderType}`);
        return true;
    }
    catch (error) {
        console.error('[GPorder Queue] Error adding to queue:', error);
        return false;
    }
}
/**
 * GPorder 배치 처리 스케줄러
 * UTC 00:40, 06:40, 12:40, 18:40에 실행
 * 대기열의 모든 pending 항목을 모아서 PointHub API로 일괄 전송
 */
exports.gporderBatchScheduler = (0, scheduler_1.onSchedule)({
    schedule: "40 0,6,12,18 * * *", // UTC 00:40, 06:40, 12:40, 18:40
    timeZone: "UTC",
    region: "asia-northeast3"
}, async () => {
    console.log('[GPorder Batch] Starting batch processing...');
    try {
        // 1. pending 상태의 모든 대기열 항목 조회
        const queueSnapshot = await firebase_config_1.rtdb.ref('/gporder_queue')
            .orderByChild('status')
            .equalTo('pending')
            .once('value');
        if (!queueSnapshot.exists()) {
            console.log('[GPorder Batch] No pending items in queue');
            return;
        }
        const queueData = queueSnapshot.val();
        const queueKeys = Object.keys(queueData);
        console.log(`[GPorder Batch] Found ${queueKeys.length} pending items`);
        // 2. GporderTransferItem 배열로 변환
        const transferItems = [];
        const processedKeys = [];
        for (const key of queueKeys) {
            const item = queueData[key];
            transferItems.push({
                mbid: item.mbid,
                mbid2: item.mbid2,
                amount: item.amount,
                Ordertype: item.orderType,
                memo: `${item.gameType}:${item.gameId}`
            });
            processedKeys.push(key);
        }
        if (transferItems.length === 0) {
            console.log('[GPorder Batch] No items to transfer');
            return;
        }
        // 3. 대기열 항목들을 'processing' 상태로 변경
        const processingUpdates = {};
        for (const key of processedKeys) {
            processingUpdates[`/gporder_queue/${key}/status`] = 'processing';
            processingUpdates[`/gporder_queue/${key}/processingStartedAt`] = Date.now();
        }
        await firebase_config_1.rtdb.ref().update(processingUpdates);
        // 4. PointHub API 호출
        console.log(`[GPorder Batch] Sending ${transferItems.length} items to PointHub...`);
        const result = await (0, pointhub_client_1.gporderTransfer)(transferItems);
        // 5. 결과에 따라 상태 업데이트
        const resultUpdates = {};
        const completedAt = Date.now();
        if (result.success) {
            console.log(`[GPorder Batch] Transfer successful: ${result.message}`);
            for (const key of processedKeys) {
                resultUpdates[`/gporder_queue/${key}/status`] = 'completed';
                resultUpdates[`/gporder_queue/${key}/completedAt`] = completedAt;
                resultUpdates[`/gporder_queue/${key}/result`] = {
                    success: true,
                    code: result.code,
                    message: result.message
                };
            }
        }
        else {
            console.error(`[GPorder Batch] Transfer failed: ${result.message}`);
            for (const key of processedKeys) {
                resultUpdates[`/gporder_queue/${key}/status`] = 'failed';
                resultUpdates[`/gporder_queue/${key}/failedAt`] = completedAt;
                resultUpdates[`/gporder_queue/${key}/result`] = {
                    success: false,
                    code: result.code,
                    message: result.message
                };
            }
        }
        await firebase_config_1.rtdb.ref().update(resultUpdates);
        // 6. 완료된 항목 로그 기록
        await firebase_config_1.rtdb.ref('/gporder_batch_logs').push({
            timestamp: completedAt,
            itemCount: transferItems.length,
            success: result.success,
            code: result.code,
            message: result.message
        });
        console.log(`[GPorder Batch] Batch processing completed. Success: ${result.success}`);
    }
    catch (error) {
        console.error('[GPorder Batch] Batch processing failed:', error);
        // 에러 로그 기록
        await firebase_config_1.rtdb.ref('/gporder_batch_logs').push({
            timestamp: Date.now(),
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});
/**
 * [TEST ONLY] GPorder 대기열 수동 처리 - 에뮬레이터 테스트용
 */
exports.testProcessGporderQueue = (0, https_1.onCall)(async (request) => {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    try {
        // pending 상태의 모든 대기열 항목 조회
        const queueSnapshot = await firebase_config_1.rtdb.ref('/gporder_queue')
            .orderByChild('status')
            .equalTo('pending')
            .once('value');
        if (!queueSnapshot.exists()) {
            return { success: true, message: 'No pending items in queue', itemCount: 0 };
        }
        const queueData = queueSnapshot.val();
        const queueKeys = Object.keys(queueData);
        // GporderTransferItem 배열로 변환
        const transferItems = [];
        for (const key of queueKeys) {
            const item = queueData[key];
            transferItems.push({
                mbid: item.mbid,
                mbid2: item.mbid2,
                amount: item.amount,
                Ordertype: item.orderType,
                memo: `${item.gameType}:${item.gameId}`
            });
        }
        // PointHub API 호출
        const result = await (0, pointhub_client_1.gporderTransfer)(transferItems);
        // 상태 업데이트
        const updates = {};
        for (const key of queueKeys) {
            updates[`/gporder_queue/${key}/status`] = result.success ? 'completed' : 'failed';
            updates[`/gporder_queue/${key}/processedAt`] = Date.now();
            updates[`/gporder_queue/${key}/result`] = {
                success: result.success,
                code: result.code,
                message: result.message
            };
        }
        await firebase_config_1.rtdb.ref().update(updates);
        return {
            success: result.success,
            message: result.message,
            itemCount: transferItems.length,
            code: result.code
        };
    }
    catch (error) {
        console.error('[TEST] GPorder queue processing failed:', error);
        throw new https_2.HttpsError('internal', error instanceof Error ? error.message : 'Unknown error');
    }
});
/**
 * [TEST ONLY] GPorder 대기열에 테스트 항목 추가 - 에뮬레이터 테스트용
 */
exports.testAddToGporderQueue = (0, https_1.onCall)(async (request) => {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    if (!request.auth) {
        throw new https_2.HttpsError('unauthenticated', 'Authentication required');
    }
    const { amount, orderType, gameType, gameId } = request.data;
    if (!amount || !orderType) {
        throw new https_2.HttpsError('invalid-argument', 'amount and orderType are required');
    }
    const success = await addToGporderQueue(request.auth.uid, amount, orderType, gameType || 'test', gameId || `test-${Date.now()}`);
    return {
        success,
        message: success ? 'Added to GPorder queue' : 'Failed to add to queue'
    };
});
// Cryptocurrency price oracle - runs every 30 seconds
exports.oracleSnapshot = (0, scheduler_1.onSchedule)({
    schedule: "every 1 minutes",
    timeZone: "Asia/Seoul",
    region: "asia-northeast3"
}, async () => {
    try {
        // API 호출은 Binance.US의 USD 페어 사용 (실제 USD 가격)
        const cryptoPairsUSD = ["BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD", "DOGEUSD", "TRXUSD"];
        // 저장은 USDT 필드명 유지 (기존 구조 호환성)
        const cryptoPairsUSDT = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT"];
        const priceData = {};
        const gameNumbers = {};
        // Fetch prices from Binance.US API (실제 USD 가격)
        for (let i = 0; i < cryptoPairsUSD.length; i++) {
            const symbolUSD = cryptoPairsUSD[i];
            const symbolUSDT = cryptoPairsUSDT[i]; // 저장용 키
            try {
                const response = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${symbolUSD}`);
                const data = await response.json();
                const price = parseFloat(data.price);
                // USDT 키로 저장 (기존 구조 유지)
                priceData[symbolUSDT] = data.price;
                // Extract second decimal digit for matching game
                const priceStr = price.toFixed(2);
                const secondDecimal = parseInt(priceStr.split('.')[1][1]);
                gameNumbers[symbolUSD.replace('USD', '')] = secondDecimal;
            }
            catch (error) {
                console.error(`Failed to fetch price for ${symbolUSD}:`, error);
                // Continue with other symbols even if one fails
            }
        }
        if (Object.keys(priceData).length > 0) {
            const timestamp = Date.now();
            await firebase_config_1.rtdb.ref(`/oracle/binance/${timestamp}`).set({
                prices: priceData,
                gameNumbers: gameNumbers,
                timestamp: timestamp
            });
            // Update current prices reference for easy access
            await firebase_config_1.rtdb.ref('/oracle/current').set({
                prices: priceData,
                gameNumbers: gameNumbers,
                timestamp: timestamp
            });
            console.log(`Oracle snapshot saved:`, { priceData, gameNumbers });
            // Clean up old snapshots (keep last 24 hours)
            await cleanupOldSnapshots();
        }
    }
    catch (error) {
        console.error('Oracle snapshot failed:', error);
    }
});
// [TEST ONLY] Manual Oracle Update - 에뮬레이터 테스트용
// 프로덕션에서는 사용 불가 (FUNCTIONS_EMULATOR 환경변수 체크)
exports.testUpdateOracle = (0, https_1.onCall)(async (request) => {
    // 에뮬레이터 환경 체크
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    try {
        // Binance.US API에서 실제 가격 가져오기
        const cryptoPairsUSD = ["BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD", "DOGEUSD", "TRXUSD"];
        const cryptoPairsUSDT = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT"];
        const priceData = {};
        const gameNumbers = {};
        for (let i = 0; i < cryptoPairsUSD.length; i++) {
            const symbolUSD = cryptoPairsUSD[i];
            const symbolUSDT = cryptoPairsUSDT[i];
            try {
                const response = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${symbolUSD}`);
                const data = await response.json();
                const price = parseFloat(data.price);
                priceData[symbolUSDT] = data.price;
                const priceStr = price.toFixed(2);
                const secondDecimal = parseInt(priceStr.split('.')[1][1]);
                gameNumbers[symbolUSD.replace('USD', '')] = secondDecimal;
            }
            catch (error) {
                console.error(`Failed to fetch price for ${symbolUSD}:`, error);
            }
        }
        if (Object.keys(priceData).length > 0) {
            const timestamp = Date.now();
            await firebase_config_1.rtdb.ref('/oracle/current').set({
                prices: priceData,
                gameNumbers: gameNumbers,
                timestamp: timestamp
            });
            console.log('[TEST] Oracle data updated:', { priceData, gameNumbers });
            return {
                success: true,
                message: 'Oracle data updated successfully (TEST MODE)',
                data: {
                    prices: priceData,
                    gameNumbers: gameNumbers,
                    timestamp: timestamp
                }
            };
        }
        throw new Error('Failed to fetch any price data');
    }
    catch (error) {
        console.error('[TEST] Oracle update failed:', error);
        throw new https_2.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Oracle update failed');
    }
});
// [TEST ONLY] Create Matching Games - 에뮬레이터 테스트용
exports.testCreateMatchingGame = (0, https_1.onCall)(async (request) => {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    try {
        const { createOrderGame, createRandomGame } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
        // ORDER 게임 생성
        await createOrderGame();
        console.log('[TEST] ORDER matching game created');
        // RANDOM 게임 생성
        await createRandomGame();
        console.log('[TEST] RANDOM matching game created');
        return {
            success: true,
            message: 'Matching games created successfully (TEST MODE)'
        };
    }
    catch (error) {
        console.error('[TEST] Matching game creation failed:', error);
        throw new https_2.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Matching game creation failed');
    }
});
// [TEST ONLY] Initialize All Test Data - 모든 테스트 데이터 한번에 초기화
exports.testInitializeAll = (0, https_1.onCall)(async (request) => {
    const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
    if (!isEmulator) {
        throw new https_2.HttpsError('failed-precondition', 'This function is only available in emulator mode');
    }
    const results = [];
    try {
        // 1. Oracle 데이터 초기화
        const cryptoPairsUSD = ["BTCUSD", "ETHUSD", "XRPUSD", "BNBUSD", "SOLUSD", "DOGEUSD", "TRXUSD"];
        const cryptoPairsUSDT = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT"];
        const priceData = {};
        const gameNumbers = {};
        for (let i = 0; i < cryptoPairsUSD.length; i++) {
            try {
                const response = await fetch(`https://api.binance.us/api/v3/ticker/price?symbol=${cryptoPairsUSD[i]}`);
                const data = await response.json();
                const price = parseFloat(data.price);
                priceData[cryptoPairsUSDT[i]] = data.price;
                gameNumbers[cryptoPairsUSD[i].replace('USD', '')] = parseInt(price.toFixed(2).split('.')[1][1]);
            }
            catch (e) {
                console.error(`Failed to fetch ${cryptoPairsUSD[i]}`);
            }
        }
        if (Object.keys(priceData).length > 0) {
            await firebase_config_1.rtdb.ref('/oracle/current').set({
                prices: priceData,
                gameNumbers: gameNumbers,
                timestamp: Date.now()
            });
            results.push('✅ Oracle data initialized');
        }
        // 2. 매칭 게임 생성
        const { createOrderGame, createRandomGame } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
        await createOrderGame();
        results.push('✅ ORDER matching game created');
        await createRandomGame();
        results.push('✅ RANDOM matching game created');
        // 3. 골든벨 게임 생성
        try {
            const { createDailyGoldenBellGames } = await Promise.resolve().then(() => __importStar(require('./goldenbell-game-new')));
            await createDailyGoldenBellGames();
            results.push('✅ Golden Bell games created');
        }
        catch (e) {
            results.push('⚠️ Golden Bell games skipped (may already exist)');
        }
        // 4. 큐브 게임 생성
        try {
            const { createNewCubeGame } = await Promise.resolve().then(() => __importStar(require('./cube-game-new')));
            await createNewCubeGame();
            results.push('✅ Cube game created');
        }
        catch (e) {
            results.push('⚠️ Cube game skipped (may already exist)');
        }
        console.log('[TEST] All test data initialized:', results);
        return {
            success: true,
            message: 'All test data initialized (TEST MODE)',
            results: results
        };
    }
    catch (error) {
        console.error('[TEST] Initialization failed:', error);
        throw new https_2.HttpsError('internal', (error === null || error === void 0 ? void 0 : error.message) || 'Initialization failed');
    }
});
// Helper function to clean up old oracle snapshots
async function cleanupOldSnapshots() {
    try {
        const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
        const oracleRef = firebase_config_1.rtdb.ref('/oracle/binance');
        // Get all snapshots older than 24 hours
        const oldSnapshotsSnapshot = await oracleRef
            .orderByKey()
            .endAt(oneDayAgo.toString())
            .once('value');
        if (oldSnapshotsSnapshot.exists()) {
            const updates = {};
            oldSnapshotsSnapshot.forEach((child) => {
                updates[child.key] = null;
            });
            await oracleRef.update(updates);
            console.log(`Cleaned up ${Object.keys(updates).length} old snapshots`);
        }
    }
    catch (error) {
        console.error('Snapshot cleanup failed:', error);
    }
}
// Get Server Time - for client-side time synchronization
// Rate limiting: Store last call time per user
const lastServerTimeCalls = new Map();
const MIN_CALL_INTERVAL_MS = 1000; // 최소 1초 간격
exports.getServerTime = (0, https_1.onCall)(async (request) => {
    var _a;
    try {
        // Rate limiting: 같은 사용자가 너무 자주 호출하지 않도록 제한
        const uid = ((_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid) || request.rawRequest.ip || 'anonymous';
        const now = Date.now();
        const lastCall = lastServerTimeCalls.get(uid);
        if (lastCall && (now - lastCall) < MIN_CALL_INTERVAL_MS) {
            // 최근 호출이 너무 빨랐으면 마지막 호출 시간 + 간격 반환 (에러 방지)
            const serverTime = lastCall + MIN_CALL_INTERVAL_MS;
            console.log(`[getServerTime] Rate limited for ${uid}, returning cached time`);
            return {
                success: true,
                serverTime: serverTime,
                timestamp: serverTime,
                cached: true
            };
        }
        // 정상 호출
        lastServerTimeCalls.set(uid, now);
        // Map 크기 제한 (메모리 누수 방지)
        if (lastServerTimeCalls.size > 10000) {
            const oldestKey = lastServerTimeCalls.keys().next().value;
            if (oldestKey) {
                lastServerTimeCalls.delete(oldestKey);
            }
        }
        const serverTime = Date.now();
        return {
            success: true,
            serverTime: serverTime,
            timestamp: serverTime
        };
    }
    catch (error) {
        console.error('Error getting server time:', error);
        return {
            success: false,
            error: (error === null || error === void 0 ? void 0 : error.message) || 'Failed to get server time'
        };
    }
});
// Get Oracle Price Data - for client-side matching game
exports.getOraclePriceData = (0, https_1.onCall)(async (request) => {
    // 인증 확인
    if (!request.auth) {
        throw new https_2.HttpsError('unauthenticated', 'Authentication required');
    }
    try {
        // Oracle 데이터 가져오기 (기존 /oracle/current 사용)
        const oracleSnapshot = await firebase_config_1.rtdb.ref('/oracle/current').once('value');
        const oracleData = oracleSnapshot.val();
        if (!oracleData || !oracleData.prices || !oracleData.gameNumbers) {
            throw new https_2.HttpsError('unavailable', 'Oracle service unavailable');
        }
        // gameNumbers 형식 변환 (문서 요구사항에 맞춤)
        // 기존: { BTC: 2, ETH: 6, ... }
        // 요구: { BTC: 2, ETH: 6, ... } (동일하지만 명시적으로 변환)
        const gameNumbers = {
            BTC: oracleData.gameNumbers.BTC || 0,
            ETH: oracleData.gameNumbers.ETH || 0,
            XRP: oracleData.gameNumbers.XRP || 0,
            BNB: oracleData.gameNumbers.BNB || 0,
            SOL: oracleData.gameNumbers.SOL || 0,
            DOGE: oracleData.gameNumbers.DOGE || 0,
            TRX: oracleData.gameNumbers.TRX || 0
        };
        // prices 형식 확인 및 반환
        const prices = {
            BTCUSDT: oracleData.prices.BTCUSDT || '0',
            ETHUSDT: oracleData.prices.ETHUSDT || '0',
            XRPUSDT: oracleData.prices.XRPUSDT || '0',
            BNBUSDT: oracleData.prices.BNBUSDT || '0',
            SOLUSDT: oracleData.prices.SOLUSDT || '0',
            DOGEUSDT: oracleData.prices.DOGEUSDT || '0',
            TRXUSDT: oracleData.prices.TRXUSDT || '0'
        };
        return {
            success: true,
            data: {
                timestamp: oracleData.timestamp || Date.now(),
                prices: prices,
                gameNumbers: gameNumbers
            }
        };
    }
    catch (error) {
        console.error('Error fetching Oracle data:', error);
        // 이미 HttpsError인 경우 그대로 throw
        if (error instanceof https_2.HttpsError) {
            throw error;
        }
        // 기타 에러는 internal 에러로 변환
        throw new https_2.HttpsError('internal', 'Failed to fetch Oracle data');
    }
});
// Initialize complete game system
exports.initializeSystem = (0, https_1.onCall)(async (request) => {
    try {
        // Set system configuration
        await firebase_config_1.rtdb.ref('/config').set({
            oracle: {
                coins: ["BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT"]
            },
            games: {
                goldenBell: {
                    intervalMinutes: 10,
                    maxParticipants: 2047,
                    roundTimeSeconds: 30,
                    maxRounds: 10
                },
                matching: {
                    orderIntervalHours: 24,
                    randomIntervalHours: 6,
                    betAmount: 2,
                    settlementDelayMinutes: "5-10"
                },
                cube: {
                    maxParticipants: 2047,
                    entryFee: 20,
                    waitTimeMinutes: 5,
                    vipOnly: true
                }
            }
        });
        // Skip game initialization for now
        // const { initializeCubeGame } = await import('./cube-game-new');
        // await initializeCubeGame({} as any, {} as any);
        console.log('All game systems initialized successfully');
        return { success: true, message: 'Complete system initialized successfully' };
    }
    catch (error) {
        console.error('System initialization failed:', error);
        throw new Error('System initialization failed');
    }
});
// User Account Functions with Rewards
exports.enhancedInitUserProfile = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { referrerId, signupAmount } = request.data;
    try {
        const uid = request.auth.uid;
        // Initialize user profile
        await firebase_config_1.rtdb.ref(`/users/${uid}`).set({
            profile: {
                createdAt: Date.now(),
                referrer: referrerId || null
            },
            wallet: { usdt: 0, ivy: 0, pending: 0 },
            vip: {
                status: 'inactive',
                autoReinvestPool: 0
            }
        });
        // Process signup rewards if amount provided
        if (signupAmount && signupAmount > 0) {
            const { distributeSignupRewards } = await Promise.resolve().then(() => __importStar(require('./reward-system')));
            await distributeSignupRewards(uid, signupAmount);
        }
        console.log(`Enhanced user profile initialized for ${uid}`);
        return { success: true, message: 'User profile initialized with rewards' };
    }
    catch (error) {
        console.error('Enhanced user initialization failed:', error);
        throw new Error('User initialization failed');
    }
});
// 테스트 함수: 모든 데이터 리셋 (gameHistory, Matching 게임, Cube 게임, 유저 데이터)
exports.testResetAllData = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    try {
        console.log('[testResetAllData] Starting full data reset...');
        const resetResults = {
            gameHistory: { deleted: 0, error: null },
            matchingGames: { deleted: 0, error: null },
            cubeGames: { deleted: 0, error: null },
            users: { deleted: 0, error: null },
            ledger: { deleted: 0, error: null }
        };
        // 1. gameHistory 리셋
        try {
            console.log('[testResetAllData] Resetting gameHistory...');
            const gameHistorySnapshot = await firebase_config_1.rtdb.ref('/gameHistory').once('value');
            if (gameHistorySnapshot.exists()) {
                const gameHistoryData = gameHistorySnapshot.val();
                const updates = {};
                // 모든 유저의 gameHistory 삭제
                Object.keys(gameHistoryData).forEach((uid) => {
                    updates[`/gameHistory/${uid}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                    resetResults.gameHistory.deleted = Object.keys(updates).length;
                }
            }
            console.log(`[testResetAllData] gameHistory reset complete: ${resetResults.gameHistory.deleted} users`);
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting gameHistory:', error);
            resetResults.gameHistory.error = error instanceof Error ? error.message : 'Unknown error';
        }
        // 2. Matching 게임 리셋
        try {
            console.log('[testResetAllData] Resetting matching games...');
            const matchingGamesSnapshot = await firebase_config_1.rtdb.ref('/games/matching').once('value');
            if (matchingGamesSnapshot.exists()) {
                const matchingGamesData = matchingGamesSnapshot.val();
                const updates = {};
                // 모든 Matching 게임 삭제
                Object.keys(matchingGamesData).forEach((gameId) => {
                    updates[`/games/matching/${gameId}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                    resetResults.matchingGames.deleted = Object.keys(updates).length;
                }
            }
            console.log(`[testResetAllData] Matching games reset complete: ${resetResults.matchingGames.deleted} games`);
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting matching games:', error);
            resetResults.matchingGames.error = error instanceof Error ? error.message : 'Unknown error';
        }
        // 3. Cube 게임 리셋
        try {
            console.log('[testResetAllData] Resetting cube games...');
            const cubeGamesSnapshot = await firebase_config_1.rtdb.ref('/games/cube').once('value');
            if (cubeGamesSnapshot.exists()) {
                const cubeGamesData = cubeGamesSnapshot.val();
                const updates = {};
                // 모든 Cube 게임 삭제
                Object.keys(cubeGamesData).forEach((gameId) => {
                    updates[`/games/cube/${gameId}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                    resetResults.cubeGames.deleted = Object.keys(updates).length;
                }
            }
            console.log(`[testResetAllData] Cube games reset complete: ${resetResults.cubeGames.deleted} games`);
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting cube games:', error);
            resetResults.cubeGames.error = error instanceof Error ? error.message : 'Unknown error';
        }
        // 4. 유저 데이터 리셋
        try {
            console.log('[testResetAllData] Resetting user data...');
            const usersSnapshot = await firebase_config_1.rtdb.ref('/users').once('value');
            if (usersSnapshot.exists()) {
                const usersData = usersSnapshot.val();
                const updates = {};
                // 모든 유저 데이터 삭제
                Object.keys(usersData).forEach((uid) => {
                    updates[`/users/${uid}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                    resetResults.users.deleted = Object.keys(updates).length;
                }
            }
            console.log(`[testResetAllData] User data reset complete: ${resetResults.users.deleted} users`);
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting user data:', error);
            resetResults.users.error = error instanceof Error ? error.message : 'Unknown error';
        }
        // 5. Ledger 리셋
        try {
            console.log('[testResetAllData] Resetting ledger...');
            const ledgerSnapshot = await firebase_config_1.rtdb.ref('/ledger').once('value');
            if (ledgerSnapshot.exists()) {
                const ledgerData = ledgerSnapshot.val();
                const updates = {};
                // 모든 유저의 ledger 삭제
                Object.keys(ledgerData).forEach((uid) => {
                    updates[`/ledger/${uid}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                    resetResults.ledger.deleted = Object.keys(updates).length;
                }
            }
            console.log(`[testResetAllData] Ledger reset complete: ${resetResults.ledger.deleted} users`);
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting ledger:', error);
            resetResults.ledger.error = error instanceof Error ? error.message : 'Unknown error';
        }
        // 실시간 게임 상태도 리셋
        try {
            console.log('[testResetAllData] Resetting realtime game status...');
            const cubeRealtimeSnapshot = await firebase_config_1.rtdb.ref('/games/cube_realtime').once('value');
            if (cubeRealtimeSnapshot.exists()) {
                const updates = {};
                Object.keys(cubeRealtimeSnapshot.val()).forEach((gameId) => {
                    updates[`/games/cube_realtime/${gameId}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                }
            }
            const matchingSummarySnapshot = await firebase_config_1.rtdb.ref('/games/matching_summary').once('value');
            if (matchingSummarySnapshot.exists()) {
                const updates = {};
                Object.keys(matchingSummarySnapshot.val()).forEach((gameId) => {
                    updates[`/games/matching_summary/${gameId}`] = null;
                });
                if (Object.keys(updates).length > 0) {
                    await firebase_config_1.rtdb.ref().update(updates);
                }
            }
            console.log('[testResetAllData] Realtime game status reset complete');
        }
        catch (error) {
            console.error('[testResetAllData] Error resetting realtime status:', error);
        }
        const totalDeleted = resetResults.gameHistory.deleted +
            resetResults.matchingGames.deleted +
            resetResults.cubeGames.deleted +
            resetResults.users.deleted +
            resetResults.ledger.deleted;
        const hasErrors = Object.values(resetResults).some(result => result.error !== null);
        console.log(`[testResetAllData] Full data reset complete. Total deleted: ${totalDeleted}`);
        // 게임 생성 결과
        const gameCreationResults = {
            orderGames: { created: 0, error: null },
            randomGames: { created: 0, error: null },
            cubeGame: { created: false, error: null }
        };
        // 데이터 삭제 후 게임 생성
        try {
            console.log('[testResetAllData] Creating games after reset...');
            // Matching 게임 생성 함수 import
            const { createOrderGame, createRandomGame } = await Promise.resolve().then(() => __importStar(require('./matching-game-new')));
            const { createNewCubeGame } = await Promise.resolve().then(() => __importStar(require('./cube-game-new')));
            // 1. Order 게임 생성 (스케줄러처럼 다음 게임 1개만 생성)
            try {
                console.log('[testResetAllData] Creating next Order game...');
                await createOrderGame();
                gameCreationResults.orderGames.created++;
                console.log('[testResetAllData] Order game created successfully');
            }
            catch (error) {
                console.error('[testResetAllData] Error creating Order game:', error);
                gameCreationResults.orderGames.error = error instanceof Error ? error.message : 'Unknown error';
            }
            // 2. Random 게임 생성 (스케줄러처럼 다음 게임 1개만 생성)
            try {
                console.log('[testResetAllData] Creating next Random game...');
                await createRandomGame();
                gameCreationResults.randomGames.created++;
                console.log('[testResetAllData] Random game created successfully');
            }
            catch (error) {
                console.error('[testResetAllData] Error creating Random game:', error);
                gameCreationResults.randomGames.error = error instanceof Error ? error.message : 'Unknown error';
            }
            // 3. Cube 게임 생성
            try {
                console.log('[testResetAllData] Creating Cube game...');
                await createNewCubeGame();
                gameCreationResults.cubeGame.created = true;
                console.log('[testResetAllData] Cube game created successfully');
            }
            catch (error) {
                console.error('[testResetAllData] Error creating Cube game:', error);
                gameCreationResults.cubeGame.error = error instanceof Error ? error.message : 'Unknown error';
            }
        }
        catch (error) {
            console.error('[testResetAllData] Error during game creation:', error);
        }
        const gameCreationHasErrors = gameCreationResults.orderGames.error !== null ||
            gameCreationResults.randomGames.error !== null ||
            gameCreationResults.cubeGame.error !== null;
        const totalGamesCreated = gameCreationResults.orderGames.created +
            gameCreationResults.randomGames.created +
            (gameCreationResults.cubeGame.created ? 1 : 0);
        return {
            success: !hasErrors && !gameCreationHasErrors,
            message: hasErrors || gameCreationHasErrors
                ? 'Data reset completed with some errors. Check details below.'
                : `All data reset successfully. Total ${totalDeleted} items deleted. ${totalGamesCreated} games created.`,
            results: resetResults,
            totalDeleted,
            gamesCreated: gameCreationResults,
            totalGamesCreated
        };
    }
    catch (error) {
        console.error('[testResetAllData] Full data reset failed:', error);
        throw new Error(`Failed to reset all data: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
//# sourceMappingURL=index.js.map