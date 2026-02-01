"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAllUsersVip = void 0;
const https_1 = require("firebase-functions/v2/https");
const firebase_config_1 = require("./firebase-config");
exports.setAllUsersVip = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
    try {
        console.log('[setAllUsersVip] Starting to set all users as VIP...');
        // Get all users
        const usersSnapshot = await firebase_config_1.rtdb.ref('/users').once('value');
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
        const updates = {};
        userIds.forEach(uid => {
            updates[`/users/${uid}/profile/membership`] = 'vip';
        });
        // Execute batch update
        await firebase_config_1.rtdb.ref().update(updates);
        console.log(`[setAllUsersVip] Successfully updated ${userIds.length} users to VIP status`);
        return {
            success: true,
            message: `Successfully set ${userIds.length} users as VIP`,
            usersUpdated: userIds.length,
            updatedUsers: userIds
        };
    }
    catch (error) {
        console.error('[setAllUsersVip] Failed to set users as VIP:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new https_1.HttpsError('internal', `Failed to set users as VIP: ${errorMessage}`);
    }
});
//# sourceMappingURL=admin-tools.js.map