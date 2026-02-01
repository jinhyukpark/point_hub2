"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGameHistoryDetail = exports.getPendingGameResults = exports.getUserGameHistory = exports.updateGameHistoryResult = exports.createGameHistory = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_config_1 = require("./firebase-config");
const history_formatter_1 = require("./history-formatter");
function toNumeric(value) {
    if (typeof value === 'number') {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number(value);
        if (!isNaN(parsed)) {
            return parsed;
        }
    }
    return NaN;
}
function normalizeRoundRewardLogs(logs) {
    if (!logs) {
        return [];
    }
    const values = Array.isArray(logs)
        ? logs
        : typeof logs === 'object'
            ? Object.values(logs)
            : [];
    return values
        .filter((entry) => entry && typeof entry === 'object')
        .map((entry) => ({
        round: Math.floor(toNumeric(entry.round)),
        winnerCount: toNumeric(entry.winnerCount) || 0,
        vipWinnerCount: toNumeric(entry.vipWinnerCount) || 0,
        opponentPot: toNumeric(entry.opponentPot) || 0,
        baseRewardPerWinner: toNumeric(entry.baseRewardPerWinner) || 0,
        vipBonusPerWinner: toNumeric(entry.vipBonusPerWinner) || 0,
        vipBonusTotal: toNumeric(entry.vipBonusTotal) || 0,
        totalRewardPerWinner: toNumeric(entry.totalRewardPerWinner) || 0,
        totalRoundPot: toNumeric(entry.totalRoundPot) || 0
    }))
        .filter((entry) => Number.isFinite(entry.round) && entry.round > 0)
        .sort((a, b) => a.round - b.round);
}
// 히스토리 생성 함수
exports.createGameHistory = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
    var _a, _b;
    try {
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'Authentication required');
        }
        const uid = request.auth.uid;
        const email = request.auth.token.email || '';
        const { gameType, gameId, betAmount, gameData } = request.data;
        if (!gameType || !gameId || betAmount === undefined || betAmount === null) {
            console.error('[createGameHistory] Missing required data:', { gameType, gameId, betAmount, hasGameData: !!gameData });
            throw new https_1.HttpsError('invalid-argument', 'Missing required data');
        }
        const timestamp = Date.now();
        // gameType이 'matching'인 경우, gameId나 gameData에서 타입 자동 추론
        let finalGameType = gameType;
        if (gameType === 'matching') {
            let matchingType = null;
            // 1. gameData.matchingType이 있으면 우선 사용
            if ((gameData === null || gameData === void 0 ? void 0 : gameData.matchingType) === 'order' || (gameData === null || gameData === void 0 ? void 0 : gameData.matchingType) === 'random') {
                matchingType = gameData.matchingType;
            }
            // 2. gameId에서 추론 (matching_order_xxx 또는 matching_random_xxx 형식)
            else if (gameId.includes('_order_')) {
                matchingType = 'order';
            }
            else if (gameId.includes('_random_')) {
                matchingType = 'random';
            }
            if (matchingType) {
                finalGameType = `matching_${matchingType}`;
            }
            else {
                // 타입을 추론할 수 없으면 기본값 'order' 사용
                finalGameType = 'matching_order';
            }
        }
        // Matching 게임의 경우 betId를 historyId에 포함시켜 각 베팅마다 별도 히스토리 생성
        let historyId;
        if (finalGameType === 'matching' || finalGameType === 'matching_order' || finalGameType === 'matching_random') {
            const betId = (gameData === null || gameData === void 0 ? void 0 : gameData.betId) || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
            historyId = `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${betId}_${gameId}`;
        }
        else {
            historyId = `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${gameId}_${timestamp}`;
        }
        let historyData;
        switch (finalGameType) {
            case 'goldenbell':
                historyData = {
                    historyId,
                    gameType: 'goldenbell',
                    gameId,
                    playerEmail: email,
                    startTime: (gameData === null || gameData === void 0 ? void 0 : gameData.startTime) || timestamp,
                    betAmount: Number(betAmount),
                    rewardAmount: 0,
                    total: 0,
                    isCompleted: false,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    maxRound: 0,
                    roundChoices: [],
                    finalRound: 0,
                    eliminatedRound: 0,
                    roundRewardLogs: []
                };
                break;
            case 'matching':
            case 'matching_order':
            case 'matching_random':
                // finalGameType에서 matchingType 추출
                let matchingType = 'order';
                if (finalGameType === 'matching_order') {
                    matchingType = 'order';
                }
                else if (finalGameType === 'matching_random') {
                    matchingType = 'random';
                }
                else if ((gameData === null || gameData === void 0 ? void 0 : gameData.matchingType) === 'order' || (gameData === null || gameData === void 0 ? void 0 : gameData.matchingType) === 'random') {
                    matchingType = gameData.matchingType;
                }
                else if (gameId.includes('_order_')) {
                    matchingType = 'order';
                }
                else if (gameId.includes('_random_')) {
                    matchingType = 'random';
                }
                // betId가 없으면 생성 (Unity에서 전달하지 않은 경우 대비)
                const betId = (gameData === null || gameData === void 0 ? void 0 : gameData.betId) || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
                historyData = {
                    historyId,
                    gameType: finalGameType,
                    gameId,
                    playerEmail: email,
                    startTime: (gameData === null || gameData === void 0 ? void 0 : gameData.startTime) || timestamp,
                    betAmount: Number(betAmount),
                    rewardAmount: 0,
                    total: 0,
                    isCompleted: false,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    matchingType: matchingType,
                    selectedNumbers: ((_a = gameData === null || gameData === void 0 ? void 0 : gameData.selectedNumbers) === null || _a === void 0 ? void 0 : _a.map((n) => n.toString())) || [],
                    winningNumbers: [],
                    matches: 0,
                    rank: 0,
                    betId: betId, // betId 필수 저장
                    coinOrder: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX']
                };
                break;
            case 'cube':
                historyData = {
                    historyId,
                    gameType: 'cube',
                    gameId,
                    playerEmail: email,
                    startTime: (gameData === null || gameData === void 0 ? void 0 : gameData.startTime) || timestamp,
                    betAmount: Number(betAmount),
                    rewardAmount: 0,
                    total: 0,
                    isCompleted: false,
                    createdAt: timestamp,
                    updatedAt: timestamp,
                    selectedIndex: (gameData === null || gameData === void 0 ? void 0 : gameData.selectedIndex) || -1,
                    finalPot: '',
                    isAutoSelected: (gameData === null || gameData === void 0 ? void 0 : gameData.isAutoSelected) || false
                };
                break;
            default:
                // 이전 호환성을 위해 'matching'만 있으면 matching_order로 처리
                if (gameType === 'matching') {
                    finalGameType = 'matching_order';
                    const matchingType = (gameData === null || gameData === void 0 ? void 0 : gameData.matchingType) || 'order';
                    const betId = (gameData === null || gameData === void 0 ? void 0 : gameData.betId) || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
                    historyData = {
                        historyId: `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${betId}_${gameId}`,
                        gameType: finalGameType,
                        gameId,
                        playerEmail: email,
                        startTime: (gameData === null || gameData === void 0 ? void 0 : gameData.startTime) || timestamp,
                        betAmount: Number(betAmount),
                        rewardAmount: 0,
                        total: 0,
                        isCompleted: false,
                        createdAt: timestamp,
                        updatedAt: timestamp,
                        matchingType: matchingType,
                        selectedNumbers: ((_b = gameData === null || gameData === void 0 ? void 0 : gameData.selectedNumbers) === null || _b === void 0 ? void 0 : _b.map((n) => n.toString())) || [],
                        winningNumbers: [],
                        matches: 0,
                        rank: 0,
                        betId: betId,
                        coinOrder: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX']
                    };
                    break;
                }
                throw new https_1.HttpsError('invalid-argument', `Unsupported game type: ${gameType}`);
        }
        // Firebase Realtime Database에 저장
        await firebase_config_1.rtdb.ref(`gameHistory/${uid}/${historyId}`).set(historyData);
        console.log(`[createGameHistory] Created history: ${historyId} for user ${uid}, gameType: ${gameType}`);
        return {
            success: true,
            historyId,
            message: 'Game history created successfully'
        };
    }
    catch (error) {
        console.error('[createGameHistory] Error details:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorStack = error instanceof Error ? error.stack : undefined;
        console.error('[createGameHistory] Error message:', errorMessage);
        console.error('[createGameHistory] Error stack:', errorStack);
        // HttpsError는 그대로 throw
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', `Failed to create game history: ${errorMessage}`);
    }
});
// 히스토리 업데이트 함수 (결과 반영)
exports.updateGameHistoryResult = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
    var _a;
    try {
        const uid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
        const { historyId, resultData } = request.data;
        if (!historyId || !resultData) {
            throw new https_1.HttpsError('invalid-argument', 'Missing required data');
        }
        const historyRef = firebase_config_1.rtdb.ref(`gameHistory/${uid}/${historyId}`);
        const historySnapshot = await historyRef.once('value');
        if (!historySnapshot.exists()) {
            throw new https_1.HttpsError('not-found', 'History not found');
        }
        const historyData = historySnapshot.val();
        const timestamp = Date.now();
        // 게임 타입별 결과 업데이트
        const updates = {
            rewardAmount: resultData.rewardAmount || 0,
            isCompleted: true,
            updatedAt: timestamp
        };
        switch (historyData.gameType) {
            case 'goldenbell':
                if (resultData.finalRound)
                    updates.finalRound = resultData.finalRound;
                if (resultData.eliminatedRound)
                    updates.eliminatedRound = resultData.eliminatedRound;
                if (resultData.roundChoices)
                    updates.roundChoices = resultData.roundChoices;
                if (resultData.maxRound)
                    updates.maxRound = resultData.maxRound;
                if (resultData.roundRewardLogs) {
                    const rewardLogs = normalizeRoundRewardLogs(resultData.roundRewardLogs);
                    if (rewardLogs.length > 0) {
                        updates.roundRewardLogs = rewardLogs;
                    }
                }
                break;
            case 'matching':
            case 'matching_order':
            case 'matching_random':
                if (resultData.winningNumbers)
                    updates.winningNumbers = resultData.winningNumbers;
                if (resultData.matches !== undefined)
                    updates.matches = resultData.matches;
                if (resultData.rank !== undefined)
                    updates.rank = resultData.rank;
                break;
            case 'cube':
                if (resultData.finalPot)
                    updates.finalPot = resultData.finalPot;
                break;
        }
        await historyRef.update(updates);
        return {
            success: true,
            message: 'Game result updated successfully'
        };
    }
    catch (error) {
        console.error('updateGameHistoryResult error:', error);
        throw new https_1.HttpsError('internal', 'Failed to update game result');
    }
});
// 사용자 게임 히스토리 조회
exports.getUserGameHistory = (0, https_1.onCall)(async (request) => {
    try {
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'Authentication required');
        }
        const uid = request.auth.uid;
        const { gameType, limit = 50, includeCompleted = true, includeIncomplete = true } = request.data || {};
        // 최신 순으로 정렬된 쿼리 생성
        const query = firebase_config_1.rtdb.ref(`gameHistory/${uid}`)
            .orderByChild('createdAt')
            .limitToLast(limit);
        const snapshot = await query.once('value');
        const histories = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.values(data).forEach((history) => {
                // 필터 조건 확인
                // gameType이 'matching'이면 'matching_order'와 'matching_random' 모두 포함
                if (gameType) {
                    if (gameType === 'matching') {
                        if (!['matching', 'matching_order', 'matching_random'].includes(history.gameType)) {
                            return;
                        }
                    }
                    else if (history.gameType !== gameType) {
                        return;
                    }
                }
                if (!includeCompleted && history.isCompleted)
                    return;
                if (!includeIncomplete && !history.isCompleted)
                    return;
                // 히스토리 포맷팅 적용 (영어 순위 텍스트 등 추가)
                const formattedHistory = (0, history_formatter_1.formatGameHistory)(history);
                histories.push(formattedHistory);
            });
        }
        // 최신 순으로 정렬
        histories.sort((a, b) => b.createdAt - a.createdAt);
        return {
            success: true,
            histories,
            total: histories.length
        };
    }
    catch (error) {
        console.error('getUserGameHistory error:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve game history');
    }
});
// 완료되지 않은 게임 조회 (결과 확인용)
exports.getPendingGameResults = (0, https_1.onCall)(async (request) => {
    try {
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'Authentication required');
        }
        const uid = request.auth.uid;
        // 완료되지 않은 게임만 조회
        const query = firebase_config_1.rtdb.ref(`gameHistory/${uid}`)
            .orderByChild('isCompleted')
            .equalTo(false);
        const snapshot = await query.once('value');
        const pendingGames = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            Object.values(data).forEach((history) => {
                // 히스토리 포맷팅 적용
                const formattedHistory = (0, history_formatter_1.formatGameHistory)(history);
                pendingGames.push(formattedHistory);
            });
        }
        return {
            success: true,
            pendingGames,
            total: pendingGames.length
        };
    }
    catch (error) {
        console.error('getPendingGameResults error:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve pending game results');
    }
});
// 특정 히스토리 상세 조회
exports.getGameHistoryDetail = (0, https_1.onCall)(async (request) => {
    try {
        if (!request.auth) {
            throw new https_1.HttpsError('unauthenticated', 'Authentication required');
        }
        const uid = request.auth.uid;
        const { historyId } = request.data;
        if (!historyId) {
            throw new https_1.HttpsError('invalid-argument', 'History ID is required');
        }
        const snapshot = await firebase_config_1.rtdb.ref(`gameHistory/${uid}/${historyId}`).once('value');
        if (!snapshot.exists()) {
            throw new https_1.HttpsError('not-found', 'History not found');
        }
        const history = snapshot.val();
        // 히스토리 포맷팅 적용
        const formattedHistory = (0, history_formatter_1.formatGameHistory)(history);
        return {
            success: true,
            history: formattedHistory
        };
    }
    catch (error) {
        console.error('getGameHistoryDetail error:', error);
        throw new https_1.HttpsError('internal', 'Failed to retrieve game history detail');
    }
});
//# sourceMappingURL=gameHistory.js.map