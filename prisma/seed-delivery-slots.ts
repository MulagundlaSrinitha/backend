import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding delivery slots and zone pincodes...');

  // Get existing zones
  const zones = await prisma.zone.findMany();
  
  if (zones.length === 0) {
    console.log('No zones found. Creating default zones...');
    const hyderabad = await prisma.zone.create({
      data: {
        name: 'Hyderabad',
        city: 'Hyderabad',
        pincodes: ['500001', '500002', '500003', '500004', '500005', '500006', '500007', '500008', '500009', '500010',
                   '500011', '500012', '500013', '500014', '500015', '500016', '500017', '500018', '500019', '500020',
                   '500021', '500022', '500023', '500024', '500025', '500026', '500027', '500028', '500029', '500030',
                   '500031', '500032', '500033', '500034', '500035', '500036', '500037', '500038', '500039', '500040',
                   '500041', '500042', '500043', '500044', '500045', '500046', '500047', '500048', '500049', '500050',
                   '500051', '500052', '500053', '500054', '500055', '500056', '500057', '500058', '500059', '500060',
                   '500061', '500062', '500063', '500064', '500065', '500066', '500067', '500068', '500069', '500070',
                   '500071', '500072', '500073', '500074', '500075', '500076', '500077', '500078', '500079', '500080',
                   '500081', '500082', '500083', '500084', '500085', '500086', '500087', '500088', '500089', '500090',
                   '500091', '500092', '500093', '500094', '500095', '500096', '500097', '500098', '500099', '500100',
                   '500101', '500102', '500103', '500104'],
        isActive: true,
      },
    });

    const vijayawada = await prisma.zone.create({
      data: {
        name: 'Vijayawada',
        city: 'Vijayawada',
        pincodes: ['520001', '520002', '520003', '520004', '520005', '520006', '520007', '520008', '520009', '520010',
                   '520011', '520012', '520013', '520014', '520015', '520016', '520017', '520018', '520019', '520020',
                   '521001', '521002', '521003', '521004', '521005', '521006', '521007', '521008', '521009', '521010',
                   '521011', '521012', '521013', '521014', '521015', '521016', '521017', '521018', '521019', '521020',
                   '521021', '521022', '521023', '521024', '521025', '521026', '521027', '521028', '521029', '521030',
                   '521031', '521032', '521033', '521034', '521035', '521036', '521037', '521038', '521039', '521040'],
        isActive: true,
      },
    });

    zones.push(hyderabad, vijayawada);
    console.log(`Created ${zones.length} zones with pincodes`);
  }

  // Create delivery slot configs for each zone
  const timeSlots = [
    { startTime: '09:00', endTime: '12:00', maxOrders: 20 },
    { startTime: '12:00', endTime: '15:00', maxOrders: 25 },
    { startTime: '15:00', endTime: '18:00', maxOrders: 20 },
    { startTime: '18:00', endTime: '21:00', maxOrders: 15 },
  ];

  for (const zone of zones) {
    // Check if slots already exist for this zone
    const existingSlots = await prisma.deliverySlotConfig.count({
      where: { zoneId: zone.id },
    });

    if (existingSlots > 0) {
      console.log(`Slots already exist for ${zone.name}, skipping`);
      continue;
    }

    // Create slots for all 7 days of the week
    for (let day = 0; day < 7; day++) {
      for (const slot of timeSlots) {
        await prisma.deliverySlotConfig.create({
          data: {
            zoneId: zone.id,
            dayOfWeek: day,
            startTime: slot.startTime,
            endTime: slot.endTime,
            maxOrders: slot.maxOrders,
            isActive: true,
          },
        });
      }
    }

    console.log(`Created ${timeSlots.length * 7} delivery slots for ${zone.name}`);
  }

  // Also update existing zones with pincodes if missing
  for (const zone of zones) {
    const currentZone = await prisma.zone.findUnique({ where: { id: zone.id } });
    if (currentZone && (!currentZone.pincodes || currentZone.pincodes.length === 0)) {
      const defaultPincodes = zone.city === 'Hyderabad'
        ? ['500001', '500010', '500020', '500030', '500040', '500050', '500060', '500070', '500080', '500090', '500100']
        : ['520001', '520010', '520020', '520030', '520040', '520050', '521001', '521010', '521020', '521030', '521040'];
      
      await prisma.zone.update({
        where: { id: zone.id },
        data: { pincodes: defaultPincodes },
      });
    }
  }

  console.log('✅ Seed complete!');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
