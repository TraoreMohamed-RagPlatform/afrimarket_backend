const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

let firebaseInitialized = false;

// ========================================
// INITIALISER FIREBASE ADMIN SDK
// ========================================
const initializeFirebase = () => {
  if (firebaseInitialized) {
    try {
      return admin.getApp();
    } catch (error) {
      console.error('[firebaseService]', error);
      return null;
    }
  }

  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || 
      path.join(__dirname, '../../config/firebase-service-account.json');

    // Lire le fichier JSON avec fs
    const serviceAccountJSON = fs.readFileSync(serviceAccountPath, 'utf8');
    const serviceAccount = JSON.parse(serviceAccountJSON);

    // Initialiser Firebase avec la bonne syntax
    admin.initializeApp({
      credential: admin.cert(serviceAccount),
      projectId: process.env.FIREBASE_PROJECT_ID
    });

    firebaseInitialized = true;
    console.log('✅ Firebase Admin SDK initialisé avec succès');
    return admin.getApp();
  } catch (error) {
    console.error('❌ Erreur initialisation Firebase:', error.message);
    return null;
  }
};

// ========================================
// ENVOYER NOTIFICATION PUSH À UN UTILISATEUR
// ========================================
const sendPushNotification = async (fcmToken, notification) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      console.warn('⚠️ Firebase non initialisé');
      return { success: false, error: 'Firebase not initialized' };
    }

    const message = {
      token: fcmToken,
      notification: {
        title: notification.title || 'AfriMarket',
        body: notification.body || '',
      },
      webpush: {
        fcmOptions: {
          link: notification.link || 'https://afrimarket.com'
        }
      },
      data: notification.data || {}
    };

    const response = await admin.messaging().send(message);
    console.log('✅ Notification envoyée:', response);
    return { success: true, messageId: response };
  } catch (error) {
    console.error('❌ Erreur envoi notification:', error.message);
    return { success: false, error: 'Operation failed' };
  }
};

// ========================================
// ENVOYER NOTIFICATION PUSH À PLUSIEURS UTILISATEURS
// ========================================
const sendPushNotificationBatch = async (fcmTokens, notification) => {
  try {
    const app = initializeFirebase();
    if (!app) {
      console.warn('⚠️ Firebase non initialisé');
      return { success: false, error: 'Firebase not initialized' };
    }

    const messages = fcmTokens.map(token => ({
      token,
      notification: {
        title: notification.title || 'AfriMarket',
        body: notification.body || '',
      },
      webpush: {
        fcmOptions: {
          link: notification.link || 'https://afrimarket.com'
        }
      },
      data: notification.data || {}
    }));

    const response = await admin.messaging().sendAll(messages);
    console.log(`✅ ${response.successCount} notifications envoyées`);
    return { 
      success: true, 
      successCount: response.successCount,
      failureCount: response.failureCount
    };
  } catch (error) {
    console.error('❌ Erreur envoi batch notifications:', error.message);
    return { success: false, error: 'Operation failed' };
  }
};

module.exports = {
  initializeFirebase,
  sendPushNotification,
  sendPushNotificationBatch
};
