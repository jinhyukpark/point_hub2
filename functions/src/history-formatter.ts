/**
 * 히스토리 포맷팅 유틸리티 함수
 */

/**
 * 순위를 영어 서수로 변환 (1 → "1st", 2 → "2nd", 3 → "3rd", etc.)
 * @param rank 순위 (숫자)
 * @returns 영어 서수 문자열
 */
export function formatRank(rank: number): string {
  if (rank <= 0) {
    return '';
  }

  const lastDigit = rank % 10;
  const lastTwoDigits = rank % 100;

  // 11, 12, 13은 예외적으로 "th" 사용
  if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
    return `${rank}th`;
  }

  switch (lastDigit) {
    case 1:
      return `${rank}st`;
    case 2:
      return `${rank}nd`;
    case 3:
      return `${rank}rd`;
    default:
      return `${rank}th`;
  }
}

/**
 * Matching 게임 히스토리 포맷팅
 * @param history 히스토리 데이터
 * @returns 포맷팅된 히스토리 데이터
 */
export function formatMatchingHistory(history: any): any {
  const formatted = { ...history };

  // gameType 필드 보장 (문서 요구사항: 항상 "order" 또는 "random")
  // gameType이 matching_order 또는 matching_random인 경우 추출
  if (formatted.gameType === 'matching_order') {
    formatted.matchingGameType = 'order';
  } else if (formatted.gameType === 'matching_random') {
    formatted.matchingGameType = 'random';
  }

  if (!formatted.matchingGameType && (formatted.matchingType === 'order' || formatted.matchingType === 'random')) {
    formatted.matchingGameType = formatted.matchingType;
  }

  if (!formatted.matchingGameType && formatted.gameType) {
    const normalized = String(formatted.gameType).toLowerCase();
    if (normalized === 'order' || normalized === 'random') {
      formatted.matchingGameType = normalized;
    }
  }

  if (!formatted.matchingGameType && formatted.gameId) {
    const gameIdLower = formatted.gameId.toLowerCase();
    if (gameIdLower.includes('_order_') || gameIdLower.includes('matching_order')) {
      formatted.matchingGameType = 'order';
    } else if (gameIdLower.includes('_random_') || gameIdLower.includes('matching_random')) {
      formatted.matchingGameType = 'random';
    }
  }

  if (!formatted.matchingGameType) {
    formatted.matchingGameType = '';
  }

  formatted.gameType = 'matching';

  // 순위 텍스트 추가
  if (formatted.rank !== undefined && formatted.rank > 0) {
    formatted.rankText = formatRank(formatted.rank);
  } else {
    formatted.rankText = '';
  }

  // 선택한 번호와 순위를 조합한 표시 텍스트
  if (formatted.selectedNumbers && formatted.selectedNumbers.length > 0) {
    const numbersText = formatted.selectedNumbers.join('/');
    if (formatted.rankText) {
      formatted.displayText = `${numbersText} - ${formatted.rankText}`;
    } else {
      formatted.displayText = numbersText;
    }
  }

  return formatted;
}

/**
 * GoldenBell 게임 히스토리 포맷팅
 * @param history 히스토리 데이터
 * @returns 포맷팅된 히스토리 데이터
 */
export function formatGoldenBellHistory(history: any): any {
  const formatted = { ...history };

  // 라운드 선택을 문자열로 변환 (PBPBPB 형식)
  if (formatted.roundChoices && formatted.roundChoices.length > 0) {
    formatted.roundChoicesText = formatted.roundChoices
      .map((choice: string) => {
        if (choice === 'PLAYER') return 'P';
        if (choice === 'BANKER') return 'B';
        if (choice === 'TIE') return 'T';
        return choice.charAt(0);
      })
      .join('');
  }

  // 승리 여부 표시
  formatted.resultText = formatted.isWinner ? 'Winner' : 'Lost';
  if (formatted.finalRound) {
    formatted.roundText = `Round ${formatted.finalRound}`;
  }

  return formatted;
}

/**
 * Cube 게임 히스토리 포맷팅
 * @param history 히스토리 데이터
 * @returns 포맷팅된 히스토리 데이터
 */
export function formatCubeHistory(history: any): any {
  const formatted = { ...history };

  // 승리 여부 표시 (rewardAmount 또는 reward 필드 확인)
  const rewardAmount = formatted.rewardAmount || formatted.reward || 0;
  if (rewardAmount > 0) {
    formatted.resultText = 'Winner';
    formatted.rewardText = `$${rewardAmount.toFixed(2)}`;
  } else {
    formatted.resultText = 'Lost';
    formatted.rewardText = '$0.00';
  }

  // 위치 표시
  if (formatted.finalPot) {
    formatted.positionText = `Position ${formatted.finalPot}`;
  } else if (formatted.winningPosition) {
    formatted.positionText = `Position ${formatted.winningPosition}`;
  }

  return formatted;
}

/**
 * 게임 타입에 따라 히스토리 포맷팅
 * @param history 히스토리 데이터
 * @returns 포맷팅된 히스토리 데이터
 */
export function formatGameHistory(history: any): any {
  if (!history) return history;

  switch (history.gameType) {
    case 'matching':
    case 'matching_order':
    case 'matching_random':
      return formatMatchingHistory(history);
    case 'goldenbell':
      return formatGoldenBellHistory(history);
    case 'cube':
      return formatCubeHistory(history);
    default:
      return history;
  }
}
