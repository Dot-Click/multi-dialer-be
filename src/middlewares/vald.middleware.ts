import _ from 'lodash';
import { z, ZodError } from 'zod';

export function validateData(schema: z.ZodObject<any, any>, payload:any) {
    try {
      const parsedData = schema.parse(payload);
      return {data: parsedData};
    } catch (error) {
      if (error instanceof ZodError) {
        return error.issues;
      } else {
        return error;
      }
    }

}