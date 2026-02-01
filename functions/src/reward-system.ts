// PointHub Reward and Commission System
import * as admin from 'firebase-admin';

const rtdb = admin.database();

// Types for reward system
interface RewardDistribution {
  referralBonus: number;      // 10% 추천수당
  cubeGameEntry: number;      // 20% 큐브게임 진입
  marketingBonus: number;     // 40% 마케팅수당
  ivyReward: number;          // 20% 회원 ivy로 지급
  gameAccumulation: number;   // 10% 게임 누적
}

interface VipPoolDistribution {
  autoReinvest: number;       // 1/3 자동재진입
  ivyPayUsage: number;        // 2/3의 20% ivypay 사용
  withdrawable: number;       // 2/3의 80% 출금가능
}

interface WinningDistribution {
  referralBonus: number;      // 5% 추천
  companyBurn: number;        // 5% 회사 (코인소각)
  marketingPool: number;      // 10% 마케팅
}

// 회원가입 수당 배분
export async function distributeSignupRewards(uid: string, amount: number) {
  try {
    const distribution: RewardDistribution = {
      referralBonus: amount * 0.10,      // 10%
      cubeGameEntry: amount * 0.20,      // 20%
      marketingBonus: amount * 0.40,     // 40%
      ivyReward: amount * 0.20,          // 20%
      gameAccumulation: amount * 0.10    // 10%
    };

    // 추천수당 처리
    await processReferralBonus(uid, distribution.referralBonus);
    
    // 큐브게임 진입비 적립
    await addToCubeGamePool(distribution.cubeGameEntry);
    
    // 마케팅수당 처리
    await addToMarketingPool(distribution.marketingBonus);
    
    // IVY 지급
    await creditUserIvy(uid, distribution.ivyReward);
    
    // 게임 누적금 배분
    await distributeGameAccumulation(distribution.gameAccumulation);
    
    console.log(`Signup rewards distributed for user ${uid}:`, distribution);
    return distribution;
  } catch (error) {
    console.error('Signup reward distribution failed:', error);
    throw error;
  }
}

// VIP 회원 300% 순환마케팅 처리
export async function processVipRewards(uid: string, totalReward: number) {
  try {
    const distribution: VipPoolDistribution = {
      autoReinvest: totalReward / 3,                    // 1/3
      ivyPayUsage: (totalReward * 2/3) * 0.20,         // 2/3의 20%
      withdrawable: (totalReward * 2/3) * 0.80         // 2/3의 80%
    };

    // 자동 재진입 풀에 추가 (100달러 쌓이면 자동 재진입)
    await addToAutoReinvestPool(uid, distribution.autoReinvest);
    
    // IVY 지갑에 추가 (우선 차감용)
    await creditUserIvy(uid, distribution.ivyPayUsage);
    
    // 출금 가능한 금액을 USDT로 지급
    await creditUserUsdt(uid, distribution.withdrawable);
    
    console.log(`VIP rewards processed for user ${uid}:`, distribution);
    return distribution;
  } catch (error) {
    console.error('VIP reward processing failed:', error);
    throw error;
  }
}

// 게임 당첨금 배분
export async function distributeWinningRewards(winnerUid: string, totalWinning: number) {
  try {
    const distribution: WinningDistribution = {
      referralBonus: totalWinning * 0.05,      // 5%
      companyBurn: totalWinning * 0.05,        // 5%
      marketingPool: totalWinning * 0.10       // 10%
    };

    const actualWinning = totalWinning * 0.80; // 80% 실제 당첨금

    // 당첨자에게 실제 당첨금 지급
    await creditUserUsdt(winnerUid, actualWinning);
    
    // 추천수당 처리
    await processReferralBonus(winnerUid, distribution.referralBonus);
    
    // 회사 소각 기록
    await recordCompanyBurn(distribution.companyBurn);
    
    // 마케팅 풀에 추가
    await addToMarketingPool(distribution.marketingPool);
    
    console.log(`Winning rewards distributed for ${winnerUid}:`, {
      actualWinning,
      ...distribution
    });
    
    return { actualWinning, ...distribution };
  } catch (error) {
    console.error('Winning reward distribution failed:', error);
    throw error;
  }
}

// Helper Functions

async function processReferralBonus(uid: string, amount: number) {
  try {
    // 추천인 정보 조회
    const userSnapshot = await rtdb.ref(`/users/${uid}/profile/referrer`).once('value');
    const referrerId = userSnapshot.val();
    
    if (referrerId) {
      await creditUserUsdt(referrerId, amount);
      
      // 추천 수당 기록
      await rtdb.ref(`/referrals/${referrerId}/earnings`).push({
        fromUser: uid,
        amount: amount,
        type: 'referral_bonus',
        createdAt: Date.now()
      });
      
      console.log(`Referral bonus ${amount} credited to ${referrerId}`);
    } else {
      // 추천인이 없으면 회사로 귀속
      await recordCompanyBurn(amount);
      console.log(`Referral bonus ${amount} added to company burn (no referrer)`);
    }
  } catch (error) {
    console.error('Referral bonus processing failed:', error);
  }
}

async function addToCubeGamePool(amount: number) {
  try {
    await rtdb.ref('/pools/cubeGame').transaction((currentAmount) => {
      return (currentAmount || 0) + amount;
    });
    console.log(`${amount} added to cube game pool`);
  } catch (error) {
    console.error('Cube game pool addition failed:', error);
  }
}

async function addToMarketingPool(amount: number) {
  try {
    await rtdb.ref('/pools/marketing').transaction((currentAmount) => {
      return (currentAmount || 0) + amount;
    });
    console.log(`${amount} added to marketing pool`);
  } catch (error) {
    console.error('Marketing pool addition failed:', error);
  }
}

async function addToAutoReinvestPool(uid: string, amount: number) {
  try {
    const currentAmount = await rtdb.ref(`/users/${uid}/vip/autoReinvestPool`).transaction((current) => {
      return (current || 0) + amount;
    });

    // 100달러 이상이면 자동 재진입 처리
    if (typeof currentAmount === 'object' && currentAmount && 'committed' in currentAmount && currentAmount.committed && (currentAmount.snapshot?.val() || 0) >= 100) {
      await processAutoReinvestment(uid);
    }
    
    console.log(`${amount} added to auto-reinvest pool for ${uid}`);
  } catch (error) {
    console.error('Auto-reinvest pool addition failed:', error);
  }
}

async function processAutoReinvestment(uid: string) {
  try {
    const poolSnapshot = await rtdb.ref(`/users/${uid}/vip/autoReinvestPool`).once('value');
    const poolAmount = poolSnapshot.val() || 0;
    
    if (poolAmount >= 100) {
      const reinvestAmount = Math.floor(poolAmount / 100) * 100;
      const remainingAmount = poolAmount - reinvestAmount;
      
      // 풀에서 재진입 금액 차감
      await rtdb.ref(`/users/${uid}/vip/autoReinvestPool`).set(remainingAmount);
      
      // 마케팅 자동 재진입 처리
      await addToMarketingPool(reinvestAmount);
      
      // 재진입 기록
      await rtdb.ref(`/users/${uid}/vip/reinvestments`).push({
        amount: reinvestAmount,
        createdAt: Date.now()
      });
      
      console.log(`Auto-reinvestment of ${reinvestAmount} processed for ${uid}`);
    }
  } catch (error) {
    console.error('Auto-reinvestment processing failed:', error);
  }
}

async function creditUserUsdt(uid: string, amount: number) {
  try {
    await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((current) => {
      return (current || 0) + amount;
    });
    
    // 거래 기록
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'credit',
      amountUsd: amount,
      meta: { source: 'reward_system' },
      createdAt: Date.now()
    });
    
    console.log(`${amount} USDT credited to user ${uid}`);
  } catch (error) {
    console.error(`USDT credit failed for user ${uid}:`, error);
  }
}

async function creditUserIvy(uid: string, amount: number) {
  try {
    await rtdb.ref(`/users/${uid}/wallet/ivy`).transaction((current) => {
      return (current || 0) + amount;
    });
    
    // 거래 기록
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'credit',
      currency: 'ivy',
      amountUsd: amount,
      meta: { source: 'reward_system' },
      createdAt: Date.now()
    });
    
    console.log(`${amount} IVY credited to user ${uid}`);
  } catch (error) {
    console.error(`IVY credit failed for user ${uid}:`, error);
  }
}

async function recordCompanyBurn(amount: number) {
  try {
    await rtdb.ref('/company/burns').push({
      amount: amount,
      createdAt: Date.now()
    });
    
    await rtdb.ref('/company/totalBurned').transaction((current) => {
      return (current || 0) + amount;
    });
    
    console.log(`Company burn recorded: ${amount}`);
  } catch (error) {
    console.error('Company burn recording failed:', error);
  }
}

async function distributeGameAccumulation(amount: number) {
  try {
    const matchingGameAmount = 3; // 매칭게임 $3
    const goldenBellAmount = 3;   // 골든벨 $3
    const cubeGameAmount = 4;     // 큐브게임 $4

    // 각 게임 누적금에 추가
    await rtdb.ref('/games/matching/accumulatedPool').transaction((current) => {
      return (current || 0) + matchingGameAmount;
    });
    
    await rtdb.ref('/games/goldenbell/accumulatedPool').transaction((current) => {
      return (current || 0) + goldenBellAmount;
    });
    
    await addToCubeGamePool(cubeGameAmount);
    
    console.log(`Game accumulation distributed: Matching(${matchingGameAmount}), GoldenBell(${goldenBellAmount}), Cube(${cubeGameAmount})`);
  } catch (error) {
    console.error('Game accumulation distribution failed:', error);
  }
}

// IVY 우선 차감 로직
export async function debitWithIvyPriority(uid: string, amount: number): Promise<boolean> {
  try {
    const walletSnapshot = await rtdb.ref(`/users/${uid}/wallet`).once('value');
    const wallet = walletSnapshot.val() || { ivy: 0, usdt: 0 };
    
    let ivyUsed = 0;
    let usdtUsed = 0;
    
    // IVY 먼저 사용
    if (wallet.ivy >= amount) {
      ivyUsed = amount;
    } else {
      ivyUsed = wallet.ivy;
      usdtUsed = amount - ivyUsed;
      
      // USDT 잔액 확인
      if (wallet.usdt < usdtUsed) {
        console.log(`Insufficient balance for user ${uid}. Required: ${amount}, Available: ${wallet.ivy + wallet.usdt}`);
        return false;
      }
    }
    
    // 차감 실행
    if (ivyUsed > 0) {
      await rtdb.ref(`/users/${uid}/wallet/ivy`).transaction((current) => {
        return (current || 0) - ivyUsed;
      });
    }
    
    if (usdtUsed > 0) {
      await rtdb.ref(`/users/${uid}/wallet/usdt`).transaction((current) => {
        return (current || 0) - usdtUsed;
      });
    }
    
    // 거래 기록
    await rtdb.ref(`/ledger/${uid}`).push({
      type: 'debit',
      amountUsd: amount,
      meta: { 
        ivyUsed,
        usdtUsed,
        source: 'game_debit'
      },
      createdAt: Date.now()
    });
    
    console.log(`Debit successful for ${uid}: IVY(${ivyUsed}) + USDT(${usdtUsed}) = ${amount}`);
    return true;
  } catch (error) {
    console.error(`Debit failed for user ${uid}:`, error);
    return false;
  }
}