import { onCall } from 'firebase-functions/v2/https';
import { CallableRequest } from 'firebase-functions/v2/https';
import { rtdb } from './firebase-config';
import { formatRank } from './history-formatter';
import { addToGporderQueue } from './index';

const MATCHING_SETTLEMENT_DELAY_MS = 5 * 60 * 1000;
const MATCHING_ORACLE_PAIRS = [
  'BTCUSDT',
  'ETHUSDT',
  'XRPUSDT',
  'BNBUSDT',
  'SOLUSDT',
  'DOGEUSDT',
  'TRXUSDT'
];

// Binance API에서 실시간 가격 데이터 가져오기
async function fetchBinanceOracleData(): Promise<{ gameNumbers: Record<string, number>; prices: Record<string, string>; timestamp: number; source: 'binance' | 'fallback'; }> {
  try {
    const priceData: Record<string, string> = {};
    const gameNumbers: Record<string, number> = {};

    for (const symbol of MATCHING_ORACLE_PAIRS) {
      const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
      if (!response.ok) {
        throw new Error(`Binance responded with ${response.status}`);
      }
      const data = await response.json();
      const price = parseFloat(data.price);
      priceData[symbol] = data.price;

      const priceStr = price.toFixed(2);
      const decimals = priceStr.split('.')[1] || '00';
      const secondDecimal = parseInt(decimals[1] ?? decimals[0] ?? '0', 10);
      gameNumbers[symbol.replace('USDT', '')] = Number.isNaN(secondDecimal) ? 0 : secondDecimal;
    }

    return {
      gameNumbers,
      prices: priceData,
      timestamp: Date.now(),
      source: 'binance'
    };
  } catch (error) {
    console.error('[fetchBinanceOracleData] Primary fetch failed. Falling back to deterministic oracle data.', error);
    return generateFallbackOracleData();
  }
}

function generateFallbackOracleData(): { gameNumbers: Record<string, number>; prices: Record<string, string>; timestamp: number; source: 'fallback'; } {
  const timestamp = Date.now();
  const gameNumbers: Record<string, number> = {};
  const prices: Record<string, string> = {};

  MATCHING_ORACLE_PAIRS.forEach((symbol, index) => {
    const coin = symbol.replace('USDT', '');
    const seed = Math.abs(Math.sin(timestamp + index) * 1000);
    const derived = Math.floor(seed) % 10;
    gameNumbers[coin] = derived;
    prices[symbol] = (seed + index).toFixed(2);
  });

  return {
    gameNumbers,
    prices,
    timestamp,
    source: 'fallback'
  };
}

// Types
interface MatchingGame {
  gameId: string;
  gameType: 'order' | 'random';
  status: 'active' | 'closed' | 'calculating' | 'finished';
  startedAt: number;
  endAt: number;
  totalPot: number;
  betAmount: number; // 2달러 고정
  participants: Record<string, MatchingParticipant[]>; // uid별 베팅 목록
  winningNumbers: number[];
  results: MatchingGameResult[];
  createdAt: number;
  settlementAt?: number; // 결과 계산 예정 시간
  oracleSnapshot?: OracleSnapshot;
}

interface MatchingParticipant {
  uid: string;
  email: string;
  betId: string;
  coin: string; // BTC, ETH, XRP, BNB, SOL, DOGE, TRX
  number: number; // 0-9 선택한 숫자
  numbers: number[]; // 7개 코인 숫자 배열
  selectionType: 'auto' | 'manual' | 'semi-auto';
  betAmount: number; // 2달러 고정
  bettedAt: number;
  result?: {
    matches: number;
    rank: number;
    reward: number;
  };
}

interface MatchingWinnerInfo {
  uid: string;
  email: string;
  betId?: string;
}

interface MatchingGameResult {
  rank: number;
  requiredMatches: number;
  winners: MatchingWinnerInfo[];
  totalReward: number;
  rewardPerWinner: number;
}

interface MatchingGameSummary {
  gameId: string;
  gameType: 'order' | 'random';
  totalParticipants: number;
  totalBets: number;
  totalPot: number;
  winningNumbers: number[];
  coinResults: any[];
  calculatedAt: number;
}

interface OracleSnapshot {
  gameNumbers: Record<string, number>;
  prices: Record<string, string>;
  timestamp: number;
  capturedAt: number;
}

// 매칭 게임 참여
export const joinMatchingGame = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { numbers, selectionType, gameType }: { 
    numbers?: number[];
    selectionType: 'auto' | 'manual' | 'semi-auto';
    gameType?: string;
  } = request.data;

  const normalizedGameType = normalizeMatchingGameType(gameType);

  if (!selectionType || !['auto', 'manual', 'semi-auto'].includes(selectionType)) {
    throw new Error('Invalid selection type. Must be: auto, manual, or semi-auto');
  }

  let selectedNumbers: number[];
  
  if (selectionType === 'manual') {
    if (!numbers || !Array.isArray(numbers) || numbers.length !== 7) {
      throw new Error('For manual selection, must provide exactly 7 numbers');
    }
    if (!numbers.every(num => Number.isInteger(num) && num >= 0 && num <= 9)) {
      throw new Error('All numbers must be integers between 0 and 9');
    }
    selectedNumbers = numbers;
  } else if (selectionType === 'auto') {
    // AUTO: 전체 7개 랜덤 생성
    selectedNumbers = Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
  } else {
    // SEMI-AUTO: 사용자가 일부만 선택, 나머지는 랜덤
    if (!numbers || !Array.isArray(numbers)) {
      throw new Error('For semi-auto selection, must provide partial numbers array');
    }
    selectedNumbers = [...numbers];
    // 빈 자리를 랜덤으로 채우기
    for (let i = 0; i < 7; i++) {
      if (selectedNumbers[i] === undefined || selectedNumbers[i] === null) {
        selectedNumbers[i] = Math.floor(Math.random() * 10);
      }
    }
  }

  try {
    // 현재 활성 매칭 게임 조회 (베팅 가능한 상태)
    const currentGames = await getCurrentMatchingGames();
    
    if (currentGames.length === 0) {
      throw new Error('No active matching games available');
    }
    
    // 베팅이 가능한 게임만 필터링
    const bettableGames = currentGames
      .filter(game => game.status === 'active')
      .map(game => ({
        ...game,
        gameType: game.gameType === 'random' ? 'random' : 'order'
      }));
    if (bettableGames.length === 0) {
      throw new Error('No games accepting bets at this time');
    }

    // 요청 타입이 있으면 해당 타입만, 없으면 order 우선
    let resolvedGameType: 'order' | 'random' | null = normalizedGameType || null;
    const availableTypes = new Set(bettableGames.map(game => game.gameType));

    if (resolvedGameType && !availableTypes.has(resolvedGameType)) {
      throw new Error(`Requested game type (${resolvedGameType}) is not available right now`);
    }

    if (!resolvedGameType) {
      resolvedGameType = availableTypes.has('order') ? 'order'
        : availableTypes.has('random') ? 'random'
        : null;
    }

    if (!resolvedGameType) {
      throw new Error('No matching games available for betting');
    }

    const targetGames = bettableGames.filter(game => game.gameType === resolvedGameType);

    if (targetGames.length === 0) {
      throw new Error(`No active ${resolvedGameType} games available for betting`);
    }

    // 사용자 정보 및 잔액 확인
    console.log(`[joinMatchingGame] Checking user data for ${uid}`);
    const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
    const userData = userSnapshot.val();
    
    if (!userData) {
      throw new Error('User not found');
    }

    const betAmount = 1; // 2달러 고정
    
    // Random 게임은 실제 잔고를 차감하지 않음
    const isRandomGame = resolvedGameType === 'random';
    
    if (!isRandomGame) {
      // ORDER 게임인 경우에만 잔액 확인 및 차감
      // 직접 경로에서 usdt 잔액 확인 (우선)
      let directBalance = 0;
      try {
        const directBalanceSnapshot = await rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
        directBalance = directBalanceSnapshot.val() || 0;
        console.log(`[joinMatchingGame] Direct path balance (/users/${uid}/wallet/usdt): ${directBalance} (type: ${typeof directBalance})`);
      } catch (directError) {
        console.error(`[joinMatchingGame] Error reading direct path:`, directError);
      }
      
      // userData에서도 usdt 확인
      const userDataBalance = userData.wallet?.usdt || 0;
      console.log(`[joinMatchingGame] UserData wallet.usdt: ${userDataBalance} (type: ${typeof userDataBalance})`);
      
      // 최종 잔액: 직접 경로가 있으면 사용, 없으면 userData에서 가져옴
      const finalBalance = directBalance > 0 ? directBalance : userDataBalance;
      
      console.log(`[joinMatchingGame] User balance check - direct: ${directBalance}, userData: ${userDataBalance}, final: ${finalBalance}, required: ${betAmount}`);
      console.log(`[joinMatchingGame] Wallet structure:`, JSON.stringify(userData.wallet, null, 2));
      
      if (finalBalance < betAmount * 2) {
        console.error(`[joinMatchingGame] Insufficient balance - Current: $${finalBalance}, Required: $${betAmount}`);
        throw new Error(`Insufficient balance. Current: $${finalBalance}, Required: $${betAmount}`);
      }

      // 지갑에서 베팅 금액 차감 (트랜잭션 사용, usdt만 사용)
      const expectedBalance = finalBalance;
      const debitResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
        // currentBalance가 null/undefined이면 expectedBalance 사용
        const balance = currentBalance !== null && currentBalance !== undefined ? currentBalance : expectedBalance;
        
        console.log(`[joinMatchingGame] Transaction callback - currentBalance from DB: ${currentBalance}, using balance: ${balance}, expected: ${expectedBalance}, required: ${betAmount}`);
        
        if (balance < betAmount * 2) {
          console.log(`[joinMatchingGame] Transaction aborted - insufficient balance: ${balance} < ${betAmount}`);
          return; // 트랜잭션 중단
        }
        
        const newBalance = balance - betAmount * 2;
        console.log(`[joinMatchingGame] Transaction will commit - newBalance: ${newBalance}`);
        return newBalance;
      });

      if (!debitResult.committed) {
        const snapshotValue = debitResult.snapshot?.val();
        console.error(`[joinMatchingGame] Transaction failed - committed: ${debitResult.committed}, snapshot: ${snapshotValue}`);
        throw new Error(`Failed to debit wallet. Transaction was not committed. Current balance: ${snapshotValue}`);
      }
      
      console.log(`[joinMatchingGame] Wallet debited successfully - new balance: ${debitResult.snapshot.val()}`);
    } else {
      console.log(`[joinMatchingGame] Random game detected - skipping wallet debit for ${uid}`);
    }

    // 베팅 정보 생성
    const betId = `bet_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const participant: MatchingParticipant = {
      uid,
      email: userData.auth?.email || 'unknown',
      betId,
      coin: 'ALL',
      number: 0,
      numbers: selectedNumbers,
      selectionType,
      betAmount,
      bettedAt: Date.now()
    };

    // 모든 활성 게임에 베팅 추가 (ORDER와 RANDOM 모두)
    const updatePromises = [];
    let totalBetAmount = 0;

    for (const game of targetGames) {
      // 각 게임의 참가자 목록에 추가
      updatePromises.push(
        rtdb.ref(`/games/matching/${game.gameId}/participants/${uid}`).transaction((currentBets) => {
          const bets = currentBets || [];
          bets.push(participant);
          return bets;
        })
      );

      // 총 상금 업데이트
      updatePromises.push(
        rtdb.ref(`/games/matching/${game.gameId}/totalPot`).transaction((currentPot) => {
          return (currentPot || 0) + betAmount;
        })
      );

      totalBetAmount += betAmount;
    }

    await Promise.all(updatePromises);

    // Random 게임이 아닌 경우에만 추가 차감 및 Ledger 기록
    if (!isRandomGame) {
      // 실제 차감된 금액으로 조정 (동일 타입 게임이 여러 개인 경우)
      if (targetGames.length > 1) {
        const additionalAmount = (targetGames.length - 1) * betAmount;
        await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
          if ((currentBalance || 0) < additionalAmount) {
            return; // 트랜잭션 중단
          }
          return currentBalance - additionalAmount;
        });
      }

      // Ledger에 베팅 기록
      for (const game of targetGames) {
        await recordMatchingLedger(uid, 'debit', betAmount, 'matching_bet', {
          gameId: game.gameId,
          gameType: game.gameType,
          numbers: selectedNumbers,
          selectionType,
          betId
        });

        // GPorder 대기열에 게임 매출 추가 (플랫폼 수수료 = betAmount)
        // Ordertype '03': 게임매출1 (게임 수익의 일부)
        await addToGporderQueue(
          uid,
          betAmount, // 플랫폼 수수료 (베팅금의 50%)
          '03',
          'matching',
          game.gameId
        );
      }
    } else {
      console.log(`[joinMatchingGame] Random game - skipping additional debit and ledger recording`);
    }

    console.log(`User ${uid} placed bet on ${targetGames.length} ${resolvedGameType} matching game(s) with numbers: [${selectedNumbers.join(', ')}] (${selectionType})`);

    return {
      success: true,
      betId,
      numbers: selectedNumbers,
      selectionType,
      betAmount,
      gamesCount: targetGames.length,
      totalBetAmount,
      games: targetGames.map(g => ({
        gameId: g.gameId,
        gameType: g.gameType,
        endAt: g.endAt
      }))
    };

  } catch (error) {
    console.error('Join matching game failed:', error);
    throw new Error(`Failed to join matching game: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 매칭 게임 상태 조회
export const getMatchingGameStatus = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;

  try {
    const currentGames = await getCurrentMatchingGames();
    const userBets = await getUserMatchingBets(uid);

    // Unity가 기대하는 개별 게임 객체 찾기
    const orderGame = currentGames.find(g => g.gameType === 'order');
    const randomGame = currentGames.find(g => g.gameType === 'random');

    const formatGame = (game: MatchingGame | undefined) => game ? {
      gameId: game.gameId,
      gameType: game.gameType,
      status: game.status,
      endAt: game.endAt,
      totalPot: game.totalPot,
      participantCount: Object.keys(game.participants || {}).length,
      timeRemaining: Math.max(0, game.endAt - Date.now())
    } : null;

    return {
      success: true,
      // Unity 호환 필드
      currentOrderGame: formatGame(orderGame),
      currentRandomGame: formatGame(randomGame),
      // 기존 필드 (하위 호환)
      activeGames: currentGames.map(game => formatGame(game)),
      userBets: userBets,
      nextOrderGame: getNextOrderGameTime(),
      nextRandomGame: getNextRandomGameTime()
    };

  } catch (error) {
    console.error('Get matching game status failed:', error);
    throw new Error('Failed to get game status');
  }
});

// 매칭 게임 기록 조회
export const getMatchingGameHistory = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const requestData = request.data || {};
  const { limit = 10 } = requestData;
  const requestedTypeRaw = requestData.gameType ?? requestData.matchingType ?? requestData.type;
  const normalizedRequestedType = normalizeMatchingGameType(requestedTypeRaw);

  try {
    console.log(`[getMatchingGameHistory] Fetching history for user ${uid}, gameType: ${normalizedRequestedType || 'all'}, limit: ${limit}`);
    
    // 모든 게임들 조회 (인덱스 문제 방지, 완료되지 않은 게임도 포함)
    const gamesSnapshot = await rtdb.ref('/games/matching')
      .orderByChild('createdAt')
      .limitToLast(limit * 3) // 여유있게 조회
      .once('value');

    const games = gamesSnapshot.val() || {};
    console.log(`[getMatchingGameHistory] Found ${Object.keys(games).length} total games`);
    
    const userHistory = [];
    const seenGameIds = new Set<string>(); // 중복 게임 방지

    for (const [gameId, game] of Object.entries(games) as [string, any][]) {
      // gameId에서 게임 타입 추출 (game.gameType이 없거나 잘못된 경우 대비)
      // 문서 요구사항: gameType은 항상 "order" 또는 "random" (소문자)이며, null/undefined 불가
      let actualGameType: 'order' | 'random' | null = null;
      
      // 1. game.gameType이 있으면 우선 사용 (소문자로 정규화)
      if (game.gameType) {
        const normalizedType = String(game.gameType).toLowerCase().trim();
        if (normalizedType === 'order' || normalizedType === 'random') {
          actualGameType = normalizedType as 'order' | 'random';
        }
      }
      
      // 2. gameId에서 추출 (gameType이 없거나 유효하지 않은 경우)
      if (!actualGameType) {
        const gameIdLower = gameId.toLowerCase();
        if (gameIdLower.includes('_order_') || gameIdLower.includes('matching_order')) {
          actualGameType = 'order';
        } else if (gameIdLower.includes('_random_') || gameIdLower.includes('matching_random')) {
          actualGameType = 'random';
        }
      }
      
      // 3. gameType을 결정할 수 없으면 스킵 (필수 필드 - 문서 요구사항)
      if (!actualGameType) {
        console.warn(`[getMatchingGameHistory] Cannot determine gameType for ${gameId}, skipping. game.gameType: ${game.gameType}`);
        continue;
      }
      
      // 4. gameType을 소문자로 보장 (문서 요구사항: 소문자 "order" 또는 "random")
      actualGameType = actualGameType.toLowerCase() as 'order' | 'random';
      
      // 게임 타입 필터링
      if (normalizedRequestedType && actualGameType !== normalizedRequestedType) {
        console.log(`[getMatchingGameHistory] Skipping game ${gameId} - gameType mismatch: ${actualGameType} !== ${normalizedRequestedType}`);
        continue;
      }
      
      // 중복 게임 체크
      if (seenGameIds.has(gameId)) {
        console.log(`[getMatchingGameHistory] Skipping duplicate game ${gameId}`);
        continue;
      }
      seenGameIds.add(gameId);
      
      const participants = game.participants || {};
      console.log(`[getMatchingGameHistory] Game ${gameId} (${actualGameType}) status: ${game.status}, has ${Object.keys(participants).length} participants`);
      
      // participants가 객체인 경우 uid로 확인
      const userParticipation = participants[uid];
      if (userParticipation) {
        console.log(`[getMatchingGameHistory] User ${uid} participated in game ${gameId} (${actualGameType})`);
        
        // 사용자 베팅 목록 가져오기 (bets 배열 또는 직접 배열)
        let userBets = [];
        if (userParticipation.bets && Array.isArray(userParticipation.bets)) {
          userBets = userParticipation.bets;
        } else if (Array.isArray(userParticipation)) {
          userBets = userParticipation;
        } else {
          userBets = [userParticipation];
        }
        
        console.log(`[getMatchingGameHistory] Found ${userBets.length} bets for user ${uid} in game ${gameId}`);
        
        // 각 베팅에 영어 순위 텍스트 추가
        const formattedBets = userBets.map((bet: any) => {
          const formattedBet = { ...bet };
          if (bet.result?.rank !== undefined && bet.result.rank > 0) {
            formattedBet.result = {
              ...bet.result,
              rankText: formatRank(bet.result.rank),
              displayText: bet.numbers 
                ? `${bet.numbers.join('/')} - ${formatRank(bet.result.rank)}`
                : formatRank(bet.result.rank)
            };
          }
          return formattedBet;
        });
        
        // gameType이 null이 될 수 없도록 보장 (문서 요구사항: null/undefined 불가)
        // actualGameType은 이미 위에서 검증되었으므로 여기서는 null이 아님을 보장
        if (!actualGameType || (actualGameType !== 'order' && actualGameType !== 'random')) {
          console.error(`[getMatchingGameHistory] Invalid gameType for ${gameId}: ${actualGameType}, skipping`);
          continue;
        }
        
        // 히스토리 항목 생성 (gameType 필수 포함)
        const normalizedResults = normalizeGameResults(game.results, participants);

        const historyItem = {
          gameId,
          gameType: actualGameType as 'order' | 'random', // 필수 필드: 항상 "order" 또는 "random" (소문자, null 불가)
          winningNumbers: game.winningNumbers || [],
          totalPot: game.totalPot || 0,
          userBets: formattedBets,
          results: normalizedResults, // 완료되지 않은 게임은 빈 배열
          calculatedAt: game.calculatedAt || game.createdAt || 0
        };
        
        userHistory.push(historyItem);
        
        console.log(`[getMatchingGameHistory] Added game ${gameId} (${actualGameType}) with ${formattedBets.length} bets`);
      }
    }

    console.log(`[getMatchingGameHistory] Returning ${userHistory.length} history items for user ${uid}`);
    
    // 최신순 정렬
    userHistory.sort((a, b) => (b.calculatedAt || 0) - (a.calculatedAt || 0));
    
    // gameType 필드 최종 검증 (문서 요구사항: null/undefined 불가)
    const validatedHistory = userHistory.map(item => {
      // gameType이 없거나 유효하지 않으면 경고하고 기본값 설정 (하지만 이미 위에서 필터링됨)
      if (!item.gameType || (item.gameType !== 'order' && item.gameType !== 'random')) {
        console.error(`[getMatchingGameHistory] Invalid gameType in history item: ${item.gameId}, gameType: ${item.gameType}`);
        // gameId에서 다시 추출 시도
        const gameIdLower = item.gameId.toLowerCase();
        if (gameIdLower.includes('_order_') || gameIdLower.includes('matching_order')) {
          item.gameType = 'order';
        } else if (gameIdLower.includes('_random_') || gameIdLower.includes('matching_random')) {
          item.gameType = 'random';
        } else {
          // 결정 불가능한 경우 제외 (이미 위에서 필터링되어야 함)
          return null;
        }
      }
      return item;
    }).filter((item): item is NonNullable<typeof item> => item !== null);

    return {
      success: true,
      history: validatedHistory.slice(0, limit)
    };

  } catch (error) {
    console.error('[getMatchingGameHistory] Get matching game history failed:', error);
    throw new Error('Failed to get game history');
  }
});

function normalizeMatchingGameType(value: any): 'order' | 'random' | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.toLowerCase().trim();
  if (normalized === 'order' || normalized === 'random') {
    return normalized;
  }

  if (normalized === 'matching_order') {
    return 'order';
  }

  if (normalized === 'matching_random') {
    return 'random';
  }

  return undefined;
}

// 내부 헬퍼 함수들

async function getCurrentMatchingGames(): Promise<MatchingGame[]> {
  const gamesSnapshot = await rtdb.ref('/games/matching')
    .orderByChild('status')
    .equalTo('active')
    .once('value');

  const games = gamesSnapshot.val() || {};
  return Object.entries(games).map(([gameId, game]: [string, any]) => ({
    ...game,
    gameId
  }));
}

async function getUserMatchingBets(uid: string): Promise<any[]> {
  const activeGames = await getCurrentMatchingGames();
  const userBets = [];

  for (const game of activeGames) {
    const userParticipation = game.participants?.[uid];
    if (userParticipation) {
      // 코인별 베팅을 평면화
      const flatBets = [];
      if (userParticipation && Array.isArray(userParticipation)) {
        flatBets.push(...userParticipation);
      }
      
      if (flatBets.length > 0) {
        userBets.push({
          gameId: game.gameId,
          gameType: game.gameType,
          bets: flatBets,
          endAt: game.endAt
        });
      }
    }
  }

  return userBets;
}

export async function calculateMatchingGameResults(gameId: string, overrideWinningNumbers?: number[]): Promise<void> {
  try {
    // 게임 상태를 계산 중으로 변경
    await rtdb.ref(`/games/matching/${gameId}/status`).set('calculating');

    const gameSnapshot = await rtdb.ref(`/games/matching/${gameId}`).once('value');
    const game: MatchingGame = gameSnapshot.val();

    if (!game) return;

    let winningNumbers: number[];
    let oracleSnapshot: OracleSnapshot;

    if (overrideWinningNumbers && overrideWinningNumbers.length === 7) {
      // 테스트용: winningNumbers를 직접 지정
      winningNumbers = overrideWinningNumbers;
      console.log(`[calculateMatchingGameResults] Using override winningNumbers: [${winningNumbers.join(', ')}]`);
      
      // Oracle snapshot은 기존 것을 사용하거나 기본값 생성
      oracleSnapshot = game.oracleSnapshot || {
        gameNumbers: {},
        prices: {},
        timestamp: Date.now(),
        capturedAt: Date.now()
      };
    } else {
      // 일반 동작: Oracle에서 가져오기
      // PRD: "정산시간 후 나온 7개의 숫자가 최종 당첨되는 번호"
      // 게임 종료 시점에 Binance API를 직접 호출하여 정확한 데이터 사용
      console.log(`[calculateMatchingGameResults] Preparing oracle data for game ${gameId} at ${new Date(game.endAt).toISOString()}`);

      oracleSnapshot = game.oracleSnapshot || await captureMatchingOracleSnapshot(gameId);

      if (!oracleSnapshot || !oracleSnapshot.gameNumbers) {
        throw new Error('Failed to capture Oracle data for matching game');
      }

      const coinOrder = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX'];
      winningNumbers = coinOrder.map(coin => oracleSnapshot.gameNumbers[coin] || 0);
      
      console.log(`[calculateMatchingGameResults] Game ${gameId} endAt: ${new Date(game.endAt).toISOString()}, oracle captured at: ${new Date(oracleSnapshot.timestamp).toISOString()}, winningNumbers: [${winningNumbers.join(', ')}]`);
    }

    // 모든 베팅 수집 및 결과 계산
    const allParticipants: MatchingParticipant[] = [];
    const participantResults: Record<string, any> = {};

    for (const [uid, userParticipation] of Object.entries(game.participants) as [string, MatchingParticipant[] | { bets?: MatchingParticipant[] }][]) {
      const betsArray = Array.isArray(userParticipation)
        ? userParticipation
        : Array.isArray((userParticipation as { bets?: MatchingParticipant[] }).bets)
          ? (userParticipation as { bets?: MatchingParticipant[] }).bets!
          : [];

      if (betsArray.length === 0) {
        continue;
      }

      for (const bet of betsArray) {
        const matches = calculateMatches(bet.numbers, winningNumbers, game.gameType);
        const rank = getRankByMatches(matches, game.gameType);
        
        bet.result = { matches, rank, reward: 0 };
        allParticipants.push(bet);

        if (!participantResults[uid]) {
          participantResults[uid] = [];
        }
        participantResults[uid].push(bet);
      }
    }

    // 등수별 승자 그룹화
    const rankGroups: Record<number, MatchingParticipant[]> = {};
    for (const participant of allParticipants) {
      const rank = participant.result!.rank;
      if (rank > 0) {
        if (!rankGroups[rank]) rankGroups[rank] = [];
        rankGroups[rank].push(participant);
      }
    }

    // 보상 계산 및 분배
    const gameResults: MatchingGameResult[] = [];
    
    if (game.gameType === 'order') {
      // ORDER 게임: 1등만 존재 (숫자와 순서 모두 맞춤)
      const rank1Winners = rankGroups[1] || [];
      if (rank1Winners.length > 0) {
        const rewardPerWinner = game.totalPot / rank1Winners.length;
        
        for (const winner of rank1Winners) {
          winner.result!.reward = rewardPerWinner;
          await creditWinner(winner.uid, rewardPerWinner, game.gameType, gameId, winner.betId);
        }

        gameResults.push({
          rank: 1,
          requiredMatches: 7,
          winners: rank1Winners.map(winner => createWinnerInfo(winner)),
          totalReward: game.totalPot,
          rewardPerWinner
        });
      }
    } else {
      // RANDOM 게임: 등수별 배당
      const payoutRates = [0, 0.50, 0.15, 0.15, 0.10, 0.10]; // 1등~5등
      
      for (let rank = 1; rank <= 5; rank++) {
        const winners = rankGroups[rank] || [];
        if (winners.length > 0) {
          const totalReward = game.totalPot * payoutRates[rank];
          const rewardPerWinner = totalReward / winners.length;

          for (const winner of winners) {
            winner.result!.reward = rewardPerWinner;
            await creditWinner(winner.uid, rewardPerWinner, game.gameType, gameId, winner.betId);
          }

          gameResults.push({
            rank,
            requiredMatches: 8 - rank, // 1등:7개, 2등:6개, ..., 5등:3개
            winners: winners.map(winner => createWinnerInfo(winner)),
            totalReward,
            rewardPerWinner
          });
        }
      }
    }

    // 결과 저장
    // participantResults를 객체 형태로 변환 (bets 배열을 포함하는 형태)
    const participantsWithBets: Record<string, { bets: MatchingParticipant[] }> = {};
    for (const [uid, bets] of Object.entries(participantResults)) {
      participantsWithBets[uid] = { bets: bets as MatchingParticipant[] };
    }
    
    await rtdb.ref(`/games/matching/${gameId}`).update({
      status: 'finished',
      winningNumbers,
      results: gameResults,
      participants: participantsWithBets,
      calculatedAt: Date.now(),
      settlementAt: null
    });

    // 🔄 게임 히스토리 업데이트
    await updateMatchingGameHistory(gameId, game, winningNumbers, participantsWithBets);

    // 게임 요약 저장 (빠른 조회용)
    const summary: MatchingGameSummary = {
      gameId,
      gameType: game.gameType,
      totalParticipants: Object.keys(game.participants).length,
      totalBets: allParticipants.length,
      totalPot: game.totalPot,
      winningNumbers,
      coinResults: gameResults,
      calculatedAt: Date.now()
    };

    await rtdb.ref(`/games/matching_summary/${gameId}`).set(summary);

    console.log(`Matching game ${gameId} (${game.gameType}) completed. Winners across ${gameResults.length} ranks.`);

  } catch (error) {
    console.error(`Failed to calculate matching game results for ${gameId}:`, error);
  }
}

// 코인별 개별 베팅 시스템에서는 단순히 숫자 일치 여부만 확인

async function creditWinner(
  uid: string, 
  amount: number, 
  gameType: string, 
  gameId: string, 
  betId: string
): Promise<void> {
  // 지갑에 보상 추가
  await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
    return (currentBalance || 0) + amount;
  });

  // Ledger에 보상 기록
  await recordMatchingLedger(uid, 'credit', amount, 'matching_win', {
    gameId,
    gameType,
    betId,
    timestamp: Date.now()
  });
}

async function recordMatchingLedger(
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

function getNextOrderGameTime(): number {
  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setUTCDate(nextMidnight.getUTCDate() + 1);
  nextMidnight.setUTCHours(0, 0, 0, 0);
  return nextMidnight.getTime();
}

function getNextRandomGameTime(): number {
  const now = new Date();
  const currentHour = now.getUTCHours();
  const nextScheduledHour = Math.ceil((currentHour + 1) / 6) * 6;
  
  const nextTime = new Date(now);
  if (nextScheduledHour >= 24) {
    nextTime.setUTCDate(nextTime.getUTCDate() + 1);
    nextTime.setUTCHours(0, 0, 0, 0);
  } else {
    nextTime.setUTCHours(nextScheduledHour, 0, 0, 0);
  }
  
  return nextTime.getTime();
}

// 매칭 게임 히스토리 업데이트 함수
async function updateMatchingGameHistory(gameId: string, game: any, winningNumbers: number[], participantResults: any) {
  try {
    console.log(`[updateMatchingGameHistory] Starting history update for game ${gameId}`);
    
    for (const [uid, participantData] of Object.entries(participantResults)) {
      // participantData는 배열 또는 객체일 수 있음
      const typedParticipantData = participantData as { bets?: MatchingParticipant[] } | MatchingParticipant[];
      const bets = Array.isArray(typedParticipantData) 
        ? typedParticipantData 
        : (typedParticipantData.bets || []);
      
      if (!bets || bets.length === 0) {
        console.log(`[updateMatchingGameHistory] No bets found for user ${uid}`);
        continue;
      }
      
      console.log(`[updateMatchingGameHistory] Processing ${bets.length} bets for user ${uid}`);
      
      // 게임 히스토리 조회
      const historyQuery = rtdb.ref(`gameHistory/${uid}`)
        .orderByChild('gameId')
        .equalTo(gameId);
      
      const historySnapshot = await historyQuery.once('value');
      
      if (!historySnapshot.exists()) {
        console.log(`[updateMatchingGameHistory] No history found for user ${uid}, gameId ${gameId}`);
        continue;
      }
      
      const histories = historySnapshot.val();
      console.log(`[updateMatchingGameHistory] Found ${Object.keys(histories).length} history entries for user ${uid}`);
      
      // 게임 타입을 기반으로 예상되는 히스토리 gameType 계산
      const expectedHistoryGameType = `matching_${game.gameType}` as 'matching_order' | 'matching_random';
      
      // gameId에서 게임 타입 추출 (이중 확인용)
      const gameIdType = gameId.includes('_order_') ? 'order' : gameId.includes('_random_') ? 'random' : null;
      
      for (const [historyId, historyData] of Object.entries(histories)) {
        const typedHistory = historyData as any;
        
        // 히스토리 타입이 매칭 게임인지 확인
        if (!(typedHistory.gameType === 'matching' || 
              typedHistory.gameType === 'matching_order' || 
              typedHistory.gameType === 'matching_random')) {
          continue;
        }
        
        // 게임 타입이 일치하는지 확인
        // 1. 히스토리의 gameType이 예상된 타입과 일치하거나
        // 2. 히스토리의 matchingType이 게임 타입과 일치하는지 확인
        // 3. gameId에서 추출한 타입도 확인
        const historyMatchingType = typedHistory.matchingType || 
          (typedHistory.gameType === 'matching_order' ? 'order' : 
           typedHistory.gameType === 'matching_random' ? 'random' : null);
        
        // 게임 타입 일치 여부 확인
        const isGameTypeMatch = historyMatchingType === game.gameType || 
                                typedHistory.gameType === expectedHistoryGameType ||
                                (typedHistory.gameType === 'matching' && historyMatchingType === game.gameType);
        
        // gameId에서 추출한 타입도 확인 (추가 검증)
        const isGameIdTypeMatch = !gameIdType || gameIdType === game.gameType;
        
        if (!isGameTypeMatch || !isGameIdTypeMatch) {
          console.log(`[updateMatchingGameHistory] Skipping history ${historyId} - gameType mismatch. History: ${typedHistory.gameType} (matchingType: ${historyMatchingType}), Game: ${game.gameType}, GameId type: ${gameIdType}`);
          continue;
        }
        
        if (typedHistory.isCompleted) {
          console.log(`[updateMatchingGameHistory] Skipping history ${historyId} - already completed`);
          continue;
        }
        
        // betId가 일치하는 베팅 찾기
        const matchingBet = bets.find((bet: any) => bet.betId === typedHistory.betId);
        
        if (matchingBet && matchingBet.result) {
          // 당첨 번호 포맷팅
          const formattedWinningNumbers = formatNumbersForHistory(winningNumbers, game.gameType);
          
          // 결과 데이터 준비
          const updates = {
            isCompleted: true,
            updatedAt: Date.now(),
            rewardAmount: matchingBet.result.reward || 0,
            total: matchingBet.result.reward || 0,
            winningNumbers: formattedWinningNumbers,
            matches: matchingBet.result.matches || 0,
            rank: matchingBet.result.rank || 0
          };
          
          // 히스토리 업데이트
          await rtdb.ref(`gameHistory/${uid}/${historyId}`).update(updates);
          
          console.log(`[updateMatchingGameHistory] Updated history ${historyId} for user ${uid}, gameType: ${typedHistory.gameType}, betId ${typedHistory.betId}, rank: ${updates.rank}, reward: ${updates.rewardAmount}`);
        } else {
          console.log(`[updateMatchingGameHistory] No matching bet found for history ${historyId}, betId: ${typedHistory.betId}`);
        }
      }
    }
    
    console.log(`[updateMatchingGameHistory] Completed history update for game ${gameId}`);
  } catch (error) {
    console.error('[updateMatchingGameHistory] Error updating game history:', error);
  }
}

// 숫자를 게임 타입에 맞게 포맷팅
function formatNumbersForHistory(numbers: number[], gameType: string): string[] {
  const coinOrder = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX'];
  
  if (gameType === 'order') {
    return numbers.map((num, index) => `${coinOrder[index] || `COIN${index}`}:${num}`);
  } else {
    return numbers.map(num => num.toString());
  }
}

function maskEmail(email?: string | null): string {
  const fallback = 'unknown@unknown.com';
  if (!email || typeof email !== 'string') {
    return fallback;
  }
  const [localPart, domain] = email.split('@');
  if (!domain) {
    return fallback;
  }
  const visible = localPart.slice(0, 2) || '*';
  const maskedLength = Math.max(localPart.length - visible.length, 3);
  const maskedLocal = `${visible}${'*'.repeat(maskedLength)}`;
  return `${maskedLocal}@${domain}`;
}

function createWinnerInfo(participant?: MatchingParticipant): MatchingWinnerInfo {
  if (!participant) {
    return {
      uid: 'unknown',
      email: maskEmail(undefined)
    };
  }

  return {
    uid: participant.uid,
    email: maskEmail(participant.email),
    betId: participant.betId
  };
}

function findParticipantBets(participants: Record<string, any> | undefined, uid: string): MatchingParticipant[] {
  if (!participants || !uid) {
    return [];
  }

  const participantEntry = participants[uid];
  if (!participantEntry) {
    return [];
  }

  if (Array.isArray(participantEntry)) {
    return participantEntry as MatchingParticipant[];
  }

  if (participantEntry && Array.isArray(participantEntry.bets)) {
    return participantEntry.bets as MatchingParticipant[];
  }

  return [];
}

function normalizeWinnerEntries(rawWinners: any, participants?: Record<string, any>): MatchingWinnerInfo[] {
  if (!Array.isArray(rawWinners)) {
    return [];
  }

  const normalized: Array<MatchingWinnerInfo | null> = rawWinners.map(winner => {
    if (!winner) {
      return null;
    }

    if (typeof winner === 'string') {
      const bets = findParticipantBets(participants, winner);
      const bet = bets[0];
      return {
        uid: winner,
        email: maskEmail(bet?.email),
        betId: bet?.betId
      };
    }

    if (typeof winner === 'object') {
      const uid = typeof winner.uid === 'string' ? winner.uid : '';
      if (!uid) {
        return null;
      }

      const bets = findParticipantBets(participants, uid);
      const bet = bets[0];

      return {
        uid,
        email: maskEmail(winner.email || bet?.email),
        betId: winner.betId || bet?.betId
      };
    }

    return null;
  });

  return normalized.filter((winner): winner is MatchingWinnerInfo => Boolean(winner));
}

function normalizeGameResults(results: any, participants?: Record<string, any>): MatchingGameResult[] {
  if (!Array.isArray(results)) {
    return [];
  }

  return results.map(result => ({
    rank: result.rank ?? 0,
    requiredMatches: result.requiredMatches ?? 0,
    winners: normalizeWinnerEntries(result.winners, participants),
    totalReward: result.totalReward ?? 0,
    rewardPerWinner: result.rewardPerWinner ?? 0
  }));
}

async function captureMatchingOracleSnapshot(gameId: string): Promise<OracleSnapshot> {
  const snapshotRef = rtdb.ref(`/games/matching/${gameId}/oracleSnapshot`);
  const existing = await snapshotRef.once('value');

  if (existing.exists()) {
    return existing.val() as OracleSnapshot;
  }

  console.log(`[captureMatchingOracleSnapshot] Fetching Binance oracle data for matching game ${gameId}`);
  const oracleData = await fetchBinanceOracleData();

  if (!oracleData || !oracleData.gameNumbers) {
    throw new Error('Failed to fetch oracle data for matching game');
  }

  const snapshot: OracleSnapshot = {
    gameNumbers: oracleData.gameNumbers,
    prices: oracleData.prices,
    timestamp: oracleData.timestamp,
    capturedAt: Date.now()
  };

  await snapshotRef.set(snapshot);
  return snapshot;
}

// 스케줄러들

// ORDER 게임 생성 함수
export async function createOrderGame() {
  try {
    await createMatchingGame('order');
    console.log('ORDER matching game created successfully');
  } catch (error) {
    console.error('Failed to create ORDER matching game:', error);
  }
}

// RANDOM 게임 생성 함수
export async function createRandomGame() {
  try {
    await createMatchingGame('random');
    console.log('RANDOM matching game created successfully');
  } catch (error) {
    console.error('Failed to create RANDOM matching game:', error);
  }
}

async function createMatchingGame(gameType: 'order' | 'random'): Promise<void> {
  const gameId = `matching_${gameType}_${Date.now()}`;
  const now = Date.now();
  const endTime = gameType === 'order' 
    ? getNextOrderGameTime()
    : getNextRandomGameTime();

  const newGame: MatchingGame = {
    gameId,
    gameType,
    status: 'active',
    startedAt: now,
    endAt: endTime,
    totalPot: 0,
    betAmount: 2,
    participants: {},
    winningNumbers: [],
    results: [],
    createdAt: now
  };

  await rtdb.ref(`/games/matching/${gameId}`).set(newGame);

  console.log(`Created ${gameType} matching game: ${gameId}, ends at: ${new Date(endTime).toISOString()}`);
}

function calculateMatches(userNumbers: number[], winningNumbers: number[], gameType: 'order' | 'random'): number {
  if (gameType === 'order') {
    // ORDER: 숫자와 순서 모두 일치해야 함
    let matches = 0;
    for (let i = 0; i < Math.min(userNumbers.length, winningNumbers.length); i++) {
      if (userNumbers[i] === winningNumbers[i]) {
        matches++;
      } else {
        break; // 순서가 틀리면 중단
      }
    }
    return matches;
  } else {
    // RANDOM: 위치별 일치 개수
    let matches = 0;
    for (let i = 0; i < Math.min(userNumbers.length, winningNumbers.length); i++) {
      if (userNumbers[i] === winningNumbers[i]) {
        matches++;
      }
    }
    return matches;
  }
}

function getRankByMatches(matches: number, gameType: 'order' | 'random'): number {
  if (gameType === 'order') {
    return matches === 7 ? 1 : 0; // 7개 모두 맞춰야 1등
  } else {
    // RANDOM 게임 등수
    if (matches === 7) return 1;
    if (matches === 6) return 2;
    if (matches === 5) return 3;
    if (matches === 4) return 4;
    if (matches === 3) return 5;
    return 0; // 등수 없음
  }
}

// 테스트 함수: Matching 게임을 종료된 것처럼 처리하여 결과 계산
export const testMatchingGameSettlement = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { gameId } = request.data;

  if (!gameId) {
    throw new Error('gameId is required');
  }

  try {
    console.log(`[testMatchingGameSettlement] Testing settlement for game ${gameId}`);
    
    // 게임 조회
    const gameSnapshot = await rtdb.ref(`/games/matching/${gameId}`).once('value');
    const game: MatchingGame = gameSnapshot.val();

    if (!game) {
      throw new Error('Game not found');
    }

    // 게임을 closed 상태로 변경하고 settlementAt을 현재 시간으로 설정
    const now = Date.now();
    const settlementAt = now + MATCHING_SETTLEMENT_DELAY_MS;
    await rtdb.ref(`/games/matching/${gameId}`).update({
      status: 'closed',
      endAt: now, // 종료 시간을 현재로 설정
      settlementAt // 실제 운영과 동일하게 5분 지연 후 정산
    });

    await captureMatchingOracleSnapshot(gameId);

    console.log(`[testMatchingGameSettlement] Game ${gameId} marked as closed. Results will calculate at ${new Date(settlementAt).toISOString()}`);

    return {
      success: true,
      message: `Game ${gameId} scheduled for settlement at ${new Date(settlementAt).toISOString()}`,
      gameId,
      settlementAt
    };

  } catch (error) {
    console.error('[testMatchingGameSettlement] Error:', error);
    throw new Error(`Failed to test matching game settlement: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 테스트 함수: Matching 게임에서 최종 결과(winningNumbers)를 지정하고 정산
export const testMatchingGameWithWinningNumbers = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { gameId, winningNumbers } = request.data as { 
    gameId: string; 
    winningNumbers: number[]; // [BTC, ETH, XRP, BNB, SOL, DOGE, TRX] 순서로 7개 숫자
  };

  if (!gameId) {
    throw new Error('gameId is required');
  }

  if (!winningNumbers || !Array.isArray(winningNumbers) || winningNumbers.length !== 7) {
    throw new Error('winningNumbers must be an array of 7 numbers [BTC, ETH, XRP, BNB, SOL, DOGE, TRX]');
  }

  // 각 숫자가 0-9 범위인지 검증
  for (let i = 0; i < winningNumbers.length; i++) {
    const num = winningNumbers[i];
    if (typeof num !== 'number' || num < 0 || num > 9 || !Number.isInteger(num)) {
      throw new Error(`winningNumbers[${i}] must be an integer between 0 and 9`);
    }
  }

  try {
    console.log(`[testMatchingGameWithWinningNumbers] Testing matching game with fixed winning numbers...`);
    console.log(`[testMatchingGameWithWinningNumbers] GameId: ${gameId}, WinningNumbers: [${winningNumbers.join(', ')}]`);
    
    // 게임 조회
    const gameSnapshot = await rtdb.ref(`/games/matching/${gameId}`).once('value');
    const game: MatchingGame = gameSnapshot.val();

    if (!game) {
      throw new Error('Game not found');
    }

    const now = Date.now();

    // 게임을 closed 상태로 변경
    await rtdb.ref(`/games/matching/${gameId}`).update({
      status: 'closed',
      endAt: now,
      settlementAt: now
    });

    // 고정된 winningNumbers로 결과 계산
    await calculateMatchingGameResults(gameId, winningNumbers);

    console.log(`[testMatchingGameWithWinningNumbers] Game ${gameId} completed with fixed winning numbers`);

    return {
      success: true,
      message: 'Game completed with fixed winning numbers',
      gameId,
      gameType: game.gameType,
      winningNumbers,
      coinOrder: ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX']
    };

  } catch (error) {
    console.error('[testMatchingGameWithWinningNumbers] Test failed:', error);
    throw new Error(`Failed to test matching game with winning numbers: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 게임 종료 시점을 체크하고 결과를 계산하는 함수 (Cloud Scheduler에서 호출)
export async function processMatchingGameSettlements(): Promise<void> {
  try {
    const now = Date.now();
    
    // 활성 게임 조회
    const gamesSnapshot = await rtdb.ref('/games/matching').once('value');
    const games = gamesSnapshot.val();
    
    if (!games) return;
    
    for (const [gameId, game] of Object.entries(games) as [string, MatchingGame][]) {
      // 게임이 종료되었지만 아직 closed 상태가 아닌 경우
      if (game.status === 'active' && game.endAt <= now) {
        console.log(`Matching game ${gameId} has ended. Closing for betting...`);
        
        const settlementAt = (game.endAt || now) + MATCHING_SETTLEMENT_DELAY_MS;
        await rtdb.ref(`/games/matching/${gameId}`).update({
          status: 'closed',
          settlementAt
        });
        
        await captureMatchingOracleSnapshot(gameId);

        console.log(`Matching game ${gameId} will calculate results at ${new Date(settlementAt).toISOString()}`);
        continue;
      }
      
      if (game.status === 'closed') {
        const settlementAt = (game as any).settlementAt || ((game.endAt || now) + MATCHING_SETTLEMENT_DELAY_MS);
        if (!game.settlementAt) {
          await rtdb.ref(`/games/matching/${gameId}/settlementAt`).set(settlementAt);
        }

        if (settlementAt <= now) {
          console.log(`Calculating results for matching game ${gameId}...`);
          await calculateMatchingGameResults(gameId);
        }
      }
    }
  } catch (error) {
    console.error('Failed to process matching game settlements:', error);
  }
}

// 완료된 매칭 게임 결과 조회 (승리번호, 승리자 정보)
export const getCompletedMatchingGames = onCall(async (request: CallableRequest) => {
  try {
    const { limit = 10, gameType } = request.data; // gameType: 'order', 'random', 또는 null (모두 조회)
    
    console.log(`[getCompletedMatchingGames] Fetching completed games, gameType: ${gameType || 'all'}, limit: ${limit}`);
    
    // 완료된 게임들 조회 (finished 상태)
    const gamesSnapshot = await rtdb.ref('/games/matching')
      .orderByChild('calculatedAt')
      .limitToLast(limit * 2) // 여유있게 조회
      .once('value');
    
    const games = gamesSnapshot.val() || {};
    console.log(`[getCompletedMatchingGames] Found ${Object.keys(games).length} total games`);
    
    const completedGames = [];
    
    for (const [gameId, game] of Object.entries(games) as [string, any][]) {
      // 게임 타입 필터링
      if (gameType && game.gameType !== gameType) {
        console.log(`[getCompletedMatchingGames] Skipping game ${gameId} - gameType mismatch: ${game.gameType} !== ${gameType}`);
        continue;
      }
      
      // finished 상태인 게임 조회 (결과가 없어도 포함)
      if (game.status === 'finished' && game.calculatedAt) {
        console.log(`[getCompletedMatchingGames] Processing finished game ${gameId} (${game.gameType})`);
        
        const participants = game.participants || {};
        // 결과가 있으면 정규화, 없으면 빈 배열 반환
        const normalizedResults = game.results 
          ? normalizeGameResults(game.results, participants)
          : [];

        // 1등 승리자 찾기 (결과가 있을 때만)
        let winner: MatchingWinnerInfo | null = null;
        if (normalizedResults.length > 0) {
          const firstPlaceResult = normalizedResults.find(result => result.rank === 1);
          
          if (firstPlaceResult && firstPlaceResult.winners && firstPlaceResult.winners.length > 0) {
            winner = firstPlaceResult.winners[0];
          }
        }
        
        completedGames.push({
          gameId: gameId,
          gameType: game.gameType,
          startedAt: game.startedAt || game.createdAt || 0, // 게임 시작 시간
          calculatedAt: game.calculatedAt,
          winningNumbers: game.winningNumbers || [], // [0,1,2,3,4,5,6] 형태, 없으면 빈 배열
          totalPot: game.totalPot || 0,
          participantCount: Object.keys(game.participants || {}).length,
          winner: winner,
          results: normalizedResults // 결과가 없으면 빈 배열
        });
      }
    }
    
    // 최신순으로 정렬 (calculatedAt 기준)
    completedGames.sort((a, b) => b.calculatedAt - a.calculatedAt);
    
    // limit 적용
    const limitedGames = completedGames.slice(0, limit);
    
    console.log(`[getCompletedMatchingGames] Returning ${limitedGames.length} completed games`);
    
    return {
      success: true,
      games: limitedGames
    };
    
  } catch (error) {
    console.error('[getCompletedMatchingGames] Get completed matching games failed:', error);
    throw new Error('Failed to get completed games');
  }
});
