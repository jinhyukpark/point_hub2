import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { CallableRequest } from 'firebase-functions/v2/https';
import { rtdb } from './firebase-config';

export const setAllUsersVip = onCall({ invoker: 'public' }, async (request: CallableRequest) => {

  try {
    console.log('[setAllUsersVip] Starting to set all users as VIP...');
    
    // Get all users
    const usersSnapshot = await rtdb.ref('/users').once('value');
    
    if (!usersSnapshot.exists()) {
      return {
        success: true,
        message: 'No users found to update',
        usersUpdated: 0
      };
    }

    const usersData = usersSnapshot.val();
    const userIds = Object.keys(usersData);
    
    console.log(`[setAllUsersVip] Found ${userIds.length} users to update`);

    // Prepare batch update
    const updates: Record<string, string> = {};
    
    userIds.forEach(uid => {
      updates[`/users/${uid}/profile/membership`] = 'vip';
    });

    // Execute batch update
    await rtdb.ref().update(updates);
    
    console.log(`[setAllUsersVip] Successfully updated ${userIds.length} users to VIP status`);

    return {
      success: true,
      message: `Successfully set ${userIds.length} users as VIP`,
      usersUpdated: userIds.length,
      updatedUsers: userIds
    };

  } catch (error) {
    console.error('[setAllUsersVip] Failed to set users as VIP:', error);
    
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    throw new HttpsError('internal', `Failed to set users as VIP: ${errorMessage}`);
  }
});