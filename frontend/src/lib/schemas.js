import { z } from 'zod'

export const candidateSchema = z.object({
  name:           z.string().min(2, 'Name must be 2+ chars').max(100),
  mobile:         z.string().min(10, 'Must be at least 10 digits'),
  dob:            z.string().optional().or(z.literal('')),
  gender:         z.string(),
  address:        z.string().max(200).optional().default(''),
  state:          z.string().optional().default(''),
  area:           z.string().max(100).optional().default(''),
  marital_status: z.string().optional(),
  timing:         z.string().optional().default(''),
  experience:     z.string(),
  education:      z.string(),
  salary:         z.coerce.number().min(0).max(999999).default(0),
  verification:   z.string().optional().default('not verified'),
  description:    z.string().max(500).optional().default(''),
  since:          z.string().optional().or(z.literal('')),
  sheet:          z.string().min(1, 'Category is required'),
})

export const loginSchema = z.object({
  identifier: z.string().min(1, 'Required'),
  password:   z.string().min(1, 'Required'),
})

export const grantAccessSchema = z.object({
  name:         z.string().min(2, 'Full name is required (min 2 chars)'),
  identifier:   z.string().min(1, 'Email or phone required'),
  phone:        z.string().optional().or(z.literal('')),
  role:         z.enum(['user', 'admin']),
  sheet_access: z.array(z.string()).default([]),
  notes:        z.string().optional().default(''),
  max_users:    z.coerce.number().min(1).max(500).optional().default(10),
})

