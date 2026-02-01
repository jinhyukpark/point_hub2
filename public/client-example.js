// PointHub Client Example
// This file demonstrates how to interact with the Firebase backend

import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  onAuthStateChanged 
} from 'firebase/auth';
import { getDatabase, ref, onValue, off } from 'firebase/database';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Firebase configuration
// Note: In production, use firebase-config.js which loads from .env file
// Make sure firebase-config.js is loaded before this script
// If window.firebaseConfig is not available, an error will be thrown
if (!window.firebaseConfig) {
  throw new Error('firebase-config.js must be loaded before client-example.js. Add <script src="./firebase-config.js"></script> before this script.');
}

const firebaseConfig = window.firebaseConfig;

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);
const functions = getFunctions(app);

class PointHubClient {
  constructor() {
    this.user = null;
    this.unsubscribes = [];
    this.setupAuthListener();
  }

  // Authentication
  setupAuthListener() {
    onAuthStateChanged(auth, (user) => {
      this.user = user;
      if (user) {
        console.log('User signed in:', user.uid);
        this.setupUserDataListeners();
      } else {
        console.log('User signed out');
        this.cleanupListeners();
      }
    });
  }

  async signUp(email, password) {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      console.log('User created:', userCredential.user.uid);
      return userCredential.user;
    } catch (error) {
      console.error('Sign up error:', error.message);
      throw error;
    }
  }

  async signIn(email, password) {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      console.log('User signed in:', userCredential.user.uid);
      return userCredential.user;
    } catch (error) {
      console.error('Sign in error:', error.message);
      throw error;
    }
  }

  async signOut() {
    try {
      await auth.signOut();
      console.log('User signed out');
    } catch (error) {
      console.error('Sign out error:', error.message);
      throw error;
    }
  }

  // Data listeners
  setupUserDataListeners() {
    if (!this.user) return;

    // Listen to user profile and wallet
    const userRef = ref(database, `users/${this.user.uid}`);
    const unsubscribeUser = onValue(userRef, (snapshot) => {
      const userData = snapshot.val();
      if (userData) {
        console.log('User data updated:', userData);
        this.onUserDataUpdate(userData);
      }
    });
    this.unsubscribes.push(() => off(userRef, 'value', unsubscribeUser));

    // Listen to current game
    const gameRef = ref(database, 'games/current');
    const unsubscribeGame = onValue(gameRef, (snapshot) => {
      const gameData = snapshot.val();
      if (gameData) {
        console.log('Current game updated:', gameData);
        this.onGameUpdate(gameData);
      }
    });
    this.unsubscribes.push(() => off(gameRef, 'value', unsubscribeGame));

    // Listen to latest oracle data
    this.setupOracleListener();
  }

  setupOracleListener() {
    const oracleRef = ref(database, 'oracle/binance');
    const unsubscribeOracle = onValue(oracleRef, (snapshot) => {
      const oracleData = snapshot.val();
      if (oracleData) {
        // Get latest timestamp
        const timestamps = Object.keys(oracleData).sort().reverse();
        const latestData = oracleData[timestamps[0]];
        console.log('Latest prices:', latestData);
        this.onPriceUpdate(latestData);
      }
    });
    this.unsubscribes.push(() => off(oracleRef, 'value', unsubscribeOracle));
  }

  cleanupListeners() {
    this.unsubscribes.forEach(unsubscribe => unsubscribe());
    this.unsubscribes = [];
  }

  // Wallet operations (server-side functions)
  async creditWallet(amount, type, meta = {}) {
    if (!this.user) {
      throw new Error('User not authenticated');
    }

    try {
      const creditFunction = httpsCallable(functions, 'credit');
      const result = await creditFunction({ 
        amount, 
        type, 
        meta 
      });
      
      console.log('Credit result:', result.data);
      return result.data;
    } catch (error) {
      console.error('Credit error:', error.message);
      throw error;
    }
  }

  async debitWallet(amount, type, meta = {}) {
    if (!this.user) {
      throw new Error('User not authenticated');
    }

    try {
      const debitFunction = httpsCallable(functions, 'debit');
      const result = await debitFunction({ 
        amount, 
        type, 
        meta 
      });
      
      console.log('Debit result:', result.data);
      return result.data;
    } catch (error) {
      console.error('Debit error:', error.message);
      throw error;
    }
  }

  // System initialization (admin function)
  async initializeSystem() {
    try {
      const initFunction = httpsCallable(functions, 'initializeSystem');
      const result = await initFunction();
      
      console.log('System initialization result:', result.data);
      return result.data;
    } catch (error) {
      console.error('System initialization error:', error.message);
      throw error;
    }
  }

  // Event handlers (override these in your implementation)
  onUserDataUpdate(userData) {
    // Handle user data updates
    console.log('Override this method to handle user data updates');
  }

  onGameUpdate(gameData) {
    // Handle game updates
    console.log('Override this method to handle game updates');
  }

  onPriceUpdate(priceData) {
    // Handle price updates
    console.log('Override this method to handle price updates');
  }

  // Utility methods
  async updateProfile(profileData) {
    if (!this.user) {
      throw new Error('User not authenticated');
    }

    try {
      const profileRef = ref(database, `users/${this.user.uid}/profile`);
      await set(profileRef, {
        ...profileData,
        updatedAt: Date.now()
      });
      
      console.log('Profile updated successfully');
    } catch (error) {
      console.error('Profile update error:', error.message);
      throw error;
    }
  }

  getCurrentUser() {
    return this.user;
  }

  isAuthenticated() {
    return !!this.user;
  }
}

// Usage example
const pointHubClient = new PointHubClient();

// Example usage:
/*
// Sign up
await pointHubClient.signUp('user@example.com', 'password');

// Sign in
await pointHubClient.signIn('user@example.com', 'password');

// Credit wallet
await pointHubClient.creditWallet(100, 'deposit', { source: 'bank_transfer' });

// Debit wallet
await pointHubClient.debitWallet(50, 'bet', { gameId: 'game_123' });

// Update profile
await pointHubClient.updateProfile({
  nickname: 'PlayerOne',
  country: 'KR'
});

// Initialize system (admin only)
await pointHubClient.initializeSystem();
*/

export default PointHubClient;