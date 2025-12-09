import { Request, Response } from "express"
import { cloudinaryUploader, errorResponse, successResponse } from "../../utils/handler"
import prisma from "../../lib/prisma"
import { insertProductInDb, updatedProductInDb, deleteProductInDb } from "./service"


export const getAllProducts = async (req: Request, res: Response): Promise<any> => {
    try {
        const prods = await prisma.product.findMany()
        successResponse(res, 200, 'products fetched', prods)
    } catch (error: any) {
        errorResponse(res, error.message, 500)
    }
}

export const getProductById = async (req: Request, res: Response): Promise<any> => {
    try {
        const {id} = req.params
        const prod = await prisma.product.findUnique({
            where: {
                id: id
            }
        })
        if (prod) {
            return successResponse(res, 200, 'product fetched', prod)
        }
        return errorResponse(res, "product not found", 404)
    } catch (error: any) {
        return errorResponse(res, error.message, 500)
    }

}

export const createProduct = async (req: Request, res: Response): Promise<any> => {
    try {
        const {id} = req.user!
        const payload = {...req.body}
        if(req.files){
            const fileFields = req.files as { [fieldname: string]: Express.Multer.File[] }
            const thumbnailUpload = await cloudinaryUploader(fileFields['file1']?.[0]?.path)
            payload.thumbnail = thumbnailUpload?.secure_url
            const imageUploads = await Promise.all(Object.values(fileFields).flat().map((file: any) => cloudinaryUploader(file.path)))
            payload.images = imageUploads.map((result: any) => result.secure_url)
        }
        const prod = await insertProductInDb(payload, id)
       return successResponse(res,200,'created', prod)
    } catch (error: any) {
        return errorResponse(res, error)
    }
}

export const updateProduct = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params
        const payload = {...req.body} 
        const upd_prod = await updatedProductInDb(payload, id)
        if (upd_prod) {
            return successResponse(res, 200, 'product updated', upd_prod)
        }
        return errorResponse(res, "product not found", 404)
    } catch (error: any) {
        return errorResponse(res, error.message, 500)

    }
}

export const deleteProduct = async (req: Request, res: Response): Promise<any> => {
    try {
        const { id } = req.params
       const isDel = await deleteProductInDb(id)
        if (isDel) {
            return successResponse(res, 201, 'product deleted')
        } else {
            return errorResponse(res, "product not found", 404)
        }
    } catch (error: any) {
        return errorResponse(res, error.message, 500)
    }
}