import multer from "multer";
import { Request, Response, NextFunction } from "express";
import { errorResponse } from "../utils/handler";

const storage = multer.diskStorage({
  destination: "./uploads",
  filename: (req, file, cb) => {
    cb(null, `${file.originalname}`);
  },
});

/**
 * Middleware for handling multiple file uploads using Multer.
 *
 * This middleware stores uploaded files in the `./upload` directory
 * and names them using the current timestamp followed by the original filename.
 *
 * @module uploadMiddleware
 */
const upload = (req: Request, res: Response, next: NextFunction) => {
  multer({
    storage,
    limits: {
      fileSize: 12 * 1024 * 1024,
    },
  }).fields([
    { name: "file1", maxCount: 1 },
    { name: "file2", maxCount: 1 },
    { name: "file3", maxCount: 1 },
    { name: "file4", maxCount: 1 },
  ])(req, res, (err) => {
    if (err) {
      return errorResponse(res, err.message, 400);
    }
    next();
  });
};

/**
 * Middleware for handling single file uploads using Multer.
 *
 * This middleware stores uploaded files fetched by specific key in the `./upload` directory
 * and names them using the current timestamp followed by the original filename.
 *
 * @module uploadMiddleware
 */

const singleUpload = (fieldName: string, allowedMimeTypes: string[] | null = null, maxFileSize: number = 5 * 1024 * 1024) => (req: Request, res: Response, next: NextFunction) => {
  multer({
    storage,
    limits: {
      fileSize: maxFileSize,
    },
    fileFilter: (req: Request, file: Express.Multer.File, cb: any) => {
      // If specific MIME types are allowed, validate them
      if (allowedMimeTypes) {
        if (allowedMimeTypes.includes(file.mimetype)) {
          cb(null, true);
        } else {
          cb(new Error(`Invalid file type. Allowed types: ${allowedMimeTypes.join(', ')}`), false);
        }
      } else {
        cb(null, true);
      }
    },
  }).single(fieldName)(req, res, (err) => {
    if (err) {
     return res.status(400).json({ message: err.message });
    }
    next();
  });
};



export {upload, singleUpload};