/**
 * PointHub Main Application
 * Unity-Web Integration with Authentication and Data Sync
 */

const REALTIME_HELPER_KEYS = [
    'firebaseRef',
    'firebaseOnValue',
    'firebaseOnChildAdded',
    'firebaseOnChildChanged'
];

const REALTIME_HELPER_RETRY_DELAY_MS = 500;
const REALTIME_HELPER_MAX_RETRIES = 10;

async function waitForFirebaseRealtimeHelpers(timeoutMs = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const ready = REALTIME_HELPER_KEYS.every((key) => {
            const value = window[key];
            return typeof value === 'function';
        });
        if (ready) {
            return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return REALTIME_HELPER_KEYS.every((key) => typeof window[key] === 'function');
}

async function waitForRealtimeHelpersWithRetry(contextLabel = 'realtime', attempt = 0) {
    const helpersReady = await waitForFirebaseRealtimeHelpers(REALTIME_HELPER_RETRY_DELAY_MS);
    if (helpersReady) {
        return true;
    }

    if (attempt >= REALTIME_HELPER_MAX_RETRIES) {
        console.error(`❌ ${contextLabel}: Firebase realtime helpers not initialized after ${REALTIME_HELPER_MAX_RETRIES + 1} attempts`);
        return false;
    }

    console.warn(`⚠️ ${contextLabel}: Firebase realtime helpers not ready (attempt ${attempt + 1}/${REALTIME_HELPER_MAX_RETRIES + 1}), retrying...`);
    await new Promise((resolve) => setTimeout(resolve, REALTIME_HELPER_RETRY_DELAY_MS));
    return waitForRealtimeHelpersWithRetry(contextLabel, attempt + 1);
}

class PointHubApp {
    constructor() {
        this.unityInstance = null;
        this.currentUser = null;
        this.userDataRef = null;
        this.isUnityLoaded = false;
        this.pendingUserData = null;
        this.userDataUploadInterval = null;
        this.historySubscription = null;
        this.historyNotificationCache = new Set();
        this.pendingHistoryNotifications = [];
        
        this.init();
    }

    async init() {
        console.log('🚀 PointHub App initializing...');
        
        // Detect browser and add appropriate classes
        this.detectBrowser();
        
        // Initialize UI event handlers
        this.setupUI();
        
        // Debug input field issues
        this.debugInputFields();
        
        // Unity 로드는 Auth 완료 후에만 시작됨 (setupAuthStateListener에서 처리)
        // 로그인 또는 회원가입 완료 시 자동으로 Unity 로드 시작
        
        // Setup Firebase auth state listener
        this.setupAuthStateListener();
    }

    detectBrowser() {
        // ============================================
        // 🧪 TEST MODE: 항상 삼성 인터넷으로 감지
        // 테스트 완료 후 이 블록을 제거하거나 주석 처리하세요
        // ============================================
        document.body.classList.remove('samsung-internet', 'chrome-detected', 'firefox-detected', 'safari-detected');
        console.log('🧪 TEST MODE: 항상 삼성 인터넷 모드로 강제 설정');
        document.body.classList.add('samsung-internet');
        setTimeout(() => {
            const authPopup = document.querySelector('.auth-popup');
            if (authPopup) {
                console.log('📱 삼성 인터넷 스타일 적용 확인');
            }
        }, 100);
        return;
        // ============================================
        // 테스트 모드 끝
        // ============================================
        
        /* 원래 브라우저 감지 로직 (테스트 모드 비활성화 시 사용)
        const userAgent = navigator.userAgent.toLowerCase();
        const vendor = navigator.vendor ? navigator.vendor.toLowerCase() : '';
        console.log('🔍 Browser detection - UserAgent:', navigator.userAgent);
        console.log('🔍 Browser detection - Vendor:', vendor);
        
        // Remove any existing browser classes
        document.body.classList.remove('samsung-internet', 'chrome-detected', 'firefox-detected', 'safari-detected');
        
        // Check for manual override (for testing)
        const urlParams = new URLSearchParams(window.location.search);
        const forceBrowser = urlParams.get('browser');
        
        if (forceBrowser === 'samsung') {
            console.log('🧪 Forcing Samsung Internet mode for testing');
            document.body.classList.add('samsung-internet');
            return;
        }
        
        // Samsung Internet detection - multiple methods for better detection
        const isSamsungInternet = 
            userAgent.includes('samsungbrowser') ||
            userAgent.includes('samsung') && userAgent.includes('mobile') && !userAgent.includes('chrome') ||
            (userAgent.includes('android') && vendor.includes('samsung') && !userAgent.includes('chrome'));
        
        if (isSamsungInternet) {
            console.log('📱 Samsung Internet detected');
            document.body.classList.add('samsung-internet');
        }
        // Chrome detection (but not Samsung Internet which also includes Chrome)
        else if (userAgent.includes('chrome') && !userAgent.includes('samsungbrowser') && !userAgent.includes('edg')) {
            console.log('🌍 Chrome detected');
            document.body.classList.add('chrome-detected');
        }
        // Firefox detection
        else if (userAgent.includes('firefox')) {
            console.log('🔥 Firefox detected');
            document.body.classList.add('firefox-detected');
        }
        // Safari detection
        else if (userAgent.includes('safari') && !userAgent.includes('chrome') && !userAgent.includes('android')) {
            console.log('🧭 Safari detected');
            document.body.classList.add('safari-detected');
        }
        
        console.log('✅ Browser detection complete:', document.body.className);
        
        // Force apply Samsung Internet styles if detected (for debugging)
        if (document.body.classList.contains('samsung-internet')) {
            console.log('📱 Applying Samsung Internet specific styles');
            // Add a small delay to ensure styles are applied
            setTimeout(() => {
                const authPopup = document.querySelector('.auth-popup');
                if (authPopup) {
                    console.log('📱 Auth popup found, verifying Samsung Internet styles');
                }
            }, 100);
        }
        */
    }

    setupUI() {
        console.log('🔧 Setting up UI...');
        console.log('🔧 Document ready state:', document.readyState);
        
        // DOM이 완전히 로드될 때까지 대기 (필요한 경우)
        if (document.readyState === 'loading') {
            console.log('⏳ Waiting for DOM to load...');
            document.addEventListener('DOMContentLoaded', () => this._setupUIElements());
            return;
        }
        
        // DOM이 이미 로드되었으면 즉시 실행
        this._setupUIElements();
    }
    
    _setupUIElements() {
        console.log('🔧 Setting up UI elements...');
        
        // Auth form elements
        this.elements = {
            // Containers
            authContainer: document.getElementById('auth-container'),
            backgroundContainer: document.getElementById('background-container'),
            unityLoading: document.getElementById('unity-loading'),
            
            // Login form
            loginForm: document.getElementById('login-form'),
            loginEmail: document.getElementById('login-email'),
            loginPassword: document.getElementById('login-password'),
            loginBtn: document.getElementById('login-btn'),
            loginError: document.getElementById('login-error'),
            loginLoading: document.getElementById('login-loading'),
            
            // Signup form
            signupForm: document.getElementById('signup-form'),
            signupEmail: document.getElementById('signup-email'),
            signupPassword: document.getElementById('signup-password'),
            signupConfirm: document.getElementById('signup-confirm'),
            signupBtn: document.getElementById('signup-btn'),
            signupError: document.getElementById('signup-error'),
            signupSuccess: document.getElementById('signup-success'),
            signupLoading: document.getElementById('signup-loading'),
            
            // Navigation
            showSignup: document.getElementById('show-signup'),
            showLogin: document.getElementById('show-login')
        };

        // 디버깅: 요소들이 제대로 로드되었는지 확인
        console.log('📋 UI Elements loaded:', {
            loginBtn: !!this.elements.loginBtn,
            signupBtn: !!this.elements.signupBtn,
            showSignup: !!this.elements.showSignup,
            showLogin: !!this.elements.showLogin,
            signupForm: !!this.elements.signupForm,
            loginForm: !!this.elements.loginForm,
            backgroundContainer: !!this.elements.backgroundContainer
        });

        // Event listeners (null 체크 포함)
        if (this.elements.loginBtn) {
            this.elements.loginBtn.addEventListener('click', () => {
                console.log('🔘 Login button clicked');
                this.handleLogin();
            });
            console.log('✅ Login button event listener attached');
        } else {
            console.error('❌ Login button not found!');
        }
        
        if (this.elements.signupBtn) {
            this.elements.signupBtn.addEventListener('click', () => {
                console.log('🔘 Signup button clicked');
                this.handleSignup();
            });
            console.log('✅ Signup button event listener attached');
        } else {
            console.error('❌ Signup button not found!');
        }
        
        if (this.elements.showSignup) {
            this.elements.showSignup.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔘 Show signup link clicked');
                this.showSignupForm();
            });
            console.log('✅ Show signup link event listener attached');
        } else {
            console.error('❌ Show signup link not found!');
        }
        
        if (this.elements.showLogin) {
            this.elements.showLogin.addEventListener('click', (e) => {
                e.preventDefault();
                console.log('🔘 Show login link clicked');
                this.showLoginForm();
            });
            console.log('✅ Show login link event listener attached');
        } else {
            console.error('❌ Show login link not found!');
        }
        
        // Enter key handlers
        document.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                console.log('⌨️ Enter key pressed');
                if (this.elements.signupForm && !this.elements.signupForm.classList.contains('hidden')) {
                    console.log('⌨️ Calling handleSignup from Enter key');
                    this.handleSignup();
                } else if (this.elements.loginForm && !this.elements.loginForm.classList.contains('hidden')) {
                    console.log('⌨️ Calling handleLogin from Enter key');
                    this.handleLogin();
                }
            }
        });

        // Initially show auth interface
        this.showAuthInterface();
        
        console.log('✅ UI setup complete');
    }

    async loadUnity() {
        console.log('🎮 Loading Unity...');
        
        try {
            const canvas = document.querySelector("#unity-canvas");
            
            // Configure canvas for mobile
            if (/iPhone|iPad|iPod|Android/i.test(navigator.userAgent)) {
                const meta = document.createElement('meta');
                meta.name = 'viewport';
                meta.content = 'width=device-width, height=device-height, initial-scale=1.0, user-scalable=no, shrink-to-fit=yes';
                document.getElementsByTagName('head')[0].appendChild(meta);
                
                canvas.style.width = "100%";
                canvas.style.height = "100%";
                canvas.style.position = "fixed";
                
                document.body.style.textAlign = "left";
            }

            // Determine Unity Build path based on current location
            // If loaded from root (index.html), use public/Build/, otherwise use Build/
            const currentPath = window.location.pathname;
            // Check if we're at root or in public folder
            const isPublicFolder = currentPath.includes('/public/') || currentPath === '/index.html' || currentPath.endsWith('/public/index.html');
            const isRoot = (currentPath === '/' || currentPath.endsWith('/index.html')) && !isPublicFolder;
            const buildPath = isRoot ? 'Build/' : 'Build/';
            
            console.log('🎮 Unity Build path:', buildPath);
            console.log('🎮 Current path:', currentPath);
            console.log('🎮 Is root:', isRoot, 'Is public:', isPublicFolder);
            
            // Create Unity instance
            this.unityInstance = await createUnityInstance(canvas, {
                dataUrl: buildPath + "pointhub.data.unityweb",
                frameworkUrl: buildPath + "pointhub.framework.js.unityweb",
                codeUrl: buildPath + "pointhub.wasm.unityweb",
                streamingAssetsUrl: "StreamingAssets",
                companyName: "DefaultCompany",
                productName: "outsourcing_pointhub",
                productVersion: "1.0"
            });

            this.isUnityLoaded = true;
            console.log('✅ Unity loaded successfully');
            
            // Hide loading screen
            if (this.elements.unityLoading) {
                this.elements.unityLoading.style.display = 'none';
            }
            
            // Unity 로드 완료 후 인증 페이지 완전히 숨기기
            this.hideAuthInterface();
            
            // If user data is pending, send it now
            if (this.pendingUserData) {
                this.sendUserDataToUnity(this.pendingUserData);
                this.pendingUserData = null;
            }

            // Expose Unity functions globally for debugging
            window.unityInstance = this.unityInstance;
            
            // Start periodic user data upload
            this.startUserDataUpload();

            this.flushPendingHistoryNotifications();
            
        } catch (error) {
            console.error('❌ Unity loading failed:', error);
            this.elements.unityLoading.innerHTML = 'Failed to load game. Please refresh.';
        }
    }

    setupAuthStateListener() {
        // Firebase Auth 상태 변화를 감지하여 로그인/로그아웃 처리
        // Unity는 Auth 완료 후에만 로드됨
        window.onAuthStateChanged(window.firebaseAuth, (user) => {
            console.log('🔐 Auth state changed:', user ? user.uid : 'logged out');
            
            if (user) {
                // 사용자 로그인 완료 (회원가입 후 자동 로그인 포함)
                this.currentUser = user;
                this.startUserDataSync();
                this.hideAuthInterface();
                
                // Unity 로드는 Auth 완료 후에만 시작 (회원가입 포함)
                if (!this.isUnityLoaded) {
                    console.log('🎮 Starting Unity loading after authentication...');
                    console.log('🎮 This happens after both login and signup');
                    this.loadUnity();
                }
            } else {
                // 사용자 로그아웃
                this.currentUser = null;
                this.stopUserDataSync();
                this.stopUserDataUpload();
                this.showAuthInterface();
            }
        });
    }

    startUserDataSync() {
        console.log('📊 Starting user data sync for:', this.currentUser.uid);
        
        // Reference to user data
        this.userDataRef = window.firebaseRef(window.firebaseDatabase, `/users/${this.currentUser.uid}`);
        
        // Listen for real-time updates
        window.firebaseOnValue(this.userDataRef, (snapshot) => {
            const userData = snapshot.val();
            if (userData) {
                console.log('📈 User data updated:', userData);
                
                // Add auth info to user data
                const enrichedData = {
                    ...userData,
                    auth: {
                        uid: this.currentUser.uid,
                        email: this.currentUser.email,
                        emailVerified: this.currentUser.emailVerified
                    }
                };
                
                if (this.isUnityLoaded) {
                    this.sendUserDataToUnity(enrichedData);
                } else {
                    // Store data until Unity is ready
                    this.pendingUserData = enrichedData;
                }
            }
        });

        this.startHistorySubscription('auth-state');
    }

    stopUserDataSync() {
        if (this.userDataRef) {
            window.firebaseOff(this.userDataRef);
            this.userDataRef = null;
        }
        this.stopHistorySubscription();
    }

    startUserDataUpload() {
        console.log('📤 Using real-time sync only (no periodic upload needed)');
        // 실시간 동기화가 이미 정상 작동하므로 주기적 업로드 비활성화
    }

    stopUserDataUpload() {
        if (this.userDataUploadInterval) {
            clearInterval(this.userDataUploadInterval);
            this.userDataUploadInterval = null;
            console.log('📤 Stopped user data upload');
        }
    }

    startHistorySubscription(trigger = 'auto') {
        if (!this.currentUser || !window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnChildAdded || !window.firebaseOnChildChanged) {
            console.warn('⚠️ Cannot start history subscription yet', trigger);
            return;
        }

        if (this.historySubscription) {
            return;
        }

        const uid = this.currentUser.uid;
        const historyRef = window.firebaseRef(window.firebaseDatabase, `/gameHistory/${uid}`);
        const handler = (snapshot) => this.handleHistoryChange(snapshot);

        window.firebaseOnChildAdded(historyRef, handler);
        window.firebaseOnChildChanged(historyRef, handler);

        this.historySubscription = {
            ref: historyRef,
            handler
        };

        console.log(`📜 Subscribed to gameHistory/${uid} (${trigger})`);

        this.primeHistorySubscription(historyRef);
    }

    stopHistorySubscription() {
        if (this.historySubscription && this.historySubscription.ref && window.firebaseOff) {
            window.firebaseOff(this.historySubscription.ref);
        }

        this.historySubscription = null;
        this.historyNotificationCache = new Set();
    }

    primeHistorySubscription(historyRef) {
        if (!window.firebaseOnce) {
            return;
        }

        window.firebaseOnce(historyRef)
            .then((snapshot) => {
                if (!snapshot || !snapshot.exists()) {
                    return;
                }

                snapshot.forEach((child) => {
                    this.handleHistoryChange(child);
                });
            })
            .catch((error) => {
                console.error('❌ Error priming history subscription:', error);
            });
    }

    handleHistoryChange(snapshot) {
        if (!snapshot) return;
        const history = snapshot.val();
        if (!history) return;

        const historyId = snapshot.key;
        const normalizedType = (history.gameType || '').toLowerCase();
        const isMatching = normalizedType.includes('matching');
        const isCube = normalizedType === 'cube';

        if (!isMatching && !isCube) {
            return;
        }

        if (!history.isCompleted || history.isPopupOpen) {
            return;
        }

        if (this.historyNotificationCache.has(historyId)) {
            return;
        }

        this.historyNotificationCache.add(historyId);

        const payload = {
            historyId,
            gameType: normalizedType,
            matchingType: history.matchingType || (normalizedType.includes('order') ? 'order' : normalizedType.includes('random') ? 'random' : null),
            gameId: history.gameId || '',
            betId: history.betId || '',
            rewardAmount: history.rewardAmount || 0,
            total: history.total ?? history.rewardAmount ?? history.finalPot ?? history.betAmount ?? 0,
            rank: history.rank || 0,
            matches: history.matches || 0,
            finalPot: history.finalPot || '',
            winningPot: history.winningPot || '',
            isCompleted: !!history.isCompleted,
            isPopupOpen: !!history.isPopupOpen,
            updatedAt: history.updatedAt || Date.now(),
            winningNumbers: history.winningNumbers || [],
            selectedNumbers: history.selectedNumbers || []
        };

        this.sendHistoryNotificationToUnity(payload);
    }

    sendHistoryNotificationToUnity(payload) {
        const serialized = JSON.stringify(payload);
        if (this.unityInstance) {
            this.unityInstance.SendMessage('Bridge', 'OnGameHistoryNotification', serialized);
        } else {
            this.pendingHistoryNotifications.push(payload);
        }
    }

    flushPendingHistoryNotifications() {
        if (!this.unityInstance || this.pendingHistoryNotifications.length === 0) {
            return;
        }

        this.pendingHistoryNotifications.forEach(payload => {
            try {
                this.unityInstance.SendMessage('Bridge', 'OnGameHistoryNotification', JSON.stringify(payload));
            } catch (error) {
                console.error('❌ Failed to resend pending history notification:', error);
            }
        });

        this.pendingHistoryNotifications = [];
    }

    async uploadUserDataToUnity() {
        if (!this.unityInstance || !this.currentUser) {
            return;
        }

        try {
            // Firebase 준비 상태 확인 및 대기
            if (!window.firebaseOnce || !window.firebaseReady) {
                console.log('⏳ Waiting for Firebase to be ready...');
                console.log('firebaseOnce type:', typeof window.firebaseOnce);
                console.log('firebaseReady:', window.firebaseReady);
                
                // Firebase 준비까지 최대 5초 대기
                let attempts = 0;
                while ((!window.firebaseOnce || !window.firebaseReady) && attempts < 50) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                    attempts++;
                }
                
                if (!window.firebaseOnce || !window.firebaseReady) {
                    console.warn('❌ Firebase not ready after waiting, skipping upload');
                    return;
                }
            }
            
            // Get current user data from Firebase
            const userRef = window.firebaseRef(window.firebaseDatabase, `/users/${this.currentUser.uid}`);
            const snapshot = await window.firebaseOnce(userRef);
            
            if (snapshot.exists()) {
                const userData = snapshot.val();
                
                // Add auth info and timestamp
                const enrichedData = {
                    ...userData,
                    auth: {
                        uid: this.currentUser.uid,
                        email: this.currentUser.email,
                        emailVerified: this.currentUser.emailVerified
                    },
                    uploadTimestamp: Date.now()
                };
                
                console.log('📤 Uploading user data to Unity:', enrichedData);
                
                // Send to Unity via UserDataUpload method
                this.unityInstance.SendMessage('Bridge', 'UserDataUpload', JSON.stringify(enrichedData));
            }
            
        } catch (error) {
            console.error('❌ Failed to upload user data to Unity:', error);
        }
    }

    debugInputFields() {
        console.log('🔍 Debugging input fields...');
        
        setTimeout(() => {
            // 1. input 요소들이 실제로 존재하는지 확인
            const emailInput = document.getElementById('login-email');
            const passwordInput = document.getElementById('login-password');
            
            console.log('Email input:', emailInput);
            console.log('Password input:', passwordInput);
            
            if (emailInput) {
                console.log('Email styles:', {
                    display: window.getComputedStyle(emailInput).display,
                    pointerEvents: window.getComputedStyle(emailInput).pointerEvents,
                    visibility: window.getComputedStyle(emailInput).visibility,
                    zIndex: window.getComputedStyle(emailInput).zIndex
                });
                
                // 이벤트 리스너 테스트
                emailInput.addEventListener('input', e => console.log('📧 Email input event:', e.target.value));
                emailInput.addEventListener('keydown', e => console.log('📧 Email keydown:', e.key));
                emailInput.addEventListener('focus', e => console.log('📧 Email focused'));
                emailInput.addEventListener('blur', e => console.log('📧 Email blurred'));
                
                // 읽기 전용 속성 확인
                console.log('📧 Email readonly:', emailInput.readOnly);
                console.log('📧 Email disabled:', emailInput.disabled);
            }
            
            if (passwordInput) {
                console.log('Password styles:', {
                    display: window.getComputedStyle(passwordInput).display,
                    pointerEvents: window.getComputedStyle(passwordInput).pointerEvents,
                    visibility: window.getComputedStyle(passwordInput).visibility,
                    zIndex: window.getComputedStyle(passwordInput).zIndex
                });
                
                // 이벤트 리스너 테스트
                passwordInput.addEventListener('input', e => console.log('🔐 Password input event:', e.target.value));
                passwordInput.addEventListener('keydown', e => console.log('🔐 Password keydown:', e.key));
                passwordInput.addEventListener('focus', e => console.log('🔐 Password focused'));
                passwordInput.addEventListener('blur', e => console.log('🔐 Password blurred'));
                
                // 읽기 전용 속성 확인
                console.log('🔐 Password readonly:', passwordInput.readOnly);
                console.log('🔐 Password disabled:', passwordInput.disabled);
            }
            
            // Unity Canvas 상태 확인
            const unityCanvas = document.getElementById('unity-canvas');
            if (unityCanvas) {
                console.log('Unity Canvas styles:', {
                    display: window.getComputedStyle(unityCanvas).display,
                    pointerEvents: window.getComputedStyle(unityCanvas).pointerEvents,
                    visibility: window.getComputedStyle(unityCanvas).visibility,
                    zIndex: window.getComputedStyle(unityCanvas).zIndex
                });
            }
            
            // Body 클래스 확인
            console.log('Body classes:', document.body.className);
            
            // Firebase 상태 확인
            console.log('Firebase Auth:', window.firebaseAuth);
            console.log('Firebase functions available:', {
                signInWithEmailAndPassword: typeof window.signInWithEmailAndPassword,
                createUserWithEmailAndPassword: typeof window.createUserWithEmailAndPassword,
                onAuthStateChanged: typeof window.onAuthStateChanged
            });
            
            // 다른 이벤트 리스너들 확인
            console.log('Document event listeners count:', Object.keys(document).filter(key => key.startsWith('on')).length);
            
        }, 1000); // Unity 로딩 후 확인
    }

    sendUserDataToUnity(userData) {
        if (!this.unityInstance) return;
        
        try {
            console.log('📤 Sending user data to Unity:', userData);
            
            // Send to Unity via SendMessage
            this.unityInstance.SendMessage('Bridge', 'OnUserDataUpdated', JSON.stringify({
                success: true,
                data: userData
            }));
            
        } catch (error) {
            console.error('❌ Failed to send data to Unity:', error);
        }
    }

    async handleLogin() {
        const email = this.elements.loginEmail.value.trim();
        const password = this.elements.loginPassword.value.trim();

        this.clearMessages('login');

        if (!this.validateLoginForm(email, password)) return;

        try {
            this.showLoading('login', true);
            
            await window.signInWithEmailAndPassword(window.firebaseAuth, email, password);
            
            console.log('✅ Login successful');
            
        } catch (error) {
            console.error('❌ Login failed:', error);
            this.showError('login', this.getErrorMessage(error.code));
        } finally {
            this.showLoading('login', false);
        }
    }

    async handleSignup() {
        const email = this.elements.signupEmail.value.trim();
        const password = this.elements.signupPassword.value.trim();
        const confirmPassword = this.elements.signupConfirm.value.trim();

        this.clearMessages('signup');

        if (!this.validateSignupForm(email, password, confirmPassword)) return;

        try {
            this.showLoading('signup', true);
            
            // Create Firebase auth user
            const userCredential = await window.createUserWithEmailAndPassword(window.firebaseAuth, email, password);
            const user = userCredential.user;
            
            console.log('✅ User created in Firebase Auth:', user.uid);
            
            // Create user profile in Firebase Realtime Database
            if (window.firebaseFunctions && window.httpsCallable) {
                try {
                    console.log('📤 Creating user profile in database...');
                    const createUserProfile = window.httpsCallable(window.firebaseFunctions, 'createUserProfile');
                    const result = await createUserProfile({ 
                        uid: user.uid, 
                        email: user.email 
                    });
                    
                    console.log('✅ User profile created:', result.data);
                    
                    // User profile will be automatically synced via startUserDataSync()
                    // which is triggered by onAuthStateChanged
                    
                } catch (profileError) {
                    console.error('❌ Failed to create user profile:', profileError);
                    // Continue anyway - profile might be created later or already exists
                }
            } else {
                console.warn('⚠️ Firebase Functions not available, skipping profile creation');
            }
            
            this.showSuccess('signup', 'Account created successfully! Logging in...');
            
            // 회원가입 성공 시 Firebase Auth에 자동 로그인됨
            // createUserWithEmailAndPassword는 자동으로 사용자를 로그인 상태로 만듦
            // onAuthStateChanged가 자동으로 트리거되어:
            //   1. 사용자 데이터 동기화 시작
            //   2. 인증 인터페이스 숨김
            //   3. Unity 로드 시작
            console.log('✅ Signup successful, user automatically logged in via Firebase Auth');
            console.log('✅ onAuthStateChanged will trigger automatically');
            console.log('✅ Unity loading will start automatically after authentication');
            
        } catch (error) {
            console.error('❌ Signup failed:', error);
            this.showError('signup', this.getErrorMessage(error.code));
        } finally {
            this.showLoading('signup', false);
        }
    }

    validateLoginForm(email, password) {
        if (!email || !password) {
            this.showError('login', 'Please enter both email and password');
            return false;
        }

        if (!this.isValidEmail(email)) {
            this.showError('login', 'Please enter a valid email address');
            return false;
        }

        return true;
    }

    validateSignupForm(email, password, confirmPassword) {
        if (!email || !password || !confirmPassword) {
            this.showError('signup', 'Please fill in all fields');
            return false;
        }

        if (!this.isValidEmail(email)) {
            this.showError('signup', 'Please enter a valid email address');
            return false;
        }

        if (password.length < 6) {
            this.showError('signup', 'Password must be at least 6 characters long');
            return false;
        }

        if (password !== confirmPassword) {
            this.showError('signup', 'Passwords do not match');
            return false;
        }

        return true;
    }

    isValidEmail(email) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    }

    showLoginForm() {
        this.elements.loginForm.classList.remove('hidden');
        this.elements.signupForm.classList.add('hidden');
        this.clearMessages('login');
        
        // 링크 다시 표시 (로딩이 끝났을 때를 대비)
        if (this.elements.showSignup) {
            this.elements.showSignup.style.display = '';
        }
        if (this.elements.showLogin) {
            this.elements.showLogin.style.display = '';
        }
        if (this.elements.loginBtn) {
            this.elements.loginBtn.style.display = '';
        }
        
        this.elements.loginEmail.focus();
    }

    showSignupForm() {
        console.log('📝 Showing signup form');
        if (this.elements.signupForm) {
            this.elements.signupForm.classList.remove('hidden');
        }
        if (this.elements.loginForm) {
            this.elements.loginForm.classList.add('hidden');
        }
        this.clearMessages('signup');
        
        // 링크 다시 표시 (로딩이 끝났을 때를 대비)
        if (this.elements.showSignup) {
            this.elements.showSignup.style.display = '';
        }
        if (this.elements.showLogin) {
            this.elements.showLogin.style.display = '';
        }
        if (this.elements.signupBtn) {
            this.elements.signupBtn.style.display = '';
        }
        
        if (this.elements.signupEmail) {
            this.elements.signupEmail.focus();
        }
    }

    showAuthInterface() {
        console.log('🔐 Showing authentication interface');
        document.body.classList.remove('authenticated');
        
        // Unity가 로드되어 있으면 Unity 숨기기
        if (this.isUnityLoaded && this.elements.unityLoading) {
            this.elements.unityLoading.style.display = 'none';
        }
        
        // 인증 페이지 표시
        if (this.elements.authContainer) {
            this.elements.authContainer.style.display = 'flex';
            this.elements.authContainer.style.visibility = 'visible';
        }
        if (this.elements.backgroundContainer) {
            this.elements.backgroundContainer.style.display = 'block';
            this.elements.backgroundContainer.style.visibility = 'visible';
            console.log('✅ Background container displayed');
        } else {
            console.error('❌ Background container not found!');
        }
        this.showLoginForm();
    }

    hideAuthInterface() {
        console.log('🎮 Hiding authentication interface');
        document.body.classList.add('authenticated');
        
        // CSS로 자동 숨김 처리되지만 확실하게 하기 위해 직접 설정
        if (this.elements.authContainer) {
            this.elements.authContainer.style.display = 'none';
            this.elements.authContainer.style.visibility = 'hidden';
        }
        if (this.elements.backgroundContainer) {
            this.elements.backgroundContainer.style.display = 'none';
            this.elements.backgroundContainer.style.visibility = 'hidden';
        }
        
        console.log('✅ Authentication interface hidden completely');
    }

    showError(type, message) {
        const errorElement = this.elements[`${type}Error`];
        errorElement.textContent = message;
    }

    showSuccess(type, message) {
        const successElement = this.elements[`${type}Success`];
        if (successElement) {
            successElement.textContent = message;
        }
    }

    showLoading(type, show) {
        const loadingElement = this.elements[`${type}Loading`];
        const buttonElement = this.elements[`${type}Btn`];
        
        loadingElement.style.display = show ? 'block' : 'none';
        if (buttonElement) {
            buttonElement.disabled = show;
        }
        
        // 로딩 중일 때 Signup/Login 링크 숨기기
        if (show) {
            // 로딩 중: 링크와 버튼 숨기기
            if (this.elements.showSignup) {
                this.elements.showSignup.style.display = 'none';
            }
            if (this.elements.showLogin) {
                this.elements.showLogin.style.display = 'none';
            }
            if (buttonElement) {
                buttonElement.style.display = 'none';
            }
        } else {
            // 로딩 완료: 링크와 버튼 다시 표시
            if (this.elements.showSignup) {
                this.elements.showSignup.style.display = '';
            }
            if (this.elements.showLogin) {
                this.elements.showLogin.style.display = '';
            }
            if (buttonElement) {
                buttonElement.style.display = '';
            }
        }
    }

    clearMessages(type) {
        const errorElement = this.elements[`${type}Error`];
        const successElement = this.elements[`${type}Success`];
        
        errorElement.textContent = '';
        if (successElement) {
            successElement.textContent = '';
        }
    }

    getErrorMessage(errorCode) {
        const errorMessages = {
            'auth/user-not-found': 'No account found with this email',
            'auth/wrong-password': 'Incorrect password',
            'auth/email-already-in-use': 'Email address is already registered',
            'auth/invalid-email': 'Invalid email address',
            'auth/weak-password': 'Password is too weak',
            'auth/too-many-requests': 'Too many failed attempts. Please try again later'
        };
        
        return errorMessages[errorCode] || 'An error occurred. Please try again';
    }

    // Public methods for Unity communication
    async logout() {
        try {
            await window.signOut(window.firebaseAuth);
            console.log('✅ Logout successful');
        } catch (error) {
            console.error('❌ Logout failed:', error);
        }
    }

    // Method to call Unity functions from web
    callUnityFunction(objectName, methodName, data = '') {
        if (this.unityInstance) {
            this.unityInstance.SendMessage(objectName, methodName, data);
        }
    }
}

const FIREBASE_INIT_MAX_ATTEMPTS = 50;
let firebaseInitAttempts = 0;

function startPointHubApp() {
    if (window.pointHubApp) {
        console.log('⚠️ PointHub App already initialized');
        return;
    }

    console.log('🌟 PointHub App starting...');
    window.pointHubApp = new PointHubApp();
}

function initializeAppWhenFirebaseReady() {
    if (window.pointHubApp) {
        return;
    }

    if (window.firebaseReady) {
        startPointHubApp();
        return;
    }

    firebaseInitAttempts++;
    if (firebaseInitAttempts > FIREBASE_INIT_MAX_ATTEMPTS) {
        console.error('❌ Firebase failed to initialize within expected time. PointHub App startup aborted.');
        return;
    }

    console.warn(`⚠️ Waiting for Firebase initialization (attempt ${firebaseInitAttempts}/${FIREBASE_INIT_MAX_ATTEMPTS})`);
    setTimeout(initializeAppWhenFirebaseReady, 100);
}

function bootstrapPointHubApp() {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeAppWhenFirebaseReady);
    } else {
        initializeAppWhenFirebaseReady();
    }
}

bootstrapPointHubApp();

// Global functions for Unity to call
window.logoutUser = () => {
    if (window.pointHubApp) {
        window.pointHubApp.logout();
    }
};

window.callUnityFunction = (objectName, methodName, data) => {
    if (window.pointHubApp) {
        window.pointHubApp.callUnityFunction(objectName, methodName, data);
    }
};

// Cloud Function 호출 (Unity에서 사용)
window.callCloudFunction = async (dataStr) => {
    try {
        const params = JSON.parse(dataStr);
        console.log('🔥 Unity calling cloud function:', params.functionName, params.params);
        
        if (!window.firebaseFunctions || !window.httpsCallable) {
            console.error('❌ Firebase Functions not initialized');
            return;
        }
        
        // Firebase Cloud Function 호출
        const cloudFunction = window.httpsCallable(window.firebaseFunctions, params.functionName);
        const result = await cloudFunction(params.params);
        
        console.log('✅ Cloud Function result:', result.data);
        
        // Unity에 결과 전송
        if (window.unityInstance) {
            window.unityInstance.SendMessage('Bridge', 'OnCloudFunctionResponse', JSON.stringify({
                success: true,
                functionName: params.functionName,
                data: result.data,
                timestamp: Date.now()
            }));
        }
        
    } catch (error) {
        console.error('❌ Error calling cloud function:', error);
        
        // 파라미터 파싱 시도
        let functionName = 'unknown';
        try {
            const errorParams = JSON.parse(dataStr);
            functionName = errorParams.functionName || 'unknown';
        } catch (parseError) {
            console.error('❌ Error parsing params in catch block:', parseError);
        }
        
        // Unity에 에러 전송
        if (window.unityInstance) {
            window.unityInstance.SendMessage('Bridge', 'OnCloudFunctionResponse', JSON.stringify({
                success: false,
                functionName: functionName,
                error: error.message,
                timestamp: Date.now()
            }));
        }
    }
};

// Unity 로드 완료 알림 수신
window.onUnityLoaded = (message) => {
    console.log('🎮 Unity loaded notification received:', message);
    if (window.pointHubApp) {
        console.log('✅ Both Unity and PointHub app are ready');
    }
};

// 큐브 게임 실시간 구독 (Unity에서 호출)
window.subscribeToCubeGameRealtime = async (dataStr) => {
    try {
        const params = JSON.parse(dataStr);
        const gameId = params.gameId;
        
        if (!gameId) {
            console.error('❌ subscribeToCubeGameRealtime: gameId is required');
            return;
        }
        
        console.log('🎮 Subscribing to cube game realtime:', gameId);
        
        const helpersReady = await waitForRealtimeHelpersWithRetry('Cube realtime subscription');
        if (!helpersReady) {
            return;
        }

        // Firebase Realtime Database 리스너 설정
        const statusRef = window.firebaseRef(window.firebaseDatabase, `/games/cube_realtime/${gameId}/status`);

        // 게임 상태 변경 리스너
        window.firebaseOnValue(statusRef, (snapshot) => {
            const statusData = snapshot.val();
            if (statusData && window.unityInstance) {
                const participantCount = statusData.participantCount || 0;
                const totalPot = statusData.totalPot || 0;
                const progressPercent = statusData.progressPercent || 0;
                const availablePositions = statusData.availablePositions ?? Math.max(0, 2047 - participantCount);
                const settlementAt = statusData.settlementAt || null;
                const status = statusData.status || '';
                const lastUpdatedAt = statusData.lastUpdatedAt || Date.now();

                window.unityInstance.SendMessage('Bridge', 'OnCubeGameRealtimeStatusUpdate', JSON.stringify({
                    participantCount,
                    totalPot,
                    lastUpdatedAt,
                    availablePositions,
                    progressPercent,
                    settlementAt,
                    status
                }));
            }
        });
        
        // 최근 참가자 리스너
        const recentJoinsRef = window.firebaseRef(window.firebaseDatabase, `/games/cube_realtime/${gameId}/recent_joins`);
        window.firebaseOnChildAdded(recentJoinsRef, (snapshot) => {
            const joinData = snapshot.val();
            if (joinData && window.unityInstance) {
                window.unityInstance.SendMessage('Bridge', 'OnCubeGamePlayerJoinUpdate', JSON.stringify({
                    position: joinData.position || snapshot.key,
                    joinedAt: joinData.joinedAt || Date.now()
                }));
            }
        });
        
        // 위치 점유 리스너
        const positionsRef = window.firebaseRef(window.firebaseDatabase, `/games/cube/${gameId}/positions`);
        window.firebaseOnChildChanged(positionsRef, (snapshot) => {
            const positionData = snapshot.val();
            if (positionData && window.unityInstance) {
                const isOccupied = Boolean(positionData.isOccupied);
                window.unityInstance.SendMessage('Bridge', 'OnCubeGamePositionUpdate', JSON.stringify({
                    position: positionData.code || snapshot.key,
                    occupiedBy: isOccupied ? (positionData.occupiedBy || '') : '',
                    occupiedAt: isOccupied ? (positionData.occupiedAt || Date.now()) : Date.now(),
                    email: isOccupied ? (positionData.email || '') : ''
                }));
            }
        });

        // 리스너 참조 저장 (나중에 해제하기 위해)
        if (!window.cubeGameListeners) {
            window.cubeGameListeners = {};
        }
        window.cubeGameListeners[gameId] = {
            statusRef: statusRef,
            recentJoinsRef: recentJoinsRef,
            positionsRef: positionsRef
        };
        
        console.log('✅ Subscribed to cube game realtime:', gameId);
        
    } catch (error) {
        console.error('❌ Error subscribing to cube game realtime:', error);
    }
};

// 큐브 게임 실시간 구독 해제 (Unity에서 호출)
window.unsubscribeFromCubeGameRealtime = (dataStr) => {
    try {
        console.log('🎮 Unsubscribing from cube game realtime');
        
        if (window.cubeGameListeners) {
            // 모든 리스너 해제
            Object.keys(window.cubeGameListeners).forEach(gameId => {
                const listeners = window.cubeGameListeners[gameId];
                
                if (listeners.statusRef && window.firebaseOff) {
                    window.firebaseOff(listeners.statusRef);
                }
                if (listeners.recentJoinsRef && window.firebaseOff) {
                    window.firebaseOff(listeners.recentJoinsRef);
                }
                if (listeners.positionsRef && window.firebaseOff) {
                    window.firebaseOff(listeners.positionsRef);
                }
                
                console.log('✅ Unsubscribed from cube game:', gameId);
            });
            
            window.cubeGameListeners = {};
        }
        
        console.log('✅ Unsubscribed from all cube game realtime updates');
        
    } catch (error) {
        console.error('❌ Error unsubscribing from cube game realtime:', error);
    }
};

// --------------------------------------------------
// Game history subscription helpers
// --------------------------------------------------

window.subscribeToGameHistory = (dataStr) => {
    try {
        if (!window.pointHubApp) {
            console.warn('PointHubApp not ready for history subscription');
            return;
        }
        window.pointHubApp.startHistorySubscription('unity-call');
    } catch (error) {
        console.error('❌ subscribeToGameHistory failed:', error);
    }
};

window.unsubscribeFromGameHistory = () => {
    try {
        if (!window.pointHubApp) {
            return;
        }
        window.pointHubApp.stopHistorySubscription();
    } catch (error) {
        console.error('❌ unsubscribeFromGameHistory failed:', error);
    }
};

window.markHistoryNotificationSeen = async (dataStr) => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const historyId = params.historyId;
        const uid = window.firebaseAuth?.currentUser?.uid;

        if (!historyId || !uid) {
            return;
        }

        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseUpdate) {
            throw new Error('Firebase helpers not ready');
        }

        const historyRef = window.firebaseRef(window.firebaseDatabase, `/gameHistory/${uid}/${historyId}`);
        await window.firebaseUpdate(historyRef, {
            isPopupOpen: true,
            popupOpenedAt: Date.now()
        });

        console.log(`✅ Marked gameHistory/${uid}/${historyId} as popup open`);
    } catch (error) {
        console.error('❌ markHistoryNotificationSeen failed:', error);
    }
};

// --------------------------------------------------
// Golden Bell RTDB helpers and subscriptions
// --------------------------------------------------

const GOLDEN_BELL_RTDB_PATH = '/games/goldenbell';
const GOLDEN_BELL_DEFAULT_LOOKBACK_MS = 15 * 60 * 1000; // 15 minutes

if (!window.goldenBellRealtime) {
    window.goldenBellRealtime = {
        gameRef: null,
        participantRefs: {},
        vipStatusCache: {}
    };
} else {
    window.goldenBellRealtime.vipStatusCache = window.goldenBellRealtime.vipStatusCache || {};
}

function sendGoldenBellMessage(methodName, payload) {
    try {
        const serialized = JSON.stringify(payload);
        if (window.unityInstance) {
            window.unityInstance.SendMessage('Bridge', methodName, serialized);
        } else {
            console.warn(`Unity instance not ready. Buffered Golden Bell message: ${methodName}`, serialized);
        }
    } catch (error) {
        console.error('❌ Failed to send Golden Bell message to Unity:', error);
    }
}

function normalizeTimestamp(value, fallback) {
    const parsed = typeof value === 'string' ? Number(value) : value;
    if (Number.isFinite(parsed)) {
        return parsed;
    }
    return fallback;
}

function normalizeGoldenBellGame(gameId, rawGame) {
    const fallbackStart = Number(gameId?.replace('goldenbell_', '')) || Date.now();
    const startAt = normalizeTimestamp(
        rawGame?.startAt ?? rawGame?.nextRoundStartAt ?? rawGame?.bettingStartAt ?? rawGame?.createdAt,
        fallbackStart
    );
    const participants = rawGame?.participants ? Object.keys(rawGame.participants) : [];
    return {
        ...rawGame,
        gameId,
        startAt,
        participantCount: participants.length,
        bettingStartAt: normalizeTimestamp(rawGame?.bettingStartAt, 0),
        bettingEndAt: normalizeTimestamp(rawGame?.bettingEndAt, 0),
        decisionEndAt: normalizeTimestamp(rawGame?.decisionEndAt, null),
        createdAt: normalizeTimestamp(rawGame?.createdAt, fallbackStart),
        totalPot: rawGame?.totalPot ?? 0,
        status: rawGame?.status ?? 'waiting',
        round: rawGame?.round ?? 1,
        maxRounds: rawGame?.maxRounds ?? 10
    };
}

window.fetchGoldenBellUpcomingGames = async (dataStr = '{}') => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const limit = Number(params.limit) > 0 ? Number(params.limit) : 20;
        const now = Number(params.now) || Date.now();
        const includeFinished = !!params.includeFinished;
        const lookbackMs = Number.isFinite(params.lookbackMs) ? params.lookbackMs : (24 * 60 * 60 * 1000); // 24시간으로 확장
        
        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnce) {
            throw new Error('Firebase is not initialized');
        }
        
        // 인증 상태 확인
        const currentUser = window.firebaseAuth?.currentUser;
        if (!currentUser) {
            console.warn('⚠️ User not authenticated, attempting to read goldenbell data anyway');
        }
        
        const gamesRef = window.firebaseRef(window.firebaseDatabase, GOLDEN_BELL_RTDB_PATH);
        const snapshot = await window.firebaseOnce(gamesRef);
        const rawGames = snapshot.exists() ? snapshot.val() : {};
        
        console.log(`📊 Found ${Object.keys(rawGames).length} games in RTDB (path: ${GOLDEN_BELL_RTDB_PATH})`);
        console.log(`🔍 Filter params: now=${now}, lookbackMs=${lookbackMs}, includeFinished=${includeFinished}`);
        
        // 샘플 게임 데이터 로깅
        if (Object.keys(rawGames).length > 0) {
            const sampleGameId = Object.keys(rawGames)[0];
            const sampleGame = rawGames[sampleGameId];
            console.log(`📋 Sample game (${sampleGameId}):`, {
                startAt: sampleGame?.startAt,
                bettingStartAt: sampleGame?.bettingStartAt,
                createdAt: sampleGame?.createdAt,
                status: sampleGame?.status
            });
        }
        
        const allGames = Object.entries(rawGames)
            .map(([gameId, game]) => {
                const normalized = normalizeGoldenBellGame(gameId, game);
                // 특정 게임 디버깅
                if (gameId === 'goldenbell_1763977500000') {
                    console.log(`🎯 Normalized game ${gameId}:`, {
                        original: { startAt: game?.startAt, status: game?.status },
                        normalized: { startAt: normalized.startAt, status: normalized.status }
                    });
                }
                return normalized;
            })
            .filter((game) => {
                // lookbackMs 범위 내 게임만 (과거 게임 포함, status 무시)
                const inRange = game.startAt >= (now - lookbackMs);
                return inRange;
            });
        
        console.log(`✅ After filtering: ${allGames.length} games`);
        
        // 현재 시간과 가장 가까운 순으로 정렬 (과거/미래 상관없이)
        allGames.sort((a, b) => {
            const aDistance = Math.abs(a.startAt - now);
            const bDistance = Math.abs(b.startAt - now);
            return aDistance - bDistance;
        });
        
        const games = allGames.slice(0, limit);
        
        sendGoldenBellMessage('OnGoldenBellUpcomingGames', {
            success: true,
            games,
            requestedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ fetchGoldenBellUpcomingGames failed:', error);
        let errorMessage = error.message;
        if (error.code === 'PERMISSION_DENIED' || error.message.includes('permission_denied')) {
            errorMessage = 'Permission denied. Please check Firebase Realtime Database security rules for /goldenbell path.';
            console.error('🔒 RTDB Security Rules Issue: /goldenbell path needs read permission');
            console.error('💡 Fix: Update Firebase Console > Realtime Database > Rules to allow read access');
        }
        sendGoldenBellMessage('OnGoldenBellUpcomingGames', {
            success: false,
            error: errorMessage,
            errorCode: error.code,
            requestedAt: Date.now()
        });
    }
};

window.subscribeToGoldenBellGame = (dataStr) => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const gameId = params.gameId;
        if (!gameId) {
            throw new Error('gameId is required to subscribe to Golden Bell game');
        }
        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) {
            throw new Error('Firebase is not initialized');
        }
        
        if (window.goldenBellRealtime.gameRef && window.firebaseOff) {
            window.firebaseOff(window.goldenBellRealtime.gameRef);
            window.goldenBellRealtime.gameRef = null;
        }
        
        const gameRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}`);
        window.firebaseOnValue(gameRef, (snapshot) => {
            const gameData = snapshot.val();
            if (!gameData) {
                return;
            }
            const normalized = normalizeGoldenBellGame(gameId, gameData);
            sendGoldenBellMessage('OnGoldenBellGameUpdate', {
                success: true,
                game: normalized,
                receivedAt: Date.now()
            });
        });
        
        window.goldenBellRealtime.gameRef = gameRef;
        sendGoldenBellMessage('OnGoldenBellGameSubscribed', {
            success: true,
            gameId,
            subscribedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ subscribeToGoldenBellGame failed:', error);
        sendGoldenBellMessage('OnGoldenBellGameSubscribed', {
            success: false,
            error: error.message,
            subscribedAt: Date.now()
        });
    }
};

window.unsubscribeFromGoldenBellGame = () => {
    try {
        if (window.goldenBellRealtime.gameRef && window.firebaseOff) {
            window.firebaseOff(window.goldenBellRealtime.gameRef);
            window.goldenBellRealtime.gameRef = null;
        }
        sendGoldenBellMessage('OnGoldenBellGameUnsubscribed', {
            success: true,
            unsubscribedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ unsubscribeFromGoldenBellGame failed:', error);
        sendGoldenBellMessage('OnGoldenBellGameUnsubscribed', {
            success: false,
            error: error.message,
            unsubscribedAt: Date.now()
        });
    }
};

window.subscribeToGoldenBellParticipant = (dataStr) => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid } = params;
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required for participant subscription');
        }
        if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnValue) {
            throw new Error('Firebase is not initialized');
        }
        
        const key = `${gameId}_${uid}`;
        if (window.goldenBellRealtime.participantRefs[key] && window.firebaseOff) {
            window.firebaseOff(window.goldenBellRealtime.participantRefs[key]);
        }
        
        const participantRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}`);
        
        // 구독 전에 초기 데이터를 한 번 읽어서 보내기
        window.firebaseOnce(participantRef).then((snapshot) => {
            sendGoldenBellMessage('OnGoldenBellParticipantUpdate', {
                success: true,
                gameId,
                uid,
                participant: snapshot.val(),
                receivedAt: Date.now()
            });
        }).catch((error) => {
            console.error('❌ Error reading initial participant data:', error);
        });
        
        // 실시간 업데이트 구독
        window.firebaseOnValue(participantRef, (snapshot) => {
            sendGoldenBellMessage('OnGoldenBellParticipantUpdate', {
                success: true,
                gameId,
                uid,
                participant: snapshot.val(),
                receivedAt: Date.now()
            });
        });
        
        window.goldenBellRealtime.participantRefs[key] = participantRef;
        sendGoldenBellMessage('OnGoldenBellParticipantSubscribed', {
            success: true,
            gameId,
            uid,
            subscribedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ subscribeToGoldenBellParticipant failed:', error);
        sendGoldenBellMessage('OnGoldenBellParticipantSubscribed', {
            success: false,
            error: error.message,
            subscribedAt: Date.now()
        });
    }
};

window.unsubscribeFromGoldenBellParticipant = (dataStr) => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid } = params;
        
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required to unsubscribe participant');
        }
        
        const key = `${gameId}_${uid}`;
        if (window.goldenBellRealtime.participantRefs[key] && window.firebaseOff) {
            window.firebaseOff(window.goldenBellRealtime.participantRefs[key]);
            delete window.goldenBellRealtime.participantRefs[key];
        }
        
        sendGoldenBellMessage('OnGoldenBellParticipantUnsubscribed', {
            success: true,
            gameId,
            uid,
            unsubscribedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ unsubscribeFromGoldenBellParticipant failed:', error);
        sendGoldenBellMessage('OnGoldenBellParticipantUnsubscribed', {
            success: false,
            error: error.message,
            unsubscribedAt: Date.now()
        });
    }
};

function ensureFirebaseRealtimeHelpers() {
    if (!window.firebaseDatabase || !window.firebaseRef || !window.firebaseOnce || !window.firebaseSet || !window.firebaseUpdate) {
        throw new Error('Firebase helpers are not ready');
    }
}

async function resolveVipStatus(uid, existingParticipant) {
    if (!uid) {
        return false;
    }

    if (existingParticipant && typeof existingParticipant.isVip === 'boolean') {
        return existingParticipant.isVip;
    }

    const cache = window.goldenBellRealtime?.vipStatusCache || {};
    if (typeof cache[uid] === 'boolean') {
        return cache[uid];
    }

    let isVip = false;
    try {
        const membershipRef = window.firebaseRef(window.firebaseDatabase, `/users/${uid}/profile/membership`);
        const membershipSnapshot = await window.firebaseOnce(membershipRef);
        const membershipValue = membershipSnapshot.exists() ? membershipSnapshot.val() : null;
        if (typeof membershipValue === 'string') {
            isVip = membershipValue.trim().toLowerCase() === 'vip';
        }
    } catch (error) {
        console.warn('[resolveVipStatus] Failed to read membership, defaulting to false', error);
    }

    window.goldenBellRealtime.vipStatusCache = window.goldenBellRealtime.vipStatusCache || {};
    window.goldenBellRealtime.vipStatusCache[uid] = isVip;
    return isVip;
}

function normalizeGoldenBellChoice(choice) {
    if (!choice) return null;
    const value = String(choice).toLowerCase();
    if (value === 'player') return 'even';
    if (value === 'banker') return 'odd';
    if (value === 'even' || value === 'odd') return value;
    return null;
}

function emitGoldenBellActionResult(payload) {
    sendGoldenBellMessage('OnGoldenBellActionResult', {
        success: payload.success,
        action: payload.action,
        gameId: payload.gameId,
        uid: payload.uid,
        timestamp: Date.now(),
        error: payload.error || null
    });
}

window.registerGoldenBellParticipant = async (dataStr) => {
    try {
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid, email } = params;
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required');
        }

        // 서버 함수 호출 (USDT 차감 포함)
        if (!window.firebaseFunctions || !window.httpsCallable) {
            throw new Error('Firebase Functions not initialized');
        }

        console.log(`📝 Registering participant via server function - gameId: ${gameId}, uid: ${uid}, email: ${email || 'none'}`);
        const registerFunction = window.httpsCallable(window.firebaseFunctions, 'registerGoldenBellParticipant');
        const result = await registerFunction({ gameId, email: email || '' });

        console.log(`📝 Server function response:`, result.data);

        if (result.data && result.data.success) {
            console.log(`✅ Participant registered successfully via server: ${uid} in game ${gameId}`, result.data);
            emitGoldenBellActionResult({ 
                success: true, 
                action: 'register', 
                gameId, 
                uid,
                newBalance: result.data.newBalance,
                transactionId: result.data.transactionId
            });
        } else {
            const errorMsg = result.data?.error || result.data?.message || 'Registration failed';
            console.error(`❌ Registration failed:`, result.data);
            throw new Error(errorMsg);
        }
    } catch (error) {
        console.error('❌ registerGoldenBellParticipant failed:', error);
        console.error('❌ Error details:', {
            code: error.code,
            message: error.message,
            stack: error.stack,
            details: error.details
        });
        emitGoldenBellActionResult({ 
            success: false, 
            action: 'register', 
            gameId: params?.gameId || null, 
            uid: params?.uid || null, 
            error: error.message || 'Unknown error',
            errorCode: error.code
        });
    }
};

window.submitGoldenBellChoiceRealtime = async (dataStr) => {
    try {
        ensureFirebaseRealtimeHelpers();
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid, choice, round, totalBet, isVip } = params;
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required');
        }

        const normalizedChoice = normalizeGoldenBellChoice(choice);
        if (!normalizedChoice) {
            throw new Error('Invalid choice value');
        }

        const participantRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}`);
        const now = Date.now();

        let existingParticipant = null;
        try {
            const participantSnapshot = await window.firebaseOnce(participantRef);
            existingParticipant = participantSnapshot.exists() ? participantSnapshot.val() : null;
        } catch (error) {
            console.warn('[submitGoldenBellChoiceRealtime] Failed to read participant before update', error);
        }

        const updateData = {
            choice: normalizedChoice,
            choiceSubmittedAt: now,
            currentRound: round || 1
        };
        
        // totalBet이 제공되면 업데이트 (로컬에서 계산된 값)
        if (totalBet !== undefined && totalBet !== null) {
            updateData.totalBet = parseFloat(totalBet);
            console.log(`[submitGoldenBellChoiceRealtime] Updating totalBet to ${updateData.totalBet}`);
        } else if (!existingParticipant) {
            updateData.totalBet = 1;
        }

        // Unity에서 받은 isVip 값을 우선 사용, 없으면 서버에서 조회
        let finalIsVip = false;
        if (typeof isVip === 'boolean') {
            finalIsVip = isVip;
            console.log(`[submitGoldenBellChoiceRealtime] Using isVip from Unity: ${finalIsVip}`);
        } else {
            finalIsVip = await resolveVipStatus(uid, existingParticipant);
            console.log(`[submitGoldenBellChoiceRealtime] Resolved isVip from server: ${finalIsVip}`);
        }
        updateData.isVip = finalIsVip;

        if (!existingParticipant) {
            updateData.joinedAt = now;
            updateData.joinedRound = round || 1;
            updateData.accumulatedReward = 0;
            updateData.isActive = true;
        }

        await window.firebaseUpdate(participantRef, updateData);

        emitGoldenBellActionResult({ success: true, action: 'choice', gameId, uid });
    } catch (error) {
        console.error('❌ submitGoldenBellChoiceRealtime failed:', error);
        emitGoldenBellActionResult({ success: false, action: 'choice', gameId: null, uid: null, error: error.message });
    }
};

window.submitGoldenBellDecisionRealtime = async (dataStr) => {
    try {
        ensureFirebaseRealtimeHelpers();
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid, decision } = params;
        if (!gameId || !uid || !decision) {
            throw new Error('gameId, uid and decision are required');
        }

        const participantRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}`);
        const now = Date.now();
        await window.firebaseUpdate(participantRef, {
            decision,
            decisionSubmittedAt: now
        });

        emitGoldenBellActionResult({ success: true, action: 'decision', gameId, uid });
    } catch (error) {
        console.error('❌ submitGoldenBellDecisionRealtime failed:', error);
        emitGoldenBellActionResult({ success: false, action: 'decision', gameId: null, uid: null, error: error.message });
    }
};

window.checkGoldenBellParticipantExists = async (dataStr) => {
    try {
        ensureFirebaseRealtimeHelpers();
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid } = params;
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required');
        }

        const participantRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}`);
        const snapshot = await window.firebaseOnce(participantRef);
        
        const exists = snapshot.exists();
        const participant = exists ? normalizeGoldenBellParticipant(uid, snapshot.val()) : null;
        
        sendGoldenBellMessage('OnGoldenBellParticipantExists', {
            success: true,
            gameId,
            uid,
            exists,
            participant
        });
    } catch (error) {
        console.error('❌ checkGoldenBellParticipantExists failed:', error);
        sendGoldenBellMessage('OnGoldenBellParticipantExists', {
            success: false,
            gameId: null,
            uid: null,
            exists: false,
            participant: null,
            error: error.message
        });
    }
};

window.updateGoldenBellParticipantReward = async (dataStr) => {
    let params = {};
    try {
        ensureFirebaseRealtimeHelpers();
        params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId, uid, accumulatedReward, isWinner, round, reward } = params;
        if (!gameId || !uid) {
            throw new Error('gameId and uid are required');
        }

        const participantRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}`);
        const updateData = {};
        if (accumulatedReward !== undefined && accumulatedReward !== null) {
            updateData.accumulatedReward = parseFloat(accumulatedReward);
        }
        if (isWinner !== undefined && isWinner !== null) {
            updateData.isWinner = Boolean(isWinner);
        }
        updateData.lastRewardUpdatedAt = Date.now();

        await window.firebaseUpdate(participantRef, updateData);

        await persistRoundRewardLogs(gameId, uid, round, reward);

        emitGoldenBellActionResult({ success: true, action: 'updateReward', gameId, uid });
    } catch (error) {
        console.error('❌ updateGoldenBellParticipantReward failed:', error);
        emitGoldenBellActionResult({ success: false, action: 'updateReward', gameId: params?.gameId || null, uid: params?.uid || null, error: error.message });
    }
};

async function persistRoundRewardLogs(gameId, uid, round, rewardPayload) {
    if (!rewardPayload) {
        return;
    }

    const normalizedRound = Number(rewardPayload.round ?? round);
    if (!Number.isFinite(normalizedRound) || normalizedRound <= 0) {
        console.warn('[updateGoldenBellParticipantReward] Skipping reward persistence - invalid round', rewardPayload);
        return;
    }

    const safeNumber = (value, fallback = 0) => {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };

    const sanitizedReward = {
        round: Math.floor(normalizedRound),
        winnerCount: safeNumber(rewardPayload.winnerCount),
        vipWinnerCount: safeNumber(rewardPayload.vipWinnerCount),
        opponentPot: safeNumber(rewardPayload.opponentPot),
        baseRewardPerWinner: safeNumber(rewardPayload.baseRewardPerWinner),
        vipBonusPerWinner: safeNumber(rewardPayload.vipBonusPerWinner),
        vipBonusTotal: safeNumber(rewardPayload.vipBonusTotal),
        totalRewardPerWinner: safeNumber(rewardPayload.totalRewardPerWinner),
        totalRoundPot: safeNumber(rewardPayload.totalRoundPot)
    };

    const rewardWithMeta = {
        ...sanitizedReward,
        recordedAt: Date.now()
    };

    const participantLogRef = window.firebaseRef(
        window.firebaseDatabase,
        `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants/${uid}/roundRewardLogs/${sanitizedReward.round}`
    );
    const roundResultRef = window.firebaseRef(
        window.firebaseDatabase,
        `${GOLDEN_BELL_RTDB_PATH}/${gameId}/results/${sanitizedReward.round}/reward`
    );

    await Promise.all([
        window.firebaseSet(participantLogRef, sanitizedReward),
        window.firebaseSet(roundResultRef, rewardWithMeta)
    ]);
}

window.fetchGoldenBellParticipants = async (dataStr) => {
    try {
        ensureFirebaseRealtimeHelpers();
        const params = typeof dataStr === 'string' && dataStr.length ? JSON.parse(dataStr) : {};
        const { gameId } = params;
        if (!gameId) {
            throw new Error('gameId is required');
        }

        const participantsRef = window.firebaseRef(window.firebaseDatabase, `${GOLDEN_BELL_RTDB_PATH}/${gameId}/participants`);
        const snapshot = await window.firebaseOnce(participantsRef);
        
        const participants = [];
        if (snapshot.exists()) {
            const data = snapshot.val();
            for (const uid in data) {
                if (data.hasOwnProperty(uid)) {
                    participants.push({
                        uid,
                        ...data[uid]
                    });
                }
            }
        }

        sendGoldenBellMessage('OnGoldenBellParticipantsFetched', {
            success: true,
            gameId,
            participants,
            fetchedAt: Date.now()
        });
    } catch (error) {
        console.error('❌ fetchGoldenBellParticipants failed:', error);
        sendGoldenBellMessage('OnGoldenBellParticipantsFetched', {
            success: false,
            gameId: params?.gameId || null,
            participants: [],
            error: error.message,
            fetchedAt: Date.now()
        });
    }
};
