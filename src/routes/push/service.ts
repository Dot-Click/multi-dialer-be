import prisma from "../../lib/prisma";
import webpush from "web-push";
import { envConfig } from "../../lib/config";

// Setup webpush
webpush.setVapidDetails(
    "mailto:admin@callscout.ai",
    "BC2L0WrqEqiq5ICO9mo__0bSRqBq6UOJBnWlIs30CyYPSTG1sqHy6KhyxHAo66UbLw__vcchpk88lWNVt1WBAD0",
    "bhvDg1CGbD1UTrkjWCroIw4WTHi136Z21ogSgrtByKc"
);

export const saveSubscription = async (userId: string, subscription: any) => {
    return prisma.pushSubscription.upsert({
        where: { endpoint: subscription.endpoint },
        update: {
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userId: userId
        },
        create: {
            endpoint: subscription.endpoint,
            p256dh: subscription.keys.p256dh,
            auth: subscription.keys.auth,
            userId: userId
        }
    });
};

export const removeSubscription = async (endpoint: string) => {
    return prisma.pushSubscription.deleteMany({
        where: { endpoint }
    });
};

export const sendNotificationToUser = async (userId: string, payload: { title: string; body: string; url?: string }) => {
    const subscriptions = await prisma.pushSubscription.findMany({
        where: { userId }
    });

    const sendPromises = subscriptions.map(sub => {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };

        return webpush.sendNotification(pushSubscription, JSON.stringify(payload))
            .catch(err => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    // Subscription has expired or is no longer valid
                    return prisma.pushSubscription.delete({ where: { id: sub.id } });
                }
                console.error("Error sending push notification:", err);
            });
    });

    return Promise.all(sendPromises);
};

export const broadcastNotification = async (payload: { title: string; body: string; url?: string }) => {
    const subscriptions = await prisma.pushSubscription.findMany();

    const sendPromises = subscriptions.map(sub => {
        const pushSubscription = {
            endpoint: sub.endpoint,
            keys: {
                p256dh: sub.p256dh,
                auth: sub.auth
            }
        };

        return webpush.sendNotification(pushSubscription, JSON.stringify(payload))
            .catch(err => {
                if (err.statusCode === 410 || err.statusCode === 404) {
                    return prisma.pushSubscription.delete({ where: { id: sub.id } });
                }
            });
    });

    return Promise.all(sendPromises);
};
