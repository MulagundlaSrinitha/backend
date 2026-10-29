import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create default roles with permissions
  const adminRole = await prisma.role.upsert({
    where: { name: 'Admin' },
    update: {},
    create: {
      name: 'Admin',
      description: 'Full system access',
      isSystem: true,
      permissions: ['*'],
    },
  });

  await prisma.role.upsert({
    where: { name: 'Vendor' },
    update: {},
    create: {
      name: 'Vendor',
      description: 'Vendor dashboard access',
      isSystem: true,
      permissions: ['products:*', 'orders:read', 'orders:update', 'inventory:*'],
    },
  });

  await prisma.role.upsert({
    where: { name: 'Delivery Partner' },
    update: {},
    create: {
      name: 'Delivery Partner',
      description: 'Delivery app access',
      isSystem: true,
      permissions: ['deliveries:*', 'earnings:read'],
    },
  });

  // Create basic permissions
  const resources = ['users', 'vendors', 'products', 'categories', 'orders', 'payments', 'coupons', 'offers', 'reviews', 'cms', 'notifications'];
  const actions = ['create', 'read', 'update', 'delete', 'manage'];

  for (const resource of resources) {
    for (const action of actions) {
      await prisma.permission.upsert({
        where: { name: `${resource}:${action}` },
        update: {},
        create: {
          name: `${resource}:${action}`,
          resource,
          action,
        },
      });
    }
  }

  // Create default CMS pages
  const pages = [
    { title: 'About Us', slug: 'about-us', content: '# About Next360\n\nNext360 is your premier destination for organic, natural, and eco-friendly products.', isPublished: true },
    { title: 'Privacy Policy', slug: 'privacy-policy', content: '# Privacy Policy\n\nYour privacy is important to us.', isPublished: true },
    { title: 'Terms & Conditions', slug: 'terms-conditions', content: '# Terms & Conditions\n\nPlease read these terms carefully.', isPublished: true },
    { title: 'FAQ', slug: 'faq', content: '# Frequently Asked Questions\n\n## How do I place an order?\n\nBrowse products, add to cart, and checkout.', isPublished: true },
  ];

  for (const page of pages) {
    await prisma.cMS_Page.upsert({
      where: { slug: page.slug },
      update: {},
      create: page,
    });
  }

  // Create zones
  const zones = [
    { name: 'Hyderabad', city: 'Hyderabad' },
    { name: 'Vijayawada', city: 'Vijayawada' },
  ];

  for (const zone of zones) {
    await prisma.zone.upsert({
      where: { id: zone.name },
      update: {},
      create: { id: zone.name, ...zone },
    });
  }

  // Create initial categories for each store type
  const categories = [
    // Organic
    { name: 'Fruits & Vegetables', slug: 'fruits-vegetables', storeType: 'ORGANIC' as const },
    { name: 'Grains & Pulses', slug: 'grains-pulses', storeType: 'ORGANIC' as const },
    { name: 'Dairy & Eggs', slug: 'dairy-eggs', storeType: 'ORGANIC' as const },
    // Natural
    { name: 'Skincare', slug: 'skincare', storeType: 'NATURAL' as const },
    { name: 'Hair Care', slug: 'hair-care', storeType: 'NATURAL' as const },
    { name: 'Wellness', slug: 'wellness', storeType: 'NATURAL' as const },
    // Eco-friendly
    { name: 'Home Decor', slug: 'home-decor', storeType: 'ECO_FRIENDLY' as const },
    { name: 'Kitchen & Dining', slug: 'kitchen-dining', storeType: 'ECO_FRIENDLY' as const },
    { name: 'Cleaning', slug: 'cleaning', storeType: 'ECO_FRIENDLY' as const },
  ];

  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug_storeType: { slug: cat.slug, storeType: cat.storeType } },
      update: {},
      create: cat,
    });
  }

  console.log('✅ Seed completed successfully');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
