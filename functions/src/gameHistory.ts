import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CallableRequest } from 'firebase-functions/v2/https';
import { rtdb } from './firebase-config';
import { formatGameHistory } from './history-formatter';

// 기본 게임 히스토리 인터페이스
interface BaseGameHistory {
  historyId: string;
  gameType: 'goldenbell' | 'matching' | 'matching_order' | 'matching_random' | 'cube';
  gameId: string;
  playerEmail: string;
  startTime: number;
  betAmount: number;
  rewardAmount: number;
  total: number;
  isCompleted: boolean;
  createdAt: number;
  updatedAt: number;
}

// 골든벨 히스토리
interface GoldenBellHistory extends BaseGameHistory {
  maxRound: number;
  roundChoices: string[];
  finalRound: number;
  eliminatedRound: number;
  roundRewardLogs?: GoldenBellRoundRewardLog[];
}

interface GoldenBellRoundRewardLog {
  round: number;
  winnerCount: number;
  vipWinnerCount: number;
  opponentPot: number;
  baseRewardPerWinner: number;
  vipBonusPerWinner: number;
  vipBonusTotal: number;
  totalRewardPerWinner: number;
  totalRoundPot: number;
}

function toNumeric(value: any): number {
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

function normalizeRoundRewardLogs(logs: any): GoldenBellRoundRewardLog[] {
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
      round: Math.floor(toNumeric((entry as any).round)),
      winnerCount: toNumeric((entry as any).winnerCount) || 0,
      vipWinnerCount: toNumeric((entry as any).vipWinnerCount) || 0,
      opponentPot: toNumeric((entry as any).opponentPot) || 0,
      baseRewardPerWinner: toNumeric((entry as any).baseRewardPerWinner) || 0,
      vipBonusPerWinner: toNumeric((entry as any).vipBonusPerWinner) || 0,
      vipBonusTotal: toNumeric((entry as any).vipBonusTotal) || 0,
      totalRewardPerWinner: toNumeric((entry as any).totalRewardPerWinner) || 0,
      totalRoundPot: toNumeric((entry as any).totalRoundPot) || 0
    }))
    .filter((entry) => Number.isFinite(entry.round) && entry.round > 0)
    .sort((a, b) => a.round - b.round);
}

// 매칭 게임 히스토리
interface MatchingGameHistory extends BaseGameHistory {
  matchingType: 'order' | 'random';
  selectedNumbers: string[];
  winningNumbers: string[];
  matches: number;
  rank: number;
  betId: string;
  coinOrder: string[];
}

// 큐브 게임 히스토리
interface CubeGameHistory extends BaseGameHistory {
  selectedIndex: number;
  finalPot: string;
  isAutoSelected: boolean;
}

// 히스토리 생성 함수
export const createGameHistory = onCall({ invoker: 'public' }, async (request: CallableRequest) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    const email = request.auth.token.email || '';

    const { gameType, gameId, betAmount, gameData } = request.data;
    
    if (!gameType || !gameId || betAmount === undefined || betAmount === null) {
      console.error('[createGameHistory] Missing required data:', { gameType, gameId, betAmount, hasGameData: !!gameData });
      throw new HttpsError('invalid-argument', 'Missing required data');
    }

    const timestamp = Date.now();
    
    // gameType이 'matching'인 경우, gameId나 gameData에서 타입 자동 추론
    let finalGameType = gameType;
    if (gameType === 'matching') {
      let matchingType: 'order' | 'random' | null = null;
      
      // 1. gameData.matchingType이 있으면 우선 사용
      if (gameData?.matchingType === 'order' || gameData?.matchingType === 'random') {
        matchingType = gameData.matchingType;
      }
      // 2. gameId에서 추론 (matching_order_xxx 또는 matching_random_xxx 형식)
      else if (gameId.includes('_order_')) {
        matchingType = 'order';
      } else if (gameId.includes('_random_')) {
        matchingType = 'random';
      }
      
      if (matchingType) {
        finalGameType = `matching_${matchingType}` as 'matching_order' | 'matching_random';
      } else {
        // 타입을 추론할 수 없으면 기본값 'order' 사용
        finalGameType = 'matching_order';
      }
    }
    
    // Matching 게임의 경우 betId를 historyId에 포함시켜 각 베팅마다 별도 히스토리 생성
    let historyId: string;
    if (finalGameType === 'matching' || finalGameType === 'matching_order' || finalGameType === 'matching_random') {
      const betId = gameData?.betId || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
      historyId = `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${betId}_${gameId}`;
    } else {
      historyId = `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${gameId}_${timestamp}`;
    }

    let historyData: BaseGameHistory;

    switch (finalGameType) {
      case 'goldenbell':
        historyData = {
          historyId,
          gameType: 'goldenbell',
          gameId,
          playerEmail: email,
          startTime: gameData?.startTime || timestamp,
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
        } as GoldenBellHistory;
        break;

      case 'matching':
      case 'matching_order':
      case 'matching_random':
        // finalGameType에서 matchingType 추출
        let matchingType: 'order' | 'random' = 'order';
        if (finalGameType === 'matching_order') {
          matchingType = 'order';
        } else if (finalGameType === 'matching_random') {
          matchingType = 'random';
        } else if (gameData?.matchingType === 'order' || gameData?.matchingType === 'random') {
          matchingType = gameData.matchingType;
        } else if (gameId.includes('_order_')) {
          matchingType = 'order';
        } else if (gameId.includes('_random_')) {
          matchingType = 'random';
        }
        
        // betId가 없으면 생성 (Unity에서 전달하지 않은 경우 대비)
        const betId = gameData?.betId || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
        
        historyData = {
          historyId,
          gameType: finalGameType as 'matching' | 'matching_order' | 'matching_random',
          gameId,
          playerEmail: email,
          startTime: gameData?.startTime || timestamp,
          betAmount: Number(betAmount),
          rewardAmount: 0,
          total: 0,
          isCompleted: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          matchingType: matchingType as 'order' | 'random',
          selectedNumbers: gameData?.selectedNumbers?.map((n: number) => n.toString()) || [],
          winningNumbers: [],
          matches: 0,
          rank: 0,
          betId: betId, // betId 필수 저장
          coinOrder: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX']
        } as MatchingGameHistory;
        break;

      case 'cube':
        historyData = {
          historyId,
          gameType: 'cube',
          gameId,
          playerEmail: email,
          startTime: gameData?.startTime || timestamp,
          betAmount: Number(betAmount),
          rewardAmount: 0,
          total: 0,
          isCompleted: false,
          createdAt: timestamp,
          updatedAt: timestamp,
          selectedIndex: gameData?.selectedIndex || -1,
          finalPot: '',
          isAutoSelected: gameData?.isAutoSelected || false
        } as CubeGameHistory;
        break;

      default:
        // 이전 호환성을 위해 'matching'만 있으면 matching_order로 처리
        if (gameType === 'matching') {
          finalGameType = 'matching_order';
          const matchingType = gameData?.matchingType || 'order';
          const betId = gameData?.betId || `bet_${timestamp}_${Math.random().toString(36).substring(2, 8)}`;
          historyData = {
            historyId: `${finalGameType}_${email.replace(/[@.]/g, '_')}_bet_${betId}_${gameId}`,
            gameType: finalGameType as 'matching_order',
            gameId,
            playerEmail: email,
            startTime: gameData?.startTime || timestamp,
            betAmount: Number(betAmount),
            rewardAmount: 0,
            total: 0,
            isCompleted: false,
            createdAt: timestamp,
            updatedAt: timestamp,
            matchingType: matchingType as 'order' | 'random',
            selectedNumbers: gameData?.selectedNumbers?.map((n: number) => n.toString()) || [],
            winningNumbers: [],
            matches: 0,
            rank: 0,
            betId: betId,
            coinOrder: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX']
          } as MatchingGameHistory;
          break;
        }
        throw new HttpsError('invalid-argument', `Unsupported game type: ${gameType}`);
    }

    // Firebase Realtime Database에 저장
    await rtdb.ref(`gameHistory/${uid}/${historyId}`).set(historyData);

    console.log(`[createGameHistory] Created history: ${historyId} for user ${uid}, gameType: ${gameType}`);

    return {
      success: true,
      historyId,
      message: 'Game history created successfully'
    };

  } catch (error) {
    console.error('[createGameHistory] Error details:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('[createGameHistory] Error message:', errorMessage);
    console.error('[createGameHistory] Error stack:', errorStack);
    
    // HttpsError는 그대로 throw
    if (error instanceof HttpsError) {
      throw error;
    }
    
    throw new HttpsError('internal', `Failed to create game history: ${errorMessage}`);
  }
});

// 히스토리 업데이트 함수 (결과 반영)
export const updateGameHistoryResult = onCall({ invoker: 'public' }, async (request: CallableRequest) => {
  try {
    const uid = request.auth?.uid;
    const { historyId, resultData } = request.data;
    
    if (!historyId || !resultData) {
      throw new HttpsError('invalid-argument', 'Missing required data');
    }

    const historyRef = rtdb.ref(`gameHistory/${uid}/${historyId}`);
    const historySnapshot = await historyRef.once('value');
    
    if (!historySnapshot.exists()) {
      throw new HttpsError('not-found', 'History not found');
    }

    const historyData = historySnapshot.val();
    const timestamp = Date.now();

    // 게임 타입별 결과 업데이트
    const updates: any = {
      rewardAmount: resultData.rewardAmount || 0,
      isCompleted: true,
      updatedAt: timestamp
    };

    switch (historyData.gameType) {
      case 'goldenbell':
        if (resultData.finalRound) updates.finalRound = resultData.finalRound;
        if (resultData.eliminatedRound) updates.eliminatedRound = resultData.eliminatedRound;
        if (resultData.roundChoices) updates.roundChoices = resultData.roundChoices;
        if (resultData.maxRound) updates.maxRound = resultData.maxRound;
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
        if (resultData.winningNumbers) updates.winningNumbers = resultData.winningNumbers;
        if (resultData.matches !== undefined) updates.matches = resultData.matches;
        if (resultData.rank !== undefined) updates.rank = resultData.rank;
        break;

      case 'cube':
        if (resultData.finalPot) updates.finalPot = resultData.finalPot;
        break;
    }

    await historyRef.update(updates);

    return {
      success: true,
      message: 'Game result updated successfully'
    };

  } catch (error) {
    console.error('updateGameHistoryResult error:', error);
    throw new HttpsError('internal', 'Failed to update game result');
  }
});

// 사용자 게임 히스토리 조회
export const getUserGameHistory = onCall(async (request: CallableRequest) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    const { gameType, limit = 50, includeCompleted = true, includeIncomplete = true } = request.data || {};

    // 최신 순으로 정렬된 쿼리 생성
    const query = rtdb.ref(`gameHistory/${uid}`)
                    .orderByChild('createdAt')
                    .limitToLast(limit);
    
    const snapshot = await query.once('value');
    const histories: any[] = [];

    if (snapshot.exists()) {
      const data = snapshot.val();
      
      Object.values(data).forEach((history: any) => {
        // 필터 조건 확인
        // gameType이 'matching'이면 'matching_order'와 'matching_random' 모두 포함
        if (gameType) {
          if (gameType === 'matching') {
            if (!['matching', 'matching_order', 'matching_random'].includes(history.gameType)) {
              return;
            }
          } else if (history.gameType !== gameType) {
            return;
          }
        }
        if (!includeCompleted && history.isCompleted) return;
        if (!includeIncomplete && !history.isCompleted) return;
        
        // 히스토리 포맷팅 적용 (영어 순위 텍스트 등 추가)
        const formattedHistory = formatGameHistory(history);
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

  } catch (error) {
    console.error('getUserGameHistory error:', error);
    throw new HttpsError('internal', 'Failed to retrieve game history');
  }
});

// 완료되지 않은 게임 조회 (결과 확인용)
export const getPendingGameResults = onCall(async (request: CallableRequest) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    
    // 완료되지 않은 게임만 조회
    const query = rtdb.ref(`gameHistory/${uid}`)
                    .orderByChild('isCompleted')
                    .equalTo(false);
    
    const snapshot = await query.once('value');
    const pendingGames: any[] = [];

    if (snapshot.exists()) {
      const data = snapshot.val();
      Object.values(data).forEach((history: any) => {
        // 히스토리 포맷팅 적용
        const formattedHistory = formatGameHistory(history);
        pendingGames.push(formattedHistory);
      });
    }

    return {
      success: true,
      pendingGames,
      total: pendingGames.length
    };

  } catch (error) {
    console.error('getPendingGameResults error:', error);
    throw new HttpsError('internal', 'Failed to retrieve pending game results');
  }
});

// 특정 히스토리 상세 조회
export const getGameHistoryDetail = onCall(async (request: CallableRequest) => {
  try {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Authentication required');
    }

    const uid = request.auth.uid;
    const { historyId } = request.data;
    
    if (!historyId) {
      throw new HttpsError('invalid-argument', 'History ID is required');
    }

    const snapshot = await rtdb.ref(`gameHistory/${uid}/${historyId}`).once('value');
    
    if (!snapshot.exists()) {
      throw new HttpsError('not-found', 'History not found');
    }

    const history = snapshot.val();
    
    // 히스토리 포맷팅 적용
    const formattedHistory = formatGameHistory(history);

    return {
      success: true,
      history: formattedHistory
    };

  } catch (error) {
    console.error('getGameHistoryDetail error:', error);
    throw new HttpsError('internal', 'Failed to retrieve game history detail');
  }
});
