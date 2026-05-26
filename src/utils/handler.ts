import { Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";
import fs from "fs";
import swaggerUi from "swagger-ui-express";
import { OpenAPIV3 } from "openapi-types";
import { auth } from "../lib/auth";
import { SwaggerTheme, SwaggerThemeNameEnum } from "swagger-themes";

// Helper function to find api-doc.yaml in both dev and production
function findApiDocPath(): string {
  // Try dist/utils first (production)
  const distPath = path.join(__dirname, "api-doc.yaml");
  if (fs.existsSync(distPath)) {
    return distPath;
  }
  
  // Try src/utils (development)
  const srcPath = path.join(__dirname, "..", "..", "src", "utils", "api-doc.yaml");
  if (fs.existsSync(srcPath)) {
    return srcPath;
  }
  
  // Fallback: try relative to process.cwd()
  const rootPath = path.join(process.cwd(), "src", "utils", "api-doc.yaml");
  if (fs.existsSync(rootPath)) {
    return rootPath;
  }
  
  throw new Error(`api-doc.yaml not found. Tried: ${distPath}, ${srcPath}, ${rootPath}`);
}


/**
 * Standard success response handler
 * @param {Object} res - Express response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Success message
 * @param {Object} data - Response data
 */
export const successResponse = (res: Response, statusCode: number = 200, message: string = 'Success', data: any = null) => {
    const response = {
      success: true,
      message,
      ...(data && { data }),
    };
    return res.status(statusCode).json(response);
  };
  
/**
   * Standard error response handler
   * @param {Object} res - Express response object
   * @param {Error} error - Error object
*/
export const errorResponse = (res: Response, error: any, statusCode = 500) => {
    // Handle Zod validation errors
    if (error.errors) {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: error.errors,
      });
    }
  
    // Handle string messages directly
    const message = typeof error === 'string' ? error : (error.message || 'Internal server error');
  
    return res.status(statusCode).json({
      success: false,
      message,
    });
  };

const swaggerDocument = yaml.load(fs.readFileSync(findApiDocPath(), "utf8")) as OpenAPIV3.Document;

const theme = new SwaggerTheme();

export const swaggerDocs = async (app: any) => {
    let betterAuthSpec: OpenAPIV3.Document | null = null;
  
    try {
      const openAPISchema = await auth.api.generateOpenAPISchema() as OpenAPIV3.Document;
  
      const transformedPaths: OpenAPIV3.PathsObject = {};
      for (const [path, pathObj] of Object.entries(openAPISchema.paths || {})) {
        transformedPaths[`/api/auth${path}`] = pathObj;
      }
  
      const transformedTags: OpenAPIV3.TagObject[] = [
        {
          name: "Authentication (Powered by betterAuth)",
        },
      ];
  
      for (const pathKey of Object.keys(transformedPaths)) {
        const methods = transformedPaths[pathKey] as OpenAPIV3.PathItemObject;
        for (const methodKey of Object.keys(methods)) {
          const operation = (methods as any)[methodKey];
          if (operation && operation.tags) {
            operation.tags = ["Authentication (Powered by betterAuth)"];
          }
        }
      }
  
      betterAuthSpec = {
        ...openAPISchema,
        paths: transformedPaths,
        tags: transformedTags,
      };
    } catch (e) {
      console.warn("⚠️ Could not fetch BetterAuth docs, showing only custom routes.");
    }
  
    // Manual merge
    const mergedSpec: any = {
      ...swaggerDocument,
      paths: {
        ...(betterAuthSpec?.paths || {}),
        ...(swaggerDocument.paths || {}),
      },
      tags: [
        ...(betterAuthSpec?.tags || []),
        ...(swaggerDocument.tags || []),
      ]
    };
  
    app.use(
      "/api-docs",
      swaggerUi.serve,
      swaggerUi.setup(mergedSpec, {
        customCss: theme.getBuffer(SwaggerThemeNameEnum.DRACULA),
        customSiteTitle: "CallScout API Documentation",
        customfavIcon: "/favicon.ico",
        swaggerOptions: {
          docExpansion: "list",
          filter: true,
          showRequestHeaders: true,
          showCommonExtensions: true,
          displayRequestDuration: true,
          tryItOutEnabled: true,
          defaultModelsExpandDepth: 2,
          defaultModelExpandDepth: 2,
        },
      })
    );
  
    console.log("Docs: http://localhost:3000/api-docs");
};

export const cloudinaryUploader = async (_filePath: string) => {
  // DEPRECATED: Cloudinary has been replaced with Cloudflare R2.
  // Use uploadToR2 from utils/r2-uploader.ts instead.
  throw new Error("cloudinaryUploader is deprecated. Use uploadToR2 from utils/r2-uploader.ts instead.");
};
