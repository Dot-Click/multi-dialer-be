import cron from "node-cron";
import prisma from "../lib/prisma";

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

                    const deletedLogs = await prisma.callRecord.deleteMany({
                        where: {
                            userId: company.userId, // Delete logs for this company's admin
                            createdAt: {
                                lt: logCutoff
                            }
                        }
                    });
                    if (deletedLogs.count > 0) {
                        console.log(`Deleted ${deletedLogs.count} call logs for company ${company.companyName}`);
                    }
                }

                // 2. Call Recording Retention (DB Focus)
                if (company.callRecordingRetentionDays > 0) {
                    const recordingCutoff = new Date(now);
                    recordingCutoff.setDate(now.getDate() - company.callRecordingRetentionDays);

                    const updatedRecordings = await prisma.callRecord.updateMany({
                        where: {
                            userId: company.userId,
                            recordingUrl: { not: null },
                            createdAt: {
                                lt: recordingCutoff
                            }
                        },
                        data: {
                            recordingUrl: null
                        }
                    });
                    if (updatedRecordings.count > 0) {
                        console.log(`Nullified ${updatedRecordings.count} recording URLs for company ${company.companyName}`);
                    }
                }

                // 3. Inactive User Data Retention
                if (company.inactiveUserDataRetentionDays > 0) {
                    const userCutoff = new Date(now);
                    userCutoff.setDate(now.getDate() - company.inactiveUserDataRetentionDays);

                    // Find users who haven't logged in since the cutoff and are part of this company
                    // Note: This logic assumes users are linked to the company creator
                    const inactiveUsers = await prisma.user.deleteMany({
                        where: {
                            createdById: company.userId, // Users created by this company admin
                            lastLogin: {
                                lt: userCutoff
                            }
                        }
                    });
                    if (inactiveUsers.count > 0) {
                        console.log(`Deleted ${inactiveUsers.count} inactive users for company ${company.companyName}`);
                    }
                }
            }
        } catch (error) {
            console.error("Error in data retention job:", error);
        }
    });
};
