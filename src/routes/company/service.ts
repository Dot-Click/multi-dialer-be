import prisma from "../../lib/prisma";

function throwHttp(statusCode: number, message: string): never {
    throw { message, statusCode };
}

export async function createCompanyInDb(payload: any) {
    return prisma.company.create({
        data: payload,
        include: { user: true },
    });
}

export async function getAllCompaniesFromDb() {
    return prisma.company.findMany({
        include: { user: true },
        orderBy: { createdAt: "desc" },
    });
}

export async function getCompanyByIdFromDb(id: string) {
    const company = await prisma.company.findUnique({
        where: { id },
        include: { user: true },
    });
    if (!company) throwHttp(404, "Company not found");
    return company;
}

export async function updateCompanyInDb(id: string, payload: any) {
    const existing = await prisma.company.findUnique({
        where: { id },
        select: { id: true },
    });
    if (!existing) throwHttp(404, "Company not found");

    return prisma.company.update({
        where: { id },
        data: payload,
    });
}

export async function deleteCompanyFromDb(id: string) {
    const existing = await prisma.company.findUnique({
        where: { id },
        select: { id: true },
    });
    if (!existing) throwHttp(404, "Company not found");

    await prisma.company.delete({
        where: { id },
    });

    return true;
}
