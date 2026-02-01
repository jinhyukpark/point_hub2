// Vite Bridge for Unity WebGL Communication
import PointHubClient from './client-example.js';

class ViteBridge {
  constructor() {
    this.pointHubClient = new PointHubClient();
    this.requestCounter = 0;
    this.pendingRequests = new Map();
    
    // Override client event handlers to forward to Unity
    this.setupClientEventHandlers();
    
    // Expose bridge to global scope for Unity access
    window.ViteBridge = this;
    
    console.log('ViteBridge initialized');
  }

  setupClientEventHandlers() {
    // Forward user data updates to Unity
    this.pointHubClient.onUserDataUpdate = (userData) => {
      this.sendToUnity('OnUserDataUpdated', {
        success: true,
        data: userData
      });
    };

    // Forward game updates to Unity
    this.pointHubClient.onGameUpdate = (gameData) => {
      this.sendToUnity('OnGameDataUpdated', {
        success: true,
        data: gameData
      });
    };

    // Forward price updates to Unity
    this.pointHubClient.onPriceUpdate = (priceData) => {
      this.sendToUnity('OnPriceDataUpdated', {
        success: true,
        data: priceData
      });
    };
  }

  // Utility function to send messages to Unity
  sendToUnity(methodName, data) {
    try {
      const jsonData = JSON.stringify(data);
      if (typeof SendMessage !== 'undefined') {
        SendMessage('Bridge', methodName, jsonData);
      } else {
        console.warn('SendMessage not available - running outside Unity WebGL');
        console.log(`Unity Call: Bridge.${methodName}(${jsonData})`);
      }
    } catch (error) {
      console.error('Failed to send message to Unity:', error);
    }
  }

  // Generate unique request ID for tracking
  generateRequestId() {
    return `req_${++this.requestCounter}_${Date.now()}`;
  }

  // Authentication Methods
  async signIn(email, password, requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`SignIn request ${reqId}: ${email}`);
      const user = await this.pointHubClient.signIn(email, password);
      
      this.sendToUnity('OnSignInCompleted', {
        requestId: reqId,
        success: true,
        data: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName
        }
      });
    } catch (error) {
      this.sendToUnity('OnSignInCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  async signUp(email, password, requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`SignUp request ${reqId}: ${email}`);
      const user = await this.pointHubClient.signUp(email, password);
      
      this.sendToUnity('OnSignUpCompleted', {
        requestId: reqId,
        success: true,
        data: {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName
        }
      });
    } catch (error) {
      this.sendToUnity('OnSignUpCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  async signOut(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`SignOut request ${reqId}`);
      await this.pointHubClient.signOut();
      
      this.sendToUnity('OnSignOutCompleted', {
        requestId: reqId,
        success: true
      });
    } catch (error) {
      this.sendToUnity('OnSignOutCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // Wallet Management Methods
  async creditWallet(amount, type, meta = '{}', requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`CreditWallet request ${reqId}: ${amount} ${type}`);
      const parsedMeta = typeof meta === 'string' ? JSON.parse(meta) : meta;
      const result = await this.pointHubClient.creditWallet(amount, type, parsedMeta);
      
      this.sendToUnity('OnCreditWalletCompleted', {
        requestId: reqId,
        success: true,
        data: result
      });
    } catch (error) {
      this.sendToUnity('OnCreditWalletCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  async debitWallet(amount, type, meta = '{}', requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`DebitWallet request ${reqId}: ${amount} ${type}`);
      const parsedMeta = typeof meta === 'string' ? JSON.parse(meta) : meta;
      const result = await this.pointHubClient.debitWallet(amount, type, parsedMeta);
      
      this.sendToUnity('OnDebitWalletCompleted', {
        requestId: reqId,
        success: true,
        data: result
      });
    } catch (error) {
      this.sendToUnity('OnDebitWalletCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // Profile Management
  async updateProfile(profileDataJson, requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`UpdateProfile request ${reqId}`);
      const profileData = typeof profileDataJson === 'string' 
        ? JSON.parse(profileDataJson) 
        : profileDataJson;
        
      await this.pointHubClient.updateProfile(profileData);
      
      this.sendToUnity('OnUpdateProfileCompleted', {
        requestId: reqId,
        success: true
      });
    } catch (error) {
      this.sendToUnity('OnUpdateProfileCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // Data Subscription Control
  startListeners(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`StartListeners request ${reqId}`);
      // Listeners are automatically set up when user signs in
      // Just acknowledge the request
      this.sendToUnity('OnStartListenersCompleted', {
        requestId: reqId,
        success: true
      });
    } catch (error) {
      this.sendToUnity('OnStartListenersCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  stopListeners(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`StopListeners request ${reqId}`);
      this.pointHubClient.cleanupListeners();
      
      this.sendToUnity('OnStopListenersCompleted', {
        requestId: reqId,
        success: true
      });
    } catch (error) {
      this.sendToUnity('OnStopListenersCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // System Management
  async initializeSystem(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      console.log(`InitializeSystem request ${reqId}`);
      const result = await this.pointHubClient.initializeSystem();
      
      this.sendToUnity('OnInitializeSystemCompleted', {
        requestId: reqId,
        success: true,
        data: result
      });
    } catch (error) {
      this.sendToUnity('OnInitializeSystemCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // Utility Methods
  getCurrentUser(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      const user = this.pointHubClient.getCurrentUser();
      
      this.sendToUnity('OnGetCurrentUserCompleted', {
        requestId: reqId,
        success: true,
        data: user ? {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          isAuthenticated: true
        } : {
          isAuthenticated: false
        }
      });
    } catch (error) {
      this.sendToUnity('OnGetCurrentUserCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  isAuthenticated(requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    try {
      const authenticated = this.pointHubClient.isAuthenticated();
      
      this.sendToUnity('OnIsAuthenticatedCompleted', {
        requestId: reqId,
        success: true,
        data: { isAuthenticated: authenticated }
      });
    } catch (error) {
      this.sendToUnity('OnIsAuthenticatedCompleted', {
        requestId: reqId,
        success: false,
        error: error.message
      });
    }
  }

  // Debug method for testing
  testConnection(message = 'Hello from Vite!', requestId = null) {
    const reqId = requestId || this.generateRequestId();
    
    this.sendToUnity('OnTestConnectionCompleted', {
      requestId: reqId,
      success: true,
      data: { message, timestamp: Date.now() }
    });
  }
}

// Initialize bridge when the page loads
document.addEventListener('DOMContentLoaded', () => {
  new ViteBridge();
});

// Also expose ViteBridge class for manual initialization
window.ViteBridgeClass = ViteBridge;

export default ViteBridge;