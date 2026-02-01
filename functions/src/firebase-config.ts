import * as admin from 'firebase-admin';

// Initialize Firebase Admin once for the entire application
if (admin.apps.length === 0) {
  admin.initializeApp({
    databaseURL: 'https://pointhub-ab054-default-rtdb.asia-southeast1.firebasedatabase.app'
  });
}

export const rtdb = admin.database();
export default admin;