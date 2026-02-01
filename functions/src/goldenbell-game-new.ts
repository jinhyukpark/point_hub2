import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { CallableRequest } from 'firebase-functions/v2/https';
import { rtdb } from './firebase-config';
import { formatGoldenBellHistory } from './history-formatter';

const GOLDEN_BELL_SLOT_MINUTES = [5, 15, 25, 35, 45, 55];
const GOLDEN_BELL_JOIN_WINDOW_MS = 15_000; // 시작 전후 15초
const GOLDEN_BELL_BETTING_DURATION_MS = 15_000;
const GOLDEN_BELL_DECISION_DURATION_MS = 15_000;
const GOLDEN_BELL_WAITING_TIMEOUT_MS = 60_000; // 1분 이상 경과 시 대기실 강제
const GOLDEN_BELL_ACTIVE_GAME_WINDOW_MS = 10 * 60 * 1000; // 시작 후 10분 동안은 동일 게임 유지
const GOLDEN_BELL_BET_COST = 1; // 라운드당 차감 금액

type GoldenBellPhase = 'waiting' | 'betting' | 'decision' | 'calculating' | 'finished';

interface GoldenBellTimingInfo {
  startAt: number;
  joinWindowStart: number;
  joinWindowEnd: number;
  bettingStartAt: number;
  bettingEndAt: number;
  decisionStartAt: number;
  decisionEndAt: number;
}

function normalizeStartAt(value: any, gameId?: string): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  if (typeof gameId === 'string' && gameId.startsWith('goldenbell_')) {
    const suffix = Number(gameId.replace('goldenbell_', ''));
    if (Number.isFinite(suffix)) {
      return suffix;
    }
  }

  return null;
}

function getGameStartAt(game: any): number {
  const normalized = normalizeStartAt(game?.startAt, game?.gameId);
  if (typeof normalized === 'number') {
    return normalized;
  }

  const createdAt = normalizeStartAt(game?.createdAt);
  return typeof createdAt === 'number' ? createdAt : 0;
}

function getGoldenBellTiming(game: any, now: number = Date.now()): GoldenBellTimingInfo {
  const startAt = getGameStartAt(game) || now;
  const bettingStartAt =
    typeof game?.bettingStartAt === 'number' && Number.isFinite(game.bettingStartAt)
      ? game.bettingStartAt
      : startAt;

  const joinWindowStart = startAt - GOLDEN_BELL_JOIN_WINDOW_MS;
  const computedJoinWindowEnd = startAt + GOLDEN_BELL_JOIN_WINDOW_MS;

  const bettingEndAtRaw =
    typeof game?.bettingEndAt === 'number' && Number.isFinite(game.bettingEndAt)
      ? game.bettingEndAt
      : bettingStartAt + GOLDEN_BELL_BETTING_DURATION_MS;
  const bettingEndAt = Math.max(bettingEndAtRaw, computedJoinWindowEnd);

  const decisionStartAt =
    typeof game?.decisionStartAt === 'number' && Number.isFinite(game.decisionStartAt)
      ? game.decisionStartAt
      : bettingEndAt;

  const decisionEndAt =
    typeof game?.decisionEndAt === 'number' && Number.isFinite(game.decisionEndAt)
      ? Math.max(game.decisionEndAt, decisionStartAt)
      : decisionStartAt + GOLDEN_BELL_DECISION_DURATION_MS;

  return {
    startAt,
    joinWindowStart,
    joinWindowEnd: computedJoinWindowEnd,
    bettingStartAt,
    bettingEndAt,
    decisionStartAt,
    decisionEndAt
  };
}

function determineGoldenBellPhase(game: any, now: number = Date.now()): GoldenBellPhase {
  if (!game) {
    return 'waiting';
  }

  if (game.status === 'finished' || game.resultCalculatedAt) {
    return 'finished';
  }

  const timings = getGoldenBellTiming(game, now);

  if (now < timings.joinWindowStart) {
    return 'waiting';
  }

  if (now <= timings.bettingEndAt) {
    return 'betting';
  }

  if (now <= timings.decisionEndAt) {
    return 'decision';
  }

  return 'calculating';
}

function isGameJoinableByTime(game: any, now: number): boolean {
  if (!game) {
    return false;
  }

  const phase = determineGoldenBellPhase(game, now);
  if (phase === 'finished' || phase === 'decision' || phase === 'calculating') {
    return false;
  }

  const timings = getGoldenBellTiming(game, now);
  return now >= timings.joinWindowStart && now <= timings.joinWindowEnd;
}

function parseAmount(value: any): number {
  if (typeof value === 'number') {
    return isFinite(value) ? value : 0;
  }
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function extractWalletBalance(userData: any): number {
  if (!userData) {
    return 0;
  }
  const wallet = userData.wallet || {};
  const candidates = [
    wallet.usdt,
    wallet.USDT,
    wallet.usdtBalance,
    wallet.USDTBalance,
    wallet.usdt_available,
    wallet.USDT_available,
    wallet?.usdt?.available,
    wallet?.USDT?.available,
    wallet?.balances?.usdt,
    wallet?.balances?.USDT,
    wallet?.balance?.usdt,
    userData.usdtBalance
  ];

  return candidates.reduce((max, candidate) => {
    const value = parseAmount(candidate);
    return value > max ? value : max;
  }, 0);
}

function toSafeArray<T = any>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

type GoldenBellGameMap = Record<string, any>;

function getLastParticipationTimestamp(
  participant?: GoldenBellParticipant,
  game?: GoldenBellGame | null
): number {
  const timestamps = [
    typeof participant?.choiceSubmittedAt === 'number' ? participant!.choiceSubmittedAt : 0,
    typeof participant?.exitedAt === 'number' ? participant!.exitedAt : 0,
    typeof game?.bettingEndAt === 'number' ? game!.bettingEndAt : 0,
    typeof game?.startAt === 'number' ? game!.startAt : 0
  ];

  return Math.max(...timestamps);
}

function normalizeRoundResults(value: any): Record<string, GoldenBellResult> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  if (!Array.isArray(value)) {
    return value as Record<string, GoldenBellResult>;
  }

  const normalized: Record<string, GoldenBellResult> = {};
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!entry) {
      continue;
    }

    const key = typeof entry.round === 'number'
      ? String(entry.round)
      : String(i);
    normalized[key] = entry;
  }

  return normalized;
}

async function loadGoldenBellGames(): Promise<GoldenBellGameMap> {
  try {
    const snapshot = await rtdb.ref('/games/goldenbell').once('value');
    const games = snapshot.val();
    if (!games || typeof games !== 'object') {
      return {};
    }
    return games;
  } catch (error) {
    console.error('[loadGoldenBellGames] Failed to load games:', error);
    throw error;
  }
}

function attachGameId(gameId: string, game: any): GoldenBellGame {
  return { ...game, gameId } as GoldenBellGame;
}

async function getGoldenBellGameForUser(
  uid: string,
  includeFinished: boolean = false,
  gamesData?: GoldenBellGameMap
): Promise<GoldenBellGame | null> {
  try {
    let games = gamesData;
    if (!games) {
      games = await loadGoldenBellGames();
    }

    if (!games || Object.keys(games).length === 0) {
      return null;
    }

    let bestActive: { gameId: string; game: any; startAt: number } | null = null;
    let mostRecentPastGame: { gameId: string; game: any; startAt: number } | null = null;
    const now = Date.now();

    for (const [gameId, game] of Object.entries(games)) {
      if (!game || typeof game !== 'object') {
        continue;
      }

      const participants = game.participants;
      if (!participants || typeof participants !== 'object') {
        continue;
      }

      if (!participants[uid]) {
        continue;
      }

      const startAt = getGameStartAt({ ...game, gameId });
      if (!startAt) {
        continue;
      }

      // includeFinished가 true일 때는 state를 무시하고 시간 기준으로만 과거 게임 반환
      if (includeFinished && startAt <= now) {
        if (!mostRecentPastGame || startAt > mostRecentPastGame.startAt) {
          mostRecentPastGame = { gameId, game, startAt };
        }
        continue;
      }

      const phase = determineGoldenBellPhase(game, now);

      if (phase === 'finished') {
        continue;
      }

      if (
        !bestActive ||
        Math.abs(startAt - now) < Math.abs(bestActive.startAt - now)
      ) {
        bestActive = { gameId, game, startAt };
      }
    }

    // includeFinished가 true이고 과거 게임이 있다면 그것을 우선 반환
    if (includeFinished && mostRecentPastGame) {
      return attachGameId(mostRecentPastGame.gameId, mostRecentPastGame.game);
    }

    const selected = bestActive;
    if (!selected) {
      return null;
    }

    return attachGameId(selected.gameId, selected.game);
  } catch (error) {
    console.error('[getGoldenBellGameForUser] Failed:', error);
    return null;
  }
}

// Types
interface GoldenBellGame {
  gameId: string;
  status: 'waiting' | 'team_selection' | 'betting' | 'calculating' | 'finished';
  round: number;
  maxRounds: number;
  maxParticipants: number;
  participants: Record<string, GoldenBellParticipant>;
  waitingRoom?: Record<string, any>;
  teams?: {
    PLAYER: Record<string, GoldenBellParticipant>;
    BANKER: Record<string, GoldenBellParticipant>;
  };
  totalPot: number;
  currentBetAmount: number;
  startAt: number; // 게임 시작 시간 (UTC 00:05 기준 10분마다)
  bettingStartAt: number;
  bettingEndAt: number;
  decisionStartAt?: number; // Decision 타이머 시작 시간
  decisionEndAt?: number; // Decision 타이머 종료 시간
  nextRoundStartAt?: number; // 다음 라운드 시작 예정 시간 (서버 관리)
  resultCalculatedAt?: number;
  results?: Record<string, GoldenBellResult>; // 라운드별 결과 (round 번호를 키로 사용)
  createdAt: number;
  schedule: string; // "5,15,25,35,45,55 * * * *"
}

interface GoldenBellParticipant {
  uid: string;
  email: string;
  joinedRound: number;
  currentRound: number;
  isActive: boolean;
  totalBet: number;
  accumulatedReward?: number; // ✅ 누적 상금 (라운드 승리 시 증가)
  choice?: 'even' | 'odd';
  choiceSubmittedAt?: number;
  isWinner?: boolean;
  decision?: 'continue' | 'exit';
  decisionSubmittedAt?: number;
  exitedAt?: number;
  exitReason?: 'eliminated' | 'chose_exit' | 'timeout';
  roundSelections?: Record<number, string>; // 라운드별 선택 (PLAYER, BANKER, TIE)
  finalRound?: number;
  eliminatedRound?: number;
  isVip?: boolean;
  roundRewardLogs?: Record<number, GoldenBellRoundRewardPayload> | GoldenBellRoundRewardPayload[];
}

interface GoldenBellResult {
  round: number;
  oracleSum: number;
  result: 'even' | 'odd';
  choices: Record<'even' | 'odd', string[]>; // 각 선택의 참가자 UID 목록
  winners: string[];
  eliminatedParticipants: string[];
  gameStatus: 'continue' | 'finished' | 'no_winners';
}

interface GoldenBellRoundRewardPayload {
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

function determineVipStatus(userData: any): boolean {
  const membership = userData?.profile?.membership;
  const isVip = membership?.toLowerCase() === 'vip';
  console.log(`[determineVipStatus] User VIP check - membership: ${membership}, isVip: ${isVip}`);
  return isVip;
}

function normalizeNumber(value: any): number {
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

function normalizeRoundRewardPayload(
  reward: any,
  fallbackRound?: number
): GoldenBellRoundRewardPayload {
  if (!reward || typeof reward !== 'object') {
    throw new HttpsError('invalid-argument', 'reward payload is required');
  }

  const roundValue = normalizeNumber(reward.round ?? fallbackRound);
  if (!Number.isFinite(roundValue) || roundValue <= 0) {
    throw new HttpsError('invalid-argument', 'reward.round must be a positive number');
  }

  const fields: (keyof GoldenBellRoundRewardPayload)[] = [
    'winnerCount',
    'vipWinnerCount',
    'opponentPot',
    'baseRewardPerWinner',
    'vipBonusPerWinner',
    'vipBonusTotal',
    'totalRewardPerWinner',
    'totalRoundPot'
  ];

  const payload: any = { round: Math.floor(roundValue) };

  for (const field of fields) {
    const numericValue = normalizeNumber((reward as any)[field]);
    if (!Number.isFinite(numericValue)) {
      throw new HttpsError('invalid-argument', `reward.${field} must be a valid number`);
    }
    payload[field] = numericValue;
  }

  return payload as GoldenBellRoundRewardPayload;
}

function toRewardLogArray(value: any): GoldenBellRoundRewardPayload[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry && typeof entry === 'object' && Number.isFinite(normalizeNumber((entry as any).round)))
      .map((entry) => ({
        round: Math.floor(normalizeNumber((entry as any).round)),
        winnerCount: normalizeNumber((entry as any).winnerCount) || 0,
        vipWinnerCount: normalizeNumber((entry as any).vipWinnerCount) || 0,
        opponentPot: normalizeNumber((entry as any).opponentPot) || 0,
        baseRewardPerWinner: normalizeNumber((entry as any).baseRewardPerWinner) || 0,
        vipBonusPerWinner: normalizeNumber((entry as any).vipBonusPerWinner) || 0,
        vipBonusTotal: normalizeNumber((entry as any).vipBonusTotal) || 0,
        totalRewardPerWinner: normalizeNumber((entry as any).totalRewardPerWinner) || 0,
        totalRoundPot: normalizeNumber((entry as any).totalRoundPot) || 0
      }));
  }

  if (typeof value === 'object') {
    return Object.values(value)
      .filter((entry) => entry && typeof entry === 'object' && Number.isFinite(normalizeNumber((entry as any).round)))
      .map((entry) => ({
        round: Math.floor(normalizeNumber((entry as any).round)),
        winnerCount: normalizeNumber((entry as any).winnerCount) || 0,
        vipWinnerCount: normalizeNumber((entry as any).vipWinnerCount) || 0,
        opponentPot: normalizeNumber((entry as any).opponentPot) || 0,
        baseRewardPerWinner: normalizeNumber((entry as any).baseRewardPerWinner) || 0,
        vipBonusPerWinner: normalizeNumber((entry as any).vipBonusPerWinner) || 0,
        vipBonusTotal: normalizeNumber((entry as any).vipBonusTotal) || 0,
        totalRewardPerWinner: normalizeNumber((entry as any).totalRewardPerWinner) || 0,
        totalRoundPot: normalizeNumber((entry as any).totalRoundPot) || 0
      }));
  }

  return [];
}

function mergeRewardLogs(
  existing: any,
  newLog: GoldenBellRoundRewardPayload
): GoldenBellRoundRewardPayload[] {
  const logs = toRewardLogArray(existing).filter((log) => log.round !== newLog.round);
  logs.push(newLog);
  return logs.sort((a, b) => a.round - b.round);
}

// 골든벨 게임 참여
export const joinGoldenBell = onCall(async (request: CallableRequest) => {
  const startTime = Date.now();
  let uid: string | undefined;
  
  try {
    // 인증 확인
    if (!request.auth) {
      console.error('[joinGoldenBell] Authentication required but not provided');
      throw new Error('Authentication required');
    }

    uid = request.auth.uid;
    if (!uid) {
      console.error('[joinGoldenBell] UID not found in auth');
      throw new Error('User ID not found');
    }

    console.log(`[joinGoldenBell] Starting - User: ${uid}, Time: ${new Date().toISOString()}`);
    console.log(`[joinGoldenBell] User ${uid} attempting to join game`);
    
    // 현재 활성 골든벨 게임 조회 (finished 상태도 포함)
    let currentGame: GoldenBellGame | null;
    try {
      currentGame = await getCurrentGoldenBellGame(true);
      console.log(`[joinGoldenBell] Current game found: ${currentGame ? currentGame.gameId : 'null'}, status: ${currentGame?.status}`);
    } catch (gameError) {
      console.error('[joinGoldenBell] Error getting current game:', gameError);
      throw new Error(`Failed to get current game: ${gameError instanceof Error ? gameError.message : 'Unknown error'}`);
    }
    
    if (!currentGame) {
      throw new Error('No active Golden Bell game available');
    }

    // 게임 데이터 유효성 검사
    console.log(`[joinGoldenBell] Validating game data structure`);
    console.log(`[joinGoldenBell] Game data keys:`, Object.keys(currentGame));
    
    if (!currentGame.gameId) {
      console.error('[joinGoldenBell] Game data missing gameId:', JSON.stringify(currentGame, null, 2));
      throw new Error('Invalid game data: missing gameId');
    }

    if (currentGame.status === undefined || currentGame.status === null) {
      console.error('[joinGoldenBell] Game data missing status:', JSON.stringify(currentGame, null, 2));
      throw new Error('Invalid game data: missing status');
    }

    // participants가 객체인지 확인
    if (currentGame.participants !== undefined && currentGame.participants !== null) {
      if (typeof currentGame.participants !== 'object' || Array.isArray(currentGame.participants)) {
        console.error('[joinGoldenBell] Invalid participants structure:', typeof currentGame.participants, currentGame.participants);
        // participants를 빈 객체로 초기화
        currentGame.participants = {};
        console.log('[joinGoldenBell] Reset participants to empty object');
      }
    } else {
      // participants가 없으면 빈 객체로 초기화
      currentGame.participants = {};
      console.log('[joinGoldenBell] Initialized participants as empty object');
    }

    // 게임 진행 중(calculating)이면 대기방으로 안내
    if (currentGame.status === 'calculating') {
      // 중도 참여자를 대기방에 추가
      const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
      const userData = userSnapshot.val();
      
      if (!userData) {
        throw new Error('User not found');
      }

      // 대기방에 추가
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/waitingRoom/${uid}`).set({
        uid,
        email: userData.auth?.email || 'unknown',
        joinedAt: Date.now(),
        reason: 'mid_game_join',
        nextGameEligible: true,
        currentGameId: currentGame.gameId,
        currentRound: currentGame.round
      });

      // 다음 게임 시작 시간 계산
      const nextGameTime = getNextGoldenBellTime();

      return {
        success: true,
        status: 'waiting_room',
        message: 'Game is in progress. You have been added to waiting room.',
        gameId: currentGame.gameId,
        currentRound: currentGame.round,
        nextGameAt: nextGameTime,
        waitingRoom: true
      };
    }

    // finished 상태이면 다음 게임 대기
    if (currentGame.status === 'finished') {
      const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
      const userData = userSnapshot.val();
      
      if (!userData) {
        throw new Error('User not found');
      }

      // 대기방에 추가
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/waitingRoom/${uid}`).set({
        uid,
        email: userData.auth?.email || 'unknown',
        joinedAt: Date.now(),
        reason: 'game_finished',
        nextGameEligible: true,
        currentGameId: currentGame.gameId
      });

      const nextGameTime = getNextGoldenBellTime();

      return {
        success: true,
        status: 'waiting_room',
        message: 'Current game has finished. You have been added to waiting room for next game.',
        nextGameAt: nextGameTime,
        waitingRoom: true
      };
    }

    const now = Date.now();
    const timings = getGoldenBellTiming(currentGame, now);
    const withinJoinWindow =
      now >= timings.joinWindowStart &&
      now <= timings.joinWindowEnd;

    if (!withinJoinWindow) {
      throw new HttpsError(
        'failed-precondition',
        'Game is not accepting new participants at this time.'
      );
    }

    // 이미 참여 중인지 확인
    console.log(`[joinGoldenBell] Checking if user ${uid} is already participating`);
    console.log(`[joinGoldenBell] Participants type:`, typeof currentGame.participants);
    console.log(`[joinGoldenBell] Participants keys:`, currentGame.participants ? Object.keys(currentGame.participants) : 'null/undefined');
    
    if (currentGame.participants && typeof currentGame.participants === 'object' && !Array.isArray(currentGame.participants)) {
      if (currentGame.participants[uid]) {
        console.log(`[joinGoldenBell] User ${uid} is already participating`);
        throw new Error('Already participating in current game');
      }
    }

    // 최대 참가자 수 확인
    const participantCount = (currentGame.participants && typeof currentGame.participants === 'object' && !Array.isArray(currentGame.participants))
      ? Object.keys(currentGame.participants).length
      : 0;
    const maxParticipants = currentGame.maxParticipants || 2047;
    console.log(`[joinGoldenBell] Current participant count: ${participantCount}, max: ${maxParticipants}`);
    
    if (participantCount >= maxParticipants) {
      throw new Error(`Game is full (${maxParticipants} participants maximum)`);
    }

    // 사용자 정보 및 잔액 확인
    console.log(`[joinGoldenBell] Checking user data for ${uid}`);
    let userSnapshot;
    try {
      userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
    } catch (userError) {
      console.error('[joinGoldenBell] Error getting user data:', userError);
      throw new Error(`Failed to get user data: ${userError instanceof Error ? userError.message : 'Unknown error'}`);
    }
    
    const userData = userSnapshot.val();
    
    if (!userData) {
      throw new Error('User not found');
    }

    // 전체 userData 구조 로깅
    console.log(`[joinGoldenBell] Full userData keys:`, Object.keys(userData || {}));
    console.log(`[joinGoldenBell] userData.wallet exists:`, !!userData.wallet);
    console.log(`[joinGoldenBell] userData.wallet type:`, typeof userData.wallet);
    if (userData.wallet) {
      console.log(`[joinGoldenBell] userData.wallet keys:`, Object.keys(userData.wallet));
      console.log(`[joinGoldenBell] userData.wallet.usdt:`, userData.wallet.usdt, `(type: ${typeof userData.wallet.usdt})`);
      console.log(`[joinGoldenBell] userData.wallet.USDT:`, userData.wallet.USDT, `(type: ${typeof userData.wallet.USDT})`);
    }
    console.log(`[joinGoldenBell] Full userData structure:`, JSON.stringify(userData, null, 2));

    // 직접 경로로도 잔액 읽기 (비교용)
    let directBalance = 0;
    try {
      const directSnapshot = await rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
      directBalance = parseAmount(directSnapshot.val());
      console.log(`[joinGoldenBell] Direct path balance (/users/${uid}/wallet/usdt): ${directBalance} (raw: ${JSON.stringify(directSnapshot.val())})`);
    } catch (directError) {
      console.error(`[joinGoldenBell] Error reading direct path:`, directError);
    }

    const currentBetAmount = currentGame.currentBetAmount || 1; // 기본값 1
    if (!currentBetAmount || currentBetAmount <= 0) {
      console.error('[joinGoldenBell] Invalid currentBetAmount:', currentBetAmount);
      throw new Error('Invalid game configuration: bet amount is invalid');
    }

    // 잔액 확인만 수행 (차감은 Bet 선택 시 수행)
    const userDataBalance = extractWalletBalance(userData);
    const userBalance = directBalance > 0 ? directBalance : userDataBalance;
    console.log(`[joinGoldenBell] User balance check (informational only): ${userBalance} (direct: ${directBalance}, walletCandidates: ${userDataBalance}), required: ${currentBetAmount}`);
    console.log(`[joinGoldenBell] Wallet structure:`, JSON.stringify(userData.wallet, null, 2));

    // 참가자 추가 (잔액 차감은 Bet 선택 시 수행)
    console.log(`[joinGoldenBell] Adding participant to game ${currentGame.gameId}`);
    
    const gameRound = currentGame.round || 1; // 기본값 1
    if (!gameRound || gameRound <= 0) {
      console.error('[joinGoldenBell] Invalid game round:', gameRound);
      throw new Error('Invalid game configuration: round is invalid');
    }

    const participant: GoldenBellParticipant = {
      uid,
      email: userData.auth?.email || 'unknown',
      joinedRound: gameRound,
      currentRound: gameRound,
      isActive: true,
      totalBet: 0, // Bet 선택 시 업데이트됨
      accumulatedReward: 0, // ✅ 누적 상금 초기화
      isVip: determineVipStatus(userData)
      // choiceSubmittedAt은 optional이므로 undefined로 설정하지 않음 (나중에 선택 제출 시 추가됨)
    };

    try {
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/participants/${uid}`).set(participant);
      console.log(`[joinGoldenBell] Participant added successfully`);
    } catch (participantError) {
      console.error('[joinGoldenBell] Error adding participant:', participantError);
      throw new Error(`Failed to add participant: ${participantError instanceof Error ? participantError.message : 'Unknown error'}`);
    }

    // 참가자 추가 후 게임 상태가 "waiting"이면 "betting"으로 변경
    if (currentGame.status === 'waiting') {
      // 참가자 추가 후 게임 상태 다시 확인
      const updatedGameSnapshot = await rtdb.ref(`/games/goldenbell/${currentGame.gameId}`).once('value');
      const updatedGame = updatedGameSnapshot.val();
      const participantCount = Object.keys(updatedGame?.participants || {}).length;
      
      // 1라운드에 참가자가 없으면 게임 종료
      if (currentGame.round === 1 && participantCount === 0) {
        console.log(`[joinGoldenBell] Round 1 has no participants - ending game ${currentGame.gameId}`);
        await rtdb.ref(`/games/goldenbell/${currentGame.gameId}`).update({
          status: 'finished',
          resultCalculatedAt: Date.now()
        });
      } else {
        const now = Date.now();
        console.log(`[joinGoldenBell] Game status is waiting - changing to betting (participants: ${participantCount})`);
        await rtdb.ref(`/games/goldenbell/${currentGame.gameId}`).update({
          status: 'betting',
          bettingStartAt: now,
          bettingEndAt: now + 15000 // 15초 베팅 시간
        });
        console.log(`[joinGoldenBell] Game status updated to betting`);
        
        // 15초 후 자동으로 라운드 계산 시작
        setTimeout(() => {
          calculateGoldenBellRound(currentGame.gameId);
        }, 15000);
      }
    }

    // Ledger에 베팅 기록 (실패해도 참가는 성공으로 처리)
    try {
      await recordGoldenBellLedger(uid, 'debit', currentBetAmount, 'goldenbell_entry', {
        gameId: currentGame.gameId,
        round: currentGame.round
      });
    } catch (ledgerError) {
      console.warn(`Failed to record ledger for user ${uid}:`, ledgerError);
      // Ledger 기록 실패는 참가 실패로 처리하지 않음
    }

    console.log(`User ${uid} joined Golden Bell game ${currentGame.gameId} round ${currentGame.round}`);

    return {
      success: true,
      gameId: currentGame.gameId,
      round: currentGame.round,
      betAmount: currentBetAmount,
      participantCount: participantCount + 1,
      totalPot: currentGame.totalPot + currentBetAmount,
      bettingEndAt: currentGame.bettingEndAt || Date.now() + 30000
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[joinGoldenBell] Join Golden Bell failed after ${duration}ms`);
    console.error('[joinGoldenBell] Error type:', typeof error);
    console.error('[joinGoldenBell] Error:', error);
    
    if (error instanceof Error) {
      console.error('[joinGoldenBell] Error message:', error.message);
      console.error('[joinGoldenBell] Error stack:', error.stack);
      console.error('[joinGoldenBell] Error name:', error.name);
    }
    
    try {
      const errorDetails = {
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : typeof error,
        stack: error instanceof Error ? error.stack : undefined,
        uid: uid || 'unknown'
      };
      console.error('[joinGoldenBell] Error details:', JSON.stringify(errorDetails, null, 2));
    } catch (stringifyError) {
      console.error('[joinGoldenBell] Failed to stringify error:', stringifyError);
    }
    
    // Firebase Functions의 HttpsError로 변환하여 더 자세한 에러 정보 제공
    if (error instanceof HttpsError) {
      console.error(`[joinGoldenBell] Re-throwing HttpsError: ${error.message}`);
      throw error;
    }
    
    if (error instanceof Error) {
      // 이미 명시적인 에러 메시지가 있으면 그대로 사용
      if (error.message.includes('Authentication required')) {
        console.error(`[joinGoldenBell] Throwing unauthenticated error: ${error.message}`);
        throw new HttpsError('unauthenticated', error.message);
      }
      
      if (error.message.includes('User not found') ||
          error.message.includes('Insufficient balance') ||
          error.message.includes('Already participating') ||
          error.message.includes('Game is full') ||
          error.message.includes('Game is not accepting') ||
          error.message.includes('No active Golden Bell game') ||
          error.message.includes('Invalid game data') ||
          error.message.includes('Invalid game configuration')) {
        console.error(`[joinGoldenBell] Throwing failed-precondition error: ${error.message}`);
        throw new HttpsError('failed-precondition', error.message);
      }
    }
    
    // 알 수 없는 에러는 internal 에러로 throw
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[joinGoldenBell] Throwing internal error: ${errorMessage}`);
    throw new HttpsError('internal', `Failed to join Golden Bell: ${errorMessage}`);
  }
});

// 골든벨 게임 선택 제출
export const submitGoldenBellChoice = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  
    // 요청 데이터 로깅
    console.log(`[submitGoldenBellChoice] Request data:`, JSON.stringify(request.data));
    console.log(`[submitGoldenBellChoice] Request data type:`, typeof request.data);
    console.log(`[submitGoldenBellChoice] Request data keys:`, request.data ? Object.keys(request.data) : 'null');
    
    let { choice } = request.data || {};

  // choice 값 로깅
  console.log(`[submitGoldenBellChoice] Choice value:`, choice);
  console.log(`[submitGoldenBellChoice] Choice type:`, typeof choice);
  console.log(`[submitGoldenBellChoice] Choice length:`, choice ? choice.length : 'null');

    if (choice === undefined || choice === null) {
      console.error(`[submitGoldenBellChoice] Invalid choice - value: ${choice}, type: ${typeof choice}`);
      throw new Error(`Invalid choice. Must be "even", "odd", "PLAYER", or "BANKER". Received: ${JSON.stringify(choice)}`);
    }

    if (typeof choice !== 'string') {
      choice = String(choice);
    }

    // 문자열 정규화 (공백 제거, 대소문자 변환)
    const normalizedInput = choice.trim().toUpperCase();
  console.log(`[submitGoldenBellChoice] Normalized input:`, normalizedInput);

  // Unity에서 PLAYER/BANKER를 보내는 경우 even/odd로 변환
  // PLAYER = even, BANKER = odd
    let normalizedChoice: 'even' | 'odd';
    if (['PLAYER', 'P', '0'].includes(normalizedInput)) {
      normalizedChoice = 'even';
    } else if (['BANKER', 'B', '1'].includes(normalizedInput)) {
      normalizedChoice = 'odd';
    } else if (normalizedInput === 'EVEN' || normalizedInput === 'ODD') {
      normalizedChoice = normalizedInput.toLowerCase() as 'even' | 'odd';
    } else {
    console.error(`[submitGoldenBellChoice] Invalid choice value: ${choice} (normalized: ${normalizedInput})`);
    throw new Error(`Invalid choice. Must be "even", "odd", "PLAYER", or "BANKER". Received: "${choice}"`);
  }
  
  console.log(`[submitGoldenBellChoice] Final normalized choice:`, normalizedChoice);

  try {
    const gamesData = await loadGoldenBellGames();
    const currentGame = await getGoldenBellGameForUser(uid, false, gamesData || undefined);
    
    if (!currentGame) {
      throw new Error('No active Golden Bell game for this user');
    }

    if (currentGame.status !== 'betting') {
      throw new Error('Game is not in betting phase');
    }

    const participant = currentGame.participants && currentGame.participants[uid];
    if (!participant || !participant.isActive) {
      throw new Error('Not participating in current game');
    }

    if (participant.choiceSubmittedAt) {
      throw new Error('Choice already submitted for this round');
    }

    // 베팅 시간 확인
    const now = Date.now();
    if (now > currentGame.bettingEndAt) {
      throw new Error('Betting time has expired');
    }

    // 이미 선택을 제출했는지 확인
    const isFirstChoice = !participant.choiceSubmittedAt;
    const betCost = GOLDEN_BELL_BET_COST;

    // 처음 선택을 제출할 때만 잔액 차감
    if (isFirstChoice) {
      console.log(`[submitGoldenBellChoice] First choice submission - debiting ${betCost} from wallet`);
      
      // 사용자 잔액 확인
      console.log(`[submitGoldenBellChoice] Checking user data for ${uid}`);
      const userSnapshot = await rtdb.ref(`/users/${uid}`).once('value');
      const userData = userSnapshot.val();
      if (!userData) {
        throw new Error('User not found');
      }

      // 직접 경로에서 usdt 잔액 확인 (우선)
      let directBalance = 0;
      try {
        const directBalanceSnapshot = await rtdb.ref(`/users/${uid}/wallet/usdt`).once('value');
        directBalance = parseAmount(directBalanceSnapshot.val());
        console.log(`[submitGoldenBellChoice] Direct path balance (/users/${uid}/wallet/usdt): ${directBalance} (raw: ${JSON.stringify(directBalanceSnapshot.val())})`);
      } catch (directError) {
        console.error(`[submitGoldenBellChoice] Error reading direct path:`, directError);
      }
      
      // userData에서도 다양한 필드 확인
      const userDataBalance = extractWalletBalance(userData);
      
      // 최종 잔액: 직접 경로가 우선, 없으면 userData에서
      const finalBalance = directBalance > 0 ? directBalance : userDataBalance;
      
      console.log(`[submitGoldenBellChoice] User balance check - direct: ${directBalance}, userData: ${userDataBalance}, final: ${finalBalance}, required: ${betCost}`);
      console.log(`[submitGoldenBellChoice] Wallet structure:`, JSON.stringify(userData.wallet, null, 2));
      
      if (finalBalance < betCost) {
        console.error(`[submitGoldenBellChoice] Insufficient balance - Current: $${finalBalance}, Required: $${betCost}`);
        throw new HttpsError('failed-precondition', `Insufficient balance. Current: $${finalBalance}, Required: $${betCost}`);
      }

      // 지갑에서 베팅 금액 차감 (트랜잭션 사용, usdt만 사용)
      console.log(`[submitGoldenBellChoice] Attempting to debit ${betCost} from wallet`);
      let transactionSuccess = false;
      let newBalance = 0;
      
      const debitResult = await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
        const balance = currentBalance !== null && currentBalance !== undefined ? currentBalance : finalBalance;
        console.log(`[submitGoldenBellChoice] Transaction callback - currentBalance from DB: ${currentBalance}, using balance: ${balance}, expected: ${finalBalance}, required: ${betCost}`);
        
        if (balance < betCost) {
          console.log(`[submitGoldenBellChoice] Transaction aborted - insufficient balance: ${balance} < ${betCost}`);
          transactionSuccess = false;
          return; // Abort transaction
        }
        
        newBalance = balance - betCost;
        console.log(`[submitGoldenBellChoice] Transaction will commit - newBalance: ${newBalance}`);
        transactionSuccess = true;
        return newBalance;
      });

      console.log(`[submitGoldenBellChoice] Transaction result - committed: ${debitResult.committed}, snapshot: ${debitResult.snapshot?.val()}`);

      if (!debitResult.committed || !transactionSuccess) {
        const finalBalanceError = debitResult.snapshot?.val() || 0;
        console.error(`[submitGoldenBellChoice] Failed to debit wallet - committed: ${debitResult.committed}, transactionSuccess: ${transactionSuccess}, balance: ${finalBalanceError}`);
        throw new HttpsError('failed-precondition', `Insufficient balance. Current: $${finalBalanceError}, Required: $${betCost}`);
      }

      console.log(`[submitGoldenBellChoice] Wallet debited successfully - new balance: ${newBalance}`);

      // 총 상금 업데이트
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/totalPot`).transaction((currentPot) => {
        return (currentPot || 0) + betCost;
      });
      console.log(`[submitGoldenBellChoice] Total pot updated successfully`);
    }

    // 선택 업데이트 (totalBet도 함께 업데이트)
    const updateData: any = {
      choice: normalizedChoice, // 변환된 choice 사용 (even/odd)
      choiceSubmittedAt: now
    };
    
    if (isFirstChoice) {
      updateData.totalBet = (participant.totalBet || 0) + betCost;
    }

    await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/participants/${uid}`).update(updateData);

    // 라운드별 선택 저장 (PLAYER/BANKER/TIE 형식으로 저장)
    // Unity에서 보낸 원본 choice를 사용 (PLAYER/BANKER/TIE)
    const originalChoice = normalizedInput === 'PLAYER' || normalizedInput === 'P' || normalizedInput === '0' 
      ? 'PLAYER' 
      : normalizedInput === 'BANKER' || normalizedInput === 'B' || normalizedInput === '1'
      ? 'BANKER'
      : normalizedInput; // TIE는 그대로
    
    const roundSelectionsRef = rtdb.ref(`/games/goldenbell/${currentGame.gameId}/participants/${uid}/roundSelections`);
    await roundSelectionsRef.update({
      [currentGame.round]: originalChoice
    });

    console.log(`User ${uid} submitted choice "${choice}" (normalized to "${normalizedChoice}") for Golden Bell round ${currentGame.round}`);

    return {
      success: true,
      choice: normalizedChoice, // 변환된 choice 반환
      round: currentGame.round,
      timeRemaining: Math.max(0, currentGame.bettingEndAt - now)
    };

  } catch (error) {
    console.error('Submit Golden Bell choice failed:', error);
    throw new Error(`Failed to submit choice: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 대기방 상태 조회
export const getWaitingRoomStatus = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;

  try {
    const gamesData = await loadGoldenBellGames();
    let waitingRoomGame: GoldenBellGame | null = null;

    if (gamesData) {
      const now = Date.now();
      let bestWaiting: { gameId: string; game: any; startAt: number } | null = null;

      for (const [gameId, game] of Object.entries(gamesData)) {
        const waitingRoom = game?.waitingRoom;
        if (!waitingRoom || !waitingRoom[uid]) {
          continue;
        }

        const startAt = getGameStartAt({ ...game, gameId });
        if (!startAt) {
          continue;
        }

        if (
          !bestWaiting ||
          Math.abs(startAt - now) < Math.abs(bestWaiting.startAt - now)
        ) {
          bestWaiting = { gameId, game, startAt };
        }
      }

      if (bestWaiting) {
        waitingRoomGame = attachGameId(bestWaiting.gameId, bestWaiting.game);
      }
    }

    const currentGame = waitingRoomGame || await getCurrentGoldenBellGame(false, gamesData || undefined);
    
    if (!currentGame) {
      return {
        success: true,
        status: 'no_game',
        nextGameAt: getNextGoldenBellTime(),
        message: 'No active game. Next game starts at the scheduled time.',
        inWaitingRoom: false
      };
    }

    const isInWaitingRoom = currentGame.waitingRoom && currentGame.waitingRoom[uid];
    const waitingRoomCount = currentGame.waitingRoom ? Object.keys(currentGame.waitingRoom).length : 0;
    const nextGameTime = getNextGoldenBellTime();

    return {
      success: true,
      status: isInWaitingRoom ? 'waiting_room' : 'not_in_waiting_room',
      inWaitingRoom: !!isInWaitingRoom,
      waitingRoomCount,
      currentGame: {
        gameId: currentGame.gameId,
        round: currentGame.round,
        status: currentGame.status,
        totalPot: currentGame.totalPot
      },
      nextGameAt: nextGameTime,
      timeUntilNextGame: Math.max(0, nextGameTime - Date.now())
    };

  } catch (error) {
    console.error('Get waiting room status failed:', error);
    throw new Error('Failed to get waiting room status');
  }
});

// 골든벨 게임 상태 조회
export const getGoldenBellStatus = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;

  try {
    const gamesData = await loadGoldenBellGames();
    const now = Date.now();
    const userGame = gamesData ? await getGoldenBellGameForUser(uid, true, gamesData) : null;

    let retainUserGame = false;
    let withinRecoveryWindow = false;

    if (userGame) {
      const userParticipant = userGame.participants && userGame.participants[uid];
      if (userParticipant) {
        const gameStartAt = getGameStartAt(userGame);
        const activeWindowEnd = gameStartAt ? gameStartAt + GOLDEN_BELL_ACTIVE_GAME_WINDOW_MS : 0;

        if (userParticipant.isActive && (!activeWindowEnd || now <= activeWindowEnd)) {
          retainUserGame = true;
        } else {
          const lastParticipationAt = getLastParticipationTimestamp(userParticipant, userGame);
          withinRecoveryWindow =
            lastParticipationAt > 0 &&
            now - lastParticipationAt < GOLDEN_BELL_WAITING_TIMEOUT_MS;
          retainUserGame = withinRecoveryWindow;
        }
      }
    }

    const currentGame =
      (retainUserGame && userGame) ||
      await getCurrentGoldenBellGame(false, gamesData || undefined);
    
    if (!currentGame) {
      return {
        success: true,
        status: 'no_game',
        nextGameAt: getNextGoldenBellTime(),
        message: 'No active game. Next game starts at the scheduled time.'
      };
    }

    const participant = currentGame.participants && currentGame.participants[uid];
    const participantCount = Object.keys(currentGame.participants || {}).length;
    const isParticipating = !!(participant && participant.isActive);

    const timings = getGoldenBellTiming(currentGame, now);
    const phase = determineGoldenBellPhase(currentGame, now);
    const joinWindowStart = timings.joinWindowStart;
    const joinWindowEnd = timings.joinWindowEnd;
    const withinJoinWindow = now >= joinWindowStart && now <= joinWindowEnd;
    const joinLocked = !withinJoinWindow;

    const canJoin =
      !isParticipating &&
      participantCount < (currentGame.maxParticipants || 2047) &&
      withinJoinWindow;

    const showWaitingRoom =
      !isParticipating && (
        withinRecoveryWindow ||
        phase === 'decision' ||
        phase === 'calculating' ||
        phase === 'finished' ||
        (phase === 'waiting' && !withinJoinWindow)
      );

    let nextGameAt: number | undefined;
    const scheduledStart = timings.startAt;
    if (showWaitingRoom) {
      nextGameAt = scheduledStart > now ? scheduledStart : getNextGoldenBellTime();
    } else if (!isParticipating && !withinJoinWindow) {
      nextGameAt = scheduledStart > now ? scheduledStart : undefined;
    }

    const bettingTimeRemaining =
      phase === 'betting'
        ? Math.max(0, timings.bettingEndAt - now)
        : 0;
    const decisionTimeRemaining =
      phase === 'decision'
        ? Math.max(0, timings.decisionEndAt - now)
        : 0;

    const resultsSnapshot = await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/results`).once('value');
    const roundResults = normalizeRoundResults(resultsSnapshot.val());

    return {
      success: true,
      status: phase,
      gameId: currentGame.gameId,
      round: currentGame.round,
      maxRounds: currentGame.maxRounds,
      participantCount,
      maxParticipants: currentGame.maxParticipants || 2047,
      totalPot: currentGame.totalPot,
      currentBetAmount: currentGame.currentBetAmount,
      startAt: scheduledStart,
      bettingStartAt: timings.bettingStartAt,
      bettingEndAt: timings.bettingEndAt,
      timeRemaining: bettingTimeRemaining,
      decisionStartAt: timings.decisionStartAt,
      decisionEndAt: timings.decisionEndAt,
      decisionTimeRemaining,
      joinWindowStart,
      joinWindowEnd,
      isParticipating,
      participantData: participant,
      canJoin,
      nextGameAt,
      joinLocked,
      roundResults,
      showWaitingRoom
    };

  } catch (error) {
    console.error('Get Golden Bell status failed:', error);
    throw new Error('Failed to get game status');
  }
});

// 라운드 결과 확인/계산 (클라이언트에서 15초 경과 후 호출)
export const checkRoundResult = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, round }: { gameId: string; round: number } = request.data;

  if (!gameId || !round) {
    throw new Error('gameId and round are required');
  }

  try {
    const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
    const game: GoldenBellGame = gameSnapshot.val();

    if (!game) {
      throw new Error('Game not found');
    }

    // 이미 결과가 계산되었는지 확인
    const resultsSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}/results/${round}`).once('value');
    const existingResult = resultsSnapshot.val();

    if (existingResult) {
      const existingWinners = toSafeArray<string>(existingResult.winners);
      const existingEliminated = toSafeArray<string>(existingResult.eliminatedParticipants);
      // 이미 계산된 결과 반환
      const isWinner = existingWinners.includes(uid);
      const isEliminated = existingEliminated.includes(uid);

      return {
        success: true,
        round: existingResult.round,
        result: existingResult.result,
        oracleSum: existingResult.oracleSum,
        isWinner,
        isEliminated,
        winners: existingWinners,
        eliminatedParticipants: existingEliminated,
        gameStatus: existingResult.gameStatus
      };
    }

    // 결과가 없으면 계산 수행
    const phase = determineGoldenBellPhase(game);
    if (phase === 'betting' || phase === 'decision' || phase === 'calculating') {
      // calculateGoldenBellRound를 호출하여 결과 계산
      await calculateGoldenBellRound(gameId);
      
      // 계산 후 결과 다시 조회
      const updatedResultsSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}/results/${round}`).once('value');
      const newResult = updatedResultsSnapshot.val();

      if (newResult) {
        const newWinners = toSafeArray<string>(newResult.winners);
        const newEliminated = toSafeArray<string>(newResult.eliminatedParticipants);
        const isWinner = newWinners.includes(uid);
        const isEliminated = newEliminated.includes(uid);

        return {
          success: true,
          round: newResult.round,
          result: newResult.result,
          oracleSum: newResult.oracleSum,
          isWinner,
          isEliminated,
          winners: newWinners,
          eliminatedParticipants: newEliminated,
          gameStatus: newResult.gameStatus
        };
      }
    }

    throw new Error('Failed to calculate round result');

  } catch (error) {
    console.error('Check round result failed:', error);
    throw new Error('Failed to check round result');
  }
});

// 승리 후 계속/멈춤 선택
export const submitGoldenBellDecision = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { decision }: { decision: 'continue' | 'exit' } = request.data;

  if (!decision || !['continue', 'exit'].includes(decision)) {
    throw new Error('Invalid decision. Must be "continue" or "exit"');
  }

  try {
    const gamesData = await loadGoldenBellGames();
    const currentGame = await getGoldenBellGameForUser(uid, false, gamesData || undefined);
    
    if (!currentGame) {
      throw new Error('No active Golden Bell game');
    }

    const participant = currentGame.participants && currentGame.participants[uid];
    if (!participant || !participant.isActive || !participant.isWinner) {
      throw new Error('Not eligible to make this decision');
    }

    const now = Date.now();
    
    if (decision === 'exit') {
      // ✅ 게임에서 나가기 - 누적된 승리금 지급
      const accumulatedReward = participant.accumulatedReward || 0;
      
      console.log(`[submitGoldenBellDecision] User ${uid} exiting with accumulated reward: $${accumulatedReward}`);
      
      // 상금 지급 (누적 상금만)
      if (accumulatedReward > 0) {
        await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
          return (currentBalance || 0) + accumulatedReward;
        });

        // Ledger에 상금 기록
        await recordGoldenBellLedger(uid, 'credit', accumulatedReward, 'goldenbell_exit_reward', {
          gameId: currentGame.gameId,
          round: currentGame.round,
          finalRound: true
        });
      }

      // 참가자 상태 업데이트
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/participants/${uid}`).update({
        isActive: false,
        decision: 'exit',
        decisionSubmittedAt: now,
        exitedAt: now,
        exitReason: 'chose_exit'
      });

      return {
        success: true,
        decision: 'exit',
        payout: accumulatedReward,
        round: currentGame.round
      };
    } else {
      // 다음 라운드 계속
      await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/participants/${uid}`).update({
        decision: 'continue',
        decisionSubmittedAt: now
      });

      return {
        success: true,
        decision: 'continue',
        round: currentGame.round,
        nextRound: currentGame.round + 1
      };
    }

  } catch (error) {
    console.error('Submit Golden Bell decision failed:', error);
    throw new Error(`Failed to submit decision: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 팀 선택 함수 추가
export const selectTeam = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { team }: { team: 'PLAYER' | 'BANKER' } = request.data;

  if (!team || !['PLAYER', 'BANKER'].includes(team)) {
    throw new Error('Invalid team. Must be "PLAYER" or "BANKER"');
  }

  try {
    const currentGame = await getCurrentGoldenBellGame();
    
    if (!currentGame) {
      throw new Error('No active Golden Bell game');
    }

    if (currentGame.status !== 'team_selection') {
      throw new Error('Game is not in team selection phase');
    }

    // 대기실에 있는지 확인
    if (!currentGame.waitingRoom || !currentGame.waitingRoom[uid]) {
      throw new Error('Not in waiting room');
    }

    // 이미 팀에 속해있는지 확인
    if ((currentGame.teams && currentGame.teams.PLAYER && currentGame.teams.PLAYER[uid]) || 
        (currentGame.teams && currentGame.teams.BANKER && currentGame.teams.BANKER[uid])) {
      throw new Error('Already assigned to a team');
    }

    // 사용자 정보 가져오기
    const waitingParticipant = currentGame.waitingRoom[uid] as any;
    
    // 팀에 참가자 추가
    const participant: any = {
      uid,
      email: waitingParticipant.email,
      team,
      joinedRound: currentGame.round,
      currentRound: currentGame.round,
      isActive: true,
      totalBet: currentGame.currentBetAmount
    };

    await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/teams/${team}/${uid}`).set(participant);
    
    // 대기실에서 제거
    await rtdb.ref(`/games/goldenbell/${currentGame.gameId}/waitingRoom/${uid}`).remove();

    // 모든 사람이 팀을 선택했으면 베팅 시작
    const updatedGame = await getCurrentGoldenBellGame();
    if (updatedGame && updatedGame.teams && updatedGame.waitingRoom) {
      const totalTeamMembers = Object.keys(updatedGame.teams.PLAYER || {}).length + Object.keys(updatedGame.teams.BANKER || {}).length;
      const waitingCount = Object.keys(updatedGame.waitingRoom).length;
      
      if (waitingCount === 0 && totalTeamMembers > 0) {
        // 베팅 페이즈 시작
        const now = Date.now();
        await rtdb.ref(`/games/goldenbell/${currentGame.gameId}`).update({
          status: 'betting',
          bettingStartAt: now,
          bettingEndAt: now + 15000 // 15초 베팅 시간
        });

        // 15초 후 자동으로 라운드 계산 시작
        setTimeout(() => {
          calculateGoldenBellRound(currentGame.gameId);
        }, 15000);
      }
    }

    console.log(`User ${uid} selected team ${team} for Golden Bell game ${currentGame.gameId}`);

    return {
      success: true,
      team,
      gameId: currentGame.gameId,
      round: currentGame.round
    };

  } catch (error) {
    console.error('Select team failed:', error);
    throw new Error(`Failed to select team: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
});

// 내부 헬퍼 함수들

/* async function startTeamSelection(gameId: string): Promise<void> {
  try {
    await rtdb.ref(`/games/goldenbell/${gameId}`).update({
      status: 'team_selection',
      teamSelectionStartAt: Date.now()
    });

    console.log(`Team selection started for Golden Bell game: ${gameId}`);

    // 5분 후에도 팀 선택을 안 한 사람들은 자동 배정
    setTimeout(() => {
      autoAssignTeams(gameId);
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error(`Failed to start team selection for game ${gameId}:`, error);
  }
} */

/* async function autoAssignTeams(gameId: string): Promise<void> {
  try {
    const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
    const game: GoldenBellGame = gameSnapshot.val();

    if (!game || game.status !== 'team_selection') return;

    // 대기실에 남은 사람들을 자동으로 팀 배정
    const waitingParticipants = Object.entries(game.waitingRoom || {});
    const playerCount = Object.keys(game.teams?.PLAYER || {}).length;
    const bankerCount = Object.keys(game.teams?.BANKER || {}).length;

    for (let i = 0; i < waitingParticipants.length; i++) {
      const [uid, waitingParticipant] = waitingParticipants[i] as [string, any];
      
      // 번갈아가며 배정 (균등하게)
      const assignToPlayer = (playerCount + Math.floor(i / 2)) <= (bankerCount + Math.ceil(i / 2));
      const team = assignToPlayer ? 'PLAYER' : 'BANKER';

      const participant: any = {
        uid,
        email: waitingParticipant.email,
        team,
        joinedRound: game.round,
        currentRound: game.round,
        isActive: true,
        totalBet: game.currentBetAmount
      };

      await rtdb.ref(`/games/goldenbell/${gameId}/teams/${team}/${uid}`).set(participant);
      await rtdb.ref(`/games/goldenbell/${gameId}/waitingRoom/${uid}`).remove();
    }

    // 베팅 페이즈 시작
    const now = Date.now();
    await rtdb.ref(`/games/goldenbell/${gameId}`).update({
      status: 'betting',
      bettingStartAt: now,
      bettingEndAt: now + 30000
    });

    // 30초 후 자동으로 라운드 계산 시작
    setTimeout(() => {
      calculateGoldenBellRound(gameId);
    }, 30000);

    console.log(`Auto-assigned teams for Golden Bell game: ${gameId}`);

  } catch (error) {
    console.error(`Failed to auto-assign teams for game ${gameId}:`, error);
  }
} */

async function getCurrentGoldenBellGame(
  includeFinished: boolean = false,
  gamesData?: GoldenBellGameMap
): Promise<GoldenBellGame | null> {
  try {
    console.log('[getCurrentGoldenBellGame] Fetching games from database, includeFinished:', includeFinished);
    
    let games = gamesData;
    if (!games) {
      games = await loadGoldenBellGames();
    }

    if (!games || Object.keys(games).length === 0) {
      console.log('[getCurrentGoldenBellGame] No games found in database (games is empty)');
      return null;
    }

    const now = Date.now();
    let bestJoinable: { gameId: string; game: any; score: number } | null = null;
    let bestUpcoming: { gameId: string; game: any; score: number } | null = null;
    let mostRecentPastGame: { gameId: string; game: any; startAt: number } | null = null;

    for (const [gameId, game] of Object.entries(games) as [string, any][]) {
      if (!game || typeof game !== 'object') {
        continue;
      }

      const startAt = getGameStartAt({ ...game, gameId });
      if (!startAt) {
        continue;
      }

      // includeFinished가 true일 때는 state를 무시하고 시간 기준으로만 과거 게임 반환
      if (includeFinished && startAt <= now) {
        if (!mostRecentPastGame || startAt > mostRecentPastGame.startAt) {
          mostRecentPastGame = { gameId, game, startAt };
        }
        continue;
      }

      const phase = determineGoldenBellPhase(game, now);
      const timings = getGoldenBellTiming(game, now);

      if (phase === 'finished') {
        continue;
      }

      const joinable = isGameJoinableByTime(game, now);
      const distanceFromNow = Math.abs(startAt - now);

      if (joinable) {
        if (!bestJoinable || distanceFromNow < bestJoinable.score) {
          bestJoinable = { gameId, game, score: distanceFromNow };
        }
        continue;
      }

      if (phase === 'waiting') {
        const timeUntilStart = timings.joinWindowStart >= now
          ? (timings.joinWindowStart - now)
          : Number.MAX_SAFE_INTEGER;
        if (!bestUpcoming || timeUntilStart < bestUpcoming.score) {
          bestUpcoming = { gameId, game, score: timeUntilStart };
        }
        continue;
      }

    }

    // includeFinished가 true이고 과거 게임이 있다면 그것을 우선 반환
    if (includeFinished && mostRecentPastGame) {
      const gameWithId = attachGameId(mostRecentPastGame.gameId, mostRecentPastGame.game);
      console.log(`[getCurrentGoldenBellGame] Returning most recent past game ${mostRecentPastGame.gameId}, startAt: ${mostRecentPastGame.startAt}, now: ${now}`);
      return gameWithId as GoldenBellGame;
    }

    const selected = bestJoinable || bestUpcoming;
    if (!selected) {
      console.log('[getCurrentGoldenBellGame] No suitable game found');
      return null;
    }

    const gameWithId = attachGameId(selected.gameId, selected.game);
    console.log(`[getCurrentGoldenBellGame] Returning game ${selected.gameId} with status ${selected.game.status}, startAt: ${selected.game.startAt}, now: ${now}`);
    return gameWithId as GoldenBellGame;
  } catch (error) {
    console.error('[getCurrentGoldenBellGame] Fatal error:', error);
    if (error instanceof Error) {
      console.error('[getCurrentGoldenBellGame] Error message:', error.message);
      console.error('[getCurrentGoldenBellGame] Error stack:', error.stack);
    }
    if (error instanceof Error && error.message.includes('Database access failed')) {
      console.error('[getCurrentGoldenBellGame] Re-throwing database error');
      throw error;
    }
    console.error('[getCurrentGoldenBellGame] Returning null due to error');
    return null;
  }
}

async function calculateGoldenBellRound(gameId: string): Promise<void> {
  try {
    // 게임 상태를 계산 중으로 변경
    await rtdb.ref(`/games/goldenbell/${gameId}/status`).set('calculating');

    const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
    const game: GoldenBellGame = gameSnapshot.val();

    if (!game) return;

    // Oracle 데이터로 결과 계산
    const oracleSnapshot = await rtdb.ref('/oracle/current').once('value');
    const oracleData = oracleSnapshot.val();

    if (!oracleData || !oracleData.gameNumbers) {
      throw new Error('Oracle data not available');
    }

    // 게임 번호 합계 계산
    const sum = Object.values(oracleData.gameNumbers).reduce((total: number, num: any) => total + (typeof num === 'number' ? num : 0), 0) as number;
    const result: 'even' | 'odd' = sum % 2 === 0 ? 'even' : 'odd';

    // 참가자들의 선택 분류
    const choices: Record<'even' | 'odd', string[]> = { even: [], odd: [] };
    const activeParticipants = Object.entries(game.participants).filter(([uid, p]) => p.isActive);

    // 1라운드에 참가자가 없으면 게임 종료
    if (game.round === 1 && activeParticipants.length === 0) {
      console.log(`[calculateGoldenBellRound] Round 1 has no participants - ending game ${gameId}`);
      await rtdb.ref(`/games/goldenbell/${gameId}`).update({
        status: 'finished',
        resultCalculatedAt: Date.now()
      });
      return;
    }

    for (const [uid, participant] of activeParticipants) {
      if (participant.choice) {
        choices[participant.choice].push(uid);
      } else {
        // 선택하지 않은 참가자는 자동으로 이번 라운드에서 멈춤 (배당 없음)
        await rtdb.ref(`/games/goldenbell/${gameId}/participants/${uid}`).update({
          isActive: false,
          exitedAt: Date.now(),
          exitReason: 'timeout'
        });
      }
    }

    // 승자 결정
    let winners: string[] = [];
    let eliminatedParticipants: string[] = [];

    // 게임 결과 로직
    if (game.round === 1) {
      // 1라운드: 무승부시 모두 승리
      if (choices.even.length === choices.odd.length) {
        winners = [...choices.even, ...choices.odd];
      } else {
        // 적은 쪽이 승리
        winners = choices.even.length < choices.odd.length ? choices.even : choices.odd;
        eliminatedParticipants = choices.even.length < choices.odd.length ? choices.odd : choices.even;
      }
    } else {
      // 2라운드 이후
      if (choices.even.length === choices.odd.length || 
          choices.even.length === 0 || 
          choices.odd.length === 0) {
        // 무승부 또는 한쪽만 선택: 모두 실패
        eliminatedParticipants = [...choices.even, ...choices.odd];
      } else if (game.round >= 10 && choices.even.length + choices.odd.length <= 2) {
        // 10단계에 2명 이하: 모두 실패
        eliminatedParticipants = [...choices.even, ...choices.odd];
      } else {
        // 적은 쪽이 승리
        winners = choices.even.length < choices.odd.length ? choices.even : choices.odd;
        eliminatedParticipants = choices.even.length < choices.odd.length ? choices.odd : choices.even;
      }
    }

    // 패배자 처리 - 대기방으로 이동
    for (const uid of eliminatedParticipants) {
      const participant = game.participants[uid];
      
      // 대기방으로 이동 (다음 게임 참여 가능)
      await rtdb.ref(`/games/goldenbell/${gameId}/waitingRoom/${uid}`).set({
        uid,
        email: participant.email,
        eliminatedAt: Date.now(),
        eliminatedRound: game.round,
        nextGameEligible: true
      });
      
      // 참가자 상태 업데이트
      await rtdb.ref(`/games/goldenbell/${gameId}/participants/${uid}`).update({
        isActive: false,
        isWinner: false,
        exitedAt: Date.now(),
        exitReason: 'eliminated'
      });
    }

    // ✅ 승리 보상 계산: 패배자들의 배팅금을 승리자들이 균등 분배
    const losersBetAmount = eliminatedParticipants.length * 1; // 각 패배자는 $1 배팅
    const rewardPerWinner = winners.length > 0 ? losersBetAmount / winners.length : 0;
    
    console.log(`[calculateGoldenBellRound] Round ${game.round} - Winners: ${winners.length}, Losers: ${eliminatedParticipants.length}, Reward per winner: $${rewardPerWinner}`);
    
    // 승자 처리
    for (const uid of winners) {
      const participant = game.participants[uid];
      const currentAccumulatedReward = participant.accumulatedReward || 0;
      const newAccumulatedReward = currentAccumulatedReward + rewardPerWinner;
      
      await rtdb.ref(`/games/goldenbell/${gameId}/participants/${uid}`).update({
        isWinner: true,
        currentRound: game.round + 1,
        accumulatedReward: newAccumulatedReward // 누적 상금 업데이트
      });
      
      console.log(`[calculateGoldenBellRound] Winner ${uid} - Previous: $${currentAccumulatedReward}, Added: $${rewardPerWinner}, New Total: $${newAccumulatedReward}`);
    }

    const remainingPot = winners.length * GOLDEN_BELL_BET_COST;
    await rtdb.ref(`/games/goldenbell/${gameId}/totalPot`).set(remainingPot);

    // 게임 결과 저장
    const roundResult: GoldenBellResult = {
      round: game.round,
      oracleSum: sum,
      result,
      choices,
      winners,
      eliminatedParticipants,
      gameStatus: winners.length === 0 ? 'finished' : 'continue'
    };

    await rtdb.ref(`/games/goldenbell/${gameId}/results/${game.round}`).set(roundResult);

    // 게임 종료 조건 확인
    // 승자가 없거나 10라운드 완료 시에만 게임 종료
    // 혼자 참가한 경우 10라운드까지 계속 진행
    if (winners.length === 0 || game.round >= 10) {
      const finishTime = Date.now();
      const participantUpdates: Record<string, any> = {};

      for (const [uid, participant] of Object.entries(game.participants || {})) {
        if (participant.isActive) {
          participantUpdates[`/games/goldenbell/${gameId}/participants/${uid}/isActive`] = false;
          participantUpdates[`/games/goldenbell/${gameId}/participants/${uid}/exitedAt`] = finishTime;
          if (!participant.exitReason) {
            participantUpdates[`/games/goldenbell/${gameId}/participants/${uid}/exitReason`] =
              participant.isWinner ? 'final_winner' : 'game_finished';
          }
        }
      }

      if (Object.keys(participantUpdates).length > 0) {
        await rtdb.ref().update(participantUpdates);
      }

      // ✅ 게임 종료 - 최종 우승자들에게 누적 상금 지급
      if (winners.length === 1) {
        // 1명만 남은 경우 (9라운드 혼자 승리 또는 중간 단독 승리)
        const winnerUid = winners[0];
        const finalReward = game.participants[winnerUid].accumulatedReward || 0;
        
        console.log(`[calculateGoldenBellRound] Final winner ${winnerUid} receives accumulated reward: $${finalReward}`);
        
        if (finalReward > 0) {
          await rtdb.ref(`/users/${winnerUid}/wallet/usdt`).transaction((currentBalance) => {
            return (currentBalance || 0) + finalReward;
          });

          await recordGoldenBellLedger(winnerUid, 'credit', finalReward, 'goldenbell_final_winner', {
            gameId,
            round: game.round,
            totalRounds: game.round,
            finalWinner: true
          });
        }
      } else if (game.round >= 10 && winners.length > 0) {
        // 10라운드 완주한 경우 (여러 명이 남았을 수 있음)
        console.log(`[calculateGoldenBellRound] Round 10 completed with ${winners.length} winners`);
        
        for (const winnerUid of winners) {
          const participant = game.participants[winnerUid];
          const finalReward = participant.accumulatedReward || 0;
          
          console.log(`[calculateGoldenBellRound] Round 10 winner ${winnerUid} receives accumulated reward: $${finalReward}`);
          
          if (finalReward > 0) {
            await rtdb.ref(`/users/${winnerUid}/wallet/usdt`).transaction((currentBalance) => {
              return (currentBalance || 0) + finalReward;
            });

            await recordGoldenBellLedger(winnerUid, 'credit', finalReward, 'goldenbell_completion_reward', {
              gameId,
              round: game.round,
              totalRounds: 10,
              completed: true
            });
          }
        }
      }

      await rtdb.ref(`/games/goldenbell/${gameId}`).update({
        status: 'finished',
        resultCalculatedAt: Date.now()
      });

      // 🔄 게임 히스토리 업데이트
      await updateGoldenBellGameHistory(gameId, game);

    } else {
      // 다음 라운드 준비 (서버 스케줄러가 1분마다 시작)
      const nextBetAmount = GOLDEN_BELL_BET_COST; // 베팅 금액은 항상 $1
      const now = Date.now();
      
      // Decision 타이머 설정 (승리자가 있을 때만)
      await rtdb.ref(`/games/goldenbell/${gameId}`).update({
        status: 'decision', // waiting 대신 decision 상태로 설정
        round: game.round + 1,
        currentBetAmount: nextBetAmount,
        bettingStartAt: null,
        bettingEndAt: null,
        decisionStartAt: now,
        decisionEndAt: now + 15000, // 15초 Decision 시간
        nextRoundStartAt: Date.now() + 60000 // 1분 후 다음 라운드 시작 예정
      });

      // 15초 후 자동으로 Decision을 선택하지 않은 승자들을 continue 처리
      setTimeout(() => {
        processGoldenBellDecisionTimeout(gameId);
      }, 15000);
    }

    console.log(`Golden Bell round ${game.round} calculated. Winners: ${winners.length}, Eliminated: ${eliminatedParticipants.length}`);

  } catch (error) {
    console.error(`Failed to calculate Golden Bell round for game ${gameId}:`, error);
  }
}

async function processGoldenBellDecisionTimeout(gameId: string): Promise<void> {
  try {
    const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
    const game: GoldenBellGame = gameSnapshot.val();

    if (!game || !game.decisionEndAt) return;

    const now = Date.now();
    if (now < game.decisionEndAt) return; // 아직 시간이 남음

    // Decision을 선택하지 않은 승자들은 자동으로 continue 처리
    const activeWinners = Object.entries(game.participants).filter(([uid, p]) => 
      p.isActive && p.isWinner && !p.decision && !p.exitedAt
    );

    for (const [uid] of activeWinners) {
      // 자동으로 continue 처리
      await rtdb.ref(`/games/goldenbell/${gameId}/participants/${uid}`).update({
        decision: 'continue',
        decisionSubmittedAt: now
      });
    }

    // Decision 완료 후 다음 라운드 베팅 시작
    const now2 = Date.now();
    await rtdb.ref(`/games/goldenbell/${gameId}`).update({
      status: 'betting', // Decision 완료 후 바로 베팅 단계 시작
      decisionStartAt: null,
      decisionEndAt: null,
      bettingStartAt: now2,
      bettingEndAt: now2 + 30000 // 30초 베팅 시간
    });

    console.log(`Auto-continued ${activeWinners.length} winners and started next round betting for game ${gameId}`);
    
    // 30초 후 자동으로 라운드 계산 시작
    setTimeout(() => {
      calculateGoldenBellRound(gameId);
    }, 30000);
  } catch (error) {
    console.error(`Failed to process Golden Bell decision timeout for game ${gameId}:`, error);
  }
}

// 이 함수는 현재 사용되지 않지만, 향후 사용을 위해 유지
// async function processGoldenBellTimeout(gameId: string): Promise<void> {
//   const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
//   const game: GoldenBellGame = gameSnapshot.val();
//
//   if (!game || game.status !== 'waiting') return;
//
//   // 선택하지 않은 승자들은 자동으로 이전 라운드에서 멈춤 처리
//   const activeWinners = Object.entries(game.participants).filter(([uid, p]) => 
//     p.isActive && p.isWinner && !p.choice
//   );
//
//   for (const [uid, participant] of activeWinners) {
//     const payout = calculateGoldenBellPayout(game.round - 1, game.totalPot);
//     
//     // 상금 지급
//     await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((currentBalance) => {
//       return (currentBalance || 0) + payout;
//     });
//
//     // 대기방으로 이동 (다음 게임 참여 가능)
//     await rtdb.ref(`/games/goldenbell/${gameId}/waitingRoom/${uid}`).set({
//       uid,
//       email: participant.email,
//       exitedAt: Date.now(),
//       exitRound: game.round - 1,
//       exitReason: 'timeout',
//       payout,
//       nextGameEligible: true
//     });
//
//     // 참가자 상태 업데이트
//     await rtdb.ref(`/games/goldenbell/${gameId}/participants/${uid}`).update({
//       isActive: false,
//       exitedAt: Date.now(),
//       exitReason: 'timeout'
//     });
//
//     // Ledger 기록
//     await recordGoldenBellLedger(uid, 'credit', payout, 'goldenbell_timeout_reward', {
//       gameId,
//       round: game.round - 1,
//       autoExit: true
//     });
//   }
// }

// ✅ 더 이상 사용하지 않음 - 누적 상금(accumulatedReward)으로 대체
// function calculateGoldenBellPayout(round: number, totalPot: number): number {
//   const payoutRates = [0, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 1.0];
//   const rate = payoutRates[Math.min(round, payoutRates.length - 1)];
//   return Math.floor(totalPot * rate);
// }

function getNextGoldenBellTime(): number {
  // UTC 시간 기준으로 계산
  const now = new Date();
  const currentUTCTime = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    now.getUTCSeconds()
  );
  
  const minutes = [5, 15, 25, 35, 45, 55];
  
  // 현재 UTC 시간의 시각
  const currentUTCHour = now.getUTCHours();
  
  // 현재 시간 내에서 다음 게임 시간 찾기
  for (const minute of minutes) {
    const nextGameTime = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      currentUTCHour,
      minute,
      0,
      0
    );
    
    if (nextGameTime > currentUTCTime) {
      console.log(`[getNextGoldenBellTime] Next game at UTC ${currentUTCHour}:${minute.toString().padStart(2, '0')}`);
      return nextGameTime;
    }
  }
  
  // 다음 시간의 5분
  const nextHour = (currentUTCHour + 1) % 24;
  const nextDay = currentUTCHour === 23 ? 1 : 0;
  const nextGameTime = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + nextDay,
    nextHour,
    5,
    0,
    0
  );
  
  console.log(`[getNextGoldenBellTime] Next game at UTC ${nextHour}:05 (next hour)`);
  return nextGameTime;
}

async function recordGoldenBellLedger(
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

// 서버에서 라운드 시작 (1분마다 호출)
export async function startNextRound(): Promise<void> {
  try {
    const currentGame = await getCurrentGoldenBellGame();
    
    if (!currentGame) {
      console.log('No active Golden Bell game to start round');
      return;
    }

    const now = Date.now();
    const phase = determineGoldenBellPhase(currentGame, now);

    if (phase === 'finished') {
      return;
    }

    if (phase !== 'waiting') {
      console.log(`Game ${currentGame.gameId} is not ready to start betting (phase: ${phase})`);
      return;
    }

    const timings = getGoldenBellTiming(currentGame, now);
    if (now < timings.joinWindowStart) {
      console.log(`[startNextRound] Waiting for join window for game ${currentGame.gameId}`);
      return;
    }

    const participantCount = Object.keys(currentGame.participants || {}).length;
    if (participantCount === 0) {
      console.log(`[startNextRound] No participants yet for game ${currentGame.gameId} - staying in waiting state`);
      return;
    }

    await rtdb.ref(`/games/goldenbell/${currentGame.gameId}`).update({
      status: 'betting',
      bettingStartAt: now,
      bettingEndAt: now + GOLDEN_BELL_BETTING_DURATION_MS
    });

    console.log(`Round ${currentGame.round} started for game ${currentGame.gameId}`);

    setTimeout(() => {
      calculateGoldenBellRound(currentGame.gameId);
    }, GOLDEN_BELL_BETTING_DURATION_MS);

  } catch (error) {
    console.error('Failed to start next round:', error);
  }
}

// 골든벨 게임 히스토리 업데이트 함수
async function updateGoldenBellGameHistory(gameId: string, game: any) {
  try {
    const participants = game.participants || {};
    
    for (const [uid, participant] of Object.entries(participants)) {
      const typedParticipant = participant as any;
      
      // 게임 히스토리 조회
      const historyQuery = rtdb.ref(`gameHistory/${uid}`)
        .orderByChild('gameId')
        .equalTo(gameId);
      
      const historySnapshot = await historyQuery.once('value');
      
      if (historySnapshot.exists()) {
        const histories = historySnapshot.val();
        
        for (const [historyId, historyData] of Object.entries(histories)) {
          const typedHistory = historyData as any;
          
          if (typedHistory.gameType === 'goldenbell' && !typedHistory.isCompleted) {
            // 라운드 선택사항 수집
            const roundSelections = typedParticipant.roundSelections || {};
            
            // roundSelections 객체를 배열로 변환 (라운드 순서대로)
            const roundChoices: string[] = [];
            const roundKeys = Object.keys(roundSelections).map(Number).sort((a, b) => a - b);
            for (const round of roundKeys) {
              if (roundSelections[round]) {
                roundChoices.push(roundSelections[round]);
              }
            }
            
            // 결과 데이터 준비
            const updates: any = {
              isCompleted: true,
              updatedAt: Date.now(),
              rewardAmount: typedParticipant.accumulatedReward || 0,
              finalRound: typedParticipant.finalRound || game.round,
              eliminatedRound: typedParticipant.eliminatedRound || 0,
              roundChoices: roundChoices
            };

            // maxRound 계산 (roundChoices가 있을 때만)
            if (roundKeys.length > 0) {
              updates.maxRound = Math.max(...roundKeys);
            }

            const rewardLogs = toRewardLogArray(typedParticipant.roundRewardLogs);
            if (rewardLogs.length > 0) {
              updates.roundRewardLogs = rewardLogs;
            }
            
            // 히스토리 업데이트
            await rtdb.ref(`gameHistory/${uid}/${historyId}`).update(updates);
            
            console.log(`[updateGoldenBellGameHistory] Updated history ${historyId} for user ${uid}`);
          }
        }
      }
    }
  } catch (error) {
    console.error('[updateGoldenBellGameHistory] Error updating game history:', error);
  }
}

// 골든벨 참가자 보상 업데이트
export const updateGoldenBellParticipantReward = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, accumulatedReward, isWinner, round, reward } = request.data;

  // 입력 검증
  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required');
  }

  if (accumulatedReward === undefined || accumulatedReward === null) {
    throw new HttpsError('invalid-argument', 'accumulatedReward is required');
  }

  if (typeof accumulatedReward !== 'number' || accumulatedReward < 0) {
    throw new HttpsError('invalid-argument', 'accumulatedReward must be a non-negative number');
  }

  if (round === undefined || round === null) {
    throw new HttpsError('invalid-argument', 'round is required');
  }

  const normalizedRound = Number(round);
  if (!Number.isFinite(normalizedRound) || normalizedRound <= 0) {
    throw new HttpsError('invalid-argument', 'round must be a positive number');
  }

  let rewardPayload: GoldenBellRoundRewardPayload | null = null;
  if (reward !== undefined && reward !== null) {
    rewardPayload = normalizeRoundRewardPayload(reward, normalizedRound);
  }

  try {
    console.log(
      `[updateGoldenBellParticipantReward] Updating reward for user ${uid}, game ${gameId}, round ${normalizedRound}, reward: $${accumulatedReward}, isWinner: ${isWinner}`
    );

    // 게임 존재 확인
    const gameRef = rtdb.ref(`/games/goldenbell/${gameId}`);
    const gameSnapshot = await gameRef.once('value');

    if (!gameSnapshot.exists()) {
      throw new HttpsError('not-found', 'Game not found');
    }

    const game = gameSnapshot.val();

    // 게임 상태 확인 (종료된 게임은 업데이트 불가)
    if (game.status === 'finished') {
      throw new HttpsError('failed-precondition', 'Game already finished');
    }

    // 참가자 확인
    const participantRef = gameRef.child(`participants/${uid}`);
    const participantSnapshot = await participantRef.once('value');

    if (!participantSnapshot.exists()) {
      throw new HttpsError('not-found', 'Participant not found');
    }

    const participant = participantSnapshot.val();

    // 누적 상금 업데이트
    const updates: Record<string, any> = {
      accumulatedReward: Number(accumulatedReward),
      lastRewardUpdatedAt: Date.now()
    };

    // isWinner가 제공된 경우 업데이트
    if (isWinner !== undefined && isWinner !== null) {
      updates.isWinner = Boolean(isWinner);
    }

    await participantRef.update(updates);

    if (rewardPayload) {
      await participantRef.child(`roundRewardLogs/${rewardPayload.round}`).set(rewardPayload);
      await storeGoldenBellRoundReward(gameId, rewardPayload);
      await persistRoundRewardLogToHistory(uid, gameId, rewardPayload);
    }

    console.log(
      `[updateGoldenBellParticipantReward] Successfully updated participant ${uid} - accumulatedReward: $${accumulatedReward}, isWinner: ${
        isWinner !== undefined ? isWinner : participant.isWinner
      }, rewardPayload: ${rewardPayload ? 'stored' : 'none'}`
    );

    return {
      success: true,
      accumulatedReward: Number(accumulatedReward),
      isWinner: isWinner !== undefined ? Boolean(isWinner) : participant.isWinner,
      round: normalizedRound,
      message: 'Participant reward updated successfully'
    };

  } catch (error) {
    console.error('[updateGoldenBellParticipantReward] Error:', error);
    if (error instanceof HttpsError) {
      throw error;
    }
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpsError('internal', `Failed to update participant reward: ${errorMessage}`);
  }
});

async function storeGoldenBellRoundReward(
  gameId: string,
  rewardPayload: GoldenBellRoundRewardPayload
): Promise<void> {
  try {
    const rewardRef = rtdb.ref(`/games/goldenbell/${gameId}/results/${rewardPayload.round}`);
    await rewardRef.child('reward').set({
      ...rewardPayload,
      recordedAt: Date.now()
    });
  } catch (error) {
    console.error('[storeGoldenBellRoundReward] Failed to persist reward payload:', error);
  }
}

async function persistRoundRewardLogToHistory(
  uid: string,
  gameId: string,
  rewardPayload: GoldenBellRoundRewardPayload
): Promise<void> {
  try {
    const historySnapshot = await rtdb
      .ref(`gameHistory/${uid}`)
      .orderByChild('gameId')
      .equalTo(gameId)
      .once('value');

    if (!historySnapshot.exists()) {
      return;
    }

    const histories = historySnapshot.val() || {};
    const updates: Record<string, any> = {};
    const updatedAt = Date.now();

    for (const [historyId, historyData] of Object.entries(histories)) {
      const typedHistory = historyData as any;
      if (typedHistory.gameType !== 'goldenbell') {
        continue;
      }

      const mergedLogs = mergeRewardLogs(typedHistory.roundRewardLogs, rewardPayload);
      const basePath = `/gameHistory/${uid}/${historyId}`;
      updates[`${basePath}/roundRewardLogs`] = mergedLogs;
      updates[`${basePath}/result/roundRewardLogs`] = mergedLogs;
      updates[`${basePath}/updatedAt`] = updatedAt;
    }

    if (Object.keys(updates).length > 0) {
      await rtdb.ref().update(updates);
    }
  } catch (error) {
    console.error('[persistRoundRewardLogToHistory] Failed to update history logs:', error);
  }
}

// 골든벨 라운드별 선택 업데이트
export const updateGoldenBellRoundChoices = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, round, choice } = request.data;

  // 입력 검증
  if (!gameId || !round || !choice) {
    return {
      success: false,
      error: 'Missing required parameters'
    };
  }

  if (typeof round !== 'number' || round < 1 || round > 10) {
    return {
      success: false,
      error: 'Invalid round number'
    };
  }

  const validChoices = ['PLAYER', 'BANKER', 'TIE'];
  const normalizedChoice = choice.toUpperCase();
  if (!validChoices.includes(normalizedChoice)) {
    return {
      success: false,
      error: 'Invalid choice'
    };
  }

  try {
    // 게임 존재 확인
    const gameRef = rtdb.ref(`/games/goldenbell/${gameId}`);
    const gameSnapshot = await gameRef.once('value');

    if (!gameSnapshot.exists()) {
      return {
        success: false,
        error: 'Game not found'
      };
    }

    const game = gameSnapshot.val();

    // 게임 상태 확인 (종료된 게임은 업데이트 불가)
    if (game.status === 'finished') {
      return {
        success: false,
        error: 'Game already finished'
      };
    }

    // 참가자 확인
    const participantRef = gameRef.child(`participants/${uid}`);
    const participantSnapshot = await participantRef.once('value');

    if (!participantSnapshot.exists()) {
      return {
        success: false,
        error: 'Participant not found'
      };
    }

    // 라운드별 선택 업데이트 (roundSelections 객체에 저장)
    const roundSelectionsRef = participantRef.child('roundSelections');
    await roundSelectionsRef.update({
      [round]: normalizedChoice
    });

    console.log(`[updateGoldenBellRoundChoices] Updated round ${round} choice to ${normalizedChoice} for user ${uid} in game ${gameId}`);

    return {
      success: true,
      message: 'Round choice updated successfully'
    };

  } catch (error) {
    console.error('[updateGoldenBellRoundChoices] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      error: `Failed to update round choice: ${errorMessage}`
    };
  }
});

// 골든벨 게임 결과 저장
export const saveGoldenBellResult = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required');
  }

  const { uid } = request.auth;
  const { gameId, finalRound, isWinner, totalBet, exitReason = 'game_ended', exitedAt } = request.data;

  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required');
  }

  try {
    console.log(`[saveGoldenBellResult] Saving result for user ${uid}, game ${gameId}, winner: ${isWinner}`);
    
    // 게임과 참가자 정보 확인
    const gameRef = rtdb.ref(`/games/goldenbell/${gameId}`);
    const participantRef = gameRef.child(`participants/${uid}`);
    
    const [gameSnapshot, participantSnapshot] = await Promise.all([
      gameRef.once('value'),
      participantRef.once('value')
    ]);

    const game = gameSnapshot.val();
    const participant = participantSnapshot.val();

    if (!game) {
      throw new HttpsError('not-found', 'Game not found');
    }

    if (!participant) {
      throw new HttpsError('not-found', 'Participant not found');
    }

    // 참가자 결과 업데이트
    const updates = {
      isWinner: isWinner,
      finalRound: finalRound || game.round,
      totalBet: totalBet || participant.totalBet || 0,
      exitReason: exitReason,
      exitedAt: exitedAt || Date.now(),
      isActive: false // 게임 종료
    };

    await participantRef.update(updates);
    
    console.log(`[saveGoldenBellResult] Successfully saved result for user ${uid} in game ${gameId}`);
    
    return { 
      success: true, 
      message: 'Game result saved successfully',
      data: updates
    };

  } catch (error) {
    console.error(`[saveGoldenBellResult] Error for user ${uid}:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpsError('internal', `Failed to save game result: ${errorMessage}`);
  }
});

// 골든벨 게임 이력 조회 (마이페이지용)
export const getGoldenBellHistory = onCall(async (request: CallableRequest) => {
  if (!request.auth) {
    throw new Error('Authentication required');
  }

  const { uid } = request.auth;
  const { limit = 20 } = request.data;

  try {
    console.log(`[getGoldenBellHistory] Fetching history for user ${uid}, limit: ${limit}`);
    
    // 전체 게임 데이터 가져오기 (시간 제한 없이)
    console.log(`[getGoldenBellHistory] Fetching all GoldenBell games from database`);
    
    const gamesSnapshot = await rtdb.ref('/games/goldenbell').once('value');
    const games = gamesSnapshot.val() || {};
    
    console.log(`[getGoldenBellHistory] Found ${Object.keys(games).length} total games in database`);
    
    const userHistory = [];

    for (const [gameId, game] of Object.entries(games) as [string, GoldenBellGame][]) {
      const participants = game.participants || {};
      console.log(`[getGoldenBellHistory] Game ${gameId} status: ${game.status}, has ${Object.keys(participants).length} participants`);
      
      const participant = participants[uid];
      
      // 사용자가 참여한 게임만 추가
      if (participant) {
        console.log(`[getGoldenBellHistory] User ${uid} participated in game ${gameId}`);
        // 라운드별 선택 가져오기
        const roundSelections = participant.roundSelections || {};
        const roundChoices: string[] = [];
        // roundSelections 객체를 배열로 변환 (라운드 순서대로)
        for (let round = 1; round <= 10; round++) {
          if (roundSelections[round]) {
            roundChoices.push(roundSelections[round]);
          }
        }

        // 사용자가 참가한 게임만 추가
        const userGameHistory = {
          gameId,
          joinedRound: participant.joinedRound,
          finalRound: game.round,
          totalRounds: game.round,
          isWinner: participant.isWinner || false,
          isActive: participant.isActive || false,
          totalBet: 1, // 실제 현금 배팅은 항상 1달러 (누적 totalBet이 아닌 실제 배팅 금액)
          result: participant.accumulatedReward || 0, // 사용자가 게임에서 얻은 순수익 (누적 보상)
          exitedAt: participant.exitedAt,
          exitReason: participant.exitReason,
          createdAt: game.createdAt,
          finishedAt: game.resultCalculatedAt || (game.status === 'finished' ? game.createdAt : 0), // 완료되지 않은 게임은 0
          totalPot: game.totalPot || 0,
          roundChoices: roundChoices, // 라운드별 선택 배열 추가
          // 라운드별 결과 정보 (완료되지 않은 게임은 빈 배열)
          rounds: [] as Array<{
            round: number;
            wasWinner: boolean;
            wasEliminated: boolean;
          }>
        };
        
        // 히스토리 포맷팅 적용 (영어 텍스트 추가)
        const formattedHistory = formatGoldenBellHistory(userGameHistory);

        // 라운드별 결과 확인 (데이터베이스에서 직접 조회, 완료되지 않은 게임은 빈 배열)
        if (game.status === 'finished') {
          const resultsSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}/results`).once('value');
          const results = normalizeRoundResults(resultsSnapshot.val());
          
          if (results && Object.keys(results).length > 0) {
            for (const [roundStr, result] of Object.entries(results) as [string, GoldenBellResult][]) {
              const round = parseInt(roundStr);
              const winnersArray = toSafeArray<string>(result.winners);
              const eliminatedArray = toSafeArray<string>(result.eliminatedParticipants);
              const wasWinner = winnersArray.includes(uid);
              const wasEliminated = eliminatedArray.includes(uid);
              
              userGameHistory.rounds.push({
                round,
                wasWinner,
                wasEliminated
              });
            }
          }
        }

        userHistory.push(formattedHistory);
      }
    }

    // 최신순 정렬 (createdAt 또는 startAt 또는 finishedAt 기준)
    userHistory.sort((a, b) => {
      const aTime = a.createdAt || a.finishedAt || 0;
      const bTime = b.createdAt || b.finishedAt || 0;
      return bTime - aTime;
    });
    
    // limit 적용
    const limitedHistory = userHistory.slice(0, limit);
    
    console.log(`[getGoldenBellHistory] Returning ${limitedHistory.length} history items for user ${uid} (total found: ${userHistory.length}, limit: ${limit})`);
    
    return {
      success: true,
      history: limitedHistory
    };

  } catch (error) {
    console.error('[getGoldenBellHistory] Get Golden Bell history failed:', error);
    throw new Error('Failed to get game history');
  }
});

// 골든벨 게임 라운드별 보상 정보 조회
export const getGoldenBellRoundRewards = onRequest({ cors: true }, async (req, res) => {
  // CORS 헤더 설정
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  
  try {
    // POST 요청에서 데이터 추출 (Unity 브릿지에서 직접 호출하는 경우도 고려)
    let rawBody: any = req.body;

    if (typeof rawBody === 'string') {
      try {
        rawBody = JSON.parse(rawBody);
      } catch (parseError) {
        console.error('[getGoldenBellRoundRewards] Invalid JSON body:', parseError);
        res.status(400).json({
          success: false,
          error: 'Invalid JSON body'
        });
        return;
      }
    }

    const bodyData = rawBody?.data ?? rawBody ?? {};
    const { gameId } = bodyData as { gameId?: string };

    if (!gameId) {
      res.status(400).json({
        success: false,
        error: 'gameId is required'
      });
      return;
    }
    
    console.log(`[getGoldenBellRoundRewards] Getting round rewards for game: ${gameId}`);
    
    // 이미 저장된 라운드별 보상 정보 조회
    const resultsSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}/results`).once('value');
    const results = resultsSnapshot.val() || {};
    
    const roundRewards = [];
    
    for (const [roundStr, result] of Object.entries(results)) {
      const round = parseInt(roundStr);
      const rewardData = (result as any).reward; // storeGoldenBellRoundReward에서 저장한 데이터
      
      if (rewardData && round > 0) {
        const totalPot = rewardData.opponentPot || 0; // 기본 상금
        const vipBonus = rewardData.vipBonusTotal || 0;
        const totalWithBonus = totalPot + vipBonus;
        
        roundRewards.push({
          round,
          totalPot: totalWithBonus, // VIP 보너스 포함된 총 상금
          vipBonus,
          vipWinnerCount: rewardData.vipWinnerCount || 0,
          winnerCount: rewardData.winnerCount || 0,
          baseReward: totalPot
        });
      }
    }
    
    // 라운드 데이터가 없으면 Round 1 기준으로 0원 보상 반환
    if (roundRewards.length === 0) {
      roundRewards.push({
        round: 1,
        totalPot: 0,
        vipBonus: 0,
        vipWinnerCount: 0,
        winnerCount: 0,
        baseReward: 0
      });
    }

    // 라운드 순서대로 정렬
    roundRewards.sort((a, b) => a.round - b.round);
    
    console.log(`[getGoldenBellRoundRewards] Found ${roundRewards.length} round rewards for game ${gameId}`);
    
    const payload = {
      success: true,
      roundRewards,
      gameId
    };

    // Firebase callable 클라이언트 호환을 위해 data 필드도 포함
    res.json({
      ...payload,
      data: payload
    });
  } catch (error) {
    console.error(`[getGoldenBellRoundRewards] Error:`, error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorPayload = {
      success: false,
      error: `Failed to get round rewards: ${errorMessage}`
    };
    res.status(500).json({
      ...errorPayload,
      data: errorPayload
    });
  }
});

// 골든벨 게임 생성 (스케줄러 또는 클라이언트에서 호출)
function buildDailySlotTimestamps(targetDate: Date): number[] {
  const slots: number[] = [];
  const year = targetDate.getUTCFullYear();
  const month = targetDate.getUTCMonth();
  const day = targetDate.getUTCDate();

  for (let hour = 0; hour < 24; hour++) {
    for (const minute of GOLDEN_BELL_SLOT_MINUTES) {
      const startAt = Date.UTC(year, month, day, hour, minute, 0, 0);
      slots.push(startAt);
    }
  }

  return slots;
}

function normalizeUtcDate(dateParam?: string): { date: Date; label: string } {
  const baseDate = dateParam ? new Date(`${dateParam}T00:00:00Z`) : new Date();
  const normalized = new Date(Date.UTC(
    baseDate.getUTCFullYear(),
    baseDate.getUTCMonth(),
    baseDate.getUTCDate(),
    0, 0, 0, 0
  ));

  const label = normalized.toISOString().substring(0, 10); // YYYY-MM-DD
  return { date: normalized, label };
}

export async function createDailyGoldenBellGames(dateParam?: string) {
  const { date: targetDate, label: dateLabel } = normalizeUtcDate(dateParam);
  console.log(`[createDailyGoldenBellGames] Generating schedule for ${dateLabel}`);

  const slotStartTimes = buildDailySlotTimestamps(targetDate);
  const gamesSnapshot = await rtdb.ref('/games/goldenbell').once('value');
  const games = gamesSnapshot.val() || {};

  const existingByStartAt = new Map<number, string>();
  Object.entries(games).forEach(([gameId, game]: [string, any]) => {
    const normalizedStartAt = normalizeStartAt(game?.startAt, gameId);
    if (typeof normalizedStartAt === 'number') {
      existingByStartAt.set(normalizedStartAt, gameId);
    }
  });

  const updates: Record<string, GoldenBellGame> = {};
  const createdGameIds: string[] = [];
  const skipped: Array<{ startAt: number; reason: string }> = [];

  for (const startAt of slotStartTimes) {
    if (existingByStartAt.has(startAt)) {
      skipped.push({ startAt, reason: 'existing' });
      continue;
    }

    const gameId = `goldenbell_${startAt}`;
    const now = Date.now();

    const newGame: GoldenBellGame = {
      gameId,
      status: 'waiting',
      round: 1,
      maxRounds: 10,
      participants: {},
      waitingRoom: {},
      teams: {
        PLAYER: {},
        BANKER: {}
      },
      totalPot: 0,
      currentBetAmount: 1,
      maxParticipants: 2047,
      startAt,
      bettingStartAt: 0,
      bettingEndAt: 0,
      createdAt: now,
      schedule: 'daily_pre_generated'
    };

    updates[`/games/goldenbell/${gameId}`] = newGame;
    createdGameIds.push(gameId);
    existingByStartAt.set(startAt, gameId);
  }

  if (Object.keys(updates).length > 0) {
    await rtdb.ref().update(updates);
  }

  console.log(`[createDailyGoldenBellGames] Created ${createdGameIds.length} games, skipped ${skipped.length} for ${dateLabel}`);

  return {
    date: dateLabel,
    createdCount: createdGameIds.length,
    skippedCount: skipped.length,
    createdGameIds
  };
}

export const createDailyGoldenBellGamesCallable = onCall({ invoker: 'public' }, async (request: CallableRequest<{ date?: string }>) => {
  try {
    const { date } = request.data || {};
    const result = await createDailyGoldenBellGames(date);

    return {
      success: true,
      ...result
    };
  } catch (error) {
    console.error('[createDailyGoldenBellGamesCallable] Error:', error);
    throw new HttpsError('internal', 'Failed to create daily Golden Bell games');
  }
});

export async function ensureTodayGoldenBellSchedule(): Promise<void> {
  const { label: dateLabel } = normalizeUtcDate();
  const slotStartTimes = buildDailySlotTimestamps(new Date());

  const gamesSnapshot = await rtdb.ref('/games/goldenbell').once('value');
  const games = gamesSnapshot.val() || {};

  let missingCount = 0;
  let futureCount = 0;

  for (const startAt of slotStartTimes) {
    const exists = Object.entries(games).some(([gameId, game]: [string, any]) => {
      const normalizedStartAt = normalizeStartAt(game?.startAt, gameId);
      return typeof normalizedStartAt === 'number' && normalizedStartAt === startAt;
    });
    if (!exists) {
      missingCount++;
      if (startAt >= Date.now()) {
        futureCount++;
      }
    }
  }

  if (futureCount > 0) {
    console.warn(`[ensureTodayGoldenBellSchedule] Detected ${futureCount} missing future slots on ${dateLabel}. Regenerating...`);
    await createDailyGoldenBellGames();
  } else {
    console.log(`[ensureTodayGoldenBellSchedule] All future slots present for ${dateLabel}. Missing total: ${missingCount}`);
  }
}

export async function createGoldenBellGame() {
    try {
      // 이미 활성 게임이 있는지 확인
      const existingGame = await getCurrentGoldenBellGame();
      if (existingGame) {
        console.log(`Active game already exists: ${existingGame.gameId}`);
        return existingGame.gameId;
      }
      
      const gameId = `goldenbell_${Date.now()}`;
      const now = Date.now();
      
      // UTC 00:05 기준 10분마다 게임 시작 시간 계산
      const gameStartTime = getNextGoldenBellTime();
      
      const newGame: GoldenBellGame = {
        gameId,
        status: 'waiting',
        round: 1,
        maxRounds: 10,
        maxParticipants: 2047,
        participants: {},
        waitingRoom: {},
        teams: {
          PLAYER: {},
          BANKER: {}
        },
        totalPot: 0,
        currentBetAmount: 1, // 첫 라운드는 1달러
        startAt: gameStartTime, // 게임 시작 시간
        bettingStartAt: 0,
        bettingEndAt: 0,
        nextRoundStartAt: now + 60000, // 1분 후 첫 라운드 시작
        createdAt: now,
        schedule: "5/10 * * * *"
      };

      await rtdb.ref(`/games/goldenbell/${gameId}`).set(newGame);
      
      console.log(`New Golden Bell game created: ${gameId}, startAt: ${gameStartTime}, first round starts in 1 minute`);
      return gameId;
      
    } catch (error) {
      console.error('Failed to create Golden Bell game:', error);
      throw error;
    }
}

// 클라이언트에서 호출 가능한 Callable Function
export const createGoldenBellGameCallable = onCall({ invoker: 'public' }, async (request: CallableRequest) => {
  try {
    console.log('[createGoldenBellGameCallable] Client requested game creation');
    const gameId = await createGoldenBellGame();
    
    return {
      success: true,
      gameId: gameId,
      message: 'Game created successfully'
    };
  } catch (error) {
    console.error('[createGoldenBellGameCallable] Error:', error);
    throw new HttpsError('internal', 'Failed to create game');
  }
});

// Unity에서 호출하는 게임 목록 가져오기 함수
export const fetchGoldenBellUpcomingGames = onCall({ invoker: 'public' }, async (request: CallableRequest) => {

  const { limit = 20, includeFinished = false } = request.data || {};
  
  try {
    console.log(`[fetchGoldenBellUpcomingGames] Fetching games - limit: ${limit}, includeFinished: ${includeFinished}`);
    
    // 디버깅: 전체 데이터 구조 확인
    const rootSnapshot = await rtdb.ref('/games').once('value');
    const rootData = rootSnapshot.val();
    console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Available game types:`, Object.keys(rootData || {}));
    
    const gamesRef = rtdb.ref('/games/goldenbell');
    
    // 디버깅: 골든벨 게임 존재 여부 확인
    const existsSnapshot = await gamesRef.once('value');
    console.log(`[fetchGoldenBellUpcomingGames] DEBUG - GoldenBell games exist:`, existsSnapshot.exists());
    if (existsSnapshot.exists()) {
      const allGames = existsSnapshot.val();
      const gameIds = Object.keys(allGames);
      console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Found ${gameIds.length} total games:`, gameIds.slice(0, 10));
      
      // 시간 기준으로 정렬해서 과거/미래 게임 확인
      const sortedGames = gameIds
        .map(id => ({ id, startAt: allGames[id].startAt || 0 }))
        .sort((a, b) => b.startAt - a.startAt);
      
      const pastGames = sortedGames.filter(g => g.startAt <= now);
      const futureGames = sortedGames.filter(g => g.startAt > now);
      
      console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Past games: ${pastGames.length}, Future games: ${futureGames.length}`);
      console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Recent past games:`, pastGames.slice(0, 3).map(g => `${g.id} (${g.startAt})`));
      console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Upcoming games:`, futureGames.slice(0, 3).map(g => `${g.id} (${g.startAt})`));
    }
    
    // 전체 게임을 가져온 후 Functions에서 필터링
    const now = Date.now();
    console.info(`[fetchGoldenBellUpcomingGames] DEBUG - Current time: ${now}, fetching all games`);
    
    const gamesSnapshot = await gamesRef.once('value');
    const allGamesData = gamesSnapshot.val() || {};
    console.info(`[fetchGoldenBellUpcomingGames] DEBUG - Total games in DB: ${Object.keys(allGamesData).length}`);
    
    const games = [];
    
    for (const [gameId, game] of Object.entries(allGamesData)) {
      if (game && typeof game === 'object') {
        const g = game as any;
        
        // 모든 게임을 포함 (현재 시간 기준 가까운 게임들)
        
        const gameSnapshot = {
          gameId,
          startAt: g.startAt || 0,
          status: g.status || 'waiting',
          round: g.round || 1,
          maxRounds: g.maxRounds || 10,
          participantCount: Object.keys(g.participants || {}).length,
          maxParticipants: g.maxParticipants || 2047,
          totalPot: g.totalPot || 0,
          currentBetAmount: g.currentBetAmount || 1,
          createdAt: g.createdAt || g.startAt || 0,
          bettingStartAt: g.bettingStartAt || 0,
          bettingEndAt: g.bettingEndAt || 0,
          nextRoundStartAt: g.nextRoundStartAt || 0
        };
        
        games.push(gameSnapshot);
      }
    }
    
    // 디버깅: 과거/미래 게임 분포 확인
    const pastGamesCount = games.filter(g => g.startAt <= now).length;
    const futureGamesCount = games.filter(g => g.startAt > now).length;
    console.info(`[fetchGoldenBellUpcomingGames] DEBUG - Games distribution: Past: ${pastGamesCount}, Future: ${futureGamesCount}`);
    
    // 현재 시간과의 거리 기준으로 정렬 (가장 가까운 게임부터)
    games.sort((a, b) => Math.abs(a.startAt - now) - Math.abs(b.startAt - now));
    
    // 디버깅: 실제 반환되는 게임들 확인
    console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Games before limit (sorted by proximity):`, 
      games.slice(0, 10).map(g => `${g.gameId} (${g.startAt}, diff: ${Math.abs(g.startAt - now)}ms)`));
    
    // limit 적용 (기본 10개로 제한)
    const effectiveLimit = Math.min(limit || 10, 10);
    const limitedGames = games.slice(0, effectiveLimit);
    
    console.log(`[fetchGoldenBellUpcomingGames] Returning ${limitedGames.length} games`);
    console.log(`[fetchGoldenBellUpcomingGames] DEBUG - Final games:`, limitedGames.slice(0, 5).map(g => `${g.gameId} (${g.startAt})`));
    
    return {
      success: true,
      games: limitedGames,
      timestamp: now
    };
  } catch (error) {
    console.error('[fetchGoldenBellUpcomingGames] Error:', error);
    throw new HttpsError('internal', 'Failed to fetch games');
  }
});

// Unity에서 호출하는 참가자 정보 가져오기 함수
export const fetchGoldenBellParticipants = onCall({ invoker: 'public' }, async (request: CallableRequest) => {

  const { gameId } = request.data;
  
  if (!gameId) {
    throw new HttpsError('invalid-argument', 'gameId is required');
  }

  try {
    console.log(`[fetchGoldenBellParticipants] Fetching participants for game: ${gameId}`);
    
    const gameSnapshot = await rtdb.ref(`/games/goldenbell/${gameId}`).once('value');
    const game = gameSnapshot.val();
    
    if (!game) {
      console.log(`[fetchGoldenBellParticipants] Game not found: ${gameId}`);
      return {
        success: true,
        gameId,
        participants: []
      };
    }

    // 모든 참가자 데이터 수집 (대기실, 팀, 활성 참가자)
    const participants = [];
    
    // 활성 참가자 (게임 진행 중인 참가자)
    const activeParticipants = game.participants || {};
    for (const [uid, participant] of Object.entries(activeParticipants)) {
      if (participant && typeof participant === 'object') {
        const p = participant as any;
        participants.push({
          uid,
          choice: p.choice || '',
          totalBet: p.totalBet || 0,
          accumulatedReward: p.accumulatedReward || 0,
          isActive: p.isActive !== false,
          currentRound: p.currentRound || 1,
          joinedRound: p.joinedRound || 1,
          ...p
        });
      }
    }
    
    // 대기실 참가자도 포함 (아직 게임에 참여하지 않은 경우)
    const waitingRoom = game.waitingRoom || {};
    for (const [uid, participant] of Object.entries(waitingRoom)) {
      if (participant && typeof participant === 'object' && !participants.find(p => p.uid === uid)) {
        const p = participant as any;
        participants.push({
          uid,
          choice: '',
          totalBet: 0,
          accumulatedReward: 0,
          isActive: true,
          currentRound: 1,
          joinedRound: 1,
          ...p
        });
      }
    }
    
    // 팀 참가자도 포함 (팀 선택 단계)
    const teams = game.teams || { PLAYER: {}, BANKER: {} };
    for (const teamName of ['PLAYER', 'BANKER']) {
      const teamMembers = teams[teamName] || {};
      for (const [uid, participant] of Object.entries(teamMembers)) {
        if (participant && typeof participant === 'object' && !participants.find(p => p.uid === uid)) {
          const p = participant as any;
          participants.push({
            uid,
            choice: teamName.toLowerCase() === 'player' ? 'even' : 'odd',
            totalBet: p.totalBet || 0,
            accumulatedReward: p.accumulatedReward || 0,
            isActive: p.isActive !== false,
            currentRound: p.currentRound || 1,
            joinedRound: p.joinedRound || 1,
            ...p
          });
        }
      }
    }

    console.log(`[fetchGoldenBellParticipants] Found ${participants.length} participants for game ${gameId}`);

    return {
      success: true,
      gameId,
      participants
    };
  } catch (error) {
    console.error('[fetchGoldenBellParticipants] Error:', error);
    throw new HttpsError('internal', 'Failed to fetch participants');
  }
});
