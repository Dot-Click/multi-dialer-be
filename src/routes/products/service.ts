import { Request, Response } from "express"
import prisma from "../../lib/prisma"
import { validateData } from "../../middlewares/vald.middleware"
import { createProductSchema } from "../../zod/products.schema"

export async function insertProductInDb(payload: any, uid: string) {
    try {
        const result = await validateData(createProductSchema, payload) as any
        if (!('data' in result)) {
            throw { errors: result }
        }
        const data = result.data
        const prod = await prisma.product.create({
            data: { ...data, userId: uid }
        })
        return prod;
    } catch (error: any) {
        throw error
    }
}

export async function updatedProductInDb(payload: any, pid: string) {
    try {
        const result = await validateData(createProductSchema.partial(), payload) as any
        if (!('data' in result)) {
            throw { errors: result }
        }
        const data = result.data
        const upd = await prisma.product.update({
            where: { id: pid },
            data: { ...data }
        })
        return upd
    } catch (error) {
        throw error
    }
}

export async function deleteProductInDb(id: string) {
    try {
        const isDel = await prisma.product.delete({
            where: { id: id }
        })
        if (isDel) {
            return true
        } else {
            return false
        }
    } catch (error) {
        throw error
    }
}
