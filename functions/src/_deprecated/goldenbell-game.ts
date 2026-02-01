// Golden Bell Game Logic
import * as admin from 'firebase-admin';

const rtdb = admin.database();

// Types for Golden Bell Game
interface GoldenBellGame {
  id: string;
  status: 'waiting' | 'active' | 'finished';
  startAt: number;
  currentRound: number;
  maxRounds: number;
  participants: string[]; // UIDs
  roundHistory: GoldenBellRound[];
  createdAt: number;
}

interface GoldenBellRound {
  round: number;
  startAt: number;
  endAt: number;
  status: 'choosing' | 'deciding' | 'settling' | 'finished';
  timePhases: {
    choosingStartAt: number;    // 15초 진영 선택 시작
    choosingEndAt: number;      // 25초 진영 선택 종료  
    decidingStartAt: number;    // 25초 진출/포기 결정 시작
    decidingEndAt: number;      // 35초 진출/포기 결정 종료 (자동 진출)
    settlingEndAt: number;      // 40초 정산 완료
  };
  choices: {
    [uid: string]: {
      side: 'PLAYER' | 'BANKER';
      decision?: 'continue' | 'quit';
      choiceTime: number;
      decisionTime?: number;
      currentBetAmount: number; // 현재 라운드까지의 베팅 금액
    };
  };
  results: {
    playerCount: number;
    bankerCount: number;
    winningSide: 'PLAYER' | 'BANKER' | 'TIE' | 'FAILED';
    winners: string[];
    eliminated: string[];
    rewards: { [uid: string]: number };
    isTie: boolean;
    isOneWinner: boolean;
  };
}

interface GoldenBellParticipant {
  uid: string;
  currentBet: number;
  totalWinnings: number;
  isActive: boolean;
  joinedAt: number;
}

// Golden Bell Game Manager
export class GoldenBellGameManager {
  private gameRef: admin.database.Reference;
  
  constructor() {
    this.gameRef = rtdb.ref('/games/goldenbell');
  }

  // 새 게임 생성 (매 10분마다)
  async createNewGame(): Promise<string> {
    try {
      const gameId = `gb_${Date.now()}`;
      const now = Date.now();
      
      const newGame: GoldenBellGame = {
        id: gameId,
        status: 'waiting',
        startAt: now + (5 * 60 * 1000), // 5분 후 시작 (00:05 UTC 기준)
        currentRound: 0,
        maxRounds: 10,
        participants: [],
        roundHistory: [],
        createdAt: now
      };

      await this.gameRef.child(`games/${gameId}`).set(newGame);
      await this.gameRef.child('current').set(gameId);
      
      console.log(`New Golden Bell game created: ${gameId}`);
      return gameId;
    } catch (error) {
      console.error('Failed to create Golden Bell game:', error);
      throw error;
    }
  }

  // 게임 참여
  async joinGame(uid: string): Promise<boolean> {
    try {
      // 현재 게임 조회
      const currentGameId = await this.getCurrentGameId();
      if (!currentGameId) {
        throw new Error('No active game available');
      }

      const gameSnapshot = await this.gameRef.child(`games/${currentGameId}`).once('value');
      const game = gameSnapshot.val() as GoldenBellGame;

      // 참여 조건 확인
      if (game.status !== 'waiting') {
        throw new Error('Game is not accepting participants');
      }

      if (game.participants.length >= 2047) {
        throw new Error('Game is full (max 2047 participants)');
      }

      if (game.participants.includes(uid)) {
        throw new Error('User already joined this game');
      }

      // 참가비 차감 ($1)
      const paymentSuccess = await this.debitParticipationFee(uid, 1);
      if (!paymentSuccess) {
        throw new Error('Insufficient balance for participation');
      }

      // 참여자 추가
      await this.gameRef.child(`games/${currentGameId}/participants`).transaction((participants) => {
        const currentParticipants = participants || [];
        if (!currentParticipants.includes(uid)) {
          currentParticipants.push(uid);
        }
        return currentParticipants;
      });

      // 참여자 정보 저장
      const participant: GoldenBellParticipant = {
        uid,
        currentBet: 1,
        totalWinnings: 0,
        isActive: true,
        joinedAt: Date.now()
      };

      await this.gameRef.child(`games/${currentGameId}/participantDetails/${uid}`).set(participant);

      console.log(`User ${uid} joined Golden Bell game ${currentGameId}`);
      return true;
    } catch (error) {
      console.error(`Failed to join game for user ${uid}:`, error);
      return false;
    }
  }

  // 게임 시작
  async startGame(gameId: string): Promise<void> {
    try {
      const gameSnapshot = await this.gameRef.child(`games/${gameId}`).once('value');
      const game = gameSnapshot.val() as GoldenBellGame;

      if (game.participants.length === 0) {
        // 참여자 없음 - 게임 종료
        await this.gameRef.child(`games/${gameId}/status`).set('finished');
        await this.createNewGame(); // 새 게임 생성
        return;
      }

      if (game.participants.length === 1) {
        // 참여자 1명 - $1 반환 후 게임 종료
        await this.refundParticipant(game.participants[0], 1);
        await this.gameRef.child(`games/${gameId}/status`).set('finished');
        await this.createNewGame();
        return;
      }

      // 게임 시작
      await this.gameRef.child(`games/${gameId}`).update({
        status: 'active',
        currentRound: 1,
        startAt: Date.now()
      });

      // 첫 번째 라운드 시작
      await this.startRound(gameId, 1);

      console.log(`Golden Bell game ${gameId} started with ${game.participants.length} participants`);
    } catch (error) {
      console.error(`Failed to start game ${gameId}:`, error);
    }
  }

  // 라운드 시작
  async startRound(gameId: string, roundNumber: number): Promise<void> {
    try {
      const now = Date.now();
      const choosingEndTime = now + (25 * 1000); // 25초 선택 시간
      const roundEndTime = now + (30 * 1000); // 30초 총 시간

      const roundData: Partial<GoldenBellRound> = {
        round: roundNumber,
        startAt: now,
        endAt: roundEndTime,
        status: 'choosing',
        choices: {},
        results: {
          playerCount: 0,
          bankerCount: 0,
          winningSide: 'TIE',
          winners: [],
          eliminated: [],
          rewards: {},
          isTie: false,
          isOneWinner: false
        }
      };

      await this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`).set(roundData);
      await this.gameRef.child(`games/${gameId}/currentRound`).set(roundNumber);

      // 25초 후 선택 시간 종료
      setTimeout(async () => {
        await this.endChoosing(gameId, roundNumber);
      }, 25000);

      // 30초 후 라운드 종료
      setTimeout(async () => {
        await this.endRound(gameId, roundNumber);
      }, 30000);

      console.log(`Round ${roundNumber} started for game ${gameId}`);
    } catch (error) {
      console.error(`Failed to start round ${roundNumber} for game ${gameId}:`, error);
    }
  }

  // 진영 선택
  async makeChoice(gameId: string, roundNumber: number, uid: string, side: 'PLAYER' | 'BANKER'): Promise<boolean> {
    try {
      const roundRef = this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`);
      const roundSnapshot = await roundRef.once('value');
      const round = roundSnapshot.val() as GoldenBellRound;

      // 선택 가능한 상태인지 확인
      if (round.status !== 'choosing') {
        return false;
      }

      // PRD 타이밍 확인: 15초~25초 구간에서만 선택 가능
      const now = Date.now();
      const choiceStartTime = round.timePhases.choosingStartAt; // 15초 시작
      const choiceEndTime = round.timePhases.choosingEndAt;     // 25초 종료
      
      if (now < choiceStartTime || now > choiceEndTime) {
        return false;
      }

      // 참여자인지 확인
      const gameSnapshot = await this.gameRef.child(`games/${gameId}`).once('value');
      const game = gameSnapshot.val() as GoldenBellGame;
      const participantSnapshot = await this.gameRef.child(`games/${gameId}/participantDetails/${uid}`).once('value');
      const participant = participantSnapshot.val() as GoldenBellParticipant;

      if (!participant || !participant.isActive) {
        return false;
      }

      // 현재 베팅 금액 계산 (기본 $1 + 이전 라운드 승리수당)
      const currentBetAmount = participant.currentBet + participant.totalWinnings;

      // 선택 저장
      await roundRef.child(`choices/${uid}`).set({
        side,
        choiceTime: now,
        currentBetAmount // PRD: 베팅 금액 표시
      });

      console.log(`User ${uid} chose ${side} in round ${roundNumber} of game ${gameId}`);
      return true;
    } catch (error) {
      console.error(`Failed to make choice for user ${uid}:`, error);
      return false;
    }
  }

  // 진출/포기 결정
  async makeDecision(gameId: string, roundNumber: number, uid: string, decision: 'continue' | 'quit'): Promise<boolean> {
    try {
      const roundRef = this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`);
      const roundSnapshot = await roundRef.once('value');
      const round = roundSnapshot.val() as GoldenBellRound;

      // 결정 가능한 상태인지 확인
      if (round.status !== 'deciding') {
        return false;
      }

      // 승자인지 확인
      if (!round.results.winners.includes(uid)) {
        return false;
      }

      // 결정 저장
      await roundRef.child(`choices/${uid}/decision`).set(decision);
      await roundRef.child(`choices/${uid}/decisionTime`).set(Date.now());

      if (decision === 'quit') {
        // 포기 시 현재까지의 상금 지급
        const participant = await this.getParticipant(gameId, uid);
        if (participant) {
          await this.creditWinnings(uid, participant.totalWinnings + participant.currentBet);
          await this.gameRef.child(`games/${gameId}/participantDetails/${uid}/isActive`).set(false);
        }
      }

      console.log(`User ${uid} decided to ${decision} in round ${roundNumber} of game ${gameId}`);
      return true;
    } catch (error) {
      console.error(`Failed to make decision for user ${uid}:`, error);
      return false;
    }
  }

  // 선택 시간 종료
  private async endChoosing(gameId: string, roundNumber: number): Promise<void> {
    try {
      const roundRef = this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`);
      await roundRef.child('status').set('deciding');

      // 결과 계산
      const results = await this.calculateRoundResults(gameId, roundNumber);
      await roundRef.child('results').set(results);

      console.log(`Choosing phase ended for round ${roundNumber}, game ${gameId}`);
    } catch (error) {
      console.error(`Failed to end choosing phase:`, error);
    }
  }

  // 라운드 종료
  private async endRound(gameId: string, roundNumber: number): Promise<void> {
    try {
      const roundRef = this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`);
      await roundRef.child('status').set('finished');

      const gameSnapshot = await this.gameRef.child(`games/${gameId}`).once('value');
      const game = gameSnapshot.val() as GoldenBellGame;

      // 계속할 참여자 확인
      const continuingParticipants = await this.getContinuingParticipants(gameId, roundNumber);

      if (continuingParticipants.length <= 1 || roundNumber >= game.maxRounds) {
        // 게임 종료
        await this.endGame(gameId);
      } else {
        // 다음 라운드 시작
        await this.startRound(gameId, roundNumber + 1);
      }

      console.log(`Round ${roundNumber} ended for game ${gameId}`);
    } catch (error) {
      console.error(`Failed to end round:`, error);
    }
  }

  // 라운드 결과 계산
  private async calculateRoundResults(gameId: string, roundNumber: number): Promise<GoldenBellRound['results']> {
    const roundSnapshot = await this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`).once('value');
    const round = roundSnapshot.val() as GoldenBellRound;

    let playerCount = 0;
    let bankerCount = 0;
    const choices = round.choices || {};

    // 선택 집계
    Object.values(choices).forEach(choice => {
      if (choice.side === 'PLAYER') playerCount++;
      if (choice.side === 'BANKER') bankerCount++;
    });

    let winningSide: 'PLAYER' | 'BANKER' | 'TIE' | 'FAILED';
    let winners: string[] = [];
    let eliminated: string[] = [];

    // PRD 승부 결과 결정
    if (playerCount === 0 && bankerCount === 0) {
      // 아무도 참여하지 않음
      winningSide = 'FAILED';
    } else if (playerCount === bankerCount) {
      // 무승부 처리
      if (roundNumber === 1) {
        // 1라운드 무승부: 모든 참여자 2라운드 진출 가능 (진출 포기도 가능)
        winningSide = 'TIE';
        winners = Object.keys(choices);
      } else {
        // 2라운드 이후 무승부: 전원 실패
        winningSide = 'FAILED';
        eliminated = Object.keys(choices);
      }
    } else if (winners.length === 1) {
      // 1명만 승리: 해당 라운드에서 게임 자동 종료
      winningSide = playerCount < bankerCount ? 'PLAYER' : 'BANKER';
      winners = playerCount < bankerCount 
        ? Object.keys(choices).filter(uid => choices[uid].side === 'PLAYER')
        : Object.keys(choices).filter(uid => choices[uid].side === 'BANKER');
      eliminated = playerCount < bankerCount
        ? Object.keys(choices).filter(uid => choices[uid].side === 'BANKER')
        : Object.keys(choices).filter(uid => choices[uid].side === 'PLAYER');
    } else if (playerCount < bankerCount) {
      // PLAYER 진영이 더 적음 -> PLAYER 승리
      winningSide = 'PLAYER';
      winners = Object.keys(choices).filter(uid => choices[uid].side === 'PLAYER');
      eliminated = Object.keys(choices).filter(uid => choices[uid].side === 'BANKER');
    } else {
      // BANKER 진영이 더 적음 -> BANKER 승리
      winningSide = 'BANKER';
      winners = Object.keys(choices).filter(uid => choices[uid].side === 'BANKER');
      eliminated = Object.keys(choices).filter(uid => choices[uid].side === 'PLAYER');
    }

    // 10라운드 특별 규칙
    if (roundNumber === 10) {
      if (winners.length === 1) {
        // 10라운드에 1명만 온 경우: 9라운드까지의 승리수당만 받고 게임 종료
        winningSide = 'FAILED';
      } else if (winners.length === 2) {
        // 10라운드에 2명이 온 경우: 무승부/몰릴시 규칙으로 전원 실패 -> 모든 승리수당 회사 회수
        winningSide = 'FAILED';
        eliminated = winners;
        winners = [];
      }
    }

    // 상금 계산
    const rewards: { [uid: string]: number } = {};
    if (winners.length > 0 && eliminated.length > 0) {
      const rewardPerWinner = eliminated.length / winners.length; // 패배자 1명당 승자가 받을 금액
      winners.forEach(uid => {
        rewards[uid] = rewardPerWinner;
      });
    }

    return {
      playerCount,
      bankerCount,
      winningSide,
      winners,
      eliminated,
      rewards,
      isTie: winningSide === 'TIE',
      isOneWinner: winners.length === 1
    };
  }

  // 계속할 참여자 조회
  private async getContinuingParticipants(gameId: string, roundNumber: number): Promise<string[]> {
    const roundSnapshot = await this.gameRef.child(`games/${gameId}/rounds/${roundNumber}`).once('value');
    const round = roundSnapshot.val() as GoldenBellRound;

    const continuingParticipants: string[] = [];
    const choices = round.choices || {};

    round.results.winners.forEach(uid => {
      const choice = choices[uid];
      // 결정하지 않았거나 continue를 선택한 경우
      if (!choice.decision || choice.decision === 'continue') {
        continuingParticipants.push(uid);
      }
    });

    return continuingParticipants;
  }

  // 게임 종료
  private async endGame(gameId: string): Promise<void> {
    try {
      await this.gameRef.child(`games/${gameId}/status`).set('finished');
      
      // 새 게임 생성
      await this.createNewGame();
      
      console.log(`Golden Bell game ${gameId} ended`);
    } catch (error) {
      console.error(`Failed to end game ${gameId}:`, error);
    }
  }

  // Helper methods
  private async getCurrentGameId(): Promise<string | null> {
    const snapshot = await this.gameRef.child('current').once('value');
    return snapshot.val();
  }

  private async getParticipant(gameId: string, uid: string): Promise<GoldenBellParticipant | null> {
    const snapshot = await this.gameRef.child(`games/${gameId}/participantDetails/${uid}`).once('value');
    return snapshot.val();
  }

  private async debitParticipationFee(uid: string, amount: number): Promise<boolean> {
    // Import from reward-system.ts
    const { debitWithIvyPriority } = await import('./reward-system');
    return await debitWithIvyPriority(uid, amount);
  }

  private async creditWinnings(uid: string, amount: number): Promise<void> {
    await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction(current => (current || 0) + amount);
    
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'credit',
      amountUsd: amount,
      meta: { source: 'goldenbell_winnings' },
      createdAt: Date.now()
    });
  }

  private async refundParticipant(uid: string, amount: number): Promise<void> {
    await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction(current => (current || 0) + amount);
    
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'credit',
      amountUsd: amount,
      meta: { source: 'goldenbell_refund' },
      createdAt: Date.now()
    });
  }
}