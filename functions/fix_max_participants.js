// Fix existing Golden Bell games to add maxParticipants field
const admin = require('firebase-admin');

// Initialize Firebase Admin
const serviceAccount = require('./serviceAccountKey.json'); // You need to add your service account key
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://pointhub-ab054-default-rtdb.asia-southeast1.firebasedatabase.app'
});

const db = admin.database();

async function fixMaxParticipants() {
  try {
    console.log('Fetching existing Golden Bell games...');
    const gamesSnapshot = await db.ref('/games/goldenbell').once('value');
    const games = gamesSnapshot.val() || {};
    
    const updates = {};
    let count = 0;
    
    for (const [gameId, game] of Object.entries(games)) {
      if (!game.maxParticipants) {
        updates[`/games/goldenbell/${gameId}/maxParticipants`] = 2047;
        count++;
      }
    }
    
    if (count > 0) {
      console.log(`Updating ${count} games with maxParticipants: 2047`);
      await db.ref().update(updates);
      console.log('Successfully updated all games!');
    } else {
      console.log('All games already have maxParticipants field.');
    }
    
  } catch (error) {
    console.error('Error fixing maxParticipants:', error);
  } finally {
    admin.app().delete();
  }
}

fixMaxParticipants();