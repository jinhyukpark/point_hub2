import { onCall } from 'firebase-functions/v2/https';
import { CallableRequest } from 'firebase-functions/v2/https';
import { rtdb } from './firebase-config';

// Types
interface GameBetRequest {
  gameType: 'cube' | 'matching' | 'goldenbell';
  betAmount: number;
  betData: any; // 게임별 베팅 데이터 (위치, 번호 등)
}

/* interface OracleSnapshot {
  timestamp: number;
  prices: Record<string, string>;
  gameNumbers: Record<string, number>;
} */

interface GameResult {
  isWin: boolean;
  reward: number;
  gameData: any;
  transactionId: string;
}

// 게임 베팅 및 결과 처리 (단일 함수로 통합)
export const playGame = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { gameType, betAmount, betData }: GameBetRequest = request.data;

  // 기본 검증
  if (!gameType || !betAmount || betAmount <= 0) {
    throw new Error('Invalid game parameters');
  }

  // 사용자 잔액 확인
  const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
  const userData = userSnapshot.val();
  
  if (!userData) {
    throw new Error('User not found');
  }

  const userBalance = userData.wallet?.usdt || 0;
  if (userBalance < betAmount) {
    throw new Error('Insufficient balance');
  }

  // 활성 게임 확인
  const currentGameSnapshot = await rtdb.ref('/games/current').once('value');
  const currentGame = currentGameSnapshot.val();
  
  if (!currentGame || currentGame.status !== 'open') {
    throw new Error('No active game available');
  }

  // Oracle 데이터 확인
  const oracleSnapshot = await rtdb.ref('/oracle/current').once('value');
  const oracleData = oracleSnapshot.val();
  
  if (!oracleData || !oracleData.gameNumbers) {
    throw new Error('Oracle data not available');
  }

  const transactionId = generateTransactionId();

  try {
    // 1. 베팅 금액 차감
    const debitResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
      if ((currentBalance || 0) < betAmount) {
        return; // 트랜잭션 중단
      }
      return currentBalance - betAmount;
    });

    if (!debitResult.committed) {
      throw new Error('Insufficient funds');
    }

    // 2. 베팅 기록
    await recordTransaction(uid, 'debit', betAmount, `${gameType}_bet`, {
      gameType,
      betData,
      transactionId,
      gameId: currentGame.id
    });

    // 3. 게임 결과 계산 (서버에서 실행)
    const gameResult = await calculateGameResult(gameType, betData, oracleData, betAmount);
    gameResult.transactionId = transactionId;

    // 4. 승리시 보상 지급
    if (gameResult.isWin && gameResult.reward > 0) {
      await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
        return (currentBalance || 0) + gameResult.reward;
      });

      // 보상 기록
      await recordTransaction(uid, 'credit', gameResult.reward, `${gameType}_win`, {
        gameType,
        gameResult: gameResult.gameData,
        transactionId,
        originalBet: betAmount
      });
    }

    console.log(`Game ${gameType} completed for user ${uid}: ${gameResult.isWin ? 'WIN' : 'LOSE'}`);

    return {
      success: true,
      result: gameResult,
      balance: await getCurrentBalance(uid)
    };

  } catch (error) {
    // 에러 발생시 차감된 금액 환불
    await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
      return (currentBalance || 0) + betAmount;
    });

    // 환불 기록
    await recordTransaction(uid, 'credit', betAmount, 'bet_refund', {
      reason: 'game_error',
      originalTransactionId: transactionId,
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    console.error('Game play failed:', error);
    throw new Error(`Game failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 게임 결과 계산 함수들
async function calculateGameResult(
  gameType: string, 
  betData: any, 
  oracleData: any, 
  betAmount: number
): Promise<GameResult> {
  
  switch (gameType) {
    case 'cube':
      return calculateCubeResult(betData, oracleData, betAmount);
    case 'matching':
      return calculateMatchingResult(betData, oracleData, betAmount);
    case 'goldenbell':
      return calculateGoldenBellResult(betData, oracleData, betAmount);
    default:
      throw new Error(`Unsupported game type: ${gameType}`);
  }
}

// 큐브 게임 결과 계산
async function calculateCubeResult(
  betData: any, 
  oracleData: any, 
  betAmount: number
): Promise<GameResult> {
  
  const { gameNumbers } = oracleData;
  const betPosition = betData.position;

  // BTC 번호로 방향 결정 (짝수: 왼쪽, 홀수: 오른쪽)
  const btcNumber = gameNumbers.BTC || 0;
  const direction = btcNumber % 2 === 0 ? -1 : 1;

  // 다른 코인 번호들로 이동 거리 계산
  const moveNumbers = [
    gameNumbers.ETH || 0,
    gameNumbers.XRP || 0,
    gameNumbers.BNB || 0,
    gameNumbers.SOL || 0,
    gameNumbers.DOGE || 0,
    gameNumbers.TRX || 0
  ];

  const moveDistance = moveNumbers.reduce((sum, num) => sum + num, 0);
  
  // 시작 위치 1024에서 이동
  const startPosition = 1024;
  const finalPosition = startPosition + (direction * moveDistance);
  
  // 0-2047 범위로 정규화
  const winningPosition = ((finalPosition % 2048) + 2048) % 2048;
  
  const isWin = betPosition === winningPosition;
  const reward = isWin ? betAmount * 2 : 0; // 2배 보상

  return {
    isWin,
    reward,
    gameData: {
      betPosition,
      winningPosition,
      btcDirection: direction > 0 ? 'right' : 'left',
      moveDistance,
      oracleNumbers: gameNumbers
    },
    transactionId: ''
  };
}

// 매칭 게임 결과 계산
async function calculateMatchingResult(
  betData: any, 
  oracleData: any, 
  betAmount: number
): Promise<GameResult> {
  
  const { gameNumbers } = oracleData;
  const userNumbers = betData.numbers || [];
  
  // 코인 순서대로 게임 번호 배열 생성
  const coinOrder = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX'];
  const winningNumbers = coinOrder.map(coin => gameNumbers[coin] || 0);
  
  // 매칭 개수 계산
  const matches = countMatches(userNumbers, winningNumbers);
  const requiredMatches = 3; // 승리 조건: 3개 이상 매칭
  
  const isWin = matches >= requiredMatches;
  const reward = isWin ? betAmount * 3 : 0; // 3배 보상

  return {
    isWin,
    reward,
    gameData: {
      userNumbers,
      winningNumbers,
      matches,
      requiredMatches,
      oracleNumbers: gameNumbers
    },
    transactionId: ''
  };
}

// 골든벨 게임 결과 계산  
async function calculateGoldenBellResult(
  betData: any, 
  oracleData: any, 
  betAmount: number
): Promise<GameResult> {
  
  const { gameNumbers } = oracleData;
  const userChoice = betData.choice; // 'even' 또는 'odd'
  
  // 모든 게임 번호의 합 계산
  const sum = Object.values(gameNumbers).reduce((total: number, num: any) => total + (typeof num === 'number' ? num : 0), 0) as number;
  const isEven = sum % 2 === 0;
  
  const isWin = (userChoice === 'even' && isEven) || (userChoice === 'odd' && !isEven);
  const reward = isWin ? betAmount * 1.8 : 0; // 1.8배 보상

  return {
    isWin,
    reward,
    gameData: {
      userChoice,
      sum,
      result: isEven ? 'even' : 'odd',
      oracleNumbers: gameNumbers
    },
    transactionId: ''
  };
}

// 매칭 개수 계산 헬퍼 함수
function countMatches(userNumbers: number[], winningNumbers: number[]): number {
  let matches = 0;
  const minLength = Math.min(userNumbers.length, winningNumbers.length);
  
  for (let i = 0; i < minLength; i++) {
    if (userNumbers[i] === winningNumbers[i]) {
      matches++;
    }
  }
  
  return matches;
}

// 트랜잭션 기록 함수
async function recordTransaction(
  uid: string, 
  type: 'credit' | 'debit', 
  amount: number, 
  operation: string, 
  meta: any
): Promise<void> {
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

  await rtdb.ref(`/ledger/${uid}`).push(ledgerEntry);
}

// 현재 잔액 조회
async function getCurrentBalance(uid: string): Promise<number> {
  const walletSnapshot = await rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
  return walletSnapshot.val() || 0;
}

// 트랜잭션 ID 생성
function generateTransactionId(): string {
  return `tx_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

// 현재 게임 상태 조회
export const getCurrentGameStatus = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  try {
    const gameSnapshot = await rtdb.ref('/games/current').once('value');
    const oracleSnapshot = await rtdb.ref('/oracle/current').once('value');
    
    const gameData = gameSnapshot.val();
    const oracleData = oracleSnapshot.val();

    return {
      success: true,
      game: gameData,
      oracle: oracleData,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Get game status failed:', error);
    throw new Error('Failed to get game status');
  }
});

// 사용자 최근 게임 기록 조회
export const getUserGameHistory = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const limit = request.data?.limit || 20;

  try {
    const ledgerSnapshot = await rtdb.ref(`/ledger/${uid}`)
      .orderByChild('createdAt')
      .limitToLast(limit * 2) // bet과 win 기록을 고려해서 2배로 조회
      .once('value');

    const ledgerData = ledgerSnapshot.val() || {};
    const gameTransactions = Object.values(ledgerData).filter((entry: any) => 
      entry.meta.operation.includes('_bet') || 
      entry.meta.operation.includes('_win')
    ).slice(-limit);

    const history = gameTransactions.reverse(); // 최신순 정렬
    return {
      success: true,
      history: history,
      total: history.length
    };
  } catch (error) {
    console.error('Get game history failed:', error);
    throw new Error('Failed to get game history');
  }
});

// ==================== 골든벨 전용 함수 ====================

// 골든벨 베팅 금액 차감
export const processGoldenBellBet = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, round, betAmount }: { gameId: string; round: number; betAmount: number } = request.data;

  if (!gameId || !round || !betAmount || betAmount <= 0) {
    throw new Error('Invalid parameters');
  }

  try {
    // 사용자 잔액 확인
    const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
    const userData = userSnapshot.val();
    
    if (!userData) {
      throw new Error('User not found');
    }

    const userBalance = userData.wallet?.usdt || 0;
    if (userBalance < betAmount) {
      throw new Error('Insufficient balance');
    }

    // 베팅 금액 차감
    const debitResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
      if ((currentBalance || 0) < betAmount) {
        return; // 트랜잭션 중단
      }
      return (currentBalance || 0) - betAmount;
    });

    if (!debitResult.committed) {
      throw new Error('Insufficient funds');
    }

    const transactionId = generateTransactionId();

    // 베팅 기록 (Ledger)
    await recordTransaction(uid, 'debit', betAmount, 'goldenbell_bet', {
      gameId,
      round,
      transactionId
    });

    // 골든벨 히스토리 저장
    await saveGoldenBellHistory(uid, {
      type: 'bet',
      gameId,
      round,
      betAmount,
      timestamp: Date.now(),
      transactionId
    });

    console.log(`[processGoldenBellBet] User ${uid} bet ${betAmount} USDT for game ${gameId} round ${round}`);

    return {
      success: true,
      transactionId,
      newBalance: debitResult.snapshot?.val() || 0
    };

  } catch (error) {
    console.error('[processGoldenBellBet] Failed:', error);
    throw new Error(`Failed to process bet: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 골든벨 참가자 등록 (USDT 차감 포함)
export const registerGoldenBellParticipant = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, email }: { gameId: string; email?: string } = request.data;

  if (!gameId) {
    throw new Error('gameId is required');
  }

  try {
    // 사용자 정보 확인
    const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
    const userData = userSnapshot.val();
    
    if (!userData) {
      throw new Error('User not found');
    }

    // VIP 상태 확인
    const membership = userData?.profile?.membership;
    const isVip = membership?.toLowerCase() === 'vip';
    console.log(`[registerGoldenBellParticipant] VIP check - membership: ${membership}, isVip: ${isVip}`);

    // 직접 경로에서 usdt 잔액 확인 (우선)
    let directBalance = 0;
    try {
      const directBalanceSnapshot = await rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
      directBalance = directBalanceSnapshot.val() || 0;
      console.log(`[registerGoldenBellParticipant] Direct path balance (/users/${uid}/wallet/usdt): ${directBalance}`);
    } catch (directError) {
      console.error(`[registerGoldenBellParticipant] Error reading direct path:`, directError);
    }
    
    // userData에서도 usdt 확인
    const userDataBalance = userData.wallet?.usdt || 0;
    
    // 최종 잔액: 직접 경로가 있으면 사용, 없으면 userData에서 가져옴
    const finalBalance = directBalance > 0 ? directBalance : userDataBalance;
    const betAmount = 1; // 첫 라운드 배팅 금액 1 USDT
    
    console.log(`[registerGoldenBellParticipant] User balance check - direct: ${directBalance}, userData: ${userDataBalance}, final: ${finalBalance}, required: ${betAmount}`);
    
    if (finalBalance < betAmount) {
      console.error(`[registerGoldenBellParticipant] Insufficient balance - Current: $${finalBalance}, Required: $${betAmount}`);
      throw new Error(`Insufficient balance. Current: $${finalBalance}, Required: $${betAmount}`);
    }

    // 참가자 경로 확인
    const participantPath = `/games/goldenbell/${gameId}/participants/${uid}`;
    const participantRef = rtdb.ref(participantPath);
    const snapshot = await participantRef.once('value');
    const now = Date.now();

    // 참가자가 이미 존재하는지 확인
    if (snapshot.exists()) {
      const existingParticipant = snapshot.val();
      // 이미 활성 참가자면 업데이트만
      if (existingParticipant.isActive) {
        console.log(`[registerGoldenBellParticipant] Participant already exists and is active, updating...`);
        await participantRef.update({
          isActive: true,
          exitReason: null,
          exitedAt: 0,
          decision: null,
          decisionSubmittedAt: 0
        });
        return {
          success: true,
          gameId,
          uid,
          alreadyRegistered: true
        };
      }
    }

    // 지갑에서 베팅 금액 차감 (트랜잭션 사용, usdt만 사용)
    const expectedBalance = finalBalance;
    const debitResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
      const balance = currentBalance !== null && currentBalance !== undefined ? currentBalance : expectedBalance;
      
      console.log(`[registerGoldenBellParticipant] Transaction callback - currentBalance: ${currentBalance}, using balance: ${balance}, required: ${betAmount}`);
      
      if (balance < betAmount) {
        console.log(`[registerGoldenBellParticipant] Transaction aborted - insufficient balance: ${balance} < ${betAmount}`);
        return; // 트랜잭션 중단
      }
      
      const newBalance = balance - betAmount;
      console.log(`[registerGoldenBellParticipant] Transaction will commit - newBalance: ${newBalance}`);
      return newBalance;
    });

    if (!debitResult.committed) {
      const snapshotValue = debitResult.snapshot?.val();
      console.error(`[registerGoldenBellParticipant] Transaction failed - committed: ${debitResult.committed}, snapshot: ${snapshotValue}`);
      throw new Error(`Failed to debit wallet. Transaction was not committed. Current balance: ${snapshotValue}`);
    }
    
    console.log(`[registerGoldenBellParticipant] Wallet debited successfully - new balance: ${debitResult.snapshot.val()}`);

    // 참가자 데이터 생성/업데이트
    const participantData = {
      uid,
      email: email || userData.auth?.email || 'unknown',
      joinedAt: now,
      joinedRound: 1,
      currentRound: 1,
      accumulatedReward: 0,
      totalBet: betAmount,
      choice: null,
      choiceSubmittedAt: 0,
      decision: null,
      decisionSubmittedAt: 0,
      isActive: true,
      isWinner: false,
      exitReason: null,
      exitedAt: 0,
      isVip: isVip
    };

    console.log(`[registerGoldenBellParticipant] Saving participant data to path: ${participantPath}`, participantData);
    await participantRef.set(participantData);
    
    // 저장 확인
    const verifySnapshot = await participantRef.once('value');
    if (!verifySnapshot.exists()) {
      throw new Error(`Failed to save participant data - data not found after write`);
    }
    console.log(`[registerGoldenBellParticipant] Participant data saved and verified:`, verifySnapshot.val());

    // Ledger에 베팅 기록
    const transactionId = generateTransactionId();
    await recordTransaction(uid, 'debit', betAmount, 'goldenbell_register', {
      gameId,
      round: 1,
      transactionId
    });

    // 골든벨 히스토리 저장
    await saveGoldenBellHistory(uid, {
      type: 'register',
      gameId,
      round: 1,
      betAmount,
      timestamp: now,
      transactionId
    });

    console.log(`[registerGoldenBellParticipant] User ${uid} registered for game ${gameId} with ${betAmount} USDT bet`);

    return {
      success: true,
      gameId,
      uid,
      newBalance: debitResult.snapshot.val(),
      transactionId
    };

  } catch (error) {
    console.error('[registerGoldenBellParticipant] Failed:', error);
    throw new Error(`Failed to register participant: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 골든벨 수당 지급
export const processGoldenBellReward = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, round, rewardAmount }: { gameId: string; round: number; rewardAmount: number } = request.data;

  if (!gameId || !round || !rewardAmount || rewardAmount <= 0) {
    throw new Error('Invalid parameters');
  }

  try {
    // 수당 지급
    const creditResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
      return (currentBalance || 0) + rewardAmount;
    });

    if (!creditResult.committed) {
      throw new Error('Failed to credit reward');
    }

    const transactionId = generateTransactionId();

    // 수당 기록 (Ledger)
    await recordTransaction(uid, 'credit', rewardAmount, 'goldenbell_reward', {
      gameId,
      round,
      transactionId
    });

    // 골든벨 히스토리 저장
    await saveGoldenBellHistory(uid, {
      type: 'reward',
      gameId,
      round,
      rewardAmount,
      timestamp: Date.now(),
      transactionId
    });

    console.log(`[processGoldenBellReward] User ${uid} received ${rewardAmount} USDT reward for game ${gameId} round ${round}`);

    return {
      success: true,
      transactionId,
      newBalance: creditResult.snapshot?.val() || 0
    };

  } catch (error) {
    console.error('[processGoldenBellReward] Failed:', error);
    throw new Error(`Failed to process reward: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 골든벨 히스토리 저장 (내부 함수)
async function saveGoldenBellHistory(uid: string, historyData: {
  type: 'bet' | 'reward' | 'exit' | 'game_end' | 'register';
  gameId: string;
  round: number;
  betAmount?: number;
  rewardAmount?: number;
  timestamp: number;
  transactionId: string;
}): Promise<void> {
  const historyEntry = {
    ...historyData,
    createdAt: Date.now()
  };

  await rtdb.ref(`/goldenbellHistory/${uid}`).push(historyEntry);
}

// 골든벨 히스토리 조회
export const getGoldenBellHistory = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const limit = request.data?.limit || 20;

  try {
    const historySnapshot = await rtdb.ref(`/goldenbellHistory/${uid}`)
      .orderByChild('createdAt')
      .limitToLast(limit)
      .once('value');

    const historyData = historySnapshot.val() || {};
    const historyArray = Object.values(historyData).reverse(); // 최신순 정렬

    return {
      success: true,
      history: historyArray
    };
  } catch (error) {
    console.error('[getGoldenBellHistory] Failed:', error);
    throw new Error('Failed to get Golden Bell history');
  }
});