"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.cubeGameSettlementWorker = exports.testResetCubeGame = exports.testCubeGameWithFixedMove = exports.testCubeGameWithOracle = exports.testFillCubeGame = exports.testCubeGameSettlement = exports.initializeCubeGame = exports.finalizeCubeGameHistory = exports.getCubeGameHistory = exports.getCurrentCubeGame = exports.getCubeGamePositions = exports.getCubeGameStatus = exports.joinCubeGame = void 0;
exports.createNewCubeGame = createNewCubeGame;
exports.processCubeGameSettlements = processCubeGameSettlements;
const https_1 = require("firebase-functions/v2/https");
const tasks_1 = require("firebase-functions/v2/tasks");
const functions_1 = require("firebase-admin/functions");
const firebase_config_1 = require("./firebase-config");
const history_formatter_1 = require("./history-formatter");
const CUBE_SETTLEMENT_DELAY_MS = 4.5 * 60 * 1000;
const MAX_CUBE_POSITIONS = 2047;
const PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.PROJECT_ID || 'pointhub-ab054';
const CUBE_TASK_REGION = process.env.CUBE_TASK_REGION || 'asia-northeast3';
const CUBE_SETTLEMENT_FUNCTION_NAME = process.env.CUBE_SETTLEMENT_FUNCTION_NAME || 'cubeGameSettlementWorker';
const CUBE_TASK_TARGET = process.env.CUBE_TASK_TARGET
    || `projects/${PROJECT_ID}/locations/${CUBE_TASK_REGION}/functions/${CUBE_SETTLEMENT_FUNCTION_NAME}`;
const CUBE_TASK_ENQUEUE_COOLDOWN_MS = 60 * 1000;
let cubeSettlementTaskQueue = null;
function getCubeSettlementTaskQueue() {
    if (!cubeSettlementTaskQueue) {
        cubeSettlementTaskQueue = (0, functions_1.getFunctions)().taskQueue(CUBE_TASK_TARGET);
    }
    return cubeSettlementTaskQueue;
}
async function enqueueCubeSettlementTask(gameId) {
    const queue = getCubeSettlementTaskQueue();
    const payload = {
        gameId,
        enqueuedAt: Date.now()
    };
    await queue.enqueue(payload, {
        dispatchDeadlineSeconds: 60 * 30
    });
}
// Binance API에서 실시간 가격 데이터 가져오기
async function fetchBinanceOracleData() {
    const cryptoPairs = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "BNBUSDT", "SOLUSDT", "DOGEUSDT", "TRXUSDT"];
    const priceData = {};
    const gameNumbers = {};
    // Fetch prices from Binance API
    for (const symbol of cryptoPairs) {
        try {
            const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
            const data = await response.json();
            const price = parseFloat(data.price);
            priceData[symbol] = data.price;
            // Extract second decimal digit for matching game
            const priceStr = price.toFixed(2);
            const secondDecimal = parseInt(priceStr.split('.')[1][1]);
            gameNumbers[symbol.replace('USDT', '')] = secondDecimal;
        }
        catch (error) {
            console.error(`Failed to fetch price for ${symbol}:`, error);
            throw new Error(`Failed to fetch Binance price for ${symbol}`);
        }
    }
    return {
        gameNumbers,
        prices: priceData,
        timestamp: Date.now()
    };
}
function getParticipantBetMap(raw) {
    if (!raw) {
        return {};
    }
    if (Array.isArray(raw)) {
        return raw.reduce((acc, entry, index) => {
            if (!entry) {
                return acc;
            }
            const betId = entry.betId || `legacy_bet_${entry.joinedAt || Date.now()}_${index}`;
            acc[betId] = { ...entry, betId };
            return acc;
        }, {});
    }
    if (raw && typeof raw === 'object' && raw.betAmount !== undefined && raw.position !== undefined) {
        const betId = raw.betId || `legacy_bet_${raw.joinedAt || Date.now()}`;
        return { [betId]: { ...raw, betId } };
    }
    return raw;
}
function getParticipantBetList(raw) {
    const betMap = getParticipantBetMap(raw);
    return Object.values(betMap).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
}
function countCubeParticipantSeats(participants) {
    if (!participants) {
        return 0;
    }
    let total = 0;
    for (const entry of Object.values(participants)) {
        const betMap = getParticipantBetMap(entry);
        total += Object.keys(betMap).length;
    }
    return total;
}
async function fillCubeGameWithFiller(gameId, game, fillerUid, fillerEmail) {
    var _a, _b;
    const emptyPositions = Object.entries(game.positions || {})
        .filter(([, position]) => !position.isOccupied)
        .map(([index]) => index);
    if (emptyPositions.length === 0) {
        return { created: 0, filledIndexes: [], newTotalPot: game.totalPot || 0, lastJoinedAt: Date.now() };
    }
    const now = Date.now();
    const updates = {};
    const basePath = `/games/cube/${gameId}`;
    const filledIndexes = [];
    const recentPositions = [];
    let lastJoinedAt = now;
    let lastBetId = '';
    const fillerBetMap = getParticipantBetMap((_a = game.participants) === null || _a === void 0 ? void 0 : _a[fillerUid]);
    emptyPositions.forEach((positionKey, index) => {
        var _a;
        const betId = `test_fill_${positionKey}_${now + index}`;
        const joinedAt = now + index;
        const participant = {
            uid: fillerUid,
            email: fillerEmail,
            position: positionKey,
            betAmount: 20,
            joinedAt,
            betId,
            settlementStatus: 'pending',
            isAutoSelected: true
        };
        updates[`${basePath}/positions/${positionKey}/isOccupied`] = true;
        updates[`${basePath}/positions/${positionKey}/occupiedBy`] = fillerUid;
        updates[`${basePath}/positions/${positionKey}/occupiedAt`] = joinedAt;
        updates[`${basePath}/participants/${fillerUid}/${betId}`] = participant;
        filledIndexes.push(positionKey);
        recentPositions.push({ position: positionKey, uid: fillerUid, joinedAt });
        fillerBetMap[betId] = participant;
        lastJoinedAt = joinedAt;
        lastBetId = betId;
        if ((_a = game.positions) === null || _a === void 0 ? void 0 : _a[positionKey]) {
            game.positions[positionKey].isOccupied = true;
            game.positions[positionKey].occupiedBy = fillerUid;
            game.positions[positionKey].occupiedAt = joinedAt;
        }
    });
    const newTotalPot = (game.totalPot || 0) + (emptyPositions.length * 20);
    updates[`${basePath}/totalPot`] = newTotalPot;
    updates[`${basePath}/participants_latest/${fillerUid}`] = {
        betId: lastBetId,
        joinedAt: lastJoinedAt,
        position: filledIndexes[filledIndexes.length - 1]
    };
    await firebase_config_1.rtdb.ref().update(updates);
    if (!game.participants) {
        game.participants = {};
    }
    game.participants[fillerUid] = fillerBetMap;
    game.totalPot = newTotalPot;
    const participantCount = countCubeParticipantSeats(game.participants);
    await updateCubeGameRealtimeStatus(gameId, {
        participantCount,
        totalPot: newTotalPot,
        lastJoinedAt,
        recentPositions: recentPositions.slice(-10),
        status: game.status,
        settlementAt: (_b = game.settlementAt) !== null && _b !== void 0 ? _b : null
    });
    return { created: emptyPositions.length, filledIndexes, newTotalPot, lastJoinedAt };
}
function getLatestParticipantBet(raw, latestSummary) {
    const betMap = getParticipantBetMap(raw);
    if ((latestSummary === null || latestSummary === void 0 ? void 0 : latestSummary.betId) && betMap[latestSummary.betId]) {
        return betMap[latestSummary.betId];
    }
    const [latest] = getParticipantBetList(betMap);
    return latest || null;
}
function mapBetToClientView(bet, game) {
    var _a, _b, _c, _d, _e;
    const betAmount = Number(bet.betAmount) || 0;
    const joinedAt = Number(bet.joinedAt) || 0;
    const finalIndex = bet.finalPotIndex || bet.position;
    const finalPotCode = bet.finalPot
        || ((_b = (_a = game.positions) === null || _a === void 0 ? void 0 : _a[finalIndex]) === null || _b === void 0 ? void 0 : _b.code)
        || ((_d = (_c = game.positions) === null || _c === void 0 ? void 0 : _c[bet.position]) === null || _d === void 0 ? void 0 : _d.code)
        || finalIndex;
    return {
        betId: bet.betId,
        betAmount,
        position: ((_e = bet.position) === null || _e === void 0 ? void 0 : _e.toString()) || '',
        joinedAt,
        finalPot: (finalPotCode === null || finalPotCode === void 0 ? void 0 : finalPotCode.toString()) || '',
        finalPotIndex: (finalIndex === null || finalIndex === void 0 ? void 0 : finalIndex.toString()) || '',
        rewardAmount: Number(bet.reward) || 0,
        isWinner: Boolean(bet.isWinner || (bet.reward || 0) > 0),
        settlementStatus: bet.settlementStatus || 'pending',
        settlementType: bet.settlementType,
        settledAt: bet.settledAt,
        rewardSettledAt: bet.rewardSettledAt
    };
}
// PRD 바이너리 트리 보상 계산 함수
function calculateBinaryTreeRewards() {
    const rewards = {};
    // PRD 바이너리 트리 구조에 따른 보상 계산
    // A1 (0대 1명) = 4092달러
    rewards['A1'] = 4092;
    // B1, B2 (1대 2명) = 각각 2044달러
    rewards['B1'] = 2044;
    rewards['B2'] = 2044;
    // C1~C4 (2대 4명) = 각각 1020달러
    for (let i = 1; i <= 4; i++) {
        rewards[`C${i}`] = 1020;
    }
    // D1~D8 (3대 8명) = 각각 508달러
    for (let i = 1; i <= 8; i++) {
        rewards[`D${i}`] = 508;
    }
    // E1~E16 (4대 16명) = 각각 252달러
    for (let i = 1; i <= 16; i++) {
        rewards[`E${i}`] = 252;
    }
    // F1~F32 (5대 32명) = 각각 124달러
    for (let i = 1; i <= 32; i++) {
        rewards[`F${i}`] = 124;
    }
    // G1~G64 (6대 64명) = 각각 60달러
    for (let i = 1; i <= 64; i++) {
        rewards[`G${i}`] = 60;
    }
    // H1~H128 (7대 128명) = 각각 28달러
    for (let i = 1; i <= 128; i++) {
        rewards[`H${i}`] = 28;
    }
    // I1~I256 (8대 256명) = 각각 12달러
    for (let i = 1; i <= 256; i++) {
        rewards[`I${i}`] = 12;
    }
    // J1~J512 (9대 512명) = 각각 4달러
    for (let i = 1; i <= 512; i++) {
        rewards[`J${i}`] = 4;
    }
    // K1~K1024 (10대 1024명) = 0달러 (기부만 함)
    for (let i = 1; i <= 1024; i++) {
        rewards[`K${i}`] = 0;
    }
    return rewards;
}
// 큐브 게임 참여
exports.joinCubeGame = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f;
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    const { position } = request.data;
    console.log(`[joinCubeGame] uid: ${uid}, position: ${position}, type: ${typeof position}`);
    if (!position) {
        console.error('[joinCubeGame] Position is null or undefined');
        throw new Error('Position is required');
    }
    if (!isValidCubePosition(position)) {
        console.error(`[joinCubeGame] Invalid position code: ${position}`);
        throw new Error(`Invalid position code: ${position}`);
    }
    try {
        // 현재 활성 큐브 게임 조회
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            throw new Error('No active cube game available');
        }
        if (currentGame.status !== 'waiting') {
            throw new Error('Game is not accepting new participants');
        }
        const positionKey = position.toString();
        const selectedPosition = currentGame.positions[positionKey];
        if (!selectedPosition) {
            throw new Error('Selected position is invalid');
        }
        const participants = currentGame.participants || {};
        const userBetMap = getParticipantBetMap(participants[uid]);
        const previousBetCount = Object.keys(userBetMap).length;
        const participantSeatCount = countCubeParticipantSeats(currentGame.participants);
        const latestBetMeta = (_a = currentGame.participantsLatest) === null || _a === void 0 ? void 0 : _a[uid];
        const latestBet = getLatestParticipantBet(userBetMap, latestBetMeta);
        const previousPosition = ((_b = latestBet === null || latestBet === void 0 ? void 0 : latestBet.position) === null || _b === void 0 ? void 0 : _b.toString()) || null;
        const previousBetId = latestBet === null || latestBet === void 0 ? void 0 : latestBet.betId;
        const seatAlreadyOwned = selectedPosition.isOccupied && selectedPosition.occupiedBy === uid;
        if (seatAlreadyOwned) {
            console.log(`[joinCubeGame] User ${uid} already occupies position ${positionKey}, no change made.`);
            return {
                success: true,
                gameId: currentGame.gameId,
                position: positionKey,
                betAmount: currentGame.betAmount,
                participantCount: participantSeatCount,
                totalPot: currentGame.totalPot,
                gameStartAt: currentGame.gameStartAt,
                action: 'already_occupied'
            };
        }
        if (selectedPosition.isOccupied && selectedPosition.occupiedBy && selectedPosition.occupiedBy !== uid) {
            throw new Error('Position is already occupied');
        }
        // 사용자 정보 및 잔액 확인
        console.log(`[joinCubeGame] Checking user data for ${uid}`);
        const userSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}`).once('value');
        const userData = userSnapshot.val();
        if (!userData) {
            throw new Error('User not found');
        }
        const betAmount = 20; // 20달러 고정
        // 직접 경로에서 usdt 잔액 확인 (우선)
        let directBalance = 0;
        try {
            const directBalanceSnapshot = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
            directBalance = directBalanceSnapshot.val() || 0;
            console.log(`[joinCubeGame] Direct path balance (/users/${uid}/wallet/usdt): ${directBalance} (type: ${typeof directBalance})`);
        }
        catch (directError) {
            console.error(`[joinCubeGame] Error reading direct path:`, directError);
        }
        // userData에서도 usdt 확인
        const userDataBalance = ((_c = userData.wallet) === null || _c === void 0 ? void 0 : _c.usdt) || 0;
        console.log(`[joinCubeGame] UserData wallet.usdt: ${userDataBalance} (type: ${typeof userDataBalance})`);
        // 최종 잔액: 직접 경로가 있으면 사용, 없으면 userData에서 가져옴
        const finalBalance = directBalance > 0 ? directBalance : userDataBalance;
        console.log(`[joinCubeGame] User balance check - direct: ${directBalance}, userData: ${userDataBalance}, final: ${finalBalance}, required: ${betAmount}`);
        console.log(`[joinCubeGame] Wallet structure:`, JSON.stringify(userData.wallet, null, 2));
        if (finalBalance < betAmount) {
            console.error(`[joinCubeGame] Insufficient balance - Current: $${finalBalance}, Required: $${betAmount}`);
            throw new Error(`Insufficient balance. Current: $${finalBalance}, Required: $${betAmount}`);
        }
        // 지갑에서 베팅 금액 차감 (트랜잭션 사용, usdt만 사용)
        console.log(`[joinCubeGame] Attempting to debit ${betAmount} from wallet`);
        let transactionSuccess = false;
        let newBalance = 0;
        const debitResult = await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
            const balance = currentBalance !== null && currentBalance !== undefined ? currentBalance : finalBalance;
            console.log(`[joinCubeGame] Transaction callback - currentBalance from DB: ${currentBalance}, using balance: ${balance}, expected: ${finalBalance}, required: ${betAmount}`);
            if (balance < betAmount) {
                console.log(`[joinCubeGame] Transaction aborted - insufficient balance: ${balance} < ${betAmount}`);
                transactionSuccess = false;
                return; // Abort transaction
            }
            newBalance = balance - betAmount;
            console.log(`[joinCubeGame] Transaction will commit - newBalance: ${newBalance}`);
            transactionSuccess = true;
            return newBalance;
        });
        console.log(`[joinCubeGame] Transaction result - committed: ${debitResult.committed}, snapshot: ${(_d = debitResult.snapshot) === null || _d === void 0 ? void 0 : _d.val()}`);
        if (!debitResult.committed || !transactionSuccess) {
            console.error(`[joinCubeGame] Failed to debit wallet - committed: ${debitResult.committed}, transactionSuccess: ${transactionSuccess}`);
            throw new Error('Failed to debit wallet');
        }
        console.log(`[joinCubeGame] Wallet debited successfully - new balance: ${newBalance}`);
        const now = Date.now();
        const participantEmail = ((_e = userData.auth) === null || _e === void 0 ? void 0 : _e.email) || 'unknown';
        const newBetId = `cube_bet_${now}_${Math.random().toString(36).substring(2, 8)}`;
        const newParticipantEntry = {
            uid,
            email: participantEmail,
            position: positionKey,
            betAmount,
            joinedAt: now,
            betId: newBetId,
            settlementStatus: 'pending'
        };
        // 원자적 업데이트: 위치 점유 + 참가자 추가 + 상금 업데이트
        const updates = {};
        updates[`/games/cube/${currentGame.gameId}/positions/${positionKey}/isOccupied`] = true;
        updates[`/games/cube/${currentGame.gameId}/positions/${positionKey}/occupiedBy`] = uid;
        updates[`/games/cube/${currentGame.gameId}/positions/${positionKey}/occupiedAt`] = now;
        updates[`/games/cube/${currentGame.gameId}/participants/${uid}/${newBetId}`] = newParticipantEntry;
        updates[`/games/cube/${currentGame.gameId}/participants_latest/${uid}`] = {
            betId: newBetId,
            joinedAt: now,
            position: positionKey
        };
        await firebase_config_1.rtdb.ref().update(updates);
        // 총 상금 업데이트
        await firebase_config_1.rtdb.ref(`/games/cube/${currentGame.gameId}/totalPot`).transaction((currentPot) => {
            return (currentPot || 0) + betAmount;
        });
        // Ledger에 베팅 기록
        await recordCubeLedger(uid, 'debit', betAmount, 'cube_bet', {
            gameId: currentGame.gameId,
            position: positionKey
        });
        // 게임이 가득 찼는지 확인 (2047명)
        const updatedGame = await getCurrentCubeGameInternal();
        if (updatedGame && countCubeParticipantSeats(updatedGame.participants) >= MAX_CUBE_POSITIONS) {
            const settlementAt = now + CUBE_SETTLEMENT_DELAY_MS;
            await firebase_config_1.rtdb.ref(`/games/cube/${currentGame.gameId}`).update({
                status: 'closed',
                gameEndAt: now,
                settlementAt
            });
            await firebase_config_1.rtdb.ref(`/games/cube_realtime/${currentGame.gameId}/status`).update({
                status: 'settlement_pending',
                message: 'Game is full! Calculating results in 5 seconds...',
                countdown: CUBE_SETTLEMENT_DELAY_MS,
                settlementAt
            });
            await captureCubeOracleSnapshot(currentGame.gameId);
        }
        // 실시간 업데이트를 위해 위치 정보 브로드캐스트
        await firebase_config_1.rtdb.ref(`/games/cube_updates/${currentGame.gameId}/${positionKey}`).set({
            occupiedBy: uid,
            occupiedAt: now,
            email: participantEmail
        });
        // 게임 상태 실시간 업데이트
        const updatedParticipantCount = participantSeatCount + 1;
        const updatedTotalPot = currentGame.totalPot + betAmount;
        await updateCubeGameRealtimeStatus(currentGame.gameId, {
            participantCount: updatedParticipantCount,
            totalPot: updatedTotalPot,
            lastJoinedAt: now,
            recentPositions: [
                { position: positionKey, uid, joinedAt: now }
            ],
            status: currentGame.status,
            settlementAt: (_f = currentGame.settlementAt) !== null && _f !== void 0 ? _f : null
        });
        console.log(`User ${uid} joined cube game at position ${positionKey}`);
        return {
            success: true,
            gameId: currentGame.gameId,
            position: positionKey,
            betAmount,
            participantCount: updatedParticipantCount,
            totalPot: updatedTotalPot,
            gameStartAt: currentGame.gameStartAt,
            action: previousBetCount > 0 ? 'added_bet' : 'joined',
            previousPosition,
            previousBetId,
            betId: newBetId,
            message: updatedParticipantCount >= MAX_CUBE_POSITIONS
                ? 'Game full! Results in 5 seconds...'
                : `Waiting for more players (${updatedParticipantCount}/${MAX_CUBE_POSITIONS})`
        };
    }
    catch (error) {
        console.error('Join cube game failed:', error);
        throw new Error(`Failed to join cube game: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// 큐브 게임 상태 조회
exports.getCubeGameStatus = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c;
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    try {
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            return {
                success: true,
                status: 'no_game',
                nextGameAt: Date.now() + CUBE_SETTLEMENT_DELAY_MS, // test delay
                message: 'No active game. New game will start soon.'
            };
        }
        const betList = getParticipantBetList((_a = currentGame.participants) === null || _a === void 0 ? void 0 : _a[uid]);
        const latestBet = getLatestParticipantBet((_b = currentGame.participants) === null || _b === void 0 ? void 0 : _b[uid], (_c = currentGame.participantsLatest) === null || _c === void 0 ? void 0 : _c[uid]);
        const participantCount = countCubeParticipantSeats(currentGame.participants);
        const availablePositions = Math.max(0, MAX_CUBE_POSITIONS - participantCount);
        const occupiedPositions = Object.entries(currentGame.positions)
            .filter(([code, pos]) => pos.isOccupied)
            .map(([code, pos]) => ({
            code,
            occupiedBy: pos.occupiedBy,
            occupiedAt: pos.occupiedAt
        }));
        // 전체 positions 리스트 (섞인 순서대로) - 저장된 shuffledPositions 사용
        const shuffledPositions = currentGame.shuffledPositions || Object.keys(currentGame.positions);
        const now = Date.now();
        return {
            success: true,
            status: currentGame.status,
            gameId: currentGame.gameId,
            participantCount,
            maxParticipants: MAX_CUBE_POSITIONS,
            totalPot: currentGame.totalPot,
            betAmount: currentGame.betAmount,
            gameStartAt: currentGame.gameStartAt,
            gameEndAt: currentGame.gameEndAt,
            timeToStart: currentGame.gameStartAt ? Math.max(0, currentGame.gameStartAt - now) : null,
            timeToEnd: currentGame.gameEndAt ? Math.max(0, currentGame.gameEndAt - now) : null,
            isParticipating: betList.length > 0,
            participantData: betList.length ? {
                latestBet: latestBet ? mapBetToClientView(latestBet, currentGame) : null,
                bets: betList.map(bet => mapBetToClientView(bet, currentGame))
            } : null,
            canJoin: currentGame.status === 'waiting' && availablePositions > 0,
            occupiedPositions: occupiedPositions.slice(0, 100), // 최근 100개만 반환
            availablePositions,
            shuffledPositions: shuffledPositions, // 전체 positions 리스트 (섞인 순서)
            allPositions: currentGame.positions // 전체 positions 정보 (code, isOccupied, occupiedBy 등)
        };
    }
    catch (error) {
        console.error('Get cube game status failed:', error);
        throw new Error('Failed to get game status');
    }
});
// 큐브 게임 위치 목록 조회 (페이징)
exports.getCubeGamePositions = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { section, offset = 0, limit = 100 } = request.data;
    try {
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            throw new Error('No active cube game');
        }
        // 섹션별 위치 조회 (A, B, C, ..., K)
        let positions = [];
        if (section) {
            // 특정 섹션의 위치들 조회
            const sectionPositions = Object.entries(currentGame.positions)
                .filter(([code, pos]) => code.startsWith(section))
                .slice(offset, offset + limit)
                .map(([code, pos]) => ({
                code,
                isOccupied: pos.isOccupied,
                occupiedBy: pos.occupiedBy,
                occupiedAt: pos.occupiedAt
            }));
            positions = sectionPositions;
        }
        else {
            // 전체 위치 중 일부 조회
            positions = Object.entries(currentGame.positions)
                .slice(offset, offset + limit)
                .map(([code, pos]) => ({
                code,
                isOccupied: pos.isOccupied,
                occupiedBy: pos.occupiedBy,
                occupiedAt: pos.occupiedAt
            }));
        }
        return {
            success: true,
            gameId: currentGame.gameId,
            section,
            offset,
            limit,
            positions,
            totalPositions: Object.keys(currentGame.positions).length,
            occupiedCount: Object.values(currentGame.positions).filter(pos => pos.isOccupied).length
        };
    }
    catch (error) {
        console.error('Get cube positions failed:', error);
        throw new Error('Failed to get positions');
    }
});
// getCurrentCubeGame Cloud Function (CORS 지원)
exports.getCurrentCubeGame = (0, https_1.onCall)({ cors: true }, async (request) => {
    console.log('getCurrentCubeGame called via Cloud Function');
    return await getCurrentCubeGameInternal();
});
// 내부 헬퍼 함수들
async function getCurrentCubeGameInternal() {
    const gamesSnapshot = await firebase_config_1.rtdb.ref('/games/cube')
        .orderByChild('createdAt')
        .limitToLast(1)
        .once('value');
    const games = gamesSnapshot.val();
    if (!games)
        return null;
    const gameId = Object.keys(games)[0];
    const game = games[gameId];
    // 게임이 끝났으면 null 반환
    if (game.status === 'finished')
        return null;
    return { ...game, gameId };
}
async function calculateCubeGameResult(gameId, overrideDirection, overrideMoveDistance) {
    try {
        // 게임 상태를 계산 중으로 변경
        await firebase_config_1.rtdb.ref(`/games/cube/${gameId}/status`).set('calculating');
        const gameSnapshot = await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).once('value');
        const game = gameSnapshot.val();
        if (!game)
            return;
        let direction;
        let moveDistance;
        let oracleSnapshot;
        if (overrideDirection !== undefined && overrideMoveDistance !== undefined) {
            // 테스트용: direction과 moveDistance를 직접 지정
            direction = overrideDirection;
            moveDistance = overrideMoveDistance;
            console.log(`[calculateCubeGameResult] Using override values: direction=${direction === -1 ? 'left' : 'right'}, moveDistance=${moveDistance}`);
            // Oracle snapshot은 기존 것을 사용하거나 기본값 생성
            oracleSnapshot = game.oracleSnapshot || {
                gameNumbers: {},
                prices: {},
                timestamp: Date.now(),
                capturedAt: Date.now()
            };
        }
        else {
            // 일반 동작: Oracle에서 가져오기
            console.log(`[calculateCubeGameResult] Preparing oracle data for game ${gameId} at ${new Date(game.gameEndAt).toISOString()}`);
            oracleSnapshot = game.oracleSnapshot || await captureCubeOracleSnapshot(gameId);
            if (!oracleSnapshot || !oracleSnapshot.gameNumbers) {
                throw new Error('Failed to capture Oracle data for cube game');
            }
            const params = getCubeMoveParameters(oracleSnapshot.gameNumbers);
            direction = params.direction;
            moveDistance = params.moveDistance;
            console.log(`[calculateCubeGameResult] Game ${gameId} using direction=${direction === -1 ? 'left' : 'right'}, moveDistance=${moveDistance}`);
        }
        const completionTimestamp = Date.now();
        const result = {
            gameId,
            winningPosition: 'CLIENT_RESOLVED',
            winningPositionIndex: '-1',
            winningString: '',
            totalPot: game.totalPot || 0,
            calculatedAt: completionTimestamp,
            oracleData: oracleSnapshot,
            winners: [],
            moveDirection: direction,
            moveDistance
        };
        const finishPayload = {
            status: 'finished',
            winningPosition: result.winningPosition,
            resultCalculatedAt: completionTimestamp,
            result,
            settlementAt: null,
            nextGameAt: completionTimestamp + CUBE_SETTLEMENT_DELAY_MS,
            settlementTaskEnqueuedAt: null,
            settlementTaskCompletedAt: completionTimestamp
        };
        if (typeof result.winningPositionIndex === 'string' && result.winningPositionIndex.length > 0) {
            finishPayload.winningPositionIndex = result.winningPositionIndex;
        }
        await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).update(finishPayload);
    }
    catch (error) {
        console.error(`Failed to calculate cube game result for ${gameId}:`, error);
    }
}
function getCubeMoveParameters(gameNumbers) {
    const btcNumber = gameNumbers.BTC || 0;
    const direction = btcNumber % 2 === 0 ? -1 : 1; // 짝수: 왼쪽(-1), 홀수: 오른쪽(1)
    const moveNumbers = [
        gameNumbers.ETH || 0,
        gameNumbers.XRP || 0,
        gameNumbers.BNB || 0,
        gameNumbers.SOL || 0,
        gameNumbers.DOGE || 0,
        gameNumbers.TRX || 0
    ];
    const moveDistanceString = moveNumbers.join('').replace(/^0+/, '');
    const moveDistance = moveDistanceString === '' ? 0 : parseInt(moveDistanceString);
    console.log(`[getCubeMoveParameters] BTC: ${btcNumber} (direction: ${direction === -1 ? 'left' : 'right'}), moveNumbers: [${moveNumbers.join(', ')}], moveDistance: ${moveDistance}`);
    return {
        direction,
        moveDistance,
        moveNumbers,
        btcNumber
    };
}
function calculateCubeFinalPosition(startPosition, direction, moveDistance) {
    const finalPosition = startPosition + (direction * moveDistance);
    return normalizeCubePosition(finalPosition);
}
function normalizeCubePosition(position) {
    let normalized = ((position - 1) % 2047) + 1;
    if (normalized <= 0) {
        normalized += 2047;
    }
    return normalized;
}
async function captureCubeOracleSnapshot(gameId) {
    const snapshotRef = firebase_config_1.rtdb.ref(`/games/cube/${gameId}/oracleSnapshot`);
    const existing = await snapshotRef.once('value');
    if (existing.exists()) {
        return existing.val();
    }
    console.log(`[captureCubeOracleSnapshot] Fetching Binance oracle data for cube game ${gameId}`);
    const oracleData = await fetchBinanceOracleData();
    if (!oracleData || !oracleData.gameNumbers) {
        throw new Error('Failed to fetch oracle data for cube game');
    }
    const snapshot = {
        gameNumbers: oracleData.gameNumbers,
        prices: oracleData.prices,
        timestamp: oracleData.timestamp,
        capturedAt: Date.now()
    };
    await snapshotRef.set(snapshot);
    return snapshot;
}
/* function convertNumberToPositionCode(position: number): string {
  // 1-2047을 A1~K1024로 변환하는 로직
  if (position === 1) return 'A1';
  
  position -= 1; // 0 기반으로 변환
  
  // A(1), B(2), C(3), D(4), E(5), F(6), G(7), H(8), I(9), J(10), K(1024)
  const sections = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 1024];
  let cumulativeCount = 1; // A1은 이미 처리됨
  
  for (let i = 1; i < sections.length; i++) {
    const sectionSize = sections[i];
    if (position < cumulativeCount + sectionSize) {
      const sectionLetter = String.fromCharCode(65 + i); // B, C, D, ...
      const positionInSection = position - cumulativeCount + 1;
      return `${sectionLetter}${positionInSection}`;
    }
    cumulativeCount += sectionSize;
  }
  
  // 범위를 벗어나는 경우 K1024 반환
  return 'K1024';
} */
function isValidCubePosition(position) {
    // ✅ Position은 이제 1~2047의 숫자 (하단 Pot Index)
    const positionNum = parseInt(position);
    if (isNaN(positionNum)) {
        console.log(`[isValidCubePosition] Position is not a number: ${position}`);
        return false;
    }
    const isValid = positionNum >= 1 && positionNum <= 2047;
    if (!isValid) {
        console.log(`[isValidCubePosition] Position out of range (1~2047): ${positionNum}`);
    }
    return isValid;
}
async function createNewCubeGame() {
    try {
        const gameId = `cube_${Date.now()}`;
        // PRD: A1~K1024까지 총 2047칸을 랜덤으로 섞어서 배치
        const positions = {};
        const binaryTreeRewards = calculateBinaryTreeRewards();
        // 1. 모든 위치 코드 생성 (A1, B1, B2, C1~C4, ..., K1~K1024)
        const allPositionCodes = [];
        // A1 추가
        allPositionCodes.push('A1');
        // B1-B2, C1-C4, ..., K1-K1024 추가
        const sections = ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'];
        const sectionSizes = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
        for (let i = 0; i < sections.length; i++) {
            const section = sections[i];
            const size = sectionSizes[i];
            for (let j = 1; j <= size; j++) {
                allPositionCodes.push(`${section}${j}`);
            }
        }
        // 2. 위치 코드들을 랜덤으로 섞기 (Fisher-Yates shuffle)
        const shuffledCodes = [...allPositionCodes];
        for (let i = shuffledCodes.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffledCodes[i], shuffledCodes[j]] = [shuffledCodes[j], shuffledCodes[i]];
        }
        // 3. 섞인 순서대로 1~2047 위치에 배당 매핑
        for (let displayPosition = 1; displayPosition <= 2047; displayPosition++) {
            const actualCode = shuffledCodes[displayPosition - 1];
            const expectedReward = binaryTreeRewards[actualCode] || 0;
            positions[displayPosition.toString()] = {
                code: actualCode, // 실제 배당 코드 (A1, B2, K500 등)
                level: getCodeLevel(actualCode),
                index: getCodeIndex(actualCode),
                expectedReward, // 해당 코드의 실제 배당금
                isOccupied: false,
                randomString: generateRandomString()
            };
        }
        const newGame = {
            gameId,
            status: 'waiting',
            positions,
            shuffledPositions: shuffledCodes, // 섞인 순서 저장 (1~2047 위치에 대한 실제 코드 순서)
            participants: {},
            participantsLatest: {},
            totalPot: 0,
            betAmount: 20,
            gameStartAt: 0,
            gameEndAt: 0,
            createdAt: Date.now()
        };
        await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).set(newGame);
        console.log(`New cube game created: ${gameId} with ${Object.keys(positions).length} positions`);
    }
    catch (error) {
        console.error('Failed to create new cube game:', error);
    }
}
function generateRandomString() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < 16; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}
// 코드에서 레벨 추출 (A=0, B=1, ..., K=10)
function getCodeLevel(code) {
    const level = code.charAt(0);
    return level.charCodeAt(0) - 'A'.charCodeAt(0);
}
// 코드에서 인덱스 추출 (A1=1, B1=1, B2=2, ...)  
function getCodeIndex(code) {
    return parseInt(code.substring(1)) || 1;
}
// 실시간 게임 상태 업데이트
async function updateCubeGameRealtimeStatus(gameId, statusUpdate) {
    try {
        // 클라이언트가 구독할 수 있는 실시간 상태 경로
        const statusPayload = {
            participantCount: statusUpdate.participantCount,
            totalPot: statusUpdate.totalPot,
            lastUpdatedAt: statusUpdate.lastJoinedAt,
            availablePositions: Math.max(0, MAX_CUBE_POSITIONS - statusUpdate.participantCount),
            progressPercent: Math.round((statusUpdate.participantCount / MAX_CUBE_POSITIONS) * 100)
        };
        if (statusUpdate.status !== undefined) {
            statusPayload.status = statusUpdate.status;
        }
        if (statusUpdate.message !== undefined) {
            statusPayload.message = statusUpdate.message;
        }
        if (statusUpdate.countdown !== undefined) {
            statusPayload.countdown = statusUpdate.countdown;
        }
        if (statusUpdate.settlementAt !== undefined) {
            statusPayload.settlementAt = statusUpdate.settlementAt;
        }
        await firebase_config_1.rtdb.ref(`/games/cube_realtime/${gameId}/status`).update(statusPayload);
        // 최근 참가자 정보 (최대 10명)
        const recentRef = firebase_config_1.rtdb.ref(`/games/cube_realtime/${gameId}/recent_joins`);
        for (const position of statusUpdate.recentPositions) {
            await recentRef.push({
                position: position.position,
                joinedAt: position.joinedAt,
                // uid는 보안상 숨김
            });
        }
        // 오래된 recent_joins 정리 (최대 10개만 유지)
        const recentSnapshot = await recentRef.limitToLast(10).once('value');
        const recentData = recentSnapshot.val();
        if (recentData && Object.keys(recentData).length > 10) {
            const keysToRemove = Object.keys(recentData).slice(0, -10);
            const removeUpdates = {};
            keysToRemove.forEach(key => removeUpdates[key] = null);
            await recentRef.update(removeUpdates);
        }
    }
    catch (error) {
        console.error('Failed to update cube game realtime status:', error);
    }
}
// 큐브 게임 이력 조회 (마이페이지용)
exports.getCubeGameHistory = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d;
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    const { limit = 20 } = request.data;
    try {
        console.log(`[getCubeGameHistory] Fetching history for user ${uid}, limit: ${limit}`);
        // 최신 게임부터 충분한 수를 가져와서 사용자 베팅 기록 생성
        const gamesSnapshot = await firebase_config_1.rtdb.ref('/games/cube')
            .orderByChild('createdAt')
            .limitToLast(limit * 5)
            .once('value');
        const games = gamesSnapshot.val() || {};
        console.log(`[getCubeGameHistory] Found ${Object.keys(games).length} total games`);
        const userHistory = [];
        for (const [gameId, game] of Object.entries(games)) {
            const betMap = getParticipantBetMap((_a = game.participants) === null || _a === void 0 ? void 0 : _a[uid]);
            const betEntries = Object.values(betMap).sort((a, b) => (b.joinedAt || 0) - (a.joinedAt || 0));
            if (betEntries.length === 0) {
                continue;
            }
            const latestBetId = ((_c = (_b = game.participantsLatest) === null || _b === void 0 ? void 0 : _b[uid]) === null || _c === void 0 ? void 0 : _c.betId) || ((_d = betEntries[0]) === null || _d === void 0 ? void 0 : _d.betId);
            console.log(`[getCubeGameHistory] User ${uid} has ${betEntries.length} bet(s) in game ${gameId}`);
            betEntries.forEach(bet => {
                var _a, _b;
                const clientBet = mapBetToClientView(bet, game);
                const historyEntry = {
                    gameId,
                    betId: clientBet.betId,
                    betAmount: clientBet.betAmount,
                    position: clientBet.position,
                    joinedAt: clientBet.joinedAt,
                    finalPot: clientBet.finalPot,
                    finalPotIndex: clientBet.finalPotIndex,
                    rewardAmount: clientBet.rewardAmount,
                    isWinner: clientBet.isWinner,
                    isLatestBet: bet.betId === latestBetId,
                    settlementStatus: clientBet.settlementStatus,
                    settlementType: clientBet.settlementType,
                    gameStatus: game.status,
                    winningPosition: game.winningPosition || null,
                    totalPot: game.totalPot || 0,
                    totalParticipants: Object.keys(game.participants || {}).length,
                    createdAt: clientBet.joinedAt,
                    finishedAt: game.resultCalculatedAt || 0,
                    moveDistance: (_a = game.result) === null || _a === void 0 ? void 0 : _a.moveDistance,
                    moveDirection: (_b = game.result) === null || _b === void 0 ? void 0 : _b.moveDirection
                };
                userHistory.push((0, history_formatter_1.formatCubeHistory)(historyEntry));
            });
        }
        userHistory.sort((a, b) => (b.joinedAt || b.createdAt || 0) - (a.joinedAt || a.createdAt || 0));
        const historySlice = userHistory.slice(0, limit);
        console.log(`[getCubeGameHistory] Returning ${historySlice.length} history items for user ${uid}`);
        return {
            success: true,
            history: historySlice,
            total: userHistory.length
        };
    }
    catch (error) {
        console.error('[getCubeGameHistory] Get Cube game history failed:', error);
        throw new Error('Failed to get game history');
    }
});
// 사용자가 자신의 히스토리를 최종 확정하도록 호출하는 함수
exports.finalizeCubeGameHistory = (0, https_1.onCall)(async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    const { gameId, historyId } = request.data;
    if (!gameId) {
        throw new Error('gameId is required');
    }
    try {
        const gameSnapshot = await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).once('value');
        const game = gameSnapshot.val();
        if (!game) {
            throw new Error('Game not found');
        }
        if (game.status !== 'finished' || !game.result) {
            throw new Error('Game result is not ready yet');
        }
        const betMap = getParticipantBetMap((_a = game.participants) === null || _a === void 0 ? void 0 : _a[uid]);
        const participant = getLatestParticipantBet((_b = game.participants) === null || _b === void 0 ? void 0 : _b[uid], (_c = game.participantsLatest) === null || _c === void 0 ? void 0 : _c[uid]);
        if (!participant) {
            throw new Error('User did not participate in this game');
        }
        const startIndex = parseInt(participant.position);
        if (isNaN(startIndex)) {
            throw new Error('Invalid participant position');
        }
        const direction = (_d = game.result.moveDirection) !== null && _d !== void 0 ? _d : 1;
        const moveDistance = (_e = game.result.moveDistance) !== null && _e !== void 0 ? _e : 0;
        const rawFinalIndex = calculateCubeFinalPosition(startIndex, direction, moveDistance);
        const resolvedFinalIndex = rawFinalIndex.toString();
        const resolvedFinalPotCode = ((_g = (_f = game.positions) === null || _f === void 0 ? void 0 : _f[resolvedFinalIndex]) === null || _g === void 0 ? void 0 : _g.code)
            || participant.finalPot
            || resolvedFinalIndex;
        const binaryTreeRewards = calculateBinaryTreeRewards();
        const rewardAmount = binaryTreeRewards[resolvedFinalPotCode] || 0;
        const isWinner = rewardAmount > 0;
        let resolvedHistoryId = historyId;
        let historyPath = '';
        if (resolvedHistoryId) {
            historyPath = `/gameHistory/${uid}/${resolvedHistoryId}`;
            const specificHistory = await firebase_config_1.rtdb.ref(historyPath).once('value');
            if (!specificHistory.exists()) {
                throw new Error('History entry not found');
            }
            const data = specificHistory.val();
            if (data.gameId !== gameId) {
                throw new Error('History entry does not belong to this game');
            }
        }
        else {
            const pendingSnapshot = await firebase_config_1.rtdb.ref(`gameHistory/${uid}`)
                .orderByChild('gameId')
                .equalTo(gameId)
                .limitToFirst(1)
                .once('value');
            if (!pendingSnapshot.exists()) {
                throw new Error('Pending history entry not found');
            }
            const histories = pendingSnapshot.val();
            resolvedHistoryId = Object.keys(histories)[0];
            historyPath = `/gameHistory/${uid}/${resolvedHistoryId}`;
        }
        const now = Date.now();
        const participantPath = `/games/cube/${gameId}/participants/${uid}/${participant.betId}`;
        const participantUpdates = {
            finalPot: resolvedFinalPotCode,
            finalPotIndex: resolvedFinalIndex,
            isWinner,
            reward: rewardAmount,
            settlementStatus: 'settled',
            settlementType: 'oracle',
            settledAt: now
        };
        let rewardCredited = false;
        if (isWinner && !participant.rewardSettledAt) {
            await firebase_config_1.rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
                return (currentBalance || 0) + rewardAmount;
            });
            await recordCubeLedger(uid, 'credit', rewardAmount, 'cube_win', {
                gameId,
                position: resolvedFinalPotCode,
                settledVia: 'finalizeCubeGameHistory'
            });
            participantUpdates.rewardSettledAt = now;
            rewardCredited = true;
        }
        else if (participant.rewardSettledAt) {
            participantUpdates.rewardSettledAt = participant.rewardSettledAt;
        }
        await firebase_config_1.rtdb.ref(participantPath).update(participantUpdates);
        const supersededUpdates = {};
        Object.entries(betMap).forEach(([betId, bet]) => {
            var _a, _b, _c, _d, _e;
            if (betId === participant.betId) {
                return;
            }
            const supersededPath = `/games/cube/${gameId}/participants/${uid}/${betId}`;
            const fallbackIndex = ((_a = bet.position) === null || _a === void 0 ? void 0 : _a.toString()) || '';
            const fallbackCode = bet.finalPot
                || ((_c = (_b = game.positions) === null || _b === void 0 ? void 0 : _b[bet.finalPotIndex || fallbackIndex]) === null || _c === void 0 ? void 0 : _c.code)
                || ((_e = (_d = game.positions) === null || _d === void 0 ? void 0 : _d[fallbackIndex]) === null || _e === void 0 ? void 0 : _e.code)
                || fallbackIndex;
            supersededUpdates[`${supersededPath}/settlementStatus`] = 'superseded';
            supersededUpdates[`${supersededPath}/settlementType`] = 'superseded';
            supersededUpdates[`${supersededPath}/finalPotIndex`] = bet.finalPotIndex || fallbackIndex;
            supersededUpdates[`${supersededPath}/finalPot`] = fallbackCode;
            supersededUpdates[`${supersededPath}/reward`] = 0;
            supersededUpdates[`${supersededPath}/isWinner`] = false;
            supersededUpdates[`${supersededPath}/settledAt`] = now;
        });
        if (Object.keys(supersededUpdates).length > 0) {
            await firebase_config_1.rtdb.ref().update(supersededUpdates);
        }
        await firebase_config_1.rtdb.ref(historyPath).update({
            isCompleted: true,
            updatedAt: now,
            finalPot: resolvedFinalPotCode,
            finalPotIndex: resolvedFinalIndex,
            winningPot: resolvedFinalPotCode,
            rewardAmount,
            isWinner,
            betId: participant.betId,
            settlementStatus: participantUpdates.settlementStatus
        });
        console.log(`[finalizeCubeGameHistory] Finalized history ${resolvedHistoryId} for user ${uid} (game ${gameId})`);
        return {
            success: true,
            historyId: resolvedHistoryId,
            gameId,
            finalPot: resolvedFinalPotCode,
            finalPotIndex: resolvedFinalIndex,
            rewardAmount,
            isWinner,
            moveDirection: direction,
            moveDistance,
            rewardCredited,
            betId: participant.betId,
            rewardSettledAt: participantUpdates.rewardSettledAt || participant.rewardSettledAt || null,
            oracleCapturedAt: ((_h = game.oracleSnapshot) === null || _h === void 0 ? void 0 : _h.capturedAt) || null,
            resultCalculatedAt: game.resultCalculatedAt || game.result.calculatedAt || null
        };
    }
    catch (error) {
        console.error('[finalizeCubeGameHistory] Failed to finalize history:', error);
        throw new Error(error instanceof Error ? error.message : 'Failed to finalize history');
    }
});
async function recordCubeLedger(uid, type, amount, operation, meta) {
    const ledgerEntry = {
        type,
        amountUsd: amount,
        meta: {
            operation,
            ...meta,
            timestamp: Date.now()
        },
        createdAt: Date.now()
    };
    await firebase_config_1.rtdb.ref(`/ledger/${uid}`).push(ledgerEntry);
}
// 초기 큐브 게임 생성 (시스템 시작시)
exports.initializeCubeGame = (0, https_1.onCall)(async (request) => {
    try {
        // 현재 활성 게임이 있는지 확인
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            await createNewCubeGame();
            return { success: true, message: 'New cube game created' };
        }
        return { success: true, message: 'Active game already exists', gameId: currentGame.gameId };
    }
    catch (error) {
        console.error('Failed to initialize cube game:', error);
        throw new Error('Failed to initialize cube game');
    }
});
// 큐브 게임 정산 및 새 게임 생성 스케줄러 (매 1분마다 실행)
// 테스트 함수: Cube 게임을 종료된 것처럼 처리하여 결과 계산
exports.testCubeGameSettlement = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    console.warn('[testCubeGameSettlement] Deprecated function invoked');
    throw new Error('testCubeGameSettlement is disabled. Use testCubeGameWithFixedMove with fillEmptyPositions instead.');
});
async function processCubeGameSettlements() {
    try {
        const now = Date.now();
        // 모든 큐브 게임 조회
        const gamesSnapshot = await firebase_config_1.rtdb.ref('/games/cube').once('value');
        const games = gamesSnapshot.val();
        if (!games) {
            // 게임이 없으면 새 게임 생성
            await createNewCubeGame();
            return;
        }
        for (const [gameId, game] of Object.entries(games)) {
            const participantCount = countCubeParticipantSeats(game.participants);
            // 대기 중인데 모든 인덱스가 찬 경우 안전장치로 바로 종료 처리
            if (game.status === 'waiting' && participantCount >= MAX_CUBE_POSITIONS) {
                const settlementAt = now + CUBE_SETTLEMENT_DELAY_MS;
                console.log(`[processCubeGameSettlements] Game ${gameId} reached max participants. Closing and scheduling settlement.`);
                await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).update({
                    status: 'closed',
                    gameEndAt: now,
                    settlementAt
                });
                await firebase_config_1.rtdb.ref(`/games/cube_realtime/${gameId}/status`).update({
                    status: 'settlement_pending',
                    message: 'Game is full! Calculating results in 5 seconds...',
                    countdown: CUBE_SETTLEMENT_DELAY_MS,
                    settlementAt
                });
                await captureCubeOracleSnapshot(gameId);
                continue;
            }
            // 과거 로직으로 active 상태인 게임도 종료시간이 지났다면 closed로 이동
            if (game.status === 'active' && game.gameEndAt > 0 && game.gameEndAt <= now) {
                const settlementAt = (game.settlementAt && game.settlementAt > now)
                    ? game.settlementAt
                    : (game.gameEndAt + CUBE_SETTLEMENT_DELAY_MS);
                console.log(`[processCubeGameSettlements] Legacy active game ${gameId} reached end time. Scheduling settlement.`);
                await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).update({
                    status: 'closed',
                    gameEndAt: now,
                    settlementAt
                });
                await captureCubeOracleSnapshot(gameId);
                continue;
            }
            if (game.status === 'closed') {
                const settlementDeadline = game.settlementAt || ((game.gameEndAt || now) + CUBE_SETTLEMENT_DELAY_MS);
                if (!game.settlementAt) {
                    await firebase_config_1.rtdb.ref(`/games/cube/${gameId}/settlementAt`).set(settlementDeadline);
                }
                if (settlementDeadline <= now) {
                    const enqueuedAt = game.settlementTaskEnqueuedAt || 0;
                    if (enqueuedAt && (now - enqueuedAt) < CUBE_TASK_ENQUEUE_COOLDOWN_MS) {
                        console.log(`Cube game ${gameId} already enqueued for settlement at ${new Date(enqueuedAt).toISOString()}`);
                    }
                    else {
                        console.log(`Cube game ${gameId} reached settlement window. Enqueuing task for calculation...`);
                        await enqueueCubeSettlementTask(gameId);
                        await firebase_config_1.rtdb.ref(`/games/cube/${gameId}`).update({
                            settlementTaskEnqueuedAt: now,
                            settlementTaskCompletedAt: null
                        });
                    }
                }
                continue;
            }
            if (game.status === 'finished' && !game.nextGameCreated) {
                console.log(`Cube game ${gameId} finished without next game. Creating a new one now.`);
                await createNewCubeGame();
                await firebase_config_1.rtdb.ref(`/games/cube/${gameId}/nextGameCreated`).set(true);
            }
        }
        // 활성 게임이 없으면 새 게임 생성
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            console.log('No active cube game found. Creating new game...');
            await createNewCubeGame();
        }
    }
    catch (error) {
        console.error('Process cube game settlements failed:', error);
    }
}
// 테스트 함수: 현재 게임을 강제로 가득 찬 상태로 만들기
exports.testFillCubeGame = (0, https_1.onCall)(async (request) => {
    try {
        console.log('[testFillCubeGame] Starting cube game fill test...');
        // 현재 활성 게임 조회
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            throw new Error('No active cube game found');
        }
        const currentParticipantCount = countCubeParticipantSeats(currentGame.participants);
        console.log(`[testFillCubeGame] Found game ${currentGame.gameId} with ${currentParticipantCount} occupied positions`);
        // 모든 Index(1~2047)를 순차적으로 채우기
        const MAX_POSITIONS = MAX_CUBE_POSITIONS;
        // 이미 채워진 위치 확인
        const occupiedPositions = new Set();
        Object.entries(currentGame.positions || {}).forEach(([index, position]) => {
            if (position.isOccupied) {
                occupiedPositions.add(parseInt(index, 10));
            }
        });
        // 비어있는 위치 찾기 (1부터 2047까지 순차적으로)
        const emptyPositions = [];
        for (let pos = 1; pos <= MAX_POSITIONS; pos++) {
            if (!occupiedPositions.has(pos)) {
                emptyPositions.push(pos);
            }
        }
        if (emptyPositions.length === 0) {
            console.log('[testFillCubeGame] Game is already full (all positions occupied)');
            return {
                success: true,
                message: 'Game is already full - all positions occupied',
                gameId: currentGame.gameId,
                participantCount: currentParticipantCount,
                totalPositions: MAX_POSITIONS
            };
        }
        console.log(`[testFillCubeGame] Filling ${emptyPositions.length} empty positions (${occupiedPositions.size}/${MAX_POSITIONS} already occupied)...`);
        const now = Date.now();
        const updates = {};
        // 모든 비어있는 위치를 순차적으로 채우기 (1부터 2047까지)
        emptyPositions.forEach((position, index) => {
            const dummyUid = `test_user_${now}_${position}`;
            // 참가자 데이터
            const betId = `test_bet_${position}_${now}`;
            const participant = {
                uid: dummyUid,
                email: `test${position}@example.com`,
                position: position.toString(),
                betAmount: 20,
                joinedAt: now + index,
                betId,
                settlementStatus: 'pending'
            };
            // 위치 점유 및 참가자 추가 (순차적으로 Index 채우기)
            updates[`/games/cube/${currentGame.gameId}/positions/${position}/isOccupied`] = true;
            updates[`/games/cube/${currentGame.gameId}/positions/${position}/occupiedBy`] = dummyUid;
            updates[`/games/cube/${currentGame.gameId}/positions/${position}/occupiedAt`] = now + index;
            updates[`/games/cube/${currentGame.gameId}/participants/${dummyUid}/${betId}`] = participant;
            updates[`/games/cube/${currentGame.gameId}/participants_latest/${dummyUid}`] = {
                betId,
                position: participant.position,
                joinedAt: participant.joinedAt
            };
        });
        // 총 참가자 수 계산 (실제 채워진 참가자 수)
        const finalParticipantCount = occupiedPositions.size + emptyPositions.length;
        // 총 상금 업데이트 (실제 채워진 참가자 수 기준)
        updates[`/games/cube/${currentGame.gameId}/totalPot`] = finalParticipantCount * 20; // $20 per participant
        // 즉시 종료 처리 후 5분 뒤 정산 예약
        const settlementAt = now + CUBE_SETTLEMENT_DELAY_MS;
        updates[`/games/cube/${currentGame.gameId}/status`] = 'closed';
        updates[`/games/cube/${currentGame.gameId}/gameEndAt`] = now;
        updates[`/games/cube/${currentGame.gameId}/settlementAt`] = settlementAt;
        // 모든 업데이트 적용
        await firebase_config_1.rtdb.ref().update(updates);
        // 실시간 상태 업데이트
        await firebase_config_1.rtdb.ref(`/games/cube_realtime/${currentGame.gameId}/status`).update({
            status: 'settlement_pending',
            message: 'Game is full! Calculating results in 5 seconds...',
            countdown: CUBE_SETTLEMENT_DELAY_MS,
            settlementAt,
            participantCount: finalParticipantCount,
            totalPot: finalParticipantCount * 20,
            availablePositions: 0,
            progressPercent: 100
        });
        await captureCubeOracleSnapshot(currentGame.gameId);
        console.log(`[testFillCubeGame] Game ${currentGame.gameId} filled successfully. All ${finalParticipantCount} positions (Index 1-2047) are now occupied. Settlement scheduled in 5 seconds.`);
        return {
            success: true,
            message: `Game filled successfully! All ${finalParticipantCount} positions (Index 1-2047) are now occupied. Calculating results in 5 seconds...`,
            gameId: currentGame.gameId,
            participantCount: finalParticipantCount,
            totalPositions: MAX_POSITIONS,
            filledPositions: finalParticipantCount,
            totalPot: finalParticipantCount * 20,
            gameEndAt: now,
            settlementAt
        };
    }
    catch (error) {
        console.error('[testFillCubeGame] Test fill failed:', error);
        throw new Error(`Failed to fill cube game: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// 테스트 함수: 특정 Oracle 결과로 게임 결과 강제 계산
exports.testCubeGameWithOracle = (0, https_1.onCall)(async (request) => {
    const { oracleNumbers } = request.data;
    try {
        console.log('[testCubeGameWithOracle] Testing cube game with custom oracle...');
        // 현재 활성 게임 조회
        const currentGame = await getCurrentCubeGameInternal();
        if (!currentGame) {
            throw new Error('No active cube game found');
        }
        // 테스트용 Oracle 데이터 (제공되지 않으면 기본값 사용)
        const testOracleNumbers = oracleNumbers || {
            BTC: 4, // 짝수 = 왼쪽
            ETH: 0,
            XRP: 0,
            BNB: 2,
            SOL: 4,
            DOGE: 5,
            TRX: 3
        };
        console.log(`[testCubeGameWithOracle] Using oracle numbers:`, testOracleNumbers);
        const now = Date.now();
        // Oracle 데이터를 테스트용으로 설정
        await firebase_config_1.rtdb.ref(`/games/cube/${currentGame.gameId}/oracleSnapshot`).set({
            gameNumbers: testOracleNumbers,
            prices: {},
            timestamp: now,
            capturedAt: now
        });
        // 게임 상태를 calculating으로 변경
        await firebase_config_1.rtdb.ref(`/games/cube/${currentGame.gameId}/status`).set('calculating');
        // 즉시 결과 계산
        await calculateCubeGameResult(currentGame.gameId);
        const { direction, moveDistance, moveNumbers } = getCubeMoveParameters(testOracleNumbers);
        const samplePosition = calculateCubeFinalPosition(1024, direction, moveDistance);
        console.log(`[testCubeGameWithOracle] Game ${currentGame.gameId} completed. Sample final position from 1024: ${samplePosition}`);
        return {
            success: true,
            message: 'Game completed with test oracle',
            gameId: currentGame.gameId,
            oracleNumbers: testOracleNumbers,
            winningPosition: samplePosition.toString(),
            calculation: {
                btcNumber: testOracleNumbers.BTC,
                direction: direction === -1 ? 'left' : 'right',
                moveNumbers,
                moveDistance
            }
        };
    }
    catch (error) {
        console.error('[testCubeGameWithOracle] Test oracle failed:', error);
        throw new Error(`Failed to test cube game with oracle: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// 테스트 함수: Cube 게임에서 MoveDistance와 MoveDirection을 고정하고 정산
exports.testCubeGameWithFixedMove = (0, https_1.onCall)(async (request) => {
    var _a;
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    const { uid } = request.auth;
    const { gameId, direction, moveDistance, fillEmptyPositions, fillerUid, fillerEmail, useAuthUserAsFiller } = request.data;
    try {
        console.log('[testCubeGameWithFixedMove] Testing cube game with fixed move parameters...');
        // gameId가 제공되지 않으면 현재 활성 게임 사용
        let targetGameId = gameId;
        if (!targetGameId) {
            const currentGame = await getCurrentCubeGameInternal();
            if (!currentGame) {
                throw new Error('No active cube game found and gameId not provided');
            }
            targetGameId = currentGame.gameId;
        }
        // direction과 moveDistance 검증
        if (direction === undefined || moveDistance === undefined) {
            throw new Error('direction and moveDistance are required');
        }
        if (direction !== -1 && direction !== 1) {
            throw new Error('direction must be -1 (left) or 1 (right)');
        }
        if (moveDistance < 0 || moveDistance > 999999) {
            throw new Error('moveDistance must be between 0 and 999999');
        }
        console.log(`[testCubeGameWithFixedMove] Using gameId: ${targetGameId}, direction: ${direction === -1 ? 'left' : 'right'}, moveDistance: ${moveDistance}`);
        // 게임 조회
        const gameSnapshot = await firebase_config_1.rtdb.ref(`/games/cube/${targetGameId}`).once('value');
        let game = gameSnapshot.val();
        if (!game) {
            throw new Error('Game not found');
        }
        const now = Date.now();
        let fillResult = null;
        if (fillEmptyPositions) {
            const resolvedFillerUid = useAuthUserAsFiller ? uid : (fillerUid || 'cube_test_user');
            const resolvedFillerEmail = useAuthUserAsFiller
                ? (((_a = request.auth.token) === null || _a === void 0 ? void 0 : _a.email) || 'cube.tester@pointhub.dev')
                : (fillerEmail || 'cube_test_user@pointhub.dev');
            fillResult = await fillCubeGameWithFiller(targetGameId, game, resolvedFillerUid, resolvedFillerEmail);
            const refreshedSnapshot = await firebase_config_1.rtdb.ref(`/games/cube/${targetGameId}`).once('value');
            const refreshedGame = refreshedSnapshot.val();
            if (refreshedGame) {
                game = refreshedGame;
            }
        }
        // 게임을 closed 상태로 변경
        await firebase_config_1.rtdb.ref(`/games/cube/${targetGameId}`).update({
            status: 'closed',
            gameEndAt: now,
            settlementAt: now
        });
        // 고정된 direction과 moveDistance로 결과 계산
        await calculateCubeGameResult(targetGameId, direction, moveDistance);
        const samplePosition = calculateCubeFinalPosition(1024, direction, moveDistance);
        console.log(`[testCubeGameWithFixedMove] Game ${targetGameId} completed with fixed move. Sample final position from 1024: ${samplePosition}`);
        return {
            success: true,
            message: 'Game completed with fixed move parameters',
            gameId: targetGameId,
            direction: direction === -1 ? 'left' : 'right',
            moveDistance,
            sampleFinalPosition: samplePosition,
            totalPot: game.totalPot,
            fillResult
        };
    }
    catch (error) {
        console.error('[testCubeGameWithFixedMove] Test failed:', error);
        throw new Error(`Failed to test cube game with fixed move: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
// 테스트 함수: 현재 실행 중인 Cube 게임을 없애고 강제로 새로운 게임 생성
exports.testResetCubeGame = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new Error('Authentication required');
    }
    try {
        console.log('[testResetCubeGame] Starting cube game reset...');
        // 현재 활성 게임 조회
        const currentGame = await getCurrentCubeGameInternal();
        if (currentGame) {
            console.log(`[testResetCubeGame] Found active game ${currentGame.gameId}, marking as finished...`);
            const now = Date.now();
            // 현재 게임을 finished 상태로 변경
            await firebase_config_1.rtdb.ref(`/games/cube/${currentGame.gameId}`).update({
                status: 'finished',
                gameEndAt: now,
                resultCalculatedAt: now,
                nextGameCreated: true
            });
            // 실시간 상태도 업데이트
            await firebase_config_1.rtdb.ref(`/games/cube_realtime/${currentGame.gameId}/status`).update({
                status: 'finished',
                message: 'Game has been reset'
            });
            console.log(`[testResetCubeGame] Game ${currentGame.gameId} marked as finished`);
        }
        else {
            console.log('[testResetCubeGame] No active game found, proceeding to create new game...');
        }
        // 새 게임 생성
        await createNewCubeGame();
        // 새로 생성된 게임 조회
        const newGame = await getCurrentCubeGameInternal();
        if (!newGame) {
            throw new Error('Failed to create new game');
        }
        console.log(`[testResetCubeGame] New cube game created: ${newGame.gameId}`);
        return {
            success: true,
            message: currentGame
                ? `Game ${currentGame.gameId} has been reset and new game ${newGame.gameId} created`
                : `New game ${newGame.gameId} created`,
            oldGameId: (currentGame === null || currentGame === void 0 ? void 0 : currentGame.gameId) || null,
            newGameId: newGame.gameId,
            newGameStatus: newGame.status,
            participantCount: countCubeParticipantSeats(newGame.participants)
        };
    }
    catch (error) {
        console.error('[testResetCubeGame] Reset failed:', error);
        throw new Error(`Failed to reset cube game: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
});
exports.cubeGameSettlementWorker = (0, tasks_1.onTaskDispatched)({
    region: CUBE_TASK_REGION,
    retry: true,
    timeoutSeconds: 60 * 15,
    memory: '2GiB'
}, async (request) => {
    var _a;
    const gameId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.gameId;
    if (!gameId) {
        console.error('[cubeGameSettlementWorker] Missing gameId in task payload');
        return;
    }
    console.log(`[cubeGameSettlementWorker] Processing settlement for game ${gameId}`);
    await calculateCubeGameResult(gameId);
});
//# sourceMappingURL=cube-game-new.js.map