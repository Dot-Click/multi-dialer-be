import cron from "node-cron";
import prisma from "../lib/prisma";
import { deleteFromR2 } from "../utils/r2-uploader";
import { deleteUserFromDb } from "../routes/user/service";

export const startRetentionJobs = () => {
    // Run every day at midnight (00:00)
    cron.schedule("0 0 * * *", async () => {
        console.log("Running data retention cleanup job...");
        try {
            const companies = await prisma.company.findMany();

            for (const company of companies) {
                const now = new Date();

                // 1. Call Log Retention
                if (company.callLogRetentionDays > 0) {
                    const logCutoff = new Date(now);
                    logCutoff.setDate(now.getDate() - company.callLogRetentionDays);

                    const expiredLogs = await prisma.callRecord.findMany({
                        where: {
                            userId: company.userId, // Delete logs for this company's admin
                            createdAt: {
                                lt: logCutoff
                            }
                        },
                        select: { id: true, recordingUrl: true },
                    });

                    if (expiredLogs.length > 0) {
                        for (const log of expiredLogs) {
                            await deleteFromR2(log.recordingUrl);
                        }

                        const deletedLogs = await prisma.callRecord.deleteMany({
                            where: { id: { in: expiredLogs.map((l) => l.id) } },
                        });
                        console.log(`Deleted ${deletedLogs.count} call logs for company ${company.companyName}`);
                    }
                }

                // 2. Call Recording Retention (DB Focus)
                if (company.callRecordingRetentionDays > 0) {
                    const recordingCutoff = new Date(now);
                    recordingCutoff.setDate(now.getDate() - company.callRecordingRetentionDays);

                    const expiredRecordings = await prisma.callRecord.findMany({
                        where: {
                            userId: company.userId,
                            recordingUrl: { not: null },
                            createdAt: {
                                lt: recordingCutoff
                            }
                        },
                        select: { id: true, recordingUrl: true },
                    });

                    if (expiredRecordings.length > 0) {
                        for (const rec of expiredRecordings) {
                            await deleteFromR2(rec.recordingUrl);
                        }

                        const updatedRecordings = await prisma.callRecord.updateMany({
                            where: { id: { in: expiredRecordings.map((r) => r.id) } },
                            data: { recordingUrl: null },
                        });
                        console.log(`Nullified ${updatedRecordings.count} recording URLs for company ${company.companyName}`);
                    }
                }

                // 3. Inactive User Data Retention
                if (company.inactiveUserDataRetentionDays > 0) {
                    const userCutoff = new Date(now);
                    userCutoff.setDate(now.getDate() - company.inactiveUserDataRetentionDays);

                    // Find users who haven't logged in since the cutoff and are part of this company
                    // Note: This logic assumes users are linked to the company creator
                    const inactiveUsers = await prisma.user.findMany({
                        where: {
                            createdById: company.userId, // Users created by this company admin
                            lastLogin: {
                                lt: userCutoff
                            }
                        },
                        select: { id: true },
                    });

                    if (inactiveUsers.length > 0) {
                        // Route through deleteUserFromDb (not a raw deleteMany) so each
                        // user's Twilio sub-account/numbers and R2 files are torn down
                        // before their row disappears — same as any other deletion path.
                        for (const inactiveUser of inactiveUsers) {
                            await deleteUserFromDb(inactiveUser.id).catch((err: any) =>
                                console.error(`Failed to delete inactive user ${inactiveUser.id}:`, err.message || err)
                            );
                        }
                        console.log(`Deleted ${inactiveUsers.length} inactive users for company ${company.companyName}`);
                    }
                }
            }
        } catch (error) {
            console.error("Error in data retention job:", error);
        }
    });
};
