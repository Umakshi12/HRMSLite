import { z } from 'zod';

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Identifier required').max(100).refine(
    val => z.string().email().safeParse(val).success || /^\+?[1-9]\d{1,14}$/.test(val) || /^[a-zA-Z0-9_-]{3,50}$/.test(val),
    { message: 'Must be a valid email, phone number, or login ID' }
  ),
  password:   z.string().min(8, 'Password must be at least 8 characters').max(100),
});


// Phase 2: candidateSchema is now schema-agnostic.
// Values are coerced to strings or numbers for consistent Google Sheets RAW writing.
export const candidateSchema = z.record(z.union([
  z.string().max(2000),
  z.number(),
  z.boolean().transform(v => String(v)),
  z.null().transform(() => '')
]));

export const addCandidateSchema = z.object({
  sheet:     z.string().min(1, 'Sheet name required').max(100),
  candidate: candidateSchema,
  added_by:  z.string().max(100).optional(),
});

export const editCandidateSchema = z.object({
  sr_no:          z.union([z.string().max(20), z.number()]).optional(),
  row_index:      z.union([z.string().max(20), z.number()]).optional(),
  sheet:          z.string().min(1).max(100).optional(),
  target_sheet:   z.string().min(1).max(100).optional(),
  updated_fields: candidateSchema.optional(),
}).refine(d => d.sheet || d.target_sheet, { message: 'Sheet name is required' });

export const grantAccessSchema = z.object({
  identifier:   z.string().min(1, 'Email or phone required').max(100),
  name:         z.string().max(100).optional().default(''),
  phone:        z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone format').optional().default(''),
  role:         z.enum(['user', 'admin']).default('user'),
  plan:         z.enum(['basic', 'standard', 'pro']).optional().default('basic'),
  sheet_access: z.array(z.string().max(100)).default([]),
  tab_access:   z.array(z.object({
    spreadsheet_id: z.string().max(100),
    tab_name:       z.string().max(100),
  })).optional().default([]),
  notes:        z.string().max(500).optional().default(''),
  max_users:    z.coerce.number().min(1).max(1000).optional(),
});

export const updateProfileSchema = z.object({
  name:  z.string().min(1).max(100),
  phone: z.string().regex(/^\+?[1-9]\d{1,14}$/, 'Invalid phone format').optional(),
});

export const importCsvSchema = z.object({
  sheet:   z.string().min(1).max(100),
  mapping: z.string().max(5000).transform((val, ctx) => {
    try { return JSON.parse(val); }
    catch { ctx.addIssue({ code: 'custom', message: 'Invalid JSON' }); return z.NEVER; }
  }),
});

export const toggleUserSchema = z.object({
  target_login_id: z.string().min(1).max(100),
  status:          z.enum(['active', 'suspended', 'inactive']),
});

export const resetPasswordSchema = z.object({
  target_login_id: z.string().min(1).max(100),
  new_password:    z.string()
    .min(8, 'Minimum 8 characters')
    .max(100)
    .regex(/[0-9]/, 'Must contain at least one digit')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter'),
});

export const validateRequest = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (err) {
    if (err instanceof z.ZodError) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: err.errors.map(e => ({ path: e.path.join('.'), message: e.message }))
      });
    }
    next(err); // Pass non-Zod errors to the global error handler
  }
};
