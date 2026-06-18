import prisma from "@/lib/prisma";
import { ensureTrashFolder } from "../../contact/service";

// Protected default dispositions: seeded for every account, shown in the user's
// Dispositions list (NOT as system "Call Outcomes"), and cannot be edited or
// deleted. Matched by their `value`.
const PROTECTED_DEFAULT_VALUES = ["TRASH"];

export function isProtectedDispositionValue(value?: string | null) {
    return !!value && PROTECTED_DEFAULT_VALUES.includes(value.toUpperCase());
}

export class DispositionService {
    static async getDispositions(userId: string) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, get their admin's settings
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        let systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId },
            include: { dispositions: { orderBy: { order: 'asc' } } }
        });

        if (!systemSetting) {
            systemSetting = await prisma.system_Setting.create({
                data: { userId: targetUserId },
                include: { dispositions: { orderBy: { order: 'asc' } } }
            });
        }

        const mojoDefaults = [
            { label: "Contacted", value: "CONTACT", color: "green", icon: "Users", isSystem: true, isActive: true, order: 1 },
            { label: "No Answer", value: "NO_ANSWER", color: "red", icon: "PhoneOff", isSystem: true, isActive: true, order: 2 },
            { label: "Bad Number", value: "BAD_NUMBER", color: "gray", icon: "XCircle", isSystem: true, isActive: true, order: 3 },
            { label: "Voicemail", value: "VOICEMAIL", color: "blue", icon: "Mail", isSystem: true, isActive: true, order: 4 },
            { label: "DNC - Contact", value: "DNC_CONTACT", color: "orange", icon: "Ban", isSystem: true, isActive: true, order: 5 },
            { label: "DNC - Number", value: "DNC_NUMBER", color: "orange", icon: "Ban", isSystem: true, isActive: true, order: 6 },
        ];

        // 1. Cleanup: Remove old system dispositions that are no longer in our defaults list
        const allowedSystemValues = mojoDefaults.map(d => d.value);
        const systemDispsToRemove = systemSetting.dispositions.filter(d => d.isSystem && !allowedSystemValues.includes(d.value));

        if (systemDispsToRemove.length > 0) {
            await prisma.disposition.deleteMany({
                where: { id: { in: systemDispsToRemove.map(d => d.id) } }
            });
            // Re-fetch before proceeding to sync
            systemSetting = await prisma.system_Setting.findFirst({
                where: { userId: targetUserId },
                include: { dispositions: { orderBy: { order: 'asc' } } }
            }) ?? systemSetting;
        }

        // 2. Sync: Ensure these Mojo-standard defaults exist and are up-to-date
        for (const def of mojoDefaults) {
            const existing = systemSetting.dispositions.find(d => d.value === def.value);
            if (!existing) {
                await prisma.disposition.create({
                    data: { ...def, systemSettingId: systemSetting.id }
                });
            } else if (existing.isSystem && (existing.label !== def.label || existing.color !== def.color || existing.icon !== def.icon)) {
                // Update existing system disposition if defaults changed
                await prisma.disposition.update({
                    where: { id: existing.id },
                    data: { label: def.label, color: def.color, icon: def.icon }
                });
            }
        }

        // 2b. Ensure the protected default "Trash" disposition exists. It is NOT a
        //     system call-outcome — it lives in the user's Dispositions list — but it
        //     is seeded by default and cannot be edited/deleted. It links to the
        //     system "Trash" folder so applying it moves the contact there and out of
        //     every list.
        const existingTrash = systemSetting.dispositions.find(d => d.value === "TRASH");
        if (!existingTrash || !existingTrash.targetFolderId) {
            const trashFolder = await ensureTrashFolder(targetUserId);
            if (!existingTrash) {
                await prisma.disposition.create({
                    data: {
                        label: "Trash",
                        value: "TRASH",
                        color: "gray",
                        icon: "Trash2",
                        isSystem: false,
                        isActive: true,
                        order: 99,
                        targetFolderId: trashFolder ? trashFolder.id : null,
                        systemSettingId: systemSetting.id,
                    }
                });
            } else if (trashFolder && !existingTrash.targetFolderId) {
                await prisma.disposition.update({
                    where: { id: existingTrash.id },
                    data: { targetFolderId: trashFolder.id },
                });
            }
        }

        // 3. Final Fetch: Return the clean synced list
        systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId },
            include: { dispositions: { orderBy: { order: 'asc' } } }
        }) ?? systemSetting;

        return systemSetting.dispositions;
    }

    static async createDisposition(userId: string, data: any) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, use their admin's id
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        const systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId }
        });

        if (!systemSetting) throw new Error("System settings not found");

        const { autoCreateFolder, ...dispositionData } = data;

        let targetFolderId = dispositionData.targetFolderId ?? null;

        // Auto-create a folder named after this disposition
        if (autoCreateFolder) {
            const newFolder = await prisma.contactFolder.create({
                data: {
                    name: dispositionData.label,
                    isSystem: false,
                    listIds: [],
                    userId: targetUserId,
                }
            });
            targetFolderId = newFolder.id;
        }

        return await prisma.disposition.create({
            data: {
                ...dispositionData,
                targetFolderId,
                systemSettingId: systemSetting.id
            }
        });
    }

    static async updateDisposition(id: string, data: any) {
        const target = await prisma.disposition.findUnique({
            where: { id },
            select: { value: true }
        });
        if (isProtectedDispositionValue(target?.value)) {
            throw new Error("The default Trash disposition cannot be modified");
        }

        const { autoCreateFolder, ...updateData } = data;

        if (autoCreateFolder) {
            // Only create a new folder if one isn't already linked
            const existing = await prisma.disposition.findUnique({
                where: { id },
                select: { targetFolderId: true, systemSettingId: true, label: true }
            });

            if (existing && !existing.targetFolderId) {
                // Get the userId from the systemSetting
                const systemSetting = await prisma.system_Setting.findUnique({
                    where: { id: existing.systemSettingId },
                    select: { userId: true }
                });

                if (systemSetting) {
                    const newFolder = await prisma.contactFolder.create({
                        data: {
                            name: updateData.label || existing.label,
                            isSystem: false,
                            listIds: [],
                            userId: systemSetting.userId,
                        }
                    });
                    updateData.targetFolderId = newFolder.id;
                }
            }
            // If already linked, keep existing targetFolderId (don't overwrite)
        }

        return await prisma.disposition.update({
            where: { id },
            data: updateData
        });
    }

    static async deleteDisposition(id: string) {
        const disposition = await prisma.disposition.findUnique({ where: { id } });
        if (disposition?.isSystem) throw new Error("Cannot delete system disposition");
        if (isProtectedDispositionValue(disposition?.value)) {
            throw new Error("The default Trash disposition cannot be deleted");
        }

        return await prisma.disposition.delete({
            where: { id }
        });
    }

    static async reorderDispositions(userId: string, orderData: { id: string, order: number }[]) {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { role: true, createdById: true }
        });

        // If user is AGENT, get their admin's id
        const targetUserId = (user?.role === 'AGENT' && user?.createdById) ? user.createdById : userId;

        // Verify the system setting exists and is associated with the target
        const systemSetting = await prisma.system_Setting.findFirst({
            where: { userId: targetUserId }
        });

        if (!systemSetting) throw new Error("System settings not found");

        return await prisma.$transaction(
            orderData.map(item =>
                prisma.disposition.update({
                    where: { id: item.id },
                    data: { order: item.order }
                })
            ))
    }

    static async applyDisposition(params: {
        contactId: string;
        dispositionId: string;
        appliedById: string;
        overrideFolderId?: string;
        callRecordId?: string;
        source: 'CALL' | 'MANUAL';
    }) {
        const { contactId, dispositionId, appliedById, overrideFolderId, callRecordId, source } = params;

        // 1. Fetch disposition to get its default targetFolderId
        const disposition = await prisma.disposition.findUniqueOrThrow({
            where: { id: dispositionId }
        });

        // 2. Resolve which folder to drop contact into
        const resolvedFolderId = overrideFolderId ?? disposition.targetFolderId ?? null;

        console.log(`[applyDisposition] contact=${contactId} disposition=${disposition.label} resolvedFolderId=${resolvedFolderId ?? 'none'}`);

        // 3. Move contact: set folderIds to only the resolved folder, and remove from all lists
        if (resolvedFolderId) {
            // 3a. Remove contact from every list it currently belongs to
            const listsContainingContact = await prisma.contactList.findMany({
                where: { contactIds: { has: contactId } },
                select: { id: true, contactIds: true }
            });
            if (listsContainingContact.length > 0) {
                console.log(`[applyDisposition] Removing contact from ${listsContainingContact.length} list(s)`);
                await Promise.all(listsContainingContact.map(list =>
                    prisma.contactList.update({
                        where: { id: list.id },
                        data: { contactIds: list.contactIds.filter(id => id !== contactId) }
                    })
                ));
            }

            // 3b. Set contact's folderIds to only the disposition folder
            await prisma.contact.update({
                where: { id: contactId },
                data: { folderIds: [resolvedFolderId] }
            });

            console.log(`[applyDisposition] Contact moved to folder ${resolvedFolderId}, removed from all lists`);
        }

        // 4. Always log the disposition application (reporting needs CALL-sourced
        //    dispositions too — e.g. "Contact" must count as a contact in reports).
        await prisma.contactDispositionLog.create({
            data: {
                contactId,
                dispositionId,
                appliedById,
                folderId: resolvedFolderId
            }
        });

        // 5. If CALL — update CallRecord with dispositionId + overrideFolderId
        if (source === 'CALL' && callRecordId) {
            await prisma.callRecord.update({
                where: { id: callRecordId },
                data: {
                    dispositionId,
                    overrideFolderId: overrideFolderId ?? null
                }
            });
        }

        return { success: true, folderId: resolvedFolderId };
    }
}
