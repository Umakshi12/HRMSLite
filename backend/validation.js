import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(3, 'Identifier is too short'),
  password: z.string().min(4, 'Password must be at least 4 characters'),
});

export const candidateSchema = z.object({
  name: z.string().min(2, 'Name is too short'),
  mobile: z.string().min(10, 'Mobile number must be at least 10 digits'),
  state: z.string().optional().or(z.literal('')),
  area: z.string().optional().or(z.literal('')),
  experience: z.string().optional().or(z.literal('')),
  education: z.string().optional().or(z.literal('')),
  dob: z.string().optional().or(z.literal('')),
  gender: z.string().optional().or(z.literal('')),
  timing: z.string().optional(),
  marital_status: z.string().optional(),
  salary: z.any().optional(), // Allow string or number
  description: z.string().optional(),
  verification: z.string().optional().default('pending'),
});

export const addCandidateSchema = z.object({
  sheet: z.string(),
  candidate: candidateSchema,
  added_by: z.any().optional()
});

export const validateRequest = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (err) {
    res.status(400).json({ 
      success: false, 
      message: 'Validation failed', 
      errors: err.errors.map(e => ({ path: e.path.join('.'), message: e.message })) 
    });
  }
};
