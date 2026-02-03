import * as admin from 'firebase-admin';

// Initialize Firebase Admin once for the entire application
if (admin.apps.length === 0) {
  admin.initializeApp({
    // [기존 pointhub-ab054 설정 - 이전 시 주석 해제]
    // databaseURL: 'https://pointhub-ab054-default-rtdb.asia-southeast1.firebasedatabase.app'
    // [새 point-hub-a9db1 설정]
    databaseURL: 'https://point-hub-a9db1-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
}

export const rtdb = admin.database();
export default admin;
