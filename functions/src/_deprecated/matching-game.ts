// Matching Game Logic (ORDER and RANDOM)
import * as admin from 'firebase-admin';

const rtdb = admin.database();

// Types for Matching Game
interface MatchingGame {
  id: string;
  type: 'ORDER' | 'RANDOM';
  status: 'active' | 'closed' | 'settling' | 'finished';
  startAt: number;
  endAt: number;
  winningNumbers: number[];
  participants: { [uid: string]: MatchingParticipant };
  totalPool: number;
  winners: MatchingWinner[];
  createdAt: number;
}

interface MatchingParticipant {
  uid: string;
  bets: MatchingBet[];
  totalBetAmount: number;
  joinedAt: number;
}

interface MatchingBet {
  id: string;
  numbers: number[];
  type: 'auto' | 'manual' | 'semi-auto';
  amount: number;
  placedAt: number;
  manualPositions?: number[]; // semi-auto의 경우 수동 선택한 위치
}

interface MatchingWinner {
  uid: string;
  rank: number;
  matchCount: number;
  reward: number;
  matchedNumbers: number[];
}

// Matching Game Manager
export class MatchingGameManager {
  private gameRef: admin.database.Reference;
  
  constructor() {
    this.gameRef = rtdb.ref('/games/matching');
  }

  // 새 ORDER 게임 생성 (24시간마다)
  async createOrderGame(): Promise<string> {
    try {
      const gameId = `order_${Date.now()}`;
      const now = Date.now();
      const endTime = now + (24 * 60 * 60 * 1000) - (60 * 1000); // 24시간 - 1분 (마감)
      
      const newGame: MatchingGame = {
        id: gameId,
        type: 'ORDER',
        status: 'active',
        startAt: now,
        endAt: endTime,
        winningNumbers: [],
        participants: {},
        totalPool: 0,
        winners: [],
        createdAt: now
      };

      await this.gameRef.child(`order/${gameId}`).set(newGame);
      await this.gameRef.child('currentOrder').set(gameId);
      
      // 마감 시간 설정
      setTimeout(async () => {
        await this.closeGame(gameId, 'ORDER');
      }, 24 * 60 * 60 * 1000 - 60 * 1000);
      
      console.log(`New ORDER game created: ${gameId}`);
      return gameId;
    } catch (error) {
      console.error('Failed to create ORDER game:', error);
      throw error;
    }
  }

  // 새 RANDOM 게임 생성 (6시간마다)
  async createRandomGame(): Promise<string> {
    try {
      const gameId = `random_${Date.now()}`;
      const now = Date.now();
      const endTime = now + (6 * 60 * 60 * 1000) - (60 * 1000); // 6시간 - 1분 (마감)
      
      const newGame: MatchingGame = {
        id: gameId,
        type: 'RANDOM',
        status: 'active',
        startAt: now,
        endAt: endTime,
        winningNumbers: [],
        participants: {},
        totalPool: 0,
        winners: [],
        createdAt: now
      };

      await this.gameRef.child(`random/${gameId}`).set(newGame);
      await this.gameRef.child('currentRandom').set(gameId);
      
      // 마감 시간 설정
      setTimeout(async () => {
        await this.closeGame(gameId, 'RANDOM');
      }, 6 * 60 * 60 * 1000 - 60 * 1000);
      
      console.log(`New RANDOM game created: ${gameId}`);
      return gameId;
    } catch (error) {
      console.error('Failed to create RANDOM game:', error);
      throw error;
    }
  }

  // 게임 참여 (베팅)
  async placeBet(
    uid: string, 
    gameType: 'ORDER' | 'RANDOM', 
    numbers: number[], 
    betType: 'auto' | 'manual' | 'semi-auto',
    manualPositions?: number[]
  ): Promise<boolean> {
    try {
      // 현재 활성 게임 조회
      const currentGameId = await this.getCurrentGameId(gameType);
      if (!currentGameId) {
        throw new Error(`No active ${gameType} game available`);
      }

      const gameRef = gameType === 'ORDER' 
        ? this.gameRef.child(`order/${currentGameId}`)
        : this.gameRef.child(`random/${currentGameId}`);

      const gameSnapshot = await gameRef.once('value');
      const game = gameSnapshot.val() as MatchingGame;

      // 게임 상태 확인
      if (game.status !== 'active') {
        throw new Error('Game is not accepting bets');
      }

      // 마감 시간 확인
      if (Date.now() >= game.endAt) {
        throw new Error('Betting time has ended');
      }

      // 베팅 금액 확인 및 차감 ($2)
      const betAmount = 2;
      const paymentSuccess = await this.debitBetAmount(uid, betAmount);
      if (!paymentSuccess) {
        throw new Error('Insufficient balance for betting');
      }

      // 베팅 정보 생성
      const betId = `bet_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const bet: MatchingBet = {
        id: betId,
        numbers: numbers.length === 7 ? numbers : this.generateNumbers(betType, manualPositions),
        type: betType,
        amount: betAmount,
        placedAt: Date.now(),
        manualPositions: manualPositions
      };

      // 참여자 정보 업데이트
      const participantRef = gameRef.child(`participants/${uid}`);
      const participantSnapshot = await participantRef.once('value');
      
      if (participantSnapshot.exists()) {
        const participant = participantSnapshot.val() as MatchingParticipant;
        participant.bets.push(bet);
        participant.totalBetAmount += betAmount;
        await participantRef.set(participant);
      } else {
        const newParticipant: MatchingParticipant = {
          uid,
          bets: [bet],
          totalBetAmount: betAmount,
          joinedAt: Date.now()
        };
        await participantRef.set(newParticipant);
      }

      // 총 풀 금액 업데이트
      await gameRef.child('totalPool').transaction(current => (current || 0) + betAmount);

      console.log(`Bet placed for user ${uid} in ${gameType} game ${currentGameId}`);
      return true;
    } catch (error) {
      console.error(`Failed to place bet for user ${uid}:`, error);
      return false;
    }
  }

  // 숫자 생성 (자동/반자동)
  private generateNumbers(betType: 'auto' | 'manual' | 'semi-auto', manualPositions?: number[]): number[] {
    const numbers = new Array(7);
    
    if (betType === 'auto') {
      // 완전 자동 - 모든 위치 랜덤
      for (let i = 0; i < 7; i++) {
        numbers[i] = Math.floor(Math.random() * 10);
      }
    } else if (betType === 'semi-auto' && manualPositions) {
      // 반자동 - 일부는 수동, 나머지는 자동
      for (let i = 0; i < 7; i++) {
        if (manualPositions[i] !== undefined) {
          numbers[i] = manualPositions[i];
        } else {
          numbers[i] = Math.floor(Math.random() * 10);
        }
      }
    }
    
    return numbers;
  }

  // 게임 마감
  async closeGame(gameId: string, gameType: 'ORDER' | 'RANDOM'): Promise<void> {
    try {
      const gameRef = gameType === 'ORDER' 
        ? this.gameRef.child(`order/${gameId}`)
        : this.gameRef.child(`random/${gameId}`);

      await gameRef.child('status').set('closed');
      
      // 정산 시작 (5-10분 후)
      const settlementDelay = Math.floor(Math.random() * 5 + 5) * 60 * 1000; // 5-10분
      setTimeout(async () => {
        await this.settleGame(gameId, gameType);
      }, settlementDelay);

      console.log(`${gameType} game ${gameId} closed, settlement in ${settlementDelay/1000/60} minutes`);
    } catch (error) {
      console.error(`Failed to close ${gameType} game ${gameId}:`, error);
    }
  }

  // 게임 정산
  async settleGame(gameId: string, gameType: 'ORDER' | 'RANDOM'): Promise<void> {
    try {
      const gameRef = gameType === 'ORDER' 
        ? this.gameRef.child(`order/${gameId}`)
        : this.gameRef.child(`random/${gameId}`);

      await gameRef.child('status').set('settling');

      // 당첨 번호 결정 (현재 시점의 7종 코인 가격 기준)
      const winningNumbers = await this.determineWinningNumbers();
      await gameRef.child('winningNumbers').set(winningNumbers);

      // 승자 결정 및 상금 배분
      const winners = await this.calculateWinners(gameId, gameType, winningNumbers);
      await gameRef.child('winners').set(winners);

      // 상금 지급
      await this.distributeRewards(winners);

      await gameRef.child('status').set('finished');

      // 새 게임 생성
      if (gameType === 'ORDER') {
        await this.createOrderGame();
      } else {
        await this.createRandomGame();
      }

      console.log(`${gameType} game ${gameId} settled with winning numbers:`, winningNumbers);
    } catch (error) {
      console.error(`Failed to settle ${gameType} game ${gameId}:`, error);
    }
  }

  // 당첨 번호 결정
  private async determineWinningNumbers(): Promise<number[]> {
    try {
      const oracleSnapshot = await rtdb.ref('/oracle/current/gameNumbers').once('value');
      const gameNumbers = oracleSnapshot.val();

      if (!gameNumbers) {
        throw new Error('Game numbers not available');
      }

      // BTC, ETH, XRP, BNB, SOL, DOGE, TRX 순서로 당첨 번호 생성
      const coinOrder = ['BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'DOGE', 'TRX'];
      const winningNumbers: number[] = [];

      for (const coin of coinOrder) {
        if (gameNumbers[coin] !== undefined) {
          winningNumbers.push(gameNumbers[coin]);
        } else {
          // 데이터가 없는 경우 랜덤으로 생성
          winningNumbers.push(Math.floor(Math.random() * 10));
        }
      }

      return winningNumbers;
    } catch (error) {
      console.error('Failed to determine winning numbers:', error);
      // 오류 발생 시 랜덤 번호 생성
      return Array.from({ length: 7 }, () => Math.floor(Math.random() * 10));
    }
  }

  // 승자 계산
  private async calculateWinners(gameId: string, gameType: 'ORDER' | 'RANDOM', winningNumbers: number[]): Promise<MatchingWinner[]> {
    const gameRef = gameType === 'ORDER' 
      ? this.gameRef.child(`order/${gameId}`)
      : this.gameRef.child(`random/${gameId}`);

    const gameSnapshot = await gameRef.once('value');
    const game = gameSnapshot.val() as MatchingGame;

    const winners: MatchingWinner[] = [];
    const participants = game.participants || {};

    // 각 참여자의 베팅을 확인하여 승자 결정
    Object.values(participants).forEach(participant => {
      participant.bets.forEach(bet => {
        const matchResult = this.calculateMatches(bet.numbers, winningNumbers, gameType);
        
        if (matchResult.isWinner) {
          winners.push({
            uid: participant.uid,
            rank: matchResult.rank,
            matchCount: matchResult.matchCount,
            reward: 0, // 나중에 계산
            matchedNumbers: matchResult.matchedNumbers
          });
        }
      });
    });

    // 등급별로 그룹화하고 상금 계산
    const winnersByRank = this.groupWinnersByRank(winners);
    const rewardsCalculated = await this.calculateRewards(winnersByRank, game.totalPool, gameType);

    return rewardsCalculated;
  }

  // 매칭 계산
  private calculateMatches(betNumbers: number[], winningNumbers: number[], gameType: 'ORDER' | 'RANDOM'): {
    isWinner: boolean;
    rank: number;
    matchCount: number;
    matchedNumbers: number[];
  } {
    let matchCount = 0;
    const matchedNumbers: number[] = [];

    if (gameType === 'ORDER') {
      // ORDER: 순서와 숫자 모두 일치
      for (let i = 0; i < 7; i++) {
        if (betNumbers[i] === winningNumbers[i]) {
          matchCount++;
          matchedNumbers.push(i);
        }
      }
      
      return {
        isWinner: matchCount === 7,
        rank: matchCount === 7 ? 1 : 0,
        matchCount,
        matchedNumbers
      };
    } else {
      // RANDOM: 숫자만 일치 (순서 무관)
      const winningSet = [...winningNumbers];
      const betSet = [...betNumbers];
      
      betSet.forEach((num, index) => {
        const winningIndex = winningSet.indexOf(num);
        if (winningIndex !== -1) {
          matchCount++;
          matchedNumbers.push(index);
          winningSet[winningIndex] = -1; // 중복 매칭 방지
        }
      });

      // PRD 등급 시스템
      let rank = 0;
      if (matchCount === 7) rank = 1;      // 1등: 7개 일치
      else if (matchCount === 6) rank = 2; // 2등: 6개 일치  
      else if (matchCount === 5) rank = 3; // 3등: 5개 일치
      else if (matchCount === 4) rank = 4; // 4등: 4개 일치
      else if (matchCount === 3) rank = 5; // 5등: 3개 일치

      return {
        isWinner: rank > 0,
        rank,
        matchCount,
        matchedNumbers
      };
    }
  }

  // 등급별 승자 그룹화
  private groupWinnersByRank(winners: MatchingWinner[]): Map<number, MatchingWinner[]> {
    const winnersByRank = new Map<number, MatchingWinner[]>();
    
    winners.forEach(winner => {
      if (!winnersByRank.has(winner.rank)) {
        winnersByRank.set(winner.rank, []);
      }
      winnersByRank.get(winner.rank)!.push(winner);
    });

    return winnersByRank;
  }

  // 상금 계산
  private async calculateRewards(winnersByRank: Map<number, MatchingWinner[]>, totalPool: number, gameType: 'ORDER' | 'RANDOM'): Promise<MatchingWinner[]> {
    const rewardRates = gameType === 'ORDER' 
      ? { 1: 1.0 } // ORDER는 1등만 전체 상금
      : { 1: 0.5, 2: 0.15, 3: 0.15, 4: 0.1, 5: 0.1 }; // RANDOM 등급별 배분

    const allWinners: MatchingWinner[] = [];

    for (const [rank, winners] of winnersByRank) {
      const rankRewardRate = rewardRates[rank as keyof typeof rewardRates] || 0;
      const totalRankReward = totalPool * rankRewardRate;
      const rewardPerWinner = winners.length > 0 ? totalRankReward / winners.length : 0;

      winners.forEach(winner => {
        winner.reward = rewardPerWinner;
        allWinners.push(winner);
      });
    }

    return allWinners;
  }

  // 상금 지급
  private async distributeRewards(winners: MatchingWinner[]): Promise<void> {
    for (const winner of winners) {
      if (winner.reward > 0) {
        // 당첨금 배분 (20% 차감 후 실제 지급)
        const { distributeWinningRewards } = await import('./reward-system');
        await distributeWinningRewards(winner.uid, winner.reward);
        
        console.log(`Reward ${winner.reward} distributed to user ${winner.uid} (Rank ${winner.rank})`);
      }
    }
  }

  // Helper methods
  private async getCurrentGameId(gameType: 'ORDER' | 'RANDOM'): Promise<string | null> {
    const refName = gameType === 'ORDER' ? 'currentOrder' : 'currentRandom';
    const snapshot = await this.gameRef.child(refName).once('value');
    return snapshot.val();
  }

  private async debitBetAmount(uid: string, amount: number): Promise<boolean> {
    const { debitWithIvyPriority } = await import('./reward-system');
    return await debitWithIvyPriority(uid, amount);
  }

  // 게임 히스토리 조회
  async getGameHistory(gameType: 'ORDER' | 'RANDOM', limit: number = 10): Promise<MatchingGame[]> {
    try {
      const refPath = gameType === 'ORDER' ? 'order' : 'random';
      const snapshot = await this.gameRef.child(refPath)
        .orderByChild('createdAt')
        .limitToLast(limit)
        .once('value');
      
      const games = snapshot.val() || {};
      return Object.values(games).filter((game: any) => game.status === 'finished');
    } catch (error) {
      console.error(`Failed to get ${gameType} game history:`, error);
      return [];
    }
  }

  // 사용자 베팅 히스토리 조회
  async getUserBetHistory(uid: string, gameType: 'ORDER' | 'RANDOM', limit: number = 10): Promise<any[]> {
    try {
      const refPath = gameType === 'ORDER' ? 'order' : 'random';
      const snapshot = await this.gameRef.child(refPath).once('value');
      const games = snapshot.val() || {};
      
      const userBets: any[] = [];
      
      Object.values(games).forEach((game: any) => {
        if (game.participants && game.participants[uid]) {
          const participant = game.participants[uid];
          participant.bets.forEach((bet: MatchingBet) => {
            userBets.push({
              gameId: game.id,
              gameType: game.type,
              bet,
              winningNumbers: game.winningNumbers,
              gameStatus: game.status,
              gameEndTime: game.endAt
            });
          });
        }
      });

      return userBets
        .sort((a, b) => b.bet.placedAt - a.bet.placedAt)
        .slice(0, limit);
    } catch (error) {
      console.error(`Failed to get user bet history for ${uid}:`, error);
      return [];
    }
  }
}