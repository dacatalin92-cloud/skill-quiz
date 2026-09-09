const webpush = require('web-push');

// Client minimal pentru notificari Web Push (protocolul standard folosit de
// Chrome, Edge, Firefox si Safari/iOS 16.4+ pentru notificari "ca de
// aplicatie" trimise catre telefon, fara WhatsApp si fara App Store).
// Cheile VAPID sunt generate o singura data (nu necesita niciun cont extern,
// spre deosebire de Twilio) si identifica serverul nostru fata de furnizorii
// de push ai browserelor.
function makePush({ publicKey, privateKey, subject }) {
  webpush.setVapidDetails(subject, publicKey, privateKey);

async function sendToSubscription(subscription, payload) {
  const pushSubscription = {
    endpoint: subscription.endpoint,
    keys: {
      p256dh: subscription.p256dh,
      auth: subscription.auth,
    },
  };
  await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
}

return { sendToSubscription };
}

module.exports = { makePush };
