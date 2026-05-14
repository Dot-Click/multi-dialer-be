import bcrypt from "bcryptjs";
import prisma from "../../lib/prisma";
import { createTwilioSubAccount } from "../../services/twilio-account.service";
import { DEFAULT_MISC_FIELDS } from "../systemSettings/miscFields/defaults";
import { triggerZapierWebhook } from "../../lib/zapier";

function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

export async function createUserInDb(payload: any) {
    const { password, ...rest } = payload;

    // Hash password if provided
    const hashedPassword = await bcrypt.hash(password, 10);

    const existing = await prisma.user.findUnique({ where: { email: rest.email } });
    if (existing) throwHttp(400, "User with this email already exists");

    // Use a transaction for atomicity
    const newUser = await prisma.$transaction(async (tx) => {
        // 1. Create User
        const newUser = await tx.user.create({
            data: {
                ...rest,
                password: hashedPassword,
                emailVerified: true, // Administrative creation skips verification
            },
        });

        // 2. Create Account for Better Auth (Mandatory for Login)
        await tx.account.create({
            data: {
                userId: newUser.id,
                accountId: newUser.email,
                providerId: "credential",
                password: hashedPassword,
            }
        });

        // 3. Create Library
        const library = await tx.library.create({
            data: { userId: newUser.id }
        });

        // 4. Create System Settings
        const settings = await tx.system_Setting.create({
            data: { userId: newUser.id }
        });

        // 5. Initialize default misc fields
        if (DEFAULT_MISC_FIELDS.length > 0) {
            await tx.miscField.createMany({
                data: DEFAULT_MISC_FIELDS.map(f => ({
                    ...f,
                    systemSettingId: settings.id,
                    options: []
                }))
            });
        }

        // 6. Ensure DNC folder exists (System Default Folder)
        await tx.contactFolder.create({
            data: {
                name: "DNC",
                isSystem: true,
                userId: newUser.id
            }
        });

        // 7. Create Twilio Sub-Account (API CALL)
        // If this fails, the entire transaction (User, Account, etc.) will ROLL BACK
        try {
            const twilioSub = await createTwilioSubAccount(newUser.fullName || "Customer");
            
            // 8. Store Twilio credentials in an Integration record
            await tx.integration.create({
                data: {
                    systemSettingId: settings.id,
                    provider: "TWILIO",
                    credentials: {
                        accountSid: twilioSub.sid,
                        authToken: twilioSub.authToken,
                        status: twilioSub.status
                    },
                    status: "CONNECTED"
                }
            });
            
            console.log(`[UserService] Twilio sub-account integrated for user ${newUser.id}`);
        } catch (twilioError: any) {
            console.error(`[UserService] Twilio creation failed, rolling back user creation:`, twilioError.message);
            throw new Error(`Failed to provision Twilio resources: ${twilioError.message}. User creation aborted.`);
        }

        return newUser;
    }, {
        timeout: 20000 // Higher timeout for external Twilio API call
    });

    // Fire Zapier webhook AFTER transaction — non-blocking
    triggerZapierWebhook({
        event: "NEW_USER_SIGNUP",
        timestamp: new Date().toISOString(),
        user: {
            id: newUser.id,
            fullName: newUser.fullName,
            email: newUser.email,
            phone: (newUser as any).phone ?? null,
            role: newUser.role,
            plan: (newUser as any).plan ?? null,
            createdAt: newUser.createdAt,
        },
    });

    return newUser;
}

/**
 * Initializes a new user's account with essential records (Library, Settings, Twilio Sub-account, etc.)
 * Used primarily by the Better Auth sign-up hook for public signups.
 */
export async function initializeUserAccount(userId: string, fullName: string) {
    try {
        console.log(`[UserService] Initializing account for user: ${userId} (${fullName})`);

        // 1. Create Library if not exists
        let library = await prisma.library.findFirst({ where: { userId } });
        if (!library) {
            library = await prisma.library.create({ data: { userId } });
        }

        // 2. Create System Settings if not exists
        let settings = await prisma.system_Setting.findFirst({ where: { userId } });
        if (!settings) {
            settings = await prisma.system_Setting.create({ data: { userId } });
        }

        // 3. Initialize default misc fields
        const existingFields = await prisma.miscField.findMany({
            where: { systemSettingId: settings.id },
            select: { fieldName: true }
        });
        const existingNames = new Set(existingFields.map(f => f.fieldName.trim().toLowerCase()));
        const missingFields = DEFAULT_MISC_FIELDS.filter(f => !existingNames.has(f.fieldName.trim().toLowerCase()));
        
        if (missingFields.length > 0) {
            await prisma.miscField.createMany({
                data: missingFields.map(f => ({
                    ...f,
                    systemSettingId: settings.id,
                    options: []
                }))
            });
        }

        // 4. Ensure DNC folder exists
        const dncFolder = await prisma.contactFolder.findFirst({
            where: { userId, name: "DNC", isSystem: true }
        });
        if (!dncFolder) {
            await prisma.contactFolder.create({
                data: { name: "DNC", isSystem: true, userId }
            });
        }

        // 5. Create Twilio Sub-Account if not exists
        const existingTwilio = await prisma.integration.findFirst({
            where: { systemSettingId: settings.id, provider: "TWILIO" }
        });

        if (!existingTwilio) {
            try {
                const twilioSub = await createTwilioSubAccount(fullName);
                await prisma.integration.create({
                    data: {
                        systemSettingId: settings.id,
                        provider: "TWILIO",
                        credentials: {
                            accountSid: twilioSub.sid,
                            authToken: twilioSub.authToken,
                            status: twilioSub.status
                        },
                        status: "CONNECTED"
                    }
                });
                console.log(`[UserService] Twilio sub-account integrated for user ${userId}`);
            } catch (twilioError: any) {
                console.error(`[UserService] Twilio creation failed for ${userId}:`, twilioError.message);
            }
        }

        return { success: true };
    } catch (error: any) {
        console.error(`[UserService] Account initialization failed for user ${userId}:`, error.message);
        throw error;
    }
}

export async function getAllUsersFromDb(where: any = {}) {
    return prisma.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            status: true,
            lastLogin: true,
            createdAt: true,
            updatedAt: true,
            defaultCallerId: true,
            createdById: true,
            createdBy: {
                select: {
                    id: true,
                    fullName: true,
                    role: true,
                    status: true
                }
            },
            createdUsers: true,
            // Excluding password
        },
    });
}

export async function updateUserInDb(
    id: string,
    payload: Partial<{
        fullName: string;
        email: string;
        password: string;
        role: "AGENT" | "ADMIN" | "OWNER";
        status: "ACTIVE" | "DEACTIVATED" | "SUSPENDED" | "PENDING" | "EXPIRING_SOON";
        emailVerified: boolean;
        defaultCallerId: string;
    }>
) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    return prisma.user.update({
        where: { id },
        data: payload,
        select: {
            id: true,
            fullName: true,
            role: true,
            status: true,
            defaultCallerId: true,
        }
    });
}

export async function deleteUserFromDb(id: string) {
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) throwHttp(404, "User not found");

    await prisma.user.delete({ where: { id } });
    return true;
}

export async function deleteAllUsersFromDb() {
    // Caution: This deletes ALL users
    await prisma.user.deleteMany({});
    return true;
}