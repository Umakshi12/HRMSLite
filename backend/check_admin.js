
import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  console.log('--- ADMIN PANEL DIAGNOSTICS ---')
  
  try {
    const userCount = await prisma.user.count()
    console.log('Total Users:', userCount)
    
    const superAdmins = await prisma.user.findMany({
      where: { role: { contains: 'super', mode: 'insensitive' } }
    })
    console.log('Super Admins Found:', superAdmins.length)
    superAdmins.forEach(u => {
      console.log(`- ID: ${u.login_id}, Identifier: ${u.identifier}, Role: ${u.role}, Status: ${u.status}`)
    })

    const admins = await prisma.user.findMany({
      where: { role: { contains: 'admin', mode: 'insensitive' } }
    })
    console.log('Admins Found:', admins.length)
    
    const dashboardStats = {
      totalUsers: await prisma.user.count({ where: { role: 'user' } }),
      activeAdmins: await prisma.user.count({ where: { role: 'admin', status: 'active' } }),
      tabs: await prisma.spreadsheetTab.count()
    }
    console.log('Dashboard Stats:', dashboardStats)

    console.log('\n--- VERDICT ---')
    if (superAdmins.length === 0) {
      console.log('CRITICAL: No Super Admin found in database!')
    } else if (superAdmins.some(u => u.status !== 'active')) {
      console.log('WARNING: Some Super Admins are INACTIVE')
    } else {
      console.log('Database state looks OK for Admin Panel.')
    }

  } catch (err) {
    console.error('DIAGNOSTIC ERROR:', err)
  } finally {
    await prisma.$disconnect()
  }
}

main()
