// Unity WebGL Plugin for PointHub Bridge Communication
// Place this file in Assets/Plugins/WebGL/ in your Unity project

mergeInto(LibraryManager.library, {
    
    ViteBridgeSignIn: function (email, password, requestId) {
        var emailStr = UTF8ToString(email);
        var passwordStr = UTF8ToString(password);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.signIn(emailStr, passwordStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnSignInCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeSignUp: function (email, password, requestId) {
        var emailStr = UTF8ToString(email);
        var passwordStr = UTF8ToString(password);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.signUp(emailStr, passwordStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnSignUpCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeSignOut: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.signOut(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnSignOutCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeCreditWallet: function (amount, type, meta, requestId) {
        var typeStr = UTF8ToString(type);
        var metaStr = UTF8ToString(meta);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.creditWallet(amount, typeStr, metaStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnCreditWalletCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeDebitWallet: function (amount, type, meta, requestId) {
        var typeStr = UTF8ToString(type);
        var metaStr = UTF8ToString(meta);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.debitWallet(amount, typeStr, metaStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnDebitWalletCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeUpdateProfile: function (profileJson, requestId) {
        var profileStr = UTF8ToString(profileJson);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.updateProfile(profileStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnUpdateProfileCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeGetCurrentUser: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.getCurrentUser(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnGetCurrentUserCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeIsAuthenticated: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.isAuthenticated(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnIsAuthenticatedCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeStartListeners: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.startListeners(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnStartListenersCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeStopListeners: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.stopListeners(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnStopListenersCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeInitializeSystem: function (requestId) {
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.initializeSystem(requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnInitializeSystemCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    },

    ViteBridgeTestConnection: function (message, requestId) {
        var messageStr = UTF8ToString(message);
        var requestIdStr = UTF8ToString(requestId);
        
        if (window.ViteBridge) {
            window.ViteBridge.testConnection(messageStr, requestIdStr);
        } else {
            console.error('ViteBridge not available');
            SendMessage('Bridge', 'OnTestConnectionCompleted', JSON.stringify({
                requestId: requestIdStr,
                success: false,
                error: 'ViteBridge not initialized'
            }));
        }
    }

});