// Cube Game Logic (VIP Binary Tree System)
import * as admin from 'firebase-admin';

const rtdb = admin.database();

// Types for Cube Game
interface CubeGame {
  id: string;
  status: 'filling' | 'ready' | 'playing' | 'finished';
  positions: { [position: number]: CubeParticipant };
  positionCount: number;
  maxPositions: number;
  startAt: number;
  finishedAt?: number;
  winningPosition?: number;
  distributionComplete: boolean;
  createdAt: number;
}

interface CubeParticipant {
  uid: string;
  position: number;
  entryFee: number;
  expectedReward: number;
  actualReward?: number;
  joinedAt: number;
}

// interface CubePosition {
//   level: number;
//   index: number;
//   position: number;
//   expectedReward: number;
// }

// Cube Game Manager
export class CubeGameManager {
  private gameRef: admin.database.Reference;
  private readonly ENTRY_FEE = 20;
  private readonly MAX_POSITIONS = 2047;
  
  constructor() {
    this.gameRef = rtdb.ref('/games/cube');
    this.initializeCubeStructure();
  }

  // 큐브 구조 초기화 (바이너리 트리 계산)
  private initializeCubeStructure(): void {
    // 각 포지션별 예상 수익 계산
    // const positionRewards = this.calculatePositionRewards();
    console.log('Cube structure initialized with', this.MAX_POSITIONS, 'positions');
  }

  // 포지션별 예상 수익 계산
  private calculatePositionRewards(): { [position: number]: number } {
    const rewards: { [position: number]: number } = {};
    
    // 바이너리 트리 구조에서 각 레벨별 수익 계산
    // A1 (position 1): 4092달러
    rewards[1] = 4092;
    
    // B1, B2 (positions 2-3): 2044달러씩
    rewards[2] = 2044;
    rewards[3] = 2044;
    
    // 각 레벨별 계산
    let position = 4;
    for (let level = 3; level <= 11; level++) {
      const nodesInLevel = Math.pow(2, level - 1);
      const rewardPerNode = this.calculateRewardForLevel(level);
      
      for (let i = 0; i < nodesInLevel; i++) {
        rewards[position] = rewardPerNode;
        position++;
      }
    }
    
    return rewards;
  }

  // 레벨별 수익 계산
  private calculateRewardForLevel(level: number): number {
    if (level === 1) return 4092; // A1
    if (level === 2) return 2044; // B1, B2
    if (level >= 3 && level <= 9) {
      // C1~I 레벨: 각각 다른 계산
      const rewardMap: { [level: number]: number } = {
        3: 1020, // C level (4개)
        4: 508,  // D level (8개)
        5: 252,  // E level (16개)
        6: 124,  // F level (32개)
        7: 60,   // G level (64개)
        8: 28,   // H level (128개)
        9: 12    // I level (256개)
      };
      return rewardMap[level] || 4;
    }
    if (level === 10) return 4;  // J level (512개)
    return 0; // K level (1024개) - 기부만 하고 받지 못함
  }

  // 새 큐브 게임 생성
  async createNewCubeGame(): Promise<string> {
    try {
      const gameId = `cube_${Date.now()}`;
      const now = Date.now();
      
      const newGame: CubeGame = {
        id: gameId,
        status: 'filling',
        positions: {},
        positionCount: 0,
        maxPositions: this.MAX_POSITIONS,
        startAt: now,
        distributionComplete: false,
        createdAt: now
      };

      await this.gameRef.child(`games/${gameId}`).set(newGame);
      await this.gameRef.child('current').set(gameId);
      
      console.log(`New Cube game created: ${gameId}`);
      return gameId;
    } catch (error) {
      console.error('Failed to create Cube game:', error);
      throw error;
    }
  }

  // VIP 회원 큐브 게임 참여
  async joinCubeGame(uid: string, selectedPosition?: number): Promise<{ success: boolean; position?: number; message?: string }> {
    try {
      // VIP 회원 자격 확인
      const isVip = await this.checkVipStatus(uid);
      if (!isVip) {
        return { success: false, message: 'VIP membership required' };
      }

      // 현재 활성 게임 조회
      const currentGameId = await this.getCurrentGameId();
      if (!currentGameId) {
        throw new Error('No active cube game available');
      }

      const gameRef = this.gameRef.child(`games/${currentGameId}`);
      const gameSnapshot = await gameRef.once('value');
      const game = gameSnapshot.val() as CubeGame;

      // 게임 상태 확인
      if (game.status !== 'filling') {
        return { success: false, message: 'Game is not accepting participants' };
      }

      // 참가비 확인 및 차감
      const paymentSuccess = await this.debitEntryFee(uid, this.ENTRY_FEE);
      if (!paymentSuccess) {
        return { success: false, message: 'Insufficient balance for entry fee' };
      }

      // 포지션 선택 (1분 제한)
      const position = await this.selectPosition(currentGameId, uid, selectedPosition);
      if (!position) {
        // 참가비 환불
        await this.refundEntryFee(uid, this.ENTRY_FEE);
        return { success: false, message: 'Failed to select position' };
      }

      // 참여자 정보 저장
      const participant: CubeParticipant = {
        uid,
        position,
        entryFee: this.ENTRY_FEE,
        expectedReward: this.calculatePositionRewards()[position] || 0,
        joinedAt: Date.now()
      };

      await gameRef.child(`positions/${position}`).set(participant);
      await gameRef.child('positionCount').transaction(count => (count || 0) + 1);

      // 게임이 꽉 찼는지 확인
      if (game.positionCount + 1 >= this.MAX_POSITIONS) {
        await this.prepareGameStart(currentGameId);
      }

      console.log(`User ${uid} joined cube game ${currentGameId} at position ${position}`);
      return { success: true, position };
    } catch (error) {
      console.error(`Failed to join cube game for user ${uid}:`, error);
      return { success: false, message: error.message };
    }
  }

  // 포지션 선택 (1분 제한)
  private async selectPosition(gameId: string, uid: string, preferredPosition?: number): Promise<number | null> {
    const gameRef = this.gameRef.child(`games/${gameId}`);
    const gameSnapshot = await gameRef.once('value');
    const game = gameSnapshot.val() as CubeGame;

    // 선호 포지션이 있고 사용 가능한 경우
    if (preferredPosition && !game.positions[preferredPosition]) {
      return preferredPosition;
    }

    // 자동 배정 - 첫 번째 빈 자리
    for (let i = 1; i <= this.MAX_POSITIONS; i++) {
      if (!game.positions[i]) {
        return i;
      }
    }

    return null; // 빈 자리 없음
  }

  // 게임 시작 준비
  private async prepareGameStart(gameId: string): Promise<void> {
    try {
      const gameRef = this.gameRef.child(`games/${gameId}`);
      
      // 상태 변경
      await gameRef.child('status').set('ready');
      
      // 5분 후 게임 시작
      setTimeout(async () => {
        await this.startCubeGame(gameId);
      }, 5 * 60 * 1000);
      
      console.log(`Cube game ${gameId} is ready, starting in 5 minutes`);
    } catch (error) {
      console.error(`Failed to prepare game start for ${gameId}:`, error);
    }
  }

  // 큐브 게임 시작
  async startCubeGame(gameId: string): Promise<void> {
    try {
      const gameRef = this.gameRef.child(`games/${gameId}`);
      await gameRef.child('status').set('playing');
      
      // 매칭게임 결과를 기반으로 당첨 포지션 결정
      const winningPosition = await this.determineWinningPosition();
      await gameRef.child('winningPosition').set(winningPosition);
      
      // 배당 계산 및 지급
      await this.distributeCubeRewards(gameId, winningPosition);
      
      await gameRef.update({
        status: 'finished',
        finishedAt: Date.now(),
        distributionComplete: true
      });
      
      // 새 게임 생성
      await this.createNewCubeGame();
      
      console.log(`Cube game ${gameId} finished, winning position: ${winningPosition}`);
    } catch (error) {
      console.error(`Failed to start cube game ${gameId}:`, error);
    }
  }

  // 당첨 포지션 결정 (매칭게임 기반)
  private async determineWinningPosition(): Promise<number> {
    try {
      // 가장 최근의 매칭게임 결과 조회
      const oracleSnapshot = await rtdb.ref('/oracle/current/gameNumbers').once('value');
      const gameNumbers = oracleSnapshot.val();
      
      if (!gameNumbers) {
        throw new Error('Game numbers not available');
      }

      // BTC 숫자로 방향 결정 (짝수: 왼쪽, 홀수: 오른쪽)
      const btcNumber = gameNumbers.BTC || 0;
      const direction = btcNumber % 2 === 0 ? 'left' : 'right';
      
      // 나머지 숫자들로 이동할 칸수 계산
      const moveNumbers = [
        gameNumbers.ETH || 0,
        gameNumbers.XRP || 0,
        gameNumbers.BNB || 0,
        gameNumbers.SOL || 0,
        gameNumbers.DOGE || 0,
        gameNumbers.TRX || 0
      ];
      
      // 6자리 숫자 조합
      const moveDistance = parseInt(moveNumbers.join(''));
      
      // 현재 선택된 위치에서 이동
      // 임시로 중앙 위치(1024)에서 시작한다고 가정
      const startPosition = 1024;
      let finalPosition: number;
      
      if (direction === 'left') {
        finalPosition = startPosition - (moveDistance % this.MAX_POSITIONS);
      } else {
        finalPosition = startPosition + (moveDistance % this.MAX_POSITIONS);
      }
      
      // 범위 조정 (순환 구조)
      while (finalPosition < 1) finalPosition += this.MAX_POSITIONS;
      while (finalPosition > this.MAX_POSITIONS) finalPosition -= this.MAX_POSITIONS;
      
      console.log(`Cube game movement: BTC(${btcNumber}) -> ${direction}, Move: ${moveDistance}, Final: ${finalPosition}`);
      return finalPosition;
    } catch (error) {
      console.error('Failed to determine winning position:', error);
      // 오류 시 랜덤 포지션
      return Math.floor(Math.random() * this.MAX_POSITIONS) + 1;
    }
  }

  // 큐브 게임 배당 지급
  private async distributeCubeRewards(gameId: string, winningPosition: number): Promise<void> {
    try {
      const gameRef = this.gameRef.child(`games/${gameId}`);
      const gameSnapshot = await gameRef.once('value');
      const game = gameSnapshot.val() as CubeGame;
      
      const winner = game.positions[winningPosition];
      if (!winner) {
        console.log(`No participant at winning position ${winningPosition}`);
        return;
      }

      // 당첨자에게 해당 포지션의 배당 지급
      const reward = winner.expectedReward;
      if (reward > 0) {
        await this.creditCubeReward(winner.uid, reward);
        
        // 실제 지급 금액 기록
        await gameRef.child(`positions/${winningPosition}/actualReward`).set(reward);
        
        console.log(`Cube game reward ${reward} distributed to user ${winner.uid} at position ${winningPosition}`);
      }
      
      // 회사 귀속 금액 기록 (4092달러)
      const totalPool = this.MAX_POSITIONS * this.ENTRY_FEE; // 40940달러
      const distributedAmount = reward;
      const companyAmount = 4092; // 고정 회사 귀속
      
      await this.recordCompanyRevenue(companyAmount);
      
      console.log(`Cube game distribution: Player(${reward}), Company(${companyAmount}), Total Pool(${totalPool})`);
    } catch (error) {
      console.error(`Failed to distribute cube rewards for game ${gameId}:`, error);
    }
  }

  // Helper methods
  private async checkVipStatus(uid: string): Promise<boolean> {
    try {
      const membershipSnapshot = await rtdb.ref(`/users/${uid}/profile/membership`).once('value');
      return membershipSnapshot.val()?.toLowerCase() === 'vip';
    } catch (error) {
      console.error(`Failed to check VIP status for ${uid}:`, error);
      return false;
    }
  }

  private async getCurrentGameId(): Promise<string | null> {
    const snapshot = await this.gameRef.child('current').once('value');
    return snapshot.val();
  }

  private async debitEntryFee(uid: string, amount: number): Promise<boolean> {
    const { debitWithIvyPriority } = await import('./reward-system');
    return await debitWithIvyPriority(uid, amount);
  }

  private async refundEntryFee(uid: string, amount: number): Promise<void> {
    await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction(current => (current || 0) + amount);
    
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'credit',
      amountUsd: amount,
      meta: { source: 'cube_game_refund' },
      createdAt: Date.now()
    });
  }

  private async creditCubeReward(uid: string, amount: number): Promise<void> {
    // 큐브게임 당첨금도 20% 배분 적용
    const { distributeWinningRewards } = await import('./reward-system');
    await distributeWinningRewards(uid, amount);
  }

  private async recordCompanyRevenue(amount: number): Promise<void> {
    await rtdb.ref('/company/cubeGameRevenue').push({
      amount: amount,
      createdAt: Date.now()
    });
    
    await rtdb.ref('/company/totalRevenue').transaction(current => (current || 0) + amount);
  }

  // 큐브 게임 현황 조회
  async getCubeGameStatus(): Promise<any> {
    try {
      const currentGameId = await this.getCurrentGameId();
      if (!currentGameId) {
        return { status: 'no_game' };
      }

      const gameSnapshot = await this.gameRef.child(`games/${currentGameId}`).once('value');
      const game = gameSnapshot.val() as CubeGame;
      
      return {
        gameId: currentGameId,
        status: game.status,
        positionCount: game.positionCount,
        maxPositions: game.maxPositions,
        availablePositions: game.maxPositions - game.positionCount,
        startAt: game.startAt,
        timeRemaining: this.calculateTimeRemaining(game)
      };
    } catch (error) {
      console.error('Failed to get cube game status:', error);
      return { status: 'error' };
    }
  }

  private calculateTimeRemaining(game: CubeGame): number {
    const now = Date.now();
    
    if (game.status === 'filling') {
      return -1; // 무제한 대기
    } else if (game.status === 'ready') {
      // 5분 카운트다운
      const gameStartTime = game.startAt + (5 * 60 * 1000);
      return Math.max(0, gameStartTime - now);
    }
    
    return 0;
  }

  // 사용자의 큐브 게임 히스토리
  async getUserCubeHistory(uid: string, limit: number = 10): Promise<any[]> {
    try {
      const gamesSnapshot = await this.gameRef.child('games').once('value');
      const games = gamesSnapshot.val() || {};
      
      const userHistory: any[] = [];
      
      Object.values(games).forEach((game: any) => {
        if (game.status === 'finished') {
          Object.values(game.positions || {}).forEach((position: any) => {
            if (position.uid === uid) {
              userHistory.push({
                gameId: game.id,
                position: position.position,
                entryFee: position.entryFee,
                expectedReward: position.expectedReward,
                actualReward: position.actualReward || 0,
                winningPosition: game.winningPosition,
                isWinner: position.position === game.winningPosition,
                finishedAt: game.finishedAt
              });
            }
          });
        }
      });
      
      return userHistory
        .sort((a, b) => b.finishedAt - a.finishedAt)
        .slice(0, limit);
    } catch (error) {
      console.error(`Failed to get cube history for ${uid}:`, error);
      return [];
    }
  }

  // 포지션별 배당표 조회
  getPositionRewardTable(): { [position: number]: number } {
    return this.calculatePositionRewards();
  }
}