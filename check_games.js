const admin = require('firebase-admin');
const serviceAccount = require('./service-account.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://pointhub-ab054-default-rtdb.firebaseio.com"
});

const db = admin.database();

async function checkGoldenBellGames() {
  try {
    console.log('Checking Golden Bell games...\n');
    
    // Get all games
    const gamesSnapshot = await db.ref('/games/goldenbell').once('value');
    const games = gamesSnapshot.val();
    
    if (!games) {
      console.log('❌ No Golden Bell games found in database');
      process.exit(0);
    }
    
    const gamesList = Object.entries(games).map(([id, game]) => ({
      id,
      ...game
    }));
    
    // Sort by createdAt
    gamesList.sort((a, b) => b.createdAt - a.createdAt);
    
    console.log(`✅ Found ${gamesList.length} Golden Bell games\n`);
    console.log('Recent games (last 10):');
    console.log('='.repeat(80));
    
    gamesList.slice(0, 10).forEach((game, index) => {
      const date = new Date(game.createdAt);
      const startDate = new Date(game.startAt || game.createdAt);
      console.log(`${index + 1}. Game ID: ${game.id}`);
      console.log(`   Status: ${game.status}`);
      console.log(`   Created: ${date.toISOString()} (${date.toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC)`);
      console.log(`   Start: ${startDate.toISOString()} (${startDate.toLocaleString('ko-KR', { timeZone: 'UTC' })} UTC)`);
      console.log(`   Round: ${game.round}/${game.maxRounds || 10}`);
      console.log(`   Participants: ${game.participants ? Object.keys(game.participants).length : 0}`);
      console.log('   ---');
    });
    
    // Check time intervals
    console.log('\n' + '='.repeat(80));
    console.log('Time interval analysis (last 5 games):');
    console.log('='.repeat(80));
    
    for (let i = 0; i < Math.min(4, gamesList.length - 1); i++) {
      const current = new Date(gamesList[i].startAt || gamesList[i].createdAt);
      const next = new Date(gamesList[i + 1].startAt || gamesList[i + 1].createdAt);
      const diffMs = current - next;
      const diffMin = Math.round(diffMs / 60000);
      
      console.log(`Game ${i + 1} → Game ${i + 2}: ${diffMin} minutes`);
    }
    
    // Check if scheduler is working (games created at 5, 15, 25, 35, 45, 55 minutes)
    console.log('\n' + '='.repeat(80));
    console.log('Scheduler timing check (should be at :05, :15, :25, :35, :45, :55):');
    console.log('='.repeat(80));
    
    gamesList.slice(0, 10).forEach((game, index) => {
      const date = new Date(game.startAt || game.createdAt);
      const minutes = date.getUTCMinutes();
      const isCorrectTiming = [5, 15, 25, 35, 45, 55].includes(minutes);
      const status = isCorrectTiming ? '✅' : '❌';
      
      console.log(`${status} Game ${index + 1}: UTC ${date.getUTCHours()}:${minutes.toString().padStart(2, '0')}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error checking games:', error);
    process.exit(1);
  }
}

checkGoldenBellGames();
